import { sportsFallbackArtwork } from "../data/sports/artwork.ts";
import { buildSportsMatchArtwork, splitSportsMatchTitle } from "../utils/sportsMatchCards.ts";
import { replayMatchesPreferences, replayParticipantsMatchFollows } from "../data/sports/board.ts";
import { disciplineFromLabels } from "../data/sports/identity.ts";
import { getSportsPreferences, hasAnyFollow } from "../data/sports/preferences.ts";
import { AVAILABLE_STREAMS_KEY, availableStreamsMediaKey, SELECTED_MEDIA_META_KEY, SELECTED_STREAM_KEY } from "../pages/Player/utils.ts";
import { cleanMetaName, fetchStreams, humanizeSport, stremioStreamToLiveSource, type StremioMeta } from "../types/stremioSports.ts";
import type { MediaStream } from "../types/stream.ts";
import type { MediaItem } from "../types/ui.ts";
import {
  buildSportsReplayPlan,
  decodeReplayPageHandle,
  encodeReplayPageHandle,
  type SportsReplayPlan,
} from "./sportsReplayCollections.ts";
import { DEFAULT_NUVIO_SPORTS_PROFILE, ensureLocalNuvioSportsServer, readNuvioSportsMode } from "./nuvioSportsRuntime.ts";
import { nuvioSportsBaseUrl } from "./stremioSportsProviders.ts";

const PAGE_SIZE = 100;
const STREAM_RESOLUTION_CONCURRENCY = 6;
/** Cola genérica del addon: repeticiones de todo, sin carpeta. */
const GENERIC_REPLAY_CATALOG = "nuvio_sports_catalog/genre=Replays";

export interface SportsReplayItem extends MediaItem {
  requestId: string;
  requestType?: string;
  /** Streams verified while loading the page, reused when playback starts. */
  streams?: MediaStream[];
}

export interface SportsReplaysPage {
  items: SportsReplayItem[];
  hasMore: boolean;
  nextSkip: number;
  /** An empty local catalog is not final while archive discovery is running. */
  pending: boolean;
}

export interface SportsReplayPlanPage {
  items: SportsReplayItem[];
  /**
   * Siguiente página del plan (fuente+skip codificados) o `null` cuando ya no
   * queda nada: ni esta fuente ni las que vienen tienen más repeticiones.
   */
  nextPage: number | null;
  pending: boolean;
}

/** Reuse the selected instance without applying live-only sports or replay filters. */
export function getSportsReplaysBaseUrl(): string {
  const url = new URL(nuvioSportsBaseUrl());
  const parts = url.pathname.replace(/\/manifest\.json$/, "").split("/").filter(Boolean);
  let config: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(decodeURIComponent(parts[parts.length - 1] ?? ""));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      config = value as Record<string, unknown>;
      parts.pop();
    }
  } catch { /* A bare origin or reverse-proxy prefix has no config to replace. */ }
  parts.push(encodeURIComponent(JSON.stringify({ ...DEFAULT_NUVIO_SPORTS_PROFILE, ...config, sports: "all", replayFilter: "all" })));
  url.pathname = `/${parts.join("/")}`;
  return url.toString().replace(/\/$/, "");
}

