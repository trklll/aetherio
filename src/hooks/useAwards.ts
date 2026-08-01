// Catálogo centralizado de premiaciones de Aetherio.
// El cliente ya NO parsea fuentes externas: consume el worker
// (GET /api/awards/media) que sirve los datos de AWARDS_DB (D1).

import { useQuery } from "@tanstack/react-query";

// Logos originales negros: Detail adapta su contraste al backdrop con CSS.
import oscarLogo from "../assets/logo premios/oscar-removebg-preview.png";
import goldenGlobeLogo from "../assets/logo premios/golden-globe-awards.png";
import baftaLogo from "../assets/logo premios/bafta-logo-.png";
import emmyLogo from "../assets/logo premios/emmy-award-logo.png";
import cannesLogo from "../assets/logo premios/festival-de-cannes-logo.png";
import veniceLogo from "../assets/logo premios/Venice-Film-Festival-logo.png";
import japanAcademyLogo from "../assets/logo premios/japan-academy-prize.png";
import marDelPlataLogo from "../assets/logo premios/Festival de Mar del Plata-logo.png";
import goyaLogo from "../assets/logo premios/goya-logo-removebg-preview.png";
import crunchyrollLogo from "../assets/logo premios/Crunchyroll_Logo.png";

// =============================================================================
// Tipos espejo del catálogo (website/worker/awards/types.ts)
// =============================================================================

export type AwardCeremony =
  | "oscar"
  | "bafta"
  | "golden_globes"
  | "emmy"
  | "goya"
  | "japan_academy"
  | "crunchyroll"
  | "cannes"
  | "venice"
  | "mar_del_plata";

export type AwardStatus = "winner" | "nominee" | "official_selection";
export type AwardSubject = "work" | "person" | "episode" | "song" | "technical";
export type MediaType = "movie" | "tv" | "anime";
export type AwardResolutionStatus = "resolved" | "pending" | "ambiguous" | "unresolved";

export interface AwardRecord {
  id: string;
  ceremony: AwardCeremony;
  edition: number | null;
  awardYear: number;
  categoryEs: string;
  categoryOriginal: string;
  status: AwardStatus;
  subject: AwardSubject;
  recipients: string[];
  workTitle: string;
  workYear?: number;
  sourceUrl: string;
  sourceTier: "official" | "secondary";
}

export interface CoverageSummary {
  ceremony: AwardCeremony;
  /** Ediciones esperadas según el manifest (complete + partial). */
  expectedEditions: number[];
  /** Esperadas sin importar todavía. */
  pendingEditions: number[];
  /** Huecos explícitos: canceladas, sin archivo o bloqueadas. */
  gapEditions: Array<{ edition: number; type: "canceled" | "no_archive" | "blocked" }>;
  completeEditions: number[];
  partialEditions: number[];
  staleEditions: number[];
  failedEditions: number[];
  lastSyncAt: string | null;
}

/** Razón por la que una obra no devuelve registros de premiaciones. */
export type AwardEmptyReason =
  | "edition_not_imported"
  | "identity_unresolved"
  | "identity_ambiguous"
  | "no_matching_records"
  | "sync_failed";

/** Identidad coincidente con la obra consultada (qué se vinculó y contra qué). */
export interface AwardMatched {
  workKey: string;
  workTitle: string;
  workYear: number | null;
  matchedTitle: string | null;
  matchedYear: number | null;
  tmdbId: number | null;
  imdbId: string | null;
  anilistId: number | null;
}

export interface AwardsResponse {
  mediaType?: MediaType;
  tmdbId?: number | null;
  imdbId?: string | null;
  anilistId?: number | null;
  records: AwardRecord[];
  featured: AwardRecord | null;
  /** Null cuando hay registros; la razón del vacío en caso contrario. */
  reason?: AwardEmptyReason | null;
  resolution: {
    status: AwardResolutionStatus;
    workKey: string | null;
    matchedTitle?: string | null;
    matchedYear?: number | null;
  };
  matched: AwardMatched | null;
  coverage: Record<AwardCeremony, CoverageSummary>;
  /** Cobertura de las ceremonias con ediciones en los años de la obra. */
  relevantCoverage?: Record<string, CoverageSummary>;
  generatedAt: string;
}

export interface AwardsData {
  records: AwardRecord[];
  featured: AwardRecord | null;
  coverage: Record<AwardCeremony, CoverageSummary> | null;
  reason: AwardEmptyReason | null;
  matched: AwardMatched | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  resolutionStatus: AwardResolutionStatus | null;
  retry: () => void;
}

// =============================================================================
// Metadatos de ceremonias para la UI (espejo de website/worker/awards/schema.ts)
// =============================================================================

const CEREMONY_INFO: Record<AwardCeremony, { nameEs: string; nameOriginal: string; logo: string }> = {
  oscar: { nameEs: "Premios Oscar", nameOriginal: "Academy Awards", logo: oscarLogo },
  cannes: { nameEs: "Festival de Cannes", nameOriginal: "Festival de Cannes", logo: cannesLogo },
  venice: { nameEs: "Festival de Venecia", nameOriginal: "Venice Film Festival", logo: veniceLogo },
  golden_globes: { nameEs: "Globos de Oro", nameOriginal: "Golden Globe Awards", logo: goldenGlobeLogo },
  bafta: { nameEs: "Premios BAFTA", nameOriginal: "British Academy Film Awards", logo: baftaLogo },
  emmy: { nameEs: "Premios Emmy", nameOriginal: "Emmy Awards", logo: emmyLogo },
  goya: { nameEs: "Premios Goya", nameOriginal: "Premios Goya", logo: goyaLogo },
  japan_academy: { nameEs: "Japan Academy Prize", nameOriginal: "Japan Academy Prize", logo: japanAcademyLogo },
  crunchyroll: { nameEs: "Crunchyroll Anime Awards", nameOriginal: "Crunchyroll Anime Awards", logo: crunchyrollLogo },
  mar_del_plata: { nameEs: "Festival de Mar del Plata", nameOriginal: "Festival Internacional de Cine de Mar del Plata", logo: marDelPlataLogo },
};

export const STATUS_LABELS: Record<AwardStatus, string> = {
  winner: "Ganadora",
  nominee: "Nominada",
  official_selection: "Selección oficial",
};

/** Nombre corto para frases tipo "Ganadora del ...". */
function badgeName(ceremony: AwardCeremony): string {
  const name = CEREMONY_INFO[ceremony]?.nameEs ?? ceremony;
  const singular = name.replace(/^Premios\s+/, "Premio ");
  if (ceremony === "golden_globes") return "Globo de Oro";
  return singular;
}

/** Frase del destacado: "Ganadora del Premio Oscar 2024" / "Nominada al Globo de Oro". */
export function featuredText(record: AwardRecord): string {
  const name = badgeName(record.ceremony);
  if (record.status === "winner") return `Ganadora del ${name}`;
  if (record.status === "nominee") return `Nominada al ${name}`;
  return `Selección oficial en ${name}`;
}

export function ceremonyName(ceremony: AwardCeremony): string {
  return CEREMONY_INFO[ceremony]?.nameEs ?? ceremony;
}

export function ceremonyLogo(ceremony: AwardCeremony): string {
  return CEREMONY_INFO[ceremony]?.logo;
}

// =============================================================================
// Cliente de la API
// =============================================================================

const API_BASE = import.meta.env.VITE_AETHERIO_API_URL?.replace(/\/$/, "")
  ?? "https://trkll.aetherio.workers.dev";

/** Logs de diagnóstico solo en desarrollo (nunca en producción). */
function logAwards(title: string, details: Array<[string, unknown]>): void {
  if (!import.meta.env.DEV) return;
  console.groupCollapsed(`[AETHERIO:AWARDS] ${title}`);
  for (const [label, value] of details) console.log(label, value);
  console.groupEnd();
}