function replayMediaItem(meta: StremioMeta): SportsReplayItem {
  const name = cleanMetaName(meta.name, "Repetición deportiva");
  const sport = humanizeSport(meta.genres?.[0]);
  const fallback = sportsFallbackArtwork({ title: name, sport: "futbol" }, sport || "Repetición");
  // Cast is opponent metadata only on versus entries, not F1/date/tournament hubs.
  const opponents = splitSportsMatchTitle(name) && meta.cast?.length === 2 ? meta.cast : undefined;
  return {
    id: `replay:${meta.id}`,
    requestId: meta.id,
    requestType: meta.type || "tv",
    type: "sports-replay",
    name,
    poster: meta.poster || meta.background || fallback,
    background: meta.background || meta.poster || fallback,
    originalPoster: fallback,
    sportsMatch: buildSportsMatchArtwork({
      title: name,
      sport: meta.genres?.[0],
      competitionName: meta.genres?.slice(1).join(" "),
      home: opponents?.[0] ? { name: opponents[0] } : undefined,
      away: opponents?.[1] ? { name: opponents[1] } : undefined,
    }),
    genres: ["Repetición", ...(meta.genres ?? []).map(humanizeSport)],
    description: meta.description,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

interface ReplayCatalogResponse {
  metas: StremioMeta[];
  /** An empty local catalog is not final while archive discovery is running. */
  pending: boolean;
}

/**
 * Lee una página de un catálogo de repeticiones. La ruta ya lleva el id
 * (con `genre=Replays` opcional incluido) y el skip va dentro del mismo
 * segmento, como exige la ruta del addon: `/catalog/tv/<id>[&<extras>].json`.
 */
async function loadReplayCatalog(catalogPath: string, skip: number, requestSignal: AbortSignal): Promise<ReplayCatalogResponse> {
  // nuvio_sports_replays returns series/date hubs, not playable replay cards;
  // the playable ones live in nuvio_sports_catalog and the collection catalogs.
  const response = await fetch(`${getSportsReplaysBaseUrl()}/catalog/tv/${catalogPath}&skip=${skip}.json`, { signal: requestSignal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: { metas?: StremioMeta[] } = await response.json();
  if (!Array.isArray(payload?.metas)) throw new Error("Catálogo no válido");
  const metas = payload.metas;
  let pending = false;
  if (skip === 0 && metas.length === 0 && readNuvioSportsMode() === "local") {
    const health = await fetch("http://127.0.0.1:7310/api/provider-health", {
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(2000)]),
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const status = await health.json();
    pending = status?.sync?.state === "running";
  }
  return { metas, pending };
}

/**
 * Personalización de las repeticiones, igual que las filas de la home: los
 * deportes elegidos acotan el tipo y lo seguido (competición, club,
 * selección, organización, peleador) acota por título y participantes,
 * porque el addon no da id canónico. Quien no eligió nada ve todo el
 * catálogo. Se filtra antes de resolver fuentes para no gastar peticiones
 * en repeticiones que van a descartarse; y una repetición de lo seguido
 * entra aunque el addon no declare el deporte.
 *
 * `bypassPrefFilter` se usa cuando la página entera procede de un catálogo
 * curado por una competición seguida: se pidió porque el usuario sigue esa
 * competición, así que no vuelve a filtrarse meta por meta.
 */
function filterReplayMetas(metas: StremioMeta[], bypassPrefFilter: boolean): StremioMeta[] {
  if (bypassPrefFilter) return metas.filter(meta => meta && typeof meta.id === "string" && meta.id);
  const prefs = getSportsPreferences();
  const followGate = hasAnyFollow(prefs);
  const sportGate = prefs.sports.length > 0;
  if (!followGate && !sportGate) return metas.filter(meta => meta && typeof meta.id === "string" && meta.id);
  const replayMetas = metas.filter(meta => meta && typeof meta.id === "string" && meta.id);
  return replayMetas.filter(meta => {
    const name = cleanMetaName(meta.name, "");
    if (followGate && !replayMatchesPreferences(name, prefs) && !replayParticipantsMatchFollows(name, prefs)) return false;
    if (!sportGate) return true;
    const discipline = disciplineFromLabels(meta.genres ?? []);
    return discipline ? prefs.sports.includes(discipline) : Boolean(followGate);
  });
}

async function resolveReplayMetas(metas: StremioMeta[], requestSignal: AbortSignal): Promise<SportsReplayItem[]> {
  const resolvedItems = await mapWithConcurrency(metas, STREAM_RESOLUTION_CONCURRENCY, async meta => {
    if (requestSignal.aborted) throw requestSignal.reason ?? new Error("Carga de repeticiones cancelada.");
    const replay = replayMediaItem(meta);
    try {
      const streams = await getSportsReplayStreams(replay);
      return { ...replay, streams };
    } catch (cause) {
      if (requestSignal.aborted) throw cause;
      // A broken or empty individual replay must not hide other cards on this page.
      return null;
    }
  });
  if (requestSignal.aborted) throw requestSignal.reason ?? new Error("Carga de repeticiones cancelada.");
  return resolvedItems.filter(item => item !== null);
}

/** Cola genérica: `nuvio_sports_catalog genre=Replays`, paginada por skip. */
export async function fetchSportsReplaysPage(skip = 0, signal?: AbortSignal): Promise<SportsReplaysPage> {
  await ensureLocalNuvioSportsServer();
  const offset = Number.isFinite(skip) ? Math.max(0, Math.floor(skip)) : 0;
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
  try {
    const page = await loadReplayCatalog(GENERIC_REPLAY_CATALOG, offset, requestSignal);
    const personalizedMetas = filterReplayMetas(page.metas, false);
    const items = await resolveReplayMetas(personalizedMetas, requestSignal);
    return {
      items,
      hasMore: page.metas.length >= PAGE_SIZE,
      nextSkip: offset + page.metas.length,
      pending: page.pending,
    };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(`No se pudieron cargar las repeticiones. ${cause instanceof Error ? cause.message : "Reintenta la carga."}`);
  }
}

function nextSourceHandle(plan: SportsReplayPlan, sourceIndex: number): number | null {
  return sourceIndex + 1 < plan.sources.length ? encodeReplayPageHandle(sourceIndex + 1, 0) : null;
}

async function readReplayPlanPage(plan: SportsReplayPlan, pageIndex: number, signal?: AbortSignal): Promise<SportsReplayPlanPage> {
  const { sourceIndex, skip } = decodeReplayPageHandle(pageIndex);
  const source = plan.sources[sourceIndex];
  if (!source) {
    // Dirección más allá del plan: la paginación terminó en una página anterior.
    return { items: [], nextPage: null, pending: false };
  }
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
  const catalogPath = source.kind === "generic" ? GENERIC_REPLAY_CATALOG : source.catalogId;
  const page = await loadReplayCatalog(catalogPath, skip, requestSignal);
  const bypassPrefFilter = source.kind === "catalog" && Boolean(source.competitionId);
  const metas = filterReplayMetas(page.metas, bypassPrefFilter);
  const items = await resolveReplayMetas(metas, requestSignal);
  const exhausted = page.metas.length < PAGE_SIZE;
  if (page.pending || !exhausted || items.length) {
    const nextPage = exhausted ? nextSourceHandle(plan, sourceIndex) : encodeReplayPageHandle(sourceIndex, skip + page.metas.length);
    return { items, nextPage: nextPage ?? null, pending: page.pending };
  }
  // La fuente se agotó sin entregar ni una repetición que valga: la carga
  // avanza sola a la siguiente fuente del plan, en vez de plantar un botón
  // "Cargar más" para una fuente que ya no tiene nada nuevo que dar.
  const nextHandle = nextSourceHandle(plan, sourceIndex);
  if (nextHandle === null) return { items: [], nextPage: null, pending: false };
  return readReplayPlanPage(plan, nextHandle, signal);
}

/**
 * Página n-ésima del plan curado. El pageParam codifica fuente+skip
 * (`decodeReplayPageHandle`): una página refetchada siempre relee la misma
 * dirección, y las fuentes vacías se saltan dentro de la misma llamada.
 */
export async function fetchSportsReplayPlanPage(pageIndex = 0, signal?: AbortSignal): Promise<SportsReplayPlanPage> {
  await ensureLocalNuvioSportsServer();
  const handle = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
  try {
    return await readReplayPlanPage(buildSportsReplayPlan(getSportsPreferences()), handle, signal);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(`No se pudieron cargar las repeticiones. ${cause instanceof Error ? cause.message : "Reintenta la carga."}`);
  }
}

/** Resolve VOD sources; it must never pass through live-source probes. */
export async function resolveSportsReplayStreams(replay: SportsReplayItem): Promise<MediaStream[]> {
  await ensureLocalNuvioSportsServer();
  return getSportsReplayStreams(replay);
}

async function getSportsReplayStreams(replay: SportsReplayItem): Promise<MediaStream[]> {
  const sources = await fetchStreams(getSportsReplaysBaseUrl(), replay.requestType || "tv", replay.requestId);
  const streams = sources.flatMap((stream, index): MediaStream[] => {
    const source = stremioStreamToLiveSource(stream, replay.id, index);
    if (!source) return [];
    const { notWebReady: _notWebReady, ...hints } = stream.behaviorHints ?? {};
    return [{
      id: source.id,
      addonId: "nuvio-sports",
      addonName: "Sports",
      name: source.label,
      title: stream.title || replay.name,
      url: source.url,
      languages: source.language ? [source.language] : undefined,
      behaviorHints: { ...hints, ...(source.headers ? { headers: source.headers } : {}), live: false, sportsReplay: true },
    }];
  });
  if (!streams.length) throw new Error("El proveedor no tiene fuentes disponibles para esta repetición. Vuelve a intentarlo más tarde.");
  return streams;
}

export function primeSportsReplayPlayback(replay: SportsReplayItem, streams: MediaStream[]): void {
  if (!streams.length) throw new Error("No hay fuentes para esta repetición.");
  sessionStorage.setItem(AVAILABLE_STREAMS_KEY, JSON.stringify({ key: availableStreamsMediaKey(replay), streams }));
  sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(streams[0]));
  sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
    name: replay.name,
    // The archive addon poster is metadata, not the Sports card. Let the Player
    // render the generated match composition while its stream starts.
    background: "",
    poster: "",
    logo: "",
    sportsMatch: replay.sportsMatch,
    resumeTime: 0,
  }));
}