function logAwardsError(title: string, error: unknown): void {
  if (!import.meta.env.DEV) return;
  console.groupCollapsed(`[AETHERIO:AWARDS] ${title}`);
  console.error(error);
  console.groupEnd();
}

function toMediaType(type: string): MediaType | null {
  const normalized = type.toLowerCase();
  if (normalized === "movie" || normalized === "film" || normalized === "pelicula" || normalized === "película") return "movie";
  if (normalized === "tv" || normalized === "series" || normalized === "serie") return "tv";
  if (normalized === "anime") return "anime";
  return null;
}

/** "tmdb:123", "tt000000" o "123" -> parámetros de consulta. */
function parseMediaId(mediaId: string): { tmdbId?: number; imdbId?: string } | null {
  if (!mediaId) return null;
  const trimmed = mediaId.trim();
  const tmdbMatch = /^tmdb:(\d+)$/i.exec(trimmed);
  if (tmdbMatch) {
    const id = Number(tmdbMatch[1]);
    return Number.isFinite(id) && id > 0 ? { tmdbId: id } : null;
  }
  if (/^tt\d+$/i.test(trimmed)) return { imdbId: trimmed };
  const direct = Number(trimmed);
  return Number.isFinite(direct) && direct > 0 ? { tmdbId: direct } : null;
}

async function fetchMediaAwards(params: {
  type?: MediaType;
  tmdbId?: number;
  imdbId?: string;
  anilistId?: number;
  title?: string | null;
  year?: number | null;
}): Promise<AwardsResponse> {
  const search = new URLSearchParams();
  // Invalida respuestas que el WebView/CDN guardó con la política anterior.
  search.set("v", "2");
  if (params.type) search.set("type", params.type);
  if (params.tmdbId) search.set("tmdbId", String(params.tmdbId));
  if (params.imdbId) search.set("imdbId", params.imdbId);
  if (params.anilistId) search.set("anilistId", String(params.anilistId));

  const url = `${API_BASE}/api/awards/media?${search.toString()}`;
  const startedAt = performance.now();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Accept": "application/json" },
      cache: "no-cache",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    logAwardsError("fallo de red en media", error);
    throw error;
  }

  const durationMs = Math.round(performance.now() - startedAt);

  if (!res.ok) {
    const error = new Error(`Awards API HTTP ${res.status}`);
    logAwardsError(`HTTP ${res.status} en media`, error);
    throw error;
  }

  const payload = await res.json() as AwardsResponse;

  const warnings: string[] = [];
  for (const [ceremony, coverage] of Object.entries(payload.relevantCoverage ?? {})) {
    if (coverage.pendingEditions.length > 0) warnings.push(`${ceremony}: ${coverage.pendingEditions.length} ediciones pendientes de importar`);
    if (coverage.gapEditions.length > 0) warnings.push(`${ceremony}: ${coverage.gapEditions.length} ediciones sin archivo`);
  }
  const ceremonyCount = new Set(payload.records.map(record => record.ceremony)).size;

  const byCeremony = new Map<string, { records: number; editions: number[]; statuses: Record<string, number> }>();
  for (const record of payload.records) {
    const key = `${record.ceremony} ${record.awardYear}`;
    const entry = byCeremony.get(key) ?? { records: 0, editions: [], statuses: {} };
    entry.records += 1;
    if (record.edition != null && !entry.editions.includes(record.edition)) entry.editions.push(record.edition);
    entry.statuses[record.status] = (entry.statuses[record.status] ?? 0) + 1;
    byCeremony.set(key, entry);
  }
  const breakdown = [...byCeremony.entries()]
    .map(([key, entry]) => ({
      ceremonia: key,
      registros: entry.records,
      ediciones: entry.editions.sort((a, b) => b - a),
      estados: entry.statuses,
    }))
    .sort((a, b) => b.registros - a.registros);

  logAwards(`media ${search.get("tmdbId") ?? search.get("imdbId") ?? search.get("anilistId")}`, [
    ["identidad recibida", { type: params.type ?? null, tmdbId: params.tmdbId ?? null, imdbId: params.imdbId ?? null, anilistId: params.anilistId ?? null }],
    ["obra original", { title: params.title ?? null, year: params.year ?? null }],
    [`GET ${new URL(url).pathname}${new URL(url).search}`, `HTTP ${res.status} · ${durationMs} ms · cache ${res.headers.get("Cache-Control") ?? "n/a"}`],
    ["resolución", { status: payload.resolution.status, workKey: payload.resolution.workKey, matchedTitle: payload.resolution.matchedTitle ?? null, matchedYear: payload.resolution.matchedYear ?? null, reason: payload.reason ?? null }],
    ["registros", `${payload.records.length} registros en ${ceremonyCount} ceremonias`],
    ["desglose", breakdown],
    ["cobertura relevante", payload.relevantCoverage ?? {}],
    ...(warnings.length > 0 ? [["advertencias", warnings] as [string, unknown]] : []),
  ]);

  return payload;
}

function useAwardsQuery(
  type: string | null,
  tmdbId: number | null,
  imdbId: string | null,
  anilistId: number | null,
  enabled: boolean,
  title?: string | null,
  year?: number | null,
): AwardsData {
  const mediaType = type ? toMediaType(type) : null;
  const query = useQuery({
    queryKey: ["awards", "media", "v2", mediaType, tmdbId, imdbId, anilistId],
    queryFn: () => fetchMediaAwards({
      type: mediaType ?? undefined,
      tmdbId: tmdbId ?? undefined,
      imdbId: imdbId ?? undefined,
      anilistId: anilistId ?? undefined,
      title: title ?? null,
      year: year ?? null,
    }),
    enabled: enabled && (tmdbId !== null || Boolean(imdbId) || anilistId !== null),
    staleTime: (currentQuery) => {
      const payload = currentQuery.state.data;
      if (!payload || payload.records.length === 0 || payload.resolution.status !== "resolved") return 0;
      return 1000 * 60 * 60;
    },
    gcTime: 1000 * 60 * 60 * 24 * 30,
    refetchOnMount: (currentQuery) => {
      const payload = currentQuery.state.data;
      return !payload || payload.records.length === 0 || payload.resolution.status !== "resolved" ? "always" : false;
    },
    refetchOnWindowFocus: (currentQuery) => {
      const payload = currentQuery.state.data;
      return !payload || payload.records.length === 0 || payload.resolution.status !== "resolved";
    },
    refetchOnReconnect: true,
    retry: 1,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  });
  const data = query.data;
  return {
    records: data?.records ?? [],
    featured: data?.featured ?? null,
    coverage: data?.coverage ?? null,
    reason: data?.reason ?? null,
    matched: data?.matched ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    errorMessage: query.error instanceof Error ? query.error.message : query.error ? "No se pudieron cargar las premiaciones." : null,
    resolutionStatus: data?.resolution.status ?? null,
    retry: () => { void query.refetch(); },
  };
}

/** Detail: consulta por TMDB id (con imdb/anilist opcionales para matchear mejor). */
export function useAwardsByTmdbId(
  type: string,
  tmdbId: number | null,
  enabled: boolean,
  imdbId?: string | null,
  anilistId?: number | null,
  title?: string | null,
  year?: number | null,
): AwardsData {
  return useAwardsQuery(
    type || null,
    tmdbId,
    typeof imdbId === "string" && imdbId.length > 0 ? imdbId : null,
    anilistId ?? null,
    enabled,
    title,
    year,
  );
}

/** Hero y back-compat: identifier crudo ("tmdb:123" o "tt000000"). */
export function useAwards(type: string, mediaId: string, enabled: boolean): AwardsData {
  const parsed = parseMediaId(mediaId);
  return useAwardsQuery(
    type || null,
    parsed?.tmdbId ?? null,
    parsed?.imdbId ?? null,
    null,
    enabled && parsed !== null,
  );
}
