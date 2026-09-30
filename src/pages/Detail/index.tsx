import { useEffect, useLayoutEffect, useMemo, useRef, useState, Children, Component, lazy, Suspense, type LazyExoticComponent, type ComponentType } from "react";
import type { ReactNode } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useBackAction } from "../../input/inputActions.ts";
import { BookmarkMinus, BookmarkPlus, Image as ImageIcon, MoreHorizontal, Play, X, Check, EyeOff, UsersRound } from "lucide-react";
import addImageIcon from "../../assets/add-image-svgrepo-com.svg";
import { tmdbFetch } from "../../config/apiKeys";
import { useHomePreferences } from "../../config/homePreferences";
import { useMdbListSettings, type MdbListRatings } from "../../config/mdblist";
import { useAddonStore } from "../../store/addonStore";
import ContextMenu from "../../components/ui/ContextMenu";
import MDBListRatingsRow from "../../components/ratings/MDBListRatingsRow";
import type { MediaStream } from "../../types/stream";
import { fetchMdbListRatingsForMedia } from "../../services/MDBListService";
import { fetchDetailCollection, type DetailCollectionItem } from "../../services/detailCollections";
import { resolveMalId, fetchAnimeCast } from "../../services/animeResolve";
import { fetchAnilistIdByMalId } from "../../services/anilist";
import {
  CONTINUE_WATCHING_EVENT,
  formatResumeTime,
  markEpisodeAsWatched,
  progressPercent,
  readPlaybackStateEntries,
  removeContinueWatchingEntry,
  saveNextEpisodePrompt,
  type ContinueWatchingEntry,
} from "../../utils/continueWatching";
import { readCachedLogo, sanitizeLogoUrl, writeCachedLogo } from "../../utils/artwork";
import { ensureOriginalTmdbImage, pickPreferredTmdbBackdrop, sortTmdbBackdropsByPreference } from "../../utils/tmdbArtwork";
import {
  readDetailBackgroundOverride,
  readDetailLogoOverride,
  readDetailMediaMeta,
  writeDetailBackgroundOverride,
  writeDetailLogoOverride,
  writeDetailMediaMeta,
} from "../../utils/mediaMetadata";
import { isInLibrary, LIBRARY_CHANGED_EVENT, toggleLibraryItem } from "../../utils/library";
import {
  syncTraktMarkedUnwatched,
  syncTraktMarkedWatched,
  syncTraktRemovePlayback,
} from "../../trakt";
import { fetchTmdbCommentsForMedia, type TmdbCommentReview } from "../../services/tmdbComments";
import { SELECTED_ENGINE_KEY, SELECTED_MEDIA_META_KEY, SELECTED_STREAM_KEY } from "../Player/utils";
import { gsap, appleEase, prefersReducedMotion, scrollByGsap, scrollToElementGsap, tweenTo } from "../../utils/motion";
import { clearSharedElementName, getSharedElementName, playHeroExpandAnimation } from "../../utils/sharedElementTransition";
import { useAwardsByTmdbId, awardCategoryLabel, featuredText } from "../../hooks/useAwards";
import { AwardLogo } from "../../components/awards/AwardLogo";
import CardArtworkPicker, { type CardArtworkPickerOption } from "../Home/CardArtworkPicker";
import type { MediaItem } from "../../types/ui";
import LoadingState from "../../components/ui/LoadingState";
import SeasonTabs from "./SeasonTabs.tsx";
import { readPageDataCache, writePageDataCache } from "../../utils/pageDataCache";
import { buildDetailPath, buildEntityPath, buildEpisodePath, buildPersonPath, buildPlayerPath, detailDataMatchesRoute, isBigPictureLocation } from "../../utils/bigPictureDetail";
import { pickTmdbSearchCandidate, type TmdbSearchCandidate } from "../../utils/tmdbIdentity";
import { DETAIL_ENTER_CONTENT_EVENT, DETAIL_EXIT_HERO_EVENT, useBigPictureActive } from "../../navigation/spatialNav.ts";
import { useLongPressAction } from "../../hooks/useLongPressAction.ts";
import { GAMEPAD_ACTION_EVENT } from "../../hooks/useGamepad.ts";
import { consumeAutoResolveBackPress } from "../../utils/autoResolveGuard.ts";

const loadEpisodieSection = () => import("../Episodie/index.tsx");

// Reintenta cargas transitorias del chunk (p. ej. HMR/dev a medio recargar):
// sin esto un fallo puntual deja el Suspense pendiente para siempre.
function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  retries = 3,
): LazyExoticComponent<T> {
  return lazy(() => {
    const attempt = (remaining: number): Promise<{ default: T }> =>
      loader().catch(error => {
        if (remaining <= 0) throw error;
        return new Promise<{ default: T }>(resolve => {
          window.setTimeout(() => { void attempt(remaining - 1).then(resolve); }, 600);
        });
      });
    return attempt(retries);
  });
}

const EpisodieSection = lazyWithRetry(loadEpisodieSection);

class EpisodeSectionErrorBoundary extends Component<{
  onRetry: () => void;
  onClose: () => void;
  onError: () => void;
  children: ReactNode;
}, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 32, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
            No se pudo cargar la sección de fuentes
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.6)", maxWidth: 420 }}>
            El detalle sigue intacto debajo. Reintenta para volver a cargar la sección.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => { this.setState({ error: null }); this.props.onRetry(); }}
              style={{ padding: "10px 22px", borderRadius: 999, border: "none", background: "#fff", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={this.props.onClose}
              style={{ padding: "10px 22px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              Volver
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface DetailEpisodeRequest {
  season?: number;
  ep?: number;
  episodeName?: string;
  continue?: boolean;
  autoplay?: boolean;
  fromSearch?: boolean;
  q?: string;
  fromPlayer?: boolean;
}

function readEpisodeRequestFromState(state: unknown): DetailEpisodeRequest | null {
  if (!state || typeof state !== "object") return null;
  const request = (state as { episodeRequest?: unknown }).episodeRequest;
  if (!request || typeof request !== "object") return null;
  const candidate = request as Record<string, unknown>;
  const clean: DetailEpisodeRequest = {};
  if (typeof candidate.season === "number") clean.season = candidate.season;
  if (typeof candidate.ep === "number") clean.ep = candidate.ep;
  if (typeof candidate.episodeName === "string") clean.episodeName = candidate.episodeName;
  if (typeof candidate.continue === "boolean") clean.continue = candidate.continue;
  if (typeof candidate.autoplay === "boolean") clean.autoplay = candidate.autoplay;
  if (typeof candidate.fromSearch === "boolean") clean.fromSearch = candidate.fromSearch;
  if (typeof candidate.q === "string") clean.q = candidate.q;
  if (typeof candidate.fromPlayer === "boolean") clean.fromPlayer = candidate.fromPlayer;
  return clean;
}
const IMG      = "https://image.tmdb.org/t/p";
const DEBUG_LOGO = false;
// Empieza el fade del logo durante la salida del hero, antes de que la primera
// fila de contenido termine de entrar en el viewport.
const CONTENT_LOGO_REVEAL_DISTANCE = 520;
// Duración del recorrido hero → contenido en Big Picture (referencia Akira).
const DETAIL_ZONE_TRAVEL_S = 0.74;
const DETAIL_LOGO_KEY = "aetherio-detail-logo";
const DETAIL_HERO_HEIGHT = "calc(78vh + var(--app-shell-nav-height) - 60px)";
const BIG_PICTURE_DETAIL_HERO_HEIGHT = "calc(78vh - 60px)";
const DETAIL_VERTICAL_CARD_GAP = 22;
const DETAIL_EPISODE_CARD_GAP = 22;
const DETAIL_ROW_SHADOW_TOP_GUTTER = 16;
const DETAIL_ROW_SHADOW_BOTTOM_GUTTER = 40;
const DETAIL_RELATED_ROW_SHADOW_GUTTER = { top: 36, bottom: 76 };
// Los trailers usan sombra + escala mayores (0 20px 42px en hover): necesitan
// más gutter vertical para que el scrollport horizontal no la recorte.
const DETAIL_TRAILER_ROW_SHADOW_GUTTER = { top: 28, bottom: 64 };
// Colección (340x192, escala 1.05 + 0 20px 42px en foco) y comentarios TMDB
// (escala 1.04 + 0 22px 46px en foco): misma clase de sombra que trailers,
// mismo problema de recorte con el gutter por defecto (16/40).
const DETAIL_COLLECTION_ROW_SHADOW_GUTTER = { top: 28, bottom: 64 };
const DETAIL_COMMENTS_ROW_SHADOW_GUTTER = { top: 28, bottom: 72 };
// Altura nominal de la card de comentario (minHeight 144 + contenido): solo
// para centrar las flechas de la row, que son un affordance hover en PC.
const DETAIL_COMMENTS_CARD_HEIGHT = 160;
// Keep arrows centered on the media (image) height, not the full card
const DETAIL_EPISODE_MEDIA_HEIGHT = 195;
const DETAIL_TRAILER_HEIGHT = 224;
const DETAIL_CAST_PORTRAIT_SIZE = 159;
const DETAIL_VERTICAL_POSTER_HEIGHT = 296;
const DETAIL_COLLECTION_HEIGHT = 192;
const DETAIL_MEDIA_ARROW_TOP = DETAIL_ROW_SHADOW_TOP_GUTTER + DETAIL_EPISODE_MEDIA_HEIGHT / 2 + 10;
const DETAIL_TRAILER_ARROW_TOP = DETAIL_TRAILER_ROW_SHADOW_GUTTER.top + DETAIL_TRAILER_HEIGHT / 2;
const DETAIL_CAST_ARROW_TOP = DETAIL_ROW_SHADOW_TOP_GUTTER + DETAIL_CAST_PORTRAIT_SIZE / 2;
const DETAIL_RELATED_ARROW_TOP = DETAIL_RELATED_ROW_SHADOW_GUTTER.top + DETAIL_VERTICAL_POSTER_HEIGHT / 2;
const DETAIL_COLLECTION_ARROW_TOP = DETAIL_COLLECTION_ROW_SHADOW_GUTTER.top + DETAIL_COLLECTION_HEIGHT / 2;
const DETAIL_COMMENTS_ARROW_TOP = DETAIL_COMMENTS_ROW_SHADOW_GUTTER.top + DETAIL_COMMENTS_CARD_HEIGHT / 2;

function preloadImage(url?: string | null, timeoutMs = 6000) {
  if (!url) return Promise.resolve();
  return new Promise<void>(resolve => {
    let settled = false;
    const img = new Image();
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    img.onload = finish;
    img.onerror = finish;
    img.src = url;
  });
}

function getDetailLogoKey(type?: string, id?: string) {
  return type && id ? `${DETAIL_LOGO_KEY}:${type}:${id}` : DETAIL_LOGO_KEY;
}

function pickAddonArtwork(...values: Array<string | undefined | null>) {
  return values.find((value): value is string => Boolean(value));
}

function addonSupportsMeta(addon: any, type: string, id: string) {
  const resources = addon.manifest?.resources ?? [];
  const supportsMeta = resources.some((resource: any) => {
    if (typeof resource === "string") return resource === "meta";
    return resource?.name === "meta";
  });
  if (!supportsMeta && resources.length > 0) return false;

  const types = addon.manifest?.types;
  if (Array.isArray(types) && types.length > 0 && !types.includes(type)) return false;

  const prefixes = addon.manifest?.idPrefixes;
  if (id.startsWith("tmdb:") && (!Array.isArray(prefixes) || !prefixes.includes("tmdb"))) return false;
  if (Array.isArray(prefixes) && prefixes.length > 0 && !prefixes.some((prefix: string) => id.startsWith(prefix))) return false;

  return true;
}

interface CastMember { id:number|string;name:string;character:string;profile_path?:string;voiceActorId?:number; }
interface Trailer    { key?:string;name:string;thumbnail?:string;stream?:MediaStream; }
interface Related    { id:number;title?:string;poster_path?:string;media_type:string; }
interface Episode    { id:string;episode:number;season:number;name?:string;overview?:string;still?:string;runtime?:number;airDate?:string; }
interface MetaCompany { id:number|string;name:string;logo?:string; }
interface BackgroundOption { url:string;label:string;source:"addon"|"tmdb"|"cache"; }
interface LogoOption { url:string;label:string;source:"addon"|"tmdb"|"cache"; }
interface DetailData {
  id:string;name:string;type:string;
  ids?:{ tmdb?:number; imdb?:string; trakt?:number; mal?:number; anilist?:number };
  aliases?:string[];
  backdrop?:string;poster?:string;logo?:string;
  description?:string;year?:number;runtime?:string;
  genres?:string[];rating?:string;cast?:CastMember[];
  director?:string;directorId?:number|string;trailers?:Trailer[];related?:Related[];
  collection?:DetailCollectionItem[];collectionName?:string;
  seasons?:{number:number;episodes:Episode[]}[];
  productionCompanies?:MetaCompany[];
  networks?:MetaCompany[];
  backgroundOptions?:BackgroundOption[];
  logoOptions?:LogoOption[];
  mdbListRatings?:MdbListRatings;
  voteAverage?:number;
}

async function hydrateAnimeIdentity(detail: DetailData): Promise<DetailData> {
  if (detail.type !== "anime" || detail.ids?.anilist) return detail;
  const malId = await resolveMalId({
    malId: detail.ids?.mal,
    imdbId: detail.ids?.imdb,
    tmdbId: detail.ids?.tmdb,
    title: detail.name,
    year: detail.year,
  });
  if (!malId) return detail;
  const anilistId = await fetchAnilistIdByMalId(malId);
  return {
    ...detail,
    ids: {
      ...detail.ids,
      mal: malId,
      ...(anilistId ? { anilist: anilistId } : {}),
    },
  };
}

function dedupeCastMembers(cast?: CastMember[]) {
  const seen = new Set<string>();
  return (cast ?? []).filter(member => {
    const key = String(member.id).trim() || normalizeTitle(member.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDetailData(detail: DetailData): DetailData {
  const cast = dedupeCastMembers(detail.cast);
  return cast.length === (detail.cast?.length ?? 0) ? detail : { ...detail, cast };
}

function numberValue(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : undefined;
}

function seasonNumberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : undefined;
}

function seasonSortKey(value: number) {
  return value <= 0 ? Number.MAX_SAFE_INTEGER : value;
}

function runtimeMinutes(value: unknown) {
  const numeric = numberValue(value);
  if (numeric) return numeric > 300 ? Math.round(numeric / 60) : Math.round(numeric);
  if (typeof value !== "string") return undefined;
  const hours = value.match(/(\d+)\s*h/i);
  const mins = value.match(/(\d+)\s*m/i);
  if (hours || mins) return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
  return undefined;
}

function formatRuntime(value: unknown) {
  const minutes = runtimeMinutes(value);
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function formatDateLabel(value?: string) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
  const date = dateOnly
    ? new Date(`${dateOnly}T00:00:00`)
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function detailPageCacheKey(type?: string, id?: string) {
  // La versión anterior podía cachear un anime con la namespace TMDB
  // equivocada (movie/229858 = Three Mothers, tv/229858 = Fate/strange Fake).
  // No reutilizar esos detalles una vez corregida la resolución de identidad.
  return type && id ? `v2:${type}:${id}` : "";
}

function normalizeMojibakeText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/\u00e2\u20ac\u00a6/g, "\u2026")
    .replace(/\u00e2\u20ac\u201c/g, "\u2013")
    .replace(/\u00e2\u20ac\u201d/g, "\u2014")
    .replace(/\u00e2\u20ac\u02dc/g, "\u2018")
    .replace(/\u00e2\u20ac\u2122/g, "\u2019")
    .replace(/\u00e2\u20ac\u0153/g, "\u201c")
    .replace(/\u00e2\u20ac/g, "\u201d")
    .replace(/\u00c3\u00a1/g, "\u00e1")
    .replace(/\u00c3\u00a9/g, "\u00e9")
    .replace(/\u00c3\u00ad/g, "\u00ed")
    .replace(/\u00c3\u00b3/g, "\u00f3")
    .replace(/\u00c3\u00ba/g, "\u00fa")
    .replace(/\u00c3\u00b1/g, "\u00f1")
    .replace(/\u00c3\u0081/g, "\u00c1")
    .replace(/\u00c3\u0089/g, "\u00c9")
    .replace(/\u00c3\u008d/g, "\u00cd")
    .replace(/\u00c3\u0093/g, "\u00d3")
    .replace(/\u00c3\u009a/g, "\u00da")
    .replace(/\u00c3\u0091/g, "\u00d1")
    .replace(/\u00c2/g, "");
}

function mapAddonCast(meta: any): CastMember[] | undefined {
  const people: CastMember[] = [];
  if (Array.isArray(meta?.cast)) {
    for (const item of meta.cast) {
      if (typeof item === "string" && item.trim()) {
        people.push({ id: `cast:${item}`, name: item, character: "" });
      } else if (item?.name) {
        people.push({
          id: item.id ?? item.imdb_id ?? item.name,
          name: item.name,
          character: item.character ?? item.role ?? "",
          profile_path: item.image ?? item.profile ?? item.photo,
        });
      }
    }
  }

  if (Array.isArray(meta?.links)) {
    for (const link of meta.links) {
      const category = String(link?.category ?? link?.type ?? "").toLowerCase();
      if (!category.includes("cast") && !category.includes("actor")) continue;
      const name = String(link?.name ?? "").trim();
      if (!name || people.some(person => person.name === name)) continue;
      people.push({ id: link.url ?? `link:${name}`, name, character: "" });
    }
  }

  return people.length ? people : undefined;
}

function mapAddonDirector(meta: any) {
  if (Array.isArray(meta?.director)) return meta.director.filter(Boolean).join(", ");
  if (typeof meta?.director === "string" && meta.director.trim()) return meta.director;
  if (!Array.isArray(meta?.links)) return undefined;
  return meta.links
    .filter((link: any) => String(link?.category ?? link?.type ?? "").toLowerCase().includes("director"))
    .map((link: any) => link?.name)
    .filter(Boolean)
    .join(", ") || undefined;
}

function buildRelatedItems(main: any, fallbackType: string): Related[] {
  const source = [
    ...(Array.isArray(main?.recommendations?.results) ? main.recommendations.results : []),
    ...(Array.isArray(main?.similar?.results) ? main.similar.results : []),
  ];
  const ownGenres = new Set((main?.genres ?? []).map((genre: any) => Number(genre?.id)).filter(Boolean));
  const ownTitle = normalizeTitle(main?.title ?? main?.name);
  const seen = new Set<string>();
  return source
    .filter((item: any) => item?.id && item?.poster_path)
    .map((item: any) => {
      const mediaType = item.media_type === "movie" || item.media_type === "tv" ? item.media_type : fallbackType;
      const title = item.title ?? item.name ?? "";
      const genreOverlap = Array.isArray(item.genre_ids)
        ? item.genre_ids.filter((genreId: number) => ownGenres.has(Number(genreId))).length
        : 0;
      const score =
        genreOverlap * 20 +
        Number(item.vote_average ?? 0) +
        Math.log10(Math.max(1, Number(item.vote_count ?? 0)) + 1) +
        Math.log10(Math.max(1, Number(item.popularity ?? 0)) + 1);
      return { item, mediaType, title, score };
    })
    .filter(({ item, mediaType, title }) => {
      const key = `${mediaType}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return normalizeTitle(title) !== ownTitle;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map(({ item, mediaType, title }) => ({
      id: item.id,
      title,
      poster_path: `${IMG}/original${item.poster_path}`,
      media_type: mediaType === "tv" ? "series" : mediaType,
    }));
}

function mapAddonRelated(meta: any): Related[] | undefined {
  const values = [
    ...(Array.isArray(meta?.related) ? meta.related : []),
    ...(Array.isArray(meta?.similar) ? meta.similar : []),
    ...(Array.isArray(meta?.recommendations) ? meta.recommendations : []),
  ];
  const items = values
    .map((item: any): Related | null => {
      const rawId = item?.id ?? item?.imdb_id ?? item?.tmdb_id;
      const title = item?.title ?? item?.name;
      const poster = pickAddonArtwork(item?.poster, item?.poster_path, item?.image, item?.thumbnail);
      if (!rawId || !title || !poster) return null;
      const mediaType = item?.type === "movie" || item?.media_type === "movie" ? "movie" : "series";
      const numericId = Number(String(rawId).replace(/^tmdb:/i, ""));
      return {
        id: Number.isFinite(numericId) && numericId > 0 ? numericId : rawId,
        title,
        poster_path: poster.startsWith("/") ? `${IMG}/original${poster}` : poster,
        media_type: mediaType,
      };
    })
    .filter((item): item is Related => item !== null);
  return items.length ? items : undefined;
}

function mergeRelatedItems(...groups: Array<Related[] | undefined>) {
  const seen = new Set<string>();
  const merged: Related[] = [];
  for (const group of groups) {
    for (const item of group ?? []) {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.slice(0, 18);
}

function hasRegularEpisodes(seasons?: Array<{ number: number; episodes: Episode[] }>) {
  return Boolean(seasons?.some(season => season.number > 0 && season.episodes.length > 0));
}

function mergeSeasons(
  current: Array<{ number: number; episodes: Episode[] }> | undefined,
  incoming: Array<{ number: number; episodes: Episode[] }> | undefined,
) {
  if (!current?.length) return incoming;
  if (!incoming?.length) return current;
  const bySeason = new Map<number, Episode[]>();
  for (const season of current) bySeason.set(season.number, [...season.episodes]);
  for (const season of incoming) {
    const existing = bySeason.get(season.number) ?? [];
    const seenEpisodes = new Set(existing.map(episode => episode.episode));
    bySeason.set(season.number, [
      ...existing,
      ...season.episodes.filter(episode => !seenEpisodes.has(episode.episode)),
    ].sort((a, b) => a.episode - b.episode));
  }
  return Array.from(bySeason.entries())
    .sort(([a], [b]) => seasonSortKey(a) - seasonSortKey(b))
    .map(([number, episodes]) => ({ number, episodes }));
}

function parseMediaIds(id: string) {
  if (id.startsWith("tt")) return { imdb: id.split(":")[0] };
  if (id.toLowerCase().startsWith("tmdb:")) {
    const tmdb = Number(id.split(":")[1]);
    return Number.isFinite(tmdb) && tmdb > 0 ? { tmdb } : {};
  }
  if (id.toLowerCase().startsWith("trakt:")) {
    const trakt = Number(id.split(":")[1]);
    return Number.isFinite(trakt) && trakt > 0 ? { trakt } : {};
  }
  if (id.toLowerCase().startsWith("mal:")) {
    const mal = Number(id.split(":")[1]);
    return Number.isFinite(mal) && mal > 0 ? { mal } : {};
  }
  if (id.toLowerCase().startsWith("anilist:")) {
    const anilist = Number(id.split(":")[1]);
    return Number.isFinite(anilist) && anilist > 0 ? { anilist } : {};
  }
  return {};
}

type TmdbKind = "movie" | "tv";

const TMDB_DETAIL_APPEND = "credits,aggregate_credits,videos,similar,recommendations,external_ids";

function inferTmdbKind(value: any, requested: TmdbKind): TmdbKind {
  if (!value || typeof value !== "object") return requested;
  if (
    typeof value.name === "string"
    || typeof value.first_air_date === "string"
    || Object.prototype.hasOwnProperty.call(value, "number_of_seasons")
  ) return "tv";
  if (
    typeof value.title === "string"
    || typeof value.release_date === "string"
    || Object.prototype.hasOwnProperty.call(value, "runtime")
  ) return "movie";
  return requested;
}

function resolveDetailImdbId(detail: DetailData) {
  if (detail.ids?.imdb?.startsWith("tt")) return detail.ids.imdb;
  const fromOwnId = parseMediaIds(detail.id).imdb;
  if (fromOwnId?.startsWith("tt")) return fromOwnId;
  return undefined;
}

function normalizeTitle(value: string | undefined | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an|el|la|los|las|un|una|unos|unas)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTitle(value: string | undefined | null) {
  return normalizeTitle(value).replace(/\s+/g, "");
}

function isTmdbImageUrl(value?: string | null) {
  return Boolean(value && /image\.tmdb\.org\/t\/p\//i.test(value));
}

function uniqueAliases(...values: Array<string | undefined | null | false>) {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== "string") continue;
    const clean = value.trim();
    const key = normalizeTitle(clean);
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(clean);
  }
  return aliases;
}

function mapTmdbCompanies(values: any[] | undefined): MetaCompany[] | undefined {
  const companies = (values ?? [])
    .map((item: any): MetaCompany | null => {
      const name = String(item?.name ?? "").trim();
      if (!name) return null;
      return {
        id: item?.id ?? name,
        name,
        logo: item?.logo_path ? `${IMG}/w300${item.logo_path}` : undefined,
      };
    })
    .filter((item): item is MetaCompany => item !== null);
  return companies.length ? companies : undefined;
}

function uniqueBackgroundOptions(options: Array<BackgroundOption | undefined | null>) {
  const seen = new Set<string>();
  const result: BackgroundOption[] = [];
  for (const option of options) {
    if (!option?.url || seen.has(option.url)) continue;
    seen.add(option.url);
    result.push(option);
  }
  return result;
}

function uniqueLogoOptions(options: Array<LogoOption | undefined | null>) {
  const seen = new Set<string>();
  const result: LogoOption[] = [];
  for (const option of options) {
    const url = sanitizeLogoUrl(option?.url);
    if (!option || !url || seen.has(url)) continue;
    seen.add(url);
    result.push({ ...option, url });
  }
  return result;
}

function backgroundPreviewUrl(url: string) {
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${IMG}/w780/`);
}

function collectAddonBackgroundOptions(raw: any, sourceName: string) {
  const values = [
    raw?.background,
    raw?.backdrop,
    raw?.fanart,
    ...(Array.isArray(raw?.backgrounds) ? raw.backgrounds : []),
    ...(Array.isArray(raw?.backdrops) ? raw.backdrops : []),
    ...(Array.isArray(raw?.images) ? raw.images : []),
    ...(Array.isArray(raw?.screenshots) ? raw.screenshots : []),
  ];
  return values
    .map((value, index): BackgroundOption | null => {
      const url = typeof value === "string"
        ? value
        : typeof value?.url === "string"
          ? value.url
          : typeof value?.file_path === "string"
            ? `${IMG}/original${value.file_path}`
            : "";
      return url ? { url, label: index === 0 ? sourceName : `${sourceName} ${index + 1}`, source: "addon" } : null;
    })
    .filter((item): item is BackgroundOption => item !== null);
}

function collectAddonLogoOptions(raw: any, sourceName: string) {
  const values = [
    raw?.logo,
    raw?.clearlogo,
    raw?.clearLogo,
    raw?.logoUrl,
    raw?.logo_url,
    ...(Array.isArray(raw?.logos) ? raw.logos : []),
  ];
  return values
    .map((value, index): LogoOption | null => {
      const url = typeof value === "string"
        ? value
        : typeof value?.url === "string"
          ? value.url
          : typeof value?.file_path === "string"
            ? `${IMG}/w500${value.file_path}`
            : "";
      const cleanUrl = sanitizeLogoUrl(url);
      return cleanUrl ? { url: cleanUrl, label: index === 0 ? sourceName : `${sourceName} ${index + 1}`, source: "addon" } : null;
    })
    .filter((item): item is LogoOption => item !== null);
}

function collectTmdbBackgroundOptions(backdrops: unknown, fallbackPath?: string | null) {
  const options = sortTmdbBackdropsByPreference(backdrops).map((url, index): BackgroundOption => ({
    url,
    label: `TMDB ${index + 1}`,
    source: "tmdb",
  }));
  const fallback = fallbackPath ? `${IMG}/original${fallbackPath}` : undefined;
  return uniqueBackgroundOptions([
    ...options,
    fallback ? { url: fallback, label: "TMDB principal", source: "tmdb" } : null,
  ]);
}

function collectTmdbLogoOptions(logos: unknown) {
  if (!Array.isArray(logos)) return [];
  return logos
    .map((logo: any): (LogoOption & { score: number }) | null => {
      if (!logo?.file_path || String(logo.file_path).toLowerCase().endsWith(".svg")) return null;
      const language = logo.iso_639_1;
      const label = language === "es"
        ? "TMDB Español"
        : language === "en"
          ? "TMDB Inglés"
          : language
            ? `TMDB ${String(language).toUpperCase()}`
            : "TMDB";
      const score = language === "es" ? 3 : language === "en" ? 2 : 1;
      return { url: `${IMG}/w500${logo.file_path}`, label, source: "tmdb", score };
    })
    .filter((item): item is LogoOption & { score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...option }) => option);
}

function normalizedMediaType(type: string) {
  return type === "movie" ? "movie" : "series";
}

function detailEntryMatches(data: DetailData, entry: ContinueWatchingEntry) {
  if (normalizedMediaType(data.type) !== normalizedMediaType(entry.type)) return false;
  if (entry.id === data.id || entry.mediaKey === `${entry.type}:${data.id}` || entry.mediaKey === `${data.type}:${data.id}`) return true;

  const entryIds = parseMediaIds(entry.id);
  const detailIds = {
    ...parseMediaIds(data.id),
    ...data.ids,
  };
  const idsMatch = Boolean(
    (entryIds.imdb && detailIds.imdb && entryIds.imdb === detailIds.imdb) ||
    (entryIds.tmdb && detailIds.tmdb && entryIds.tmdb === detailIds.tmdb) ||
    (entryIds.trakt && detailIds.trakt && entryIds.trakt === detailIds.trakt),
  );
  if (idsMatch) return true;

  const aliases = uniqueAliases(data.name, ...(data.aliases ?? []));
  const entryTitles = uniqueAliases(entry.name, entry.id);
  return entryTitles.some(entryTitle => {
    const entryNormalized = normalizeTitle(entryTitle);
    const entryCompact = compactTitle(entryTitle);
    if (!entryNormalized) return false;
    return aliases.some(alias => (
      normalizeTitle(alias) === entryNormalized ||
      compactTitle(alias) === entryCompact
    ));
  });
}

function isResumableDetailEntry(entry: ContinueWatchingEntry) {
  return !entry.completed && progressPercent(entry) > 0;
}

function isEpisodeLocked(episode: Episode) {
  const releaseMs = parseEpisodeAirDateMs(episode.airDate);
  if (!releaseMs) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // TMDB suele ir 1 día desfasado (dice 21 cuando estrena el 20).
  // Permitir entrar 1 día antes de la fecha anunciada.
  const EARLY_ACCESS_MS = 24 * 60 * 60 * 1000;
  return releaseMs > today.getTime() + EARLY_ACCESS_MS;
}

function parseEpisodeAirDateMs(value?: string) {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const direct = Date.parse(trimmed);
  if (Number.isFinite(direct)) return direct;
  const asDate = Date.parse(`${trimmed}T00:00:00Z`);
  return Number.isFinite(asDate) ? asDate : 0;
}

function getEpisodeKey(season?: number, episode?: number) {
  return typeof season === "number" && episode ? `${season}:${episode}` : "";
}

function isActiveDetailPath(pathname: string, type?: string, id?: string) {
  if (!type || !id) return false;
  const segments = pathname.split("/").filter(Boolean);
  // PC: /detail/:type/:id — Big Picture: /big-picture/detail/:type/:id
  const offset = segments[0] === "big-picture" && segments[1] === "detail" ? 1 : 0;
  if (segments.length !== 3 + offset || segments[offset] !== "detail" || segments[offset + 1] !== type) return false;
  try {
    return decodeURIComponent(segments[offset + 2]) === id;
  } catch {
    return false;
  }
}

function findDisplayEpisodeForEntry(data: DetailData, entry: ContinueWatchingEntry, episodeByKey?: Map<string, Episode>) {
  if (typeof entry.season !== "number" || !entry.episode || !data.seasons?.length) return null;
  const exactKey = `${entry.season}:${entry.episode}`;
  const exact = episodeByKey?.get(exactKey) ?? data.seasons
    .flatMap(season => season.episodes)
    .find(episode => episode.season === entry.season && episode.episode === entry.episode);
  if (exact) return exact;

  if (entry.season !== 1) return null;
  const ordered = data.seasons
    .flatMap(season => season.episodes)
    .filter(episode => episode.season > 0 && episode.episode > 0)
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  return ordered[entry.episode - 1] ?? null;
}

function findNextEpisode(
  seasons: Array<{ number: number; episodes: Episode[] }>,
  season: number,
  episode: number,
) {
  const ordered = seasons
    .flatMap(item => item.episodes)
    .filter(item => item.season > 0 && item.episode > 0 && !isEpisodeLocked(item))
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  const index = ordered.findIndex(item => item.season === season && item.episode === episode);
  if (index === -1) return ordered[0] ?? null;
  return ordered[index + 1] ?? null;
}

function extractYoutubeId(value?: string) {
  if (!value) return undefined;
  const plain = value.match(/^[a-zA-Z0-9_-]{8,}$/)?.[0];
  if (plain && !value.includes("/") && !value.includes(".")) return plain;
  return value.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/)?.[1];
}

function mapAddonTrailers(meta: any, addon: any): Trailer[] | undefined {
  const rawTrailers = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.trailerStreams) ? meta.trailerStreams : []),
  ];
  const trailers = rawTrailers.map((raw: any, index: number): Trailer | null => {
    const key = extractYoutubeId(raw?.source ?? raw?.ytId ?? raw?.url ?? raw?.externalUrl);
    const name = raw?.title ?? raw?.name ?? `Trailer ${index + 1}`;
    if (key) return { key, name, thumbnail: raw?.thumbnail };
    if (!raw?.url && !raw?.externalUrl && !raw?.infoHash && !raw?.sources?.length) return null;
    return {
      name,
      thumbnail: raw?.thumbnail ?? raw?.behaviorHints?.thumbnail,
      stream: {
        id: `addon-trailer-${addon.id}-${meta?.id ?? "meta"}-${index}`,
        addonId: addon.id,
        addonName: addon.name,
        name: "Trailer",
        title: name,
        description: raw?.description,
        url: raw?.url,
        externalUrl: raw?.externalUrl,
        ytId: raw?.ytId,
        infoHash: raw?.infoHash,
        fileIdx: raw?.fileIdx,
        sources: raw?.sources,
        behaviorHints: raw?.behaviorHints,
        subtitles: raw?.subtitles,
      },
    };
  }).filter((item): item is Trailer => item !== null);
  return trailers.length ? trailers.slice(0, 8) : undefined;
}

function mapAddonSeasons(meta: any): DetailData["seasons"] | undefined {
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  const bySeason = new Map<number, Episode[]>();
  for (const video of videos) {
    const rawSeason = seasonNumberValue(video?.season ?? video?.season_number ?? video?.seasonNumber);
    const episode = numberValue(video?.episode ?? video?.episode_number ?? video?.episodeNumber ?? video?.number);
    if (!episode) continue;
    const season = rawSeason ?? 0;
    const item: Episode = {
      id: String(video?.id ?? `${meta?.id ?? "episode"}:${season}:${episode}`),
      season,
      episode,
      name: video?.title ?? video?.name,
      overview: video?.overview ?? video?.description,
      still: pickAddonArtwork(video?.thumbnail, video?.still, video?.background, video?.poster),
      runtime: runtimeMinutes(video?.runtime ?? video?.duration),
      airDate: video?.released ?? video?.air_date ?? video?.first_aired ?? video?.aired,
    };
    const list = bySeason.get(season) ?? [];
    list.push(item);
    bySeason.set(season, list);
  }

  return Array.from(bySeason.entries())
    .sort(([a], [b]) => seasonSortKey(a) - seasonSortKey(b))
    .map(([number, episodes]) => ({
      number,
      episodes: episodes.sort((a, b) => a.episode - b.episode),
    }));
}

export default function DetailPage({
  onShellPreviewReady,
  onShellPreviewBackground,
  onBigPictureBackground,
  onBigPictureEpisodeNavigation,
  bigPictureEpisodeTransitioning = false,
  initialEpisodeRequest,
}: {
  onShellPreviewReady?: () => void;
  onShellPreviewBackground?: (background: string) => void;
  onBigPictureBackground?: (background: string) => void;
  onBigPictureEpisodeNavigation?: (to: string) => void;
  bigPictureEpisodeTransitioning?: boolean;
  initialEpisodeRequest?: DetailEpisodeRequest | null;
} = {}) {
  const { type, id } = useParams<{type:string;id:string}>();
  const navigate = useNavigate();
  const location = useLocation();
  const routeCacheKey = detailPageCacheKey(type, id);
  const initialCachedDetail = readPageDataCache<DetailData>("detail", routeCacheKey);
  const normalizedInitialDetail = initialCachedDetail ? normalizeDetailData({
    ...initialCachedDetail,
    backdrop: ensureOriginalTmdbImage(initialCachedDetail.backdrop) ?? initialCachedDetail.backdrop,
  }) : null;
  const initialBackgroundOverride = readDetailBackgroundOverride(type, id);
  const initialSeed = readDetailMediaMeta(type, id);
  const initialDetail = normalizedInitialDetail && initialBackgroundOverride
    ? {
      ...normalizedInitialDetail,
      backdrop: ensureOriginalTmdbImage(initialBackgroundOverride) ?? initialBackgroundOverride,
    }
    : normalizedInitialDetail ?? (type && id && initialSeed ? {
      id,
      name: initialSeed.name ?? "",
      type,
      ids: parseMediaIds(id),
      aliases: uniqueAliases(initialSeed.name, id),
      backdrop: ensureOriginalTmdbImage(initialBackgroundOverride ?? initialSeed.background)
        ?? initialBackgroundOverride
        ?? initialSeed.background,
      poster: initialSeed.poster,
      logo: sanitizeLogoUrl(initialSeed.logo),
      description: initialSeed.description,
      year: initialSeed.year,
      mdbListRatings: initialSeed.mdbListRatings,
    } : null);
  const [data, setData]         = useState<DetailData|null>(() => initialDetail);
  // El seed reserva el layout y puede mantenerse visible mientras la
  // revalidación resuelve el backdrop definitivo.
  const [loading, setLoading]   = useState(() => isBigPictureLocation(location.pathname) || !initialDetail);
  const [season, setSeason]     = useState(1);
  const [showMore, setShowMore] = useState(false);
  const [synopsisTop, setSynopsisTop] = useState<number | null>(null);
  const [progressVersion, setProgressVersion] = useState(0);
  const [logoStatus, setLogoStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [cachedLogo, setCachedLogo] = useState<string | null>(() => readCachedLogo(getDetailLogoKey(type, id)));
  const [tmdbComments, setTmdbComments] = useState<TmdbCommentReview[]>([]);
  const [tmdbCommentsLoading, setTmdbCommentsLoading] = useState(false);
  const [tmdbCommentsError, setTmdbCommentsError] = useState("");
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [inLibrary, setInLibrary] = useState(() => isInLibrary(type ?? "", id ?? ""));
  const [backgroundPickerOpen, setBackgroundPickerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const popupOpenTimerRef = useRef<number | null>(null);
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const detailMenuButtonRef = useRef<HTMLButtonElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  // Fade del hero ligado al scroll (vía imperativa con gsap.set, igual que el
  // blur del backdrop: no depende de la cascada CSS).
  const heroCopyRef = useRef<HTMLDivElement>(null);
  const heroCreditsRef = useRef<HTMLDivElement>(null);
  const awardBadgeRef = useRef<HTMLDivElement>(null);
  const detailContentRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const loadGenerationRef = useRef(0);
  const backdropImageRef = useRef<HTMLDivElement>(null);
  const backdropBlurAmountRef = useRef(0);
  const bgPrevImageRef = useRef<HTMLImageElement>(null);
  const bgCurrImageRef = useRef<HTMLImageElement>(null);
  const bgLoadTokenRef = useRef(0);
  const [bgStack, setBgStack] = useState<{ prev: string | null; curr: string }>(() => ({
    prev: null,
    curr: data?.backdrop ?? data?.poster ?? "",
  }));
  const logoImgRef = useRef<HTMLImageElement>(null);
  const logoPrevImageRef = useRef<HTMLImageElement>(null);
  const [logoStack, setLogoStack] = useState<{ prev: string | null; curr: string }>({ prev: null, curr: "" });
  const metadataVignetteRef = useRef<HTMLDivElement>(null);
  const metadataVignetteOpacityRef = useRef(1);
  const darkOverlayRef = useRef<HTMLDivElement>(null);
  const darkOverlayOpacityRef = useRef(0);
  // Zona de contenido (solo picture): el logo desplegado marca "ya bajaste".
  const pastHeroRef = useRef(false);
  const detailScrollTopRef = useRef(0);
  // La key del capítulo resume viaja en ref: el listener de
  // enterContentZone se registra una vez y si leyera el closure vería la key
  // del primer render (vacía).
  const episodeScrollKeyRef = useRef("");
  const getEnabled = useAddonStore(s => s.getEnabledAddons);
  const { allowTmdbArtworkFallback } = useHomePreferences();
  const mdbListSettings = useMdbListSettings();
  // En picture el detail es la misma page de PC pero con foco = escala sin
  // bordes, logo y créditos del hero no clicables, y foco inicial en Reproducir.
  const bigPicture = useBigPictureActive();
  // Episodie como sección embebida: nunca se sale del Detail, solo cambia de
  // sección sobre el MISMO fondo (una sola imagen). La sección se pilota con
  // el state del historial: abrir empuja una entrada, Atrás la cierra.
  const inShellPreview = Boolean(onShellPreviewReady ?? onShellPreviewBackground);
  const episodeRequestFromState = useMemo(() => readEpisodeRequestFromState(location.state), [location.state]);
  const episodeRequest = episodeRequestFromState ?? initialEpisodeRequest ?? null;
  const episodeOpen = Boolean(episodeRequest && data);
  const episodeSectionRef = useRef<HTMLDivElement>(null);
  const episodeWasOpenRef = useRef(false);
  // La sección solo se revela cuando confirma contenido listo. Mientras tanto
  // el Detail sigue visible sobre el mismo fondo: imposible quedarse en un
  // fondo vacío atascado.
  const [episodeSectionReady, setEpisodeSectionReady] = useState(false);
  // La sección viva adapta su query internamente; el ready se mantiene entre
  // peticiones para no re-animar al cambiar de episodio con ella abierta.
  const [sectionAttempt, setSectionAttempt] = useState(0);
  const episodeShown = episodeOpen && episodeSectionReady;
  const selectedEpisode = (episodeRequest && data?.seasons
    ?.find(season => season.number === episodeRequest.season)?.episodes
    ?.find(episode => episode.episode === episodeRequest.ep))
    ?? null;
  const episodeQueryOverride = useMemo(() => data && episodeRequest ? ({
    type: data.type,
    id: data.id,
    season: episodeRequest.season,
    episode: episodeRequest.ep,
    epTitle: episodeRequest.episodeName ?? selectedEpisode?.name,
    continue: episodeRequest.continue,
    autoplay: episodeRequest.autoplay,
    fromSearch: episodeRequest.fromSearch,
    q: episodeRequest.q,
    fromPlayer: episodeRequest.fromPlayer,
    name: data.name,
    background: data.backdrop,
    poster: data.poster,
    logo: data.logo,
    description: data.description,
    genres: data.genres,
    episodeTitle: selectedEpisode?.name,
    episodeOverview: selectedEpisode?.overview,
    episodeStill: selectedEpisode?.still,
    runtime: selectedEpisode?.runtime,
    airDate: selectedEpisode?.airDate,
    mdbListRatings: data.mdbListRatings,
    voteAverage: data.voteAverage,
    trailerVideoIds: data.trailers?.map(trailer => trailer.key).filter((key): key is string => Boolean(key)),
  }) : null, [
    data,
    // La identidad del request: pasar de null a {} (película sin campos) debe
    // recomputar aunque ningún campo opcional haya cambiado.
    episodeRequest,
    episodeRequest?.autoplay,
    episodeRequest?.continue,
    episodeRequest?.ep,
    episodeRequest?.episodeName,
    episodeRequest?.fromPlayer,
    episodeRequest?.fromSearch,
    episodeRequest?.q,
    episodeRequest?.season,
    selectedEpisode,
  ]);
  useEffect(() => {
    // La sección Episodie vive en otro chunk: precargarlo en reposo para que
    // la primera apertura no muestre la sección vacía mientras se resuelve.
    if (inShellPreview) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(() => { void loadEpisodieSection(); });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => { void loadEpisodieSection(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [inShellPreview]);
  const openEpisodeSection = (request: DetailEpisodeRequest) => {
    // Preload before changing sections so the shared backdrop can remain
    // unobstructed while the section chunk is resolved.
    void loadEpisodieSection();
    const baseState = (location.state && typeof location.state === "object" ? location.state : {}) as Record<string, unknown>;
    navigate(`${location.pathname}${location.search}`, {
      state: { ...baseState, episodeRequest: request },
    });
  };
  const closeEpisodeSection = () => {
    if (!episodeRequest) return;
    const baseState = (location.state && typeof location.state === "object" ? { ...(location.state as Record<string, unknown>) } : {}) as Record<string, unknown>;
    delete baseState.episodeRequest;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: Object.keys(baseState).length ? baseState : null,
    });
    window.setTimeout(() => {
      playButtonRef.current?.focus({ preventScroll: true });
    }, 60);
  };
  useBackAction(() => {
    if (consumeAutoResolveBackPress()) return;
    if (episodeOpen) closeEpisodeSection();
  }, !episodeOpen);
  const pickerItem = useMemo<MediaItem | null>(() => data ? {
    id: data.id,
    type: data.type,
    name: data.name,
    poster: data.poster,
    background: data.backdrop,
    logo: data.logo,
  } : null, [data]);
  const backgroundPickerOptions = useMemo<CardArtworkPickerOption[]>(
    () => (data?.backgroundOptions ?? []).map(option => ({
      url: option.url,
      label: option.label,
      preview: backgroundPreviewUrl(option.url),
    })),
    [data?.backgroundOptions],
  );
  const logoPickerOptions = useMemo<CardArtworkPickerOption[]>(
    () => (data?.logoOptions ?? []).map(option => ({
      url: sanitizeLogoUrl(option.url) ?? option.url,
      label: option.label,
      preview: option.url,
    })),
    [data?.logoOptions],
  );
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const tmdbIdForAwards = data?.ids?.tmdb ?? (id?.startsWith("tmdb:") ? Number(id.replace("tmdb:", "")) : null);
  const awardsType = data?.type ?? type ?? "";
  const awards = useAwardsByTmdbId(
    awardsType,
    typeof tmdbIdForAwards === "number" ? tmdbIdForAwards : null,
    Boolean(data && type && (tmdbIdForAwards !== null || data?.ids?.imdb || data?.ids?.anilist)),
    data?.ids?.imdb ?? null,
    data?.ids?.anilist ?? null,
    data?.name ?? null,
    data?.year ?? null,
  );
  function logoLog(event: string, extra?: Record<string, unknown>) {
    if (!DEBUG_LOGO) return;
    console.info("[AETHERIO:DETAIL:LOGO]", {
      event,
      ts: Number(performance.now().toFixed(1)),
      mediaType: type,
      mediaId: id,
      dataLogo: data?.logo ?? null,
      logoStatus,
      ...extra,
    });
  }

  useEffect(() => {
    const requestId = ++loadGenerationRef.current;
    if (type && id) void load(type, id, requestId);
    return () => {
      if (loadGenerationRef.current === requestId) loadGenerationRef.current += 1;
    };
  }, [
    type,
    id,
    allowTmdbArtworkFallback,
    mdbListSettings.enabled,
    mdbListSettings.apiKey,
    mdbListSettings.showTrakt,
    mdbListSettings.showImdb,
    mdbListSettings.showTmdb,
    mdbListSettings.showLetterboxd,
    mdbListSettings.showTomatoes,
    mdbListSettings.showMetacritic,
  ]);

  useEffect(() => {
    if (!showMore && !backgroundPickerOpen && !logoPickerOpen) return;
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const shellScroll = heroRef.current?.closest<HTMLElement>("[data-aetherio-scroll-shell]")
      ?? document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    const previousShellOverflowY = shellScroll?.style.overflowY ?? "";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    if (shellScroll) {
      shellScroll.style.overflowY = "hidden";
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      if (shellScroll) {
        shellScroll.style.overflowY = previousShellOverflowY;
      }
      window.scrollTo(0, scrollY);
    };
  }, [backgroundPickerOpen, logoPickerOpen, showMore]);

  useEffect(() => {
    return () => {
      if (popupOpenTimerRef.current !== null) window.clearTimeout(popupOpenTimerRef.current);
    };
  }, []);

  // En Big Picture el popup de sinopsis no tiene X: B del mando / Esc lo
  // cierra. En captura para preceder al back de BigPicture (burbuja); AppShell
  // y BigPicture lo ignoran cuando el popup está abierto (marcador DOM).
  useEffect(() => {
    if (!bigPicture || !showMore) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setShowMore(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [bigPicture, showMore]);

  useEffect(() => {
    if (data?.logo || cachedLogo) setLogoStatus("loaded");
    else setLogoStatus("idle");
  }, [data?.id, data?.logo, cachedLogo]);

  useLayoutEffect(() => {
    const name = getSharedElementName();
    if (!name) return;
    const target = heroRef.current ?? document.querySelector<HTMLElement>("[data-vt-hero-claim]");
    if (!target) return;
    playHeroExpandAnimation(target, () => { clearSharedElementName(); });
  }, [loading, data?.id]);

  useLayoutEffect(() => {
    if (!bigPicture && !isActiveDetailPath(location.pathname, type, id)) return;
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    gsap.killTweensOf([
      backdropImageRef.current,
      metadataVignetteRef.current,
      darkOverlayRef.current,
    ]);
    backdropBlurAmountRef.current = 0;
    metadataVignetteOpacityRef.current = 1;
    darkOverlayOpacityRef.current = 0;
    pastHeroRef.current = false;
    detailScrollTopRef.current = 0;
    detailScrollRef.current?.removeAttribute("data-past-hero");
    detailScrollRef.current?.removeAttribute("data-content-zone");
    // El fade del hero es estilo inline (gsap.set en updateBackdropBlur):
    // al cambiar de ruta se restaura sin depender de la cascada.
    if (heroCopyRef.current) gsap.set(heroCopyRef.current, { opacity: 1, y: 0 });
    if (heroCreditsRef.current) gsap.set(heroCreditsRef.current, { opacity: 1, y: 0 });
    gsap.set(backdropImageRef.current, { opacity: 1, filter: "blur(0px)", scale: 1 });
    gsap.set(metadataVignetteRef.current, { opacity: 1 });
    gsap.set(darkOverlayRef.current, { opacity: 0 });
  }, [bigPicture, type, id, location.pathname]);

  useLayoutEffect(() => {
    backdropBlurAmountRef.current = -1;
    updateBackdropBlur(detailScrollRef.current?.scrollTop ?? 0);
  }, [data?.backdrop, data?.poster]);

  // Crossfade del fondo del medio: al cambiar backdrop, se hace un fundido de la imagen anterior a la nueva
  // Sincroniza el stack del fondo. Si ya hay una imagen visible, la nueva se
  // precarga por completo antes de fundir: así el crossfade nunca muestra un
  // hueco negro ni un "pop" en los últimos frames mientras descarga.
  useLayoutEffect(() => {
    const next = data?.backdrop ?? data?.poster ?? "";
    if (!next || bgStack.curr === next) return;
    const token = ++bgLoadTokenRef.current;
    let cancelled = false;
    const commit = () => {
      if (cancelled || bgLoadTokenRef.current !== token) return;
      setBgStack(latest => (latest.curr === next ? latest : { prev: latest.curr || null, curr: next }));
    };
    if (!bgStack.curr) {
      commit();
      return () => { cancelled = true; };
    }
    const probe = new Image();
    probe.decoding = "async";
    probe.src = next;
    if (probe.complete && probe.naturalWidth > 0) {
      commit();
    } else {
      probe.onload = commit;
      probe.onerror = commit;
    }
    return () => { cancelled = true; };
  }, [data?.backdrop, data?.poster, bgStack.curr]);

  useLayoutEffect(() => {
    if (!bgStack.prev || bgStack.prev === bgStack.curr) return;
    const prevEl = bgPrevImageRef.current;
    const currEl = bgCurrImageRef.current;
    if (!prevEl || !currEl) return;
    const targetCurr = bgStack.curr;
    gsap.killTweensOf([prevEl, currEl]);
    gsap.to(prevEl, { opacity: 0, duration: 0.62, ease: "power1.out", overwrite: true });
    gsap.fromTo(currEl, { opacity: 0 }, {
      opacity: 1,
      duration: 0.62,
      ease: appleEase,
      overwrite: true,
      onComplete: () => setBgStack(current => (current.curr === targetCurr && current.prev ? { prev: null, curr: current.curr } : current)),
    });
    return () => gsap.killTweensOf([prevEl, currEl]);
  }, [bgStack]);

  // Crossfade del logo: al cambiar logo, fundido de la imagen anterior a la nueva.
  // Estos efectos van antes de cualquier return temprano (Rules of Hooks).
  useLayoutEffect(() => {
    const nextLogo = sanitizeLogoUrl(data?.logo) || cachedLogo;
    if (!nextLogo) return;
    setLogoStack(current => (current.curr === nextLogo ? current : { prev: current.curr || null, curr: nextLogo }));
  }, [data?.logo, cachedLogo]);

  useLayoutEffect(() => {
    if (!logoStack.prev || logoStack.prev === logoStack.curr) return;
    const prevEl = logoPrevImageRef.current;
    const currEl = logoImgRef.current;
    if (!prevEl || !currEl) return;
    const targetCurr = logoStack.curr;
    gsap.killTweensOf([prevEl, currEl]);
    gsap.to(prevEl, { opacity: 0, duration: 0.34, ease: "power1.out", overwrite: true });
    gsap.fromTo(currEl, { opacity: 0 }, {
      opacity: 1,
      duration: 0.34,
      ease: appleEase,
      overwrite: true,
      onComplete: () => setLogoStack(current => (current.curr === targetCurr && current.prev ? { prev: null, curr: current.curr } : current)),
    });
    return () => gsap.killTweensOf([prevEl, currEl]);
  }, [logoStack]);

  useLayoutEffect(() => {
    const root = detailContentRef.current;
    if (loading || !data || !root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(
      ".detail-page-hero > div, .detail-page-content > *:not(.detail-content-logo)",
    ));
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline.fromTo(
      backdropImageRef.current,
      { opacity: 0, scale: 1.02 },
      { opacity: 1, scale: 1, duration: 0.68 },
      0,
    );
    timeline.fromTo(
      items,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, clearProps: "transform" },
      0.08,
    );
    return () => {
      timeline.kill();
      gsap.set(backdropImageRef.current, { opacity: 1, filter: "blur(0px)", scale: 1, visibility: "inherit" });
      gsap.set(items, { clearProps: "opacity,visibility,transform" });
    };
  }, [loading, data?.id]);

  useLayoutEffect(() => {
    const badge = awardBadgeRef.current;
    const award = awards.featured;
    if (!badge || !award) return;

    const tween = gsap.fromTo(
      badge,
      {
        autoAlpha: 0,
        x: 14,
        y: 8,
        scale: 0.96,
      },
      {
        autoAlpha: 1,
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.52,
        ease: "power3.out",
        clearProps: "transform,visibility",
      },
    );

    return () => {
      tween.kill();
      gsap.set(badge, { clearProps: "opacity,transform,visibility" });
    };
  }, [
    awards.featured?.ceremony,
    awards.featured?.categoryEs,
    awards.featured?.awardYear,
    awards.featured?.status,
  ]);

  useEffect(() => {
    if (!type || !id) return;
    const refresh = () => setInLibrary(isInLibrary(type, id));
    refresh();
    window.addEventListener(LIBRARY_CHANGED_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
    };
  }, [id, type]);

  useEffect(() => () => { clearSharedElementName(); }, []);

  useEffect(() => {
    setCachedLogo(readCachedLogo(getDetailLogoKey(type, id)));
  }, [type, id]);

  useEffect(() => {
    const background = data?.backdrop ?? data?.poster;
    if (background) {
      onShellPreviewBackground?.(background);
      onBigPictureBackground?.(background);
    }
  }, [data?.backdrop, data?.poster, onBigPictureBackground, onShellPreviewBackground]);

  useEffect(() => {
    if (!loading && data) onShellPreviewReady?.();
  }, [loading, data, onShellPreviewReady]);

  // Al entrar a un detail en picture, el foco principal cae en Reproducir.
  //
  // No basta con un unico intento diferido: la page entra con una transicion que
  // arranca en `visibility: hidden`, y enfocar un elemento invisible es un no-op
  // silencioso para el navegador (focus() no lanza error, simplemente no pasa
  // nada). Con un solo disparo a 80 ms, si la page venia del buscador —que trae
  // la metadata ya cacheada y monta el detail de inmediato— el boton todavia no
  // era enfocable, el foco se perdia, y el nav espacial a los 380 ms se quedaba
  // con el primer candidato en vez de Reproducir.
  //
  // Por eso se reintenta durante ~700ms y se VERIFICA que el foco quedo donde
  // toca. Solo se abandona si el usuario movio el foco dentro de esta misma page.
  useEffect(() => {
    if (!bigPicture || loading || !data || episodeOpen) return;
    let attempts = 0;
    let timer = 0;
    // Solo se cede ante input REAL del usuario. Sin esto, el nav espacial enfoca el
    // primer candidato a los 380 ms (focusInitialContent) y eso se confundiria con
    // "el usuario movio el foco", perdiendo Reproducir otra vez.
    let userMoved = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow") || event.key === "Enter" || event.key === "Tab") {
        userMoved = true;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    const tryFocus = () => {
      const button = playButtonRef.current;
      if (button && document.activeElement === button) return;
      if (userMoved) {
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) return;
      }
      if (button) {
        button.focus({ preventScroll: true });
        // Verificacion: si el navegador lo rechazo (sigue oculto o sin foco), se
        // vuelve a intentar en el siguiente tick.
        if (document.activeElement === button) return;
      }
      attempts += 1;
      if (attempts >= 14) return;
      timer = window.setTimeout(tryFocus, 50);
    };
    timer = window.setTimeout(tryFocus, 40);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [bigPicture, loading, data?.id, episodeOpen]);

  // Transición Detail <-> sección Episodie sobre el MISMO fondo: el contenido
  // del Detail se funde hacia abajo, el fondo pasa a grayscale y la sección
  // entra. Solo corre cuando la sección confirma contenido (ready): nunca hay
  // dos imágenes ni un fondo vacío atascado.
  useLayoutEffect(() => {
    const wasOpen = episodeWasOpenRef.current;
    if (wasOpen === episodeShown) return;
    episodeWasOpenRef.current = episodeShown;
    const content = detailContentRef.current;
    const section = episodeSectionRef.current;
    const shell = detailScrollRef.current;
    const reduced = prefersReducedMotion();
    shell?.scrollTo({ top: 0, behavior: "auto" as ScrollBehavior });
    gsap.killTweensOf([content, section, backdropImageRef.current]);
    if (episodeShown) {
      if (content) {
        content.inert = true;
        content.setAttribute("aria-hidden", "true");
      }
      const timeline = gsap.timeline({
        onComplete: () => {
          window.setTimeout(() => {
            section?.querySelector<HTMLElement>("button, [tabindex='0']")?.focus({ preventScroll: true });
          }, 0);
        },
      });
      if (content) {
        timeline.to(content, {
          autoAlpha: 0,
          ...(reduced ? {} : { y: 34 }),
          duration: reduced ? 0.12 : 0.42,
          ease: "power3.out",
          overwrite: "auto",
        }, 0);
      }
      timeline.to(backdropImageRef.current, {
        opacity: 1,
        visibility: "inherit",
        filter: "blur(0px) grayscale(1)",
        duration: reduced ? 0.16 : 0.72,
        ease: "power3.out",
        overwrite: "auto",
      }, 0);
      if (section) {
        timeline.fromTo(section, { opacity: 0, y: reduced ? 0 : 26 }, {
          opacity: 1,
          y: 0,
          duration: reduced ? 0.12 : 0.44,
          ease: "power3.out",
          overwrite: "auto",
          clearProps: "transform",
        }, 0.08);
      }
    } else {
      if (content) {
        content.inert = false;
        content.removeAttribute("aria-hidden");
        gsap.fromTo(content, { autoAlpha: 0, y: reduced ? 0 : 34 }, {
          autoAlpha: 1,
          y: 0,
          duration: reduced ? 0.12 : 0.46,
          ease: "power3.out",
          overwrite: "auto",
          clearProps: "transform",
          onComplete: () => playButtonRef.current?.focus({ preventScroll: true }),
        });
      }
      gsap.to(backdropImageRef.current, {
        opacity: 1,
        visibility: "inherit",
        filter: `blur(${backdropBlurAmountRef.current}px) grayscale(0)`,
        duration: reduced ? 0.16 : 0.56,
        ease: "power3.out",
        overwrite: "auto",
      });
    }
  }, [episodeShown]);

  // Esc con la sección abierta la cierra (captura, antes del back exterior).
  useEffect(() => {
    if (!episodeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeEpisodeSection();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [episodeOpen]);

  // Port de onMoveToContent nativo: baja a la zona de contenido (el logo se
  // despliega y las tabs bajan a su sitio) y enfoca el primer contenido.
  function enterContentZone() {
    if (!bigPicture) return;
    const shell = detailScrollRef.current;
    const heroEl = heroRef.current;
    if (!shell || !heroEl) return;
    // El evento solo inicia el desplazamiento. El logo se habilita desde el
    // onScroll cuando el shell ya se está moviendo hacia el contenido.
    shell.removeAttribute("data-past-hero");
    shell.removeAttribute("data-content-zone");
    pastHeroRef.current = false;
    // The scaled detail moves one visual pixel per shell scroll pixel. Use
    // the rendered hero edge instead of converting it to layout coordinates;
    // the latter stops short and lets the scroll handler collapse the logo.
    const shellTop = shell.getBoundingClientRect().top;
    const heroBottom = heroEl.getBoundingClientRect().bottom;
    // El logo se revela progresivamente desde el scroll handler mientras el
    // desplazamiento suave atraviesa el final del hero.
    const target = Math.max(0, heroBottom - shellTop + 24);
    // El foco entra de frente, sin esperar al recorrido: la row ya está
    // scrolleada a su posición (initialScrollKey) y el tween vertical trae
    // el contenido a vista con la card enfocada.
    // Las tabs de temporada son solo indicador (LB/RB): el foco cae al
    // primer episodio o tráiler, nunca a la row de temporadas.
    // Si la serie se está viendo, cae en el capítulo que sigue (resume),
    // no en el primero.
    const resumeKey = episodeScrollKeyRef.current;
    const resume = resumeKey
      ? shell.querySelector<HTMLElement>(`.detail-episode-card[data-scroll-key="${resumeKey}"]`)
      : null;
    const ep = resume
      ?? shell.querySelector<HTMLElement>('.detail-episode-card[tabindex="0"]');
    const trailer = shell.querySelector<HTMLElement>(
      '[data-row-key$=":trailers"] button:not([disabled]), [data-row-key$=":trailers"] [tabindex="0"]',
    ) ?? shell.querySelector<HTMLElement>(".detail-page-content button");
    (ep ?? trailer)?.focus({ preventScroll: true });
    const reduced = prefersReducedMotion();
    if (reduced) {
      shell.scrollTo({ top: target, behavior: "auto" });
    } else {
      // Recorrido de referencia: 0.74 s clavados, no el smooth nativo. El
      // onUpdate alimenta al scroll handler porque el tween por propiedad no
      // siempre dispara scroll events en todos los frames.
      tweenTo(shell, {
        scrollTop: target,
        onUpdate: () => updateBackdropBlur(shell.scrollTop),
        onComplete: () => updateBackdropBlur(shell.scrollTop),
      }, DETAIL_ZONE_TRAVEL_S);
    }
  }

  // Port de onMoveToHero nativo: vuelve arriba y enfoca Reproducir.
  function exitToHeroZone() {
    if (!bigPicture) return;
    const shell = detailScrollRef.current;
    if (!shell) return;
    const reduced = prefersReducedMotion();
    shell.removeAttribute("data-past-hero");
    shell.removeAttribute("data-content-zone");
    pastHeroRef.current = false;
    // El foco vuelve de inmediato al hero; la animación visual y el scroll
    // continúan debajo, sin dejar la navegación atrapada durante 790ms.
    playButtonRef.current?.focus({ preventScroll: true });
    if (reduced) {
      shell.scrollTo({ top: 0, behavior: "auto" });
    } else {
      tweenTo(shell, {
        scrollTop: 0,
        onUpdate: () => updateBackdropBlur(shell.scrollTop),
        onComplete: () => updateBackdropBlur(shell.scrollTop),
      }, DETAIL_ZONE_TRAVEL_S);
    }
  }

  useEffect(() => {
    if (!bigPicture) return;
    const onEnter = () => enterContentZone();
    const onExit = () => exitToHeroZone();
    window.addEventListener(DETAIL_ENTER_CONTENT_EVENT, onEnter);
    window.addEventListener(DETAIL_EXIT_HERO_EVENT, onExit);
    return () => {
      window.removeEventListener(DETAIL_ENTER_CONTENT_EVENT, onEnter);
      window.removeEventListener(DETAIL_EXIT_HERO_EVENT, onExit);
    };
  }, [bigPicture]);

  // Sin guardián `window.history.pushState` (ver nota en Player/Episodie): esa
  // entrada real fuera del router desincronizaba el historial y el "atrás" desde
  // la ficha volvía al reproductor. El destino "atrás" de una ficha alcanzada desde
  // el selector de fuentes lo resuelve el shell (findDetailReturnDelta / fromStreams).

  useEffect(() => {
    const onUpdated = () => setProgressVersion(prev => prev + 1);
    window.addEventListener(CONTINUE_WATCHING_EVENT, onUpdated as EventListener);
    return () => window.removeEventListener(CONTINUE_WATCHING_EVENT, onUpdated as EventListener);
  }, []);

  async function load(t:string, mediaId:string, requestId = loadGenerationRef.current) {
    const isCurrent = () => requestId === loadGenerationRef.current;
    if (!isCurrent()) return;
    const cacheKey = detailPageCacheKey(t, mediaId);
    const backgroundOverride = readDetailBackgroundOverride(t, mediaId);
    const cachedDetail = readPageDataCache<DetailData>("detail", cacheKey);
    if (cachedDetail) {
      const hydrated = normalizeDetailData(await hydrateAnimeIdentity(cachedDetail));
      const resolved = {
        ...hydrated,
        backdrop: ensureOriginalTmdbImage(backgroundOverride ?? hydrated.backdrop)
          ?? backgroundOverride
          ?? hydrated.backdrop,
      };
      if (!isCurrent()) return;
      if (resolved !== cachedDetail) writePageDataCache("detail", cacheKey, resolved);
      setData(resolved);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Al cambiar de ruta sí descartamos el detalle anterior. En una
    // revalidación de la misma ruta conservamos el seed para no volver a
    // mostrar una pantalla de carga mientras TMDB/Jikan responden.
    if (!data || data.id !== mediaId) setData(null);
    const shouldUseTmdbArtwork = allowTmdbArtworkFallback || mediaId.startsWith("tmdb:");
    const logoOverride = readDetailLogoOverride(t, mediaId);
    const hasLogoOverride = logoOverride !== undefined;
    const overrideLogo = sanitizeLogoUrl(logoOverride);
    const cachedMediaLogo = hasLogoOverride ? overrideLogo : readCachedLogo(getDetailLogoKey(t, mediaId)) ?? undefined;
    const seededMeta = readDetailMediaMeta(t, mediaId);
    let d:DetailData = {
      id: mediaId,
      name: seededMeta?.name ?? "",
      type: t,
      ids: parseMediaIds(mediaId),
      aliases: uniqueAliases(seededMeta?.name, mediaId),
      backdrop: ensureOriginalTmdbImage(backgroundOverride ?? seededMeta?.background)
        ?? backgroundOverride
        ?? seededMeta?.background,
      poster: seededMeta?.poster,
      logo: hasLogoOverride ? overrideLogo : sanitizeLogoUrl(seededMeta?.logo) ?? cachedMediaLogo,
      description: seededMeta?.description,
      year: seededMeta?.year,
      mdbListRatings: seededMeta?.mdbListRatings,
      backgroundOptions: uniqueBackgroundOptions([
        backgroundOverride ? { url: backgroundOverride, label: "Fondo elegido", source: "cache" } : null,
        seededMeta?.background ? { url: seededMeta.background, label: "Aetherio", source: "cache" } : null,
      ]),
      logoOptions: uniqueLogoOptions([
        overrideLogo ? { url: overrideLogo, label: "Logo elegido", source: "cache" } : null,
        seededMeta?.logo ? { url: seededMeta.logo, label: "Aetherio", source: "cache" } : null,
        cachedMediaLogo ? { url: cachedMediaLogo, label: "Cache", source: "cache" } : null,
      ]),
    };
    // La ficha sembrada por Home conserva la identidad humana correcta. Los
    // add-ons son útiles para enriquecerla, pero no deben cambiar el título
    // que usaremos para desambiguar namespaces movie/tv.
    const requestedIdentityName = d.name;
    const requestedIdentityYear = d.year;
    // Home/Big Picture ya tiene metadata suficiente para pintar el shell.
    // Se muestra mientras addon/TMDB revalidan y enriquecen la página.
    if (d.name || d.poster || d.backdrop || d.logo) setData(d);
    const finish = async (next: DetailData) => {
      next = normalizeDetailData(await hydrateAnimeIdentity(next));
      if (!isCurrent()) return;
      logoLog("detail data ready", { resolvedLogo: next.logo ?? null });
      if (next.logo) setCachedLogo(writeCachedLogo(getDetailLogoKey(t, mediaId), next.logo) ?? null);
      else setCachedLogo(null);
      await Promise.all([
        preloadImage(next.backdrop),
        preloadImage(next.poster),
        preloadImage(next.logo),
      ]);
      writeDetailMediaMeta({
        id: next.id,
        type: next.type,
        name: next.name,
        poster: next.poster,
        background: next.backdrop,
        logo: next.logo,
        description: next.description,
        year: next.year,
        mdbListRatings: next.mdbListRatings,
      });
      writePageDataCache("detail", cacheKey, next);
      setData(next);
      setLoading(false);
    };
    const finishWithRatings = async (next: DetailData) => {
      if (!mdbListSettings.enabled || !mdbListSettings.apiKey.trim()) {
        await finish(next);
        return;
      }
      const ratings = await fetchMdbListRatingsForMedia({
        settings: mdbListSettings,
        mediaType: next.type,
        mediaId: typeof next.ids?.tmdb === "number" && next.ids.tmdb > 0 ? `tmdb:${next.ids.tmdb}` : next.id,
        imdbId: resolveDetailImdbId(next),
      }).catch(() => null);
      await finish(ratings ? { ...next, mdbListRatings: ratings } : next);
    };
    for (const addon of getEnabled()) {
      try {
        const base = addon.url.replace(/\/manifest\.json$/,"").replace(/\/$/,"");
        const metaTypes = t === "series" ? ["series", "tv"] : [t];
        let json: any = null;
        for (const metaType of metaTypes) {
          if (!addonSupportsMeta(addon, metaType, mediaId)) continue;
          const endpoint = `${base}/meta/${metaType}/${encodeURIComponent(mediaId)}.json`;
          logoLog("meta request start", { addonId: addon.id, endpoint });
          const res  = await fetch(endpoint);
          logoLog("meta response", { addonId: addon.id, endpoint, status: res.status, ok: res.ok });
          if (!res.ok) continue;
          json = await res.json();
          break;
        }
        if (!json) continue;
        const m    = json.meta ?? json;
        logoLog("meta payload mapped", {
          addonId: addon.id,
          payloadKeys: Object.keys(m ?? {}),
          rawLogo: m?.logo ?? null,
          background: m?.background ?? m?.backdrop ?? null,
          poster: m?.poster ?? null,
        });
        const addonSeasons = mapAddonSeasons(m);
        const addonTrailers = mapAddonTrailers(m, addon);
        const addonCast = mapAddonCast(m);
        const addonRelated = mapAddonRelated(m);
        const addonBackgroundOptions = collectAddonBackgroundOptions(m, addon.name ?? "Addon");
        const addonLogoOptions = collectAddonLogoOptions(m, addon.name ?? "Addon");
        d = {
          ...d,
          name: m.name ?? m.title ?? d.name,
          aliases: uniqueAliases(...(d.aliases ?? []), m.name, m.title, m.originalName, m.original_name, m.slug),
          backdrop: ensureOriginalTmdbImage(backgroundOverride ?? pickAddonArtwork(m.background, m.backdrop, m.fanart))
            ?? backgroundOverride
            ?? pickAddonArtwork(m.background, m.backdrop, m.fanart)
            ?? d.backdrop,
          poster: pickAddonArtwork(m.poster) ?? d.poster,
          logo: hasLogoOverride ? d.logo : sanitizeLogoUrl(m.logo) ?? d.logo,
          description: m.description ?? m.overview ?? d.description,
          year: m.year ?? d.year,
          runtime: m.runtime ?? d.runtime,
          genres: Array.isArray(m.genres) && m.genres.length ? m.genres : d.genres,
          rating: m.imdbRating ?? m.rating ?? d.rating,
          cast: addonCast ?? d.cast,
          director: mapAddonDirector(m) ?? d.director,
          productionCompanies: Array.isArray(m.productionCompanies) ? m.productionCompanies : d.productionCompanies,
          networks: Array.isArray(m.networks) ? m.networks : d.networks,
          trailers: addonTrailers ?? d.trailers,
          related: mergeRelatedItems(d.related, addonRelated),
          seasons: mergeSeasons(d.seasons, addonSeasons),
          backgroundOptions: uniqueBackgroundOptions([...(d.backgroundOptions ?? []), ...addonBackgroundOptions]),
          logoOptions: uniqueLogoOptions([...(d.logoOptions ?? []), ...addonLogoOptions]),
        };
        break;
      } catch {}
    }

    try {
      let tmdbId:number|null = null;
      let resolvedType: TmdbKind | null = null;
      let mainEs: any = null;
      let imgRes: any = null;
      let mainEn: any = null;

      if (mediaId.startsWith("tt")) {
        const fd = await tmdbFetch<any>(`/find/${mediaId}`, { params: { external_source: "imdb_id", language: "es-ES" } });
        const candidates: TmdbSearchCandidate[] = [
          ...(fd?.movie_results ?? []).map((item: any) => ({ kind: "movie" as const, item })),
          ...(fd?.tv_results ?? []).map((item: any) => ({ kind: "tv" as const, item })),
        ];
        const selected = pickTmdbSearchCandidate(candidates, requestedIdentityName, requestedIdentityYear, t === "anime");
        const fallback = t === "movie"
          ? candidates.find(candidate => candidate.kind === "movie")
          : t === "anime"
            ? selected ?? candidates.find(candidate => candidate.kind === "tv") ?? candidates.find(candidate => candidate.kind === "movie")
            : candidates.find(candidate => candidate.kind === "tv") ?? candidates.find(candidate => candidate.kind === "movie");
        tmdbId = Number(fallback?.item.id) || null;
        resolvedType = fallback?.kind ?? null;
      } else if (mediaId.startsWith("tmdb:")) {
        tmdbId = Number(mediaId.slice("tmdb:".length));
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) tmdbId = null;

        // Anime is an umbrella type: AniList/Jikan can resolve both series
        // and movies to the same numeric TMDB id. TMDB keeps movie and TV in
        // separate namespaces, so query both before choosing one. Example:
        // movie/229858 = Three Mothers, tv/229858 = Fate/strange Fake.
        if (tmdbId && t === "anime") {
          const directCandidates = (await Promise.all(([
            "movie",
            "tv",
          ] as TmdbKind[]).map(async requestedKind => {
            const item = await tmdbFetch<any>(`/${requestedKind}/${tmdbId}`, {
              params: { language: "es-ES", append_to_response: TMDB_DETAIL_APPEND },
            });
            if (!item) return null;
            const kind = inferTmdbKind(item, requestedKind);
            return { kind, item } satisfies TmdbSearchCandidate;
          }))).filter((candidate): candidate is TmdbSearchCandidate => candidate !== null);
          const uniqueCandidates = directCandidates.filter((candidate, index, list) => (
            list.findIndex(other => other.kind === candidate.kind && Number(other.item.id) === Number(candidate.item.id)) === index
          ));
          const selected = pickTmdbSearchCandidate(
            uniqueCandidates,
            requestedIdentityName,
            requestedIdentityYear,
            true,
          ) ?? uniqueCandidates.find(candidate => candidate.kind === "tv") ?? uniqueCandidates[0];
          if (selected) {
            tmdbId = Number(selected.item.id) || tmdbId;
            resolvedType = selected.kind;
            mainEs = selected.item;
          }
        } else if (tmdbId) {
          resolvedType = t === "movie" ? "movie" : "tv";
        }
      }

      if (!tmdbId && requestedIdentityName) {
        const isAnime = t === "anime";
        const searchTypes: TmdbKind[] = t === "movie" ? ["movie"] : isAnime ? ["movie", "tv"] : ["tv"];
        const candidates: TmdbSearchCandidate[] = [];
        for (const searchType of searchTypes) {
          const sd = await tmdbFetch<any>(`/search/${searchType}`, { params: { query: requestedIdentityName, language: "es-ES" } })
            ?? await tmdbFetch<any>(`/search/${searchType}`, { params: { query: requestedIdentityName, language: "en-US" } });
          for (const item of sd?.results ?? []) {
            if (item?.id) candidates.push({ kind: searchType, item });
          }
        }
        const selected = pickTmdbSearchCandidate(candidates, requestedIdentityName, requestedIdentityYear, isAnime);
        if (selected) {
          tmdbId = selected.item.id ?? null;
          resolvedType = selected.kind;
        }
      }
      if (!tmdbId) { await finishWithRatings(d); return; }

      let ep2Type: TmdbKind = resolvedType ?? (t === "movie" ? "movie" : "tv");
      let ep2 = `/${ep2Type}/${tmdbId}`;
      if (!mainEs) {
        [mainEs, imgRes, mainEn] = await Promise.all([
          tmdbFetch<any>(`${ep2}`, { params: { language: "es-ES", append_to_response: TMDB_DETAIL_APPEND } }),
          tmdbFetch<any>(`${ep2}/images`, { params: { include_image_language: "en,es,null" } }),
          tmdbFetch<any>(`${ep2}`, { params: { language: "en-US", append_to_response: TMDB_DETAIL_APPEND } }),
        ]);
      } else {
        [imgRes, mainEn] = await Promise.all([
          tmdbFetch<any>(`${ep2}/images`, { params: { include_image_language: "en,es,null" } }),
          tmdbFetch<any>(`${ep2}`, { params: { language: "en-US", append_to_response: TMDB_DETAIL_APPEND } }),
        ]);
      }

      // The proxy may transparently try the opposite namespace after a 404.
      // Keep the resolved type in sync with the payload rather than trusting
      // the original request path.
      const actualMainKind = inferTmdbKind(mainEs ?? mainEn, ep2Type);
      if (actualMainKind !== ep2Type) {
        ep2Type = actualMainKind;
        resolvedType = actualMainKind;
      }

      if (!mainEs && !mainEn && (ep2Type === "tv" || t === "anime")) {
        ep2Type = ep2Type === "tv" ? "movie" : "tv";
        ep2 = `/${ep2Type}/${tmdbId}`;
        resolvedType = ep2Type;
        [mainEs,imgRes,mainEn]=await Promise.all([
          tmdbFetch<any>(`${ep2}`, { params: { language: "es-ES", append_to_response: TMDB_DETAIL_APPEND } }),
          tmdbFetch<any>(`${ep2}/images`, { params: { include_image_language: "en,es,null" } }),
          tmdbFetch<any>(`${ep2}`, { params: { language: "en-US", append_to_response: TMDB_DETAIL_APPEND } }),
        ]);
      }
      const main=mainEs ?? mainEn;
      const imgs=imgRes ?? {};
      if (!main) { await finishWithRatings(d); return; }
      const explicitTmdbIdentity = /^tmdb:\d+$/i.test(mediaId);
      if (explicitTmdbIdentity) {
        // A numeric tmdb id is the stable identity. Once its namespace has
        // been resolved, addon metadata must not be allowed to turn the
        // title into another work that happens to share that number.
        d.name = main.title ?? main.name ?? d.name;
        d.description = main.overview ?? d.description;
        d.year = parseInt((main.release_date ?? main.first_air_date ?? "").slice(0, 4), 10) || d.year;
        d.genres = Array.isArray(main.genres) && main.genres.length
          ? main.genres.map((genre: any) => genre.name).filter(Boolean)
          : d.genres;
        d.cast = undefined;
        d.director = undefined;
        d.directorId = undefined;
        d.productionCompanies = undefined;
        d.networks = undefined;
        d.trailers = undefined;
        d.related = undefined;
        d.seasons = undefined;
      }
      d.ids = {
        ...d.ids,
        tmdb: tmdbId,
        imdb: main.external_ids?.imdb_id ?? d.ids?.imdb,
        mal: d.ids?.mal,
        anilist: d.ids?.anilist,
      };
      d.aliases = uniqueAliases(
        ...(d.aliases ?? []),
        main.title,
        main.name,
        main.original_title,
        main.original_name,
        mainEn?.title,
        mainEn?.name,
        mainEn?.original_title,
        mainEn?.original_name,
      );

      const logos = imgs.logos ?? [];
      d.logoOptions = uniqueLogoOptions([...(d.logoOptions ?? []), ...collectTmdbLogoOptions(logos)]);
      const logo = logos.find((item:any)=>item.iso_639_1==="es")
        ?? logos.find((item:any)=>item.iso_639_1==="en")
        ?? logos.find((item:any)=>item.iso_639_1===null)
        ?? logos[0];
      if (!hasLogoOverride&&shouldUseTmdbArtwork&&logo&&!d.logo) d.logo=`${IMG}/w500${logo.file_path}`;
      logoLog("tmdb logo fallback", { tmdbLogoPath: logo?.file_path ?? null, resolvedLogo: d.logo ?? null });
      const preferredBackdrop = pickPreferredTmdbBackdrop(imgs.backdrops, main.backdrop_path);
      d.backgroundOptions = uniqueBackgroundOptions([
        ...(d.backgroundOptions ?? []),
        ...collectTmdbBackgroundOptions(imgs.backdrops, main.backdrop_path),
      ]);
      if (shouldUseTmdbArtwork && preferredBackdrop && (!d.backdrop || isTmdbImageUrl(d.backdrop))) d.backdrop=preferredBackdrop;
      if (backgroundOverride) d.backdrop = backgroundOverride;
      if (shouldUseTmdbArtwork&&!d.poster&&main.poster_path)     d.poster=`${IMG}/w780${main.poster_path}`;
       if (explicitTmdbIdentity || !d.description || t === "anime") d.description=main.overview ?? d.description;
       if (explicitTmdbIdentity || !d.year) d.year=parseInt((main.release_date??main.first_air_date??"").slice(0,4),10)||d.year;
       if (explicitTmdbIdentity || !d.genres?.length) d.genres=main.genres?.map((g:any)=>g.name);
      const genreIds = new Set<number>((main.genres ?? []).map((g: any) => Number(g?.id)).filter((id: number) => Number.isFinite(id)));
      const isActuallyAnime = t === "anime"
        || (main.genres ?? []).some((g: any) => String(g?.name ?? "").toLowerCase() === "anime")
        || (genreIds.has(16) && main.original_language === "ja");
      if (resolvedType === "movie") d.type = "movie";
      else if (isActuallyAnime) d.type = "anime";
       if (explicitTmdbIdentity || !d.name) d.name=main.title??main.name??"";
       if (typeof main.vote_average === "number") d.voteAverage=main.vote_average;
       if (explicitTmdbIdentity || !d.runtime){ const mins=resolvedType === "movie" ? main.runtime : main.episode_run_time?.[0]; if(mins) d.runtime=formatRuntime(mins); }
       d.productionCompanies = mapTmdbCompanies(main.production_companies) ?? d.productionCompanies;
       d.networks = mapTmdbCompanies(main.networks) ?? d.networks;
      const castSource = t === "movie" ? main.credits?.cast : main.aggregate_credits?.cast ?? main.credits?.cast;
      const tmdbCast: CastMember[] = (castSource??[]).map((c:any)=>({
        id:c.id,
        name:c.name,
        character:c.character || c.roles?.[0]?.character || "",
        profile_path:c.profile_path?`${IMG}/w500${c.profile_path}`:undefined,
      }));
      const leadingCast: CastMember[] = [];
      if (t === "movie") {
        const directors = (main.credits?.crew??[])
          .filter((member:any)=>member.job==="Director")
          .filter((member:any,index:number,items:any[])=>items.findIndex(candidate=>candidate.name===member.name)===index)
          .slice(0,2);
        for (const director of directors) {
          leadingCast.push({
            id:director.id,
            name:director.name,
            character:"Director",
            profile_path:director.profile_path?`${IMG}/w500${director.profile_path}`:undefined,
          });
        }
      } else {
        for (const creator of (main.created_by??[]).slice(0,2)) {
          leadingCast.push({
            id:creator.id,
            name:creator.name,
            character:"Creator",
            profile_path:creator.profile_path?`${IMG}/w500${creator.profile_path}`:undefined,
          });
        }
        if (!leadingCast.length) {
          const crew = main.aggregate_credits?.crew ?? main.credits?.crew ?? [];
          for (const director of crew.filter((member:any)=>member.job==="Director" || member.jobs?.some((job:any)=>job.job==="Director")).slice(0,2)) {
            leadingCast.push({
              id:director.id,
              name:director.name,
              character:"Director",
              profile_path:director.profile_path?`${IMG}/w500${director.profile_path}`:undefined,
            });
          }
        }
      }
      const combinedCast = [...leadingCast, ...tmdbCast].filter((member,index,items)=>(
        items.findIndex(candidate=>String(candidate.id)===String(member.id))===index
      ));
      if (combinedCast.length) d.cast=combinedCast;

      if (isActuallyAnime) {
        console.log("[anime-cast] isActuallyAnime=true, ids:", { mal: d.ids?.mal, imdb: d.ids?.imdb, tmdb: d.ids?.tmdb, type: t, name: d.name, year: d.year });
        const malId = await resolveMalId({
          malId: d.ids?.mal,
          imdbId: d.ids?.imdb,
          tmdbId: typeof tmdbId === "number" ? tmdbId : Number(tmdbId),
          title: d.name || main.name || main.original_name || main.original_title,
          year: d.year,
        });
        console.log("[anime-cast] resolved malId:", malId);
        if (malId && Number.isFinite(malId)) {
          d.ids.mal = malId;
          try {
            console.log("[anime-cast] fetching characters for mal:", malId);
            const jikanChars = await fetchAnimeCast(malId);
            console.log("[anime-cast] returned", jikanChars.length, "characters");
            if (jikanChars.length) {
              d.cast = jikanChars.map((ch) => ({
                id: ch.voiceActorId || `jikan-char:${ch.malId}`,
                name: ch.name,
                character: ch.voiceActor || "",
                profile_path: ch.image,
                voiceActorId: ch.voiceActorId,
                _role: ch.role,
              } as CastMember & { _role?: string }));
            }
          } catch (err) {
            console.warn("[anime-cast] Jikan fetch failed:", err);
          }
        } else {
          console.warn("[anime-cast] no malId resolved, falling back to TMDB cast");
        }
      }

       if (explicitTmdbIdentity || !d.director){ const crew = [...(main.credits?.crew ?? []), ...(main.aggregate_credits?.crew ?? [])]; const dir = crew.find((c:any)=>c.job==="Director" || c.jobs?.some((j:any)=>j.job==="Director")); if(dir) { d.director=dir.name; d.directorId=dir.id; } }
      let trailerResults = (main.videos?.results??[]).filter((v:any)=>v.site==="YouTube"&&(v.type==="Trailer"||v.type==="Teaser"));
      if (!trailerResults.length) {
        try {
          const videosJson = await tmdbFetch<any>(`${ep2}/videos`, { params: { language: "en-US" } });
          trailerResults = (videosJson?.results??[]).filter((v:any)=>v.site==="YouTube"&&(v.type==="Trailer"||v.type==="Teaser"));
        } catch {}
      }
      if (!d.trailers?.length) d.trailers=trailerResults.slice(0,5).map((v:any)=>({key:v.key,name:v.name}));
      d.related=mergeRelatedItems(d.related, buildRelatedItems(main, t));

      const collection = await fetchDetailCollection({
        mediaId,
        mediaType: t,
        tmdbId,
        title: d.name,
        tmdbData: main,
      }).catch(() => null);
      if (collection?.items.length) {
        d.collection = collection.items;
        d.collectionName = collection.name;
        const collectionIds = new Set(collection.items.map(item => `${item.type}:${item.id}`));
        d.related = d.related?.filter(item => !collectionIds.has(`${item.media_type}:tmdb:${item.id}`));
      }

      if (t!=="movie"&&main.seasons&&(!d.seasons?.length || !hasRegularEpisodes(d.seasons))) {
        const seasonResults = await Promise.allSettled(
          (main.seasons ?? []).filter((s: any) => s.season_number >= 0).map(async (s: any) => {
            try {
              const sd2 = await tmdbFetch<any>(`/tv/${tmdbId}/season/${s.season_number}`, { params: { language: "es-ES" } })
                ?? await tmdbFetch<any>(`/tv/${tmdbId}/season/${s.season_number}`, { params: { language: "en-US" } });
              if (!sd2) return null;
              return { number: s.season_number, episodes: (sd2.episodes ?? []).map((e: any) => ({ id: `${tmdbId}:${s.season_number}:${e.episode_number}`, episode: e.episode_number, season: s.season_number, name: e.name, overview: e.overview, still: e.still_path ? `${IMG}/original${e.still_path}` : undefined, runtime: e.runtime, airDate: e.air_date })) };
            } catch { return null; }
          }),
        );
        const seasons: Array<{ number: number; episodes: Episode[] }> = [];
        for (const r of seasonResults) {
          if (r.status === "fulfilled" && r.value) seasons.push(r.value);
        }
        d.seasons = mergeSeasons(d.seasons, seasons);
      }
    } catch(e){ console.warn("TMDB:",e); }

    await finishWithRatings(d);
  }

  const playbackEntries = useMemo(() => readPlaybackStateEntries(), [progressVersion]);

  const episodeByKey = useMemo(() => {
    const map = new Map<string, Episode>();
    if (!data?.seasons) return map;
    for (const season of data.seasons) {
      for (const ep of season.episodes) {
        map.set(`${ep.season}:${ep.episode}`, ep);
      }
    }
    return map;
  }, [data?.seasons]);

  const episodeProgressMap = useMemo(() => {
    if (!data || data.type === "movie") return new Map<string, ContinueWatchingEntry>();
    const map = new Map<string, ContinueWatchingEntry>();
    for (const entry of playbackEntries) {
      if (!detailEntryMatches(data, entry)) continue;
      if (typeof entry.season !== "number" || !entry.episode) continue;
      const displayEpisode = findDisplayEpisodeForEntry(data, entry, episodeByKey);
      const key = getEpisodeKey(displayEpisode?.season ?? entry.season, displayEpisode?.episode ?? entry.episode);
      if (!key) continue;
      const existing = map.get(key);
      if (
        !existing ||
        (entry.completed && !existing.completed) ||
        (!existing.completed && !entry.completed && progressPercent(entry) > progressPercent(existing)) ||
        (entry.completed === existing.completed && entry.updatedAt > existing.updatedAt)
      ) {
        map.set(key, entry);
      }
    }
    return map;
  }, [data, playbackEntries]);

  const completedEpisodeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, entry] of episodeProgressMap) {
      if (entry.completed) keys.add(key);
    }
    return keys;
  }, [episodeProgressMap]);

  const seasonMarkedMap = useMemo(() => {
    const map = new Map<number, boolean>();
    if (!data?.seasons) return map;
    for (const season of data.seasons) {
      const unlocked = season.episodes.filter(item => !isEpisodeLocked(item));
      const allCompleted = unlocked.length > 0 && unlocked.every(item => completedEpisodeKeys.has(`${item.season}:${item.episode}`));
      map.set(season.number, allCompleted);
    }
    return map;
  }, [data?.seasons, completedEpisodeKeys]);

  const completedMediaKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of playbackEntries) {
      if (entry.completed) keys.add(entry.mediaKey);
    }
    return keys;
  }, [playbackEntries]);

  const resumeEntry = useMemo(() => {
    if (!data) return null;
    return playbackEntries
      .filter(entry => detailEntryMatches(data, entry) && isResumableDetailEntry(entry))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }, [data, playbackEntries]);

  const focusEpisodeEntry = useMemo(() => {
    if (!data) return null;
    const matched = playbackEntries
      .filter(entry => detailEntryMatches(data, entry) && typeof entry.season === "number" && Boolean(entry.episode));
    return (
      matched
        .filter(isResumableDetailEntry)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      matched
        .filter(entry => entry.completed)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      null
    );
  }, [data, playbackEntries]);

  const focusDisplayEpisode = data && focusEpisodeEntry ? findDisplayEpisodeForEntry(data, focusEpisodeEntry, episodeByKey) : null;
  const focusTargetEpisode = (() => {
    if (!data) return null;
    const regular = (data.seasons ?? [])
      .filter(item => item.number > 0)
      .sort((a, b) => a.number - b.number);
    const firstEpisode = regular[0]?.episodes?.[0] ?? null;
    if (!focusEpisodeEntry) return firstEpisode;
    if (!focusDisplayEpisode) return firstEpisode;
    if (!focusEpisodeEntry.completed) return focusDisplayEpisode;
    return findNextEpisode(regular, focusDisplayEpisode.season, focusDisplayEpisode.episode) ?? focusDisplayEpisode;
  })();
  const episodeScrollKey = focusTargetEpisode
    ? getEpisodeKey(focusTargetEpisode.season, focusTargetEpisode.episode)
    : "";

  useEffect(() => {
    episodeScrollKeyRef.current = episodeScrollKey;
  }, [episodeScrollKey]);

  useEffect(() => {
    if (!data) {
      setTmdbComments([]);
      setTmdbCommentsError("");
      setTmdbCommentsLoading(false);
      return;
    }

    let cancelled = false;

    const commentsCacheKey = `tmdb:${data.type}:${data.id}`;
    const cachedComments = readPageDataCache<TmdbCommentReview[]>("detail-comments", commentsCacheKey);
    if (cachedComments) {
      setTmdbComments(cachedComments);
      setTmdbCommentsError("");
      setTmdbCommentsLoading(false);
      return;
    }

    if (!data.ids?.tmdb && !data.id.startsWith("tmdb:") && !data.ids?.imdb) {
      setTmdbComments([]);
      setTmdbCommentsError("");
      setTmdbCommentsLoading(false);
      return;
    }

    setTmdbCommentsLoading(true);
    setTmdbCommentsError("");
    void fetchTmdbCommentsForMedia({
      type: data.type,
      id: data.id,
      tmdbId: data.ids?.tmdb,
      imdbId: data.ids?.imdb,
    }).then(items => {
      if (cancelled) return;
      writePageDataCache("detail-comments", commentsCacheKey, items);
      setTmdbComments(items);
      setTmdbCommentsError("");
    }).catch(error => {
      if (cancelled) return;
      setTmdbComments([]);
      setTmdbCommentsError(String(error instanceof Error ? error.message : error));
    }).finally(() => {
      if (!cancelled) setTmdbCommentsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    data?.id,
    data?.ids?.imdb,
    data?.ids?.tmdb,
    data?.type,
  ]);

  useEffect(() => {
    const targetSeason = focusTargetEpisode?.season;
    if (!targetSeason) return;
    setSeason(current => current === targetSeason ? current : targetSeason);
  }, [focusTargetEpisode?.season]);

  const regularSeasons = data?.seasons?.filter(s => s.number > 0) ?? [];
  const curSeason = regularSeasons.find(s => s.number === season) ?? regularSeasons[0];

  // Keep this hook before the loading returns below. Detail data arrives
  // asynchronously, so placing it after an early return changes the hook
  // count between the loading and loaded renders.
  useEffect(() => {
    if (!bigPicture || regularSeasons.length < 2) return;
    const seasonNumbers = regularSeasons.map(item => item.number);
    // Al entrar a la temporada el foco cae en el episodio que se está viendo
    // (con progreso sin terminar) o en el primer episodio disponible.
    const focusSeasonEpisode = (nextSeason: number) => {
      const shell = detailScrollRef.current;
      if (!shell) return;
      const nextData = regularSeasons.find(item => item.number === nextSeason);
      const episodes = nextData?.episodes ?? [];
      if (!episodes.length) return;
      const watching = episodes.find(episode => {
        const entry = episodeProgressMap.get(`${nextSeason}:${episode.episode}`);
        return entry && !entry.completed;
      });
      const firstOpen = episodes.find(episode => !isEpisodeLocked(episode));
      const target = watching ?? firstOpen ?? episodes[0];
      if (!target) return;
      const key = getEpisodeKey(nextSeason, target.episode);
      window.setTimeout(() => {
        const card = (key
          ? shell.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`)
          : null) ?? shell.querySelector<HTMLElement>('.detail-episode-card[tabindex="0"]');
        card?.focus({ preventScroll: true });
        card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }, 140);
    };
    const switchSeason = (direction: 1 | -1) => {
      const shell = detailScrollRef.current;
      // LB/RB are the season controls in Big Picture. Do not couple them to
      // the scroll marker: that marker is visual state and can briefly lag
      // while the detail shell is moving into the content zone.
      if (!bigPicture || !shell) return false;
      const currentNumber = curSeason?.number ?? season;
      const currentIndex = seasonNumbers.indexOf(currentNumber);
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : seasonNumbers.length - 1)
        : (currentIndex + direction + seasonNumbers.length) % seasonNumbers.length;
      const nextSeason = seasonNumbers[nextIndex];
      if (nextSeason === undefined || nextSeason === currentNumber) return false;
      setSeason(nextSeason);
      focusSeasonEpisode(nextSeason);
      return true;
    };
    const onGamepadAction = (event: Event) => {
      const actionId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (actionId !== "lb" && actionId !== "rb") return;
      if (switchSeason(actionId === "lb" ? -1 : 1)) event.preventDefault();
    };
    // Respaldo de teclado (PageUp/PageDown es lo que emite el mando si nadie
    // reclama lb/rb): permite probar sin gamepad físico.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "PageUp" && event.key !== "PageDown") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (switchSeason(event.key === "PageUp" ? -1 : 1)) event.preventDefault();
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [bigPicture, regularSeasons, curSeason?.number, season, data?.id, episodeProgressMap]);

  const dataMatchesRoute = detailDataMatchesRoute(data, id);
  if (loading && !dataMatchesRoute) {
    if (bigPicture) return <LoadingState label="Cargando detalle" shellPreviewLoading />;
    return (
    <div
      data-vt-hero-claim
      style={{
        position: "relative",
        width: "100vw",
        left: "50%",
        marginLeft: "-50vw",
        height: "100vh",
        marginTop: "calc(-1 * var(--app-shell-nav-height))",
        overflow: "hidden",
        background: "#08090b",
      }}
    >
      <div className="detail-page-scale" style={{ position:"relative",minHeight:"100vh" }}>
        <div className="detail-page-hero" style={{ position:"relative",width:"100vw",left:"50%",marginLeft:"-50vw",height:bigPicture ? BIG_PICTURE_DETAIL_HERO_HEIGHT : DETAIL_HERO_HEIGHT,minHeight:540,overflow:"hidden" }}>
          <div className="skeleton" style={{ position:"absolute",inset:0,opacity:0.38 }} />
          <div style={{ position:"absolute",inset:0,background:"linear-gradient(90deg, rgba(0,0,0,0.78), rgba(0,0,0,0.18) 58%, transparent)" }} />
          <div style={{ position:"absolute",left:"var(--app-safe-x)",bottom:4,width:460,maxWidth:"42vw",paddingBottom:22,display:"flex",flexDirection:"column",gap:11 }}>
            <div className="skeleton" style={{ width:250,height:72,borderRadius:12 }} />
            <div className="skeleton" style={{ width:285,height:15,borderRadius:999 }} />
            <div className="skeleton" style={{ width:"100%",height:13,borderRadius:999 }} />
            <div className="skeleton" style={{ width:"82%",height:13,borderRadius:999 }} />
            <div style={{ display:"flex",gap:12,marginTop:9 }}>
              <div className="skeleton" style={{ width:180,height:48,borderRadius:999 }} />
              <div className="skeleton" style={{ width:48,height:48,borderRadius:999 }} />
            </div>
          </div>
        </div>
        <div style={{ padding:"24px var(--app-safe-x)",overflow:"hidden" }}>
          <div className="skeleton" style={{ width:150,height:18,borderRadius:999,marginBottom:18 }} />
          <div style={{ display:"flex",gap:10 }}>
            {[0,1,2,3,4].map(item => (
              <div key={item} className="skeleton" style={{ width:302,height:196,borderRadius:14,flexShrink:0 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
    );
  }
  if (!dataMatchesRoute || !data) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"80vh",color:"rgba(255,255,255,0.4)" }}>Error cargando.</div>;
  const detailData = data;

  const isMovie = detailData.type==="movie";
  const typeLabel = isMovie ? "Película" : data.type === "anime" ? "Anime" : "Programa de TV";
  const DESC_MAX  = 180;
  const normalizedDescription = normalizeMojibakeText(data.description ?? "");
  const descShort = normalizedDescription.length > DESC_MAX
    ? normalizedDescription.slice(0, DESC_MAX) + "..."
    : normalizedDescription;
  const hasMore   = (data.description ?? "").length>DESC_MAX;
  const specialSeason = data.seasons?.find(s=>s.number===0);

  const displayLogo = sanitizeLogoUrl(data.logo) || cachedLogo;
  const playLabel = resumeEntry ? `Continuar ${formatResumeTime(resumeEntry.currentTime)}` : "Reproducir";
  const playableEpisodes = regularSeasons.flatMap(item => item.episodes).filter(item => !isEpisodeLocked(item));
  const showMarkedWatched = isMovie
    ? playbackEntries.some(entry => detailEntryMatches(detailData, entry) && entry.completed)
    : playableEpisodes.length > 0 && playableEpisodes.every(item => episodeProgressMap.get(getEpisodeKey(item.season, item.episode))?.completed);

  function markEpisodeFromCard(episode: Episode) {
    const marked = markEpisodeAsWatched({
      query: { type: detailData.type, id: detailData.id, season: episode.season, episode: episode.episode },
      name: detailData.name,
      episodeName: episode.name,
      runtimeSeconds: (episode.runtime ?? 0) * 60,
      logo: sanitizeLogoUrl(detailData.logo) ?? cachedLogo ?? undefined,
      background: detailData.backdrop,
      poster: detailData.poster,
    });
    void syncTraktMarkedWatched(marked);
    const nextEpisode = findNextEpisode(regularSeasons, episode.season, episode.episode);
    if (nextEpisode) {
      saveNextEpisodePrompt({
        query: { type: detailData.type, id: detailData.id, season: nextEpisode.season, episode: nextEpisode.episode },
        name: detailData.name,
        episodeName: nextEpisode.name,
        runtimeSeconds: (nextEpisode.runtime ?? 0) * 60,
        logo: sanitizeLogoUrl(detailData.logo) ?? cachedLogo ?? undefined,
        background: nextEpisode.still ?? detailData.backdrop,
        episodeStill: nextEpisode.still,
        poster: detailData.poster,
        entryKind: nextEpisode.season > episode.season ? "new" : "next",
        source: "local",
      });
    }
  }

  function findPlaybackEntryForEpisode(
    episode: Episode,
    entries: ContinueWatchingEntry[],
  ) {
    return entries.find(entry => (
      detailEntryMatches(detailData, entry) &&
      typeof entry.season === "number" &&
      entry.season === episode.season &&
      entry.episode === episode.episode
    )) ?? null;
  }

  function markEpisodeAsUnwatched(episode: Episode, entries: ContinueWatchingEntry[]) {
    const target = findPlaybackEntryForEpisode(episode, entries);
    if (!target) return;
    const removed = removeContinueWatchingEntry(target.key);
    void syncTraktRemovePlayback(removed ?? target);
    void syncTraktMarkedUnwatched(removed ?? target);
  }

  function markSeasonAsWatched(seasonNumber: number) {
    const seasonData = detailData.seasons?.find(item => item.number === seasonNumber);
    if (!seasonData) return;
    for (const episode of seasonData.episodes) {
      if (isEpisodeLocked(episode)) continue;
      markEpisodeFromCard(episode);
    }
    const nextSeasonEpisode = regularSeasons
      .filter(item => item.number > seasonNumber)
      .sort((a, b) => a.number - b.number)[0]
      ?.episodes?.[0];
    if (nextSeasonEpisode) {
      saveNextEpisodePrompt({
        query: { type: detailData.type, id: detailData.id, season: nextSeasonEpisode.season, episode: nextSeasonEpisode.episode },
        name: detailData.name,
        episodeName: nextSeasonEpisode.name,
        runtimeSeconds: (nextSeasonEpisode.runtime ?? 0) * 60,
        logo: sanitizeLogoUrl(detailData.logo) ?? cachedLogo ?? undefined,
        background: nextSeasonEpisode.still ?? detailData.backdrop,
        episodeStill: nextSeasonEpisode.still,
        poster: detailData.poster,
        entryKind: nextSeasonEpisode.season > seasonNumber ? "new" : "next",
        source: "local",
      });
    }
  }

  function markSeasonAsUnwatched(seasonNumber: number) {
    const seasonData = detailData.seasons?.find(item => item.number === seasonNumber);
    if (!seasonData) return;
    const entries = readPlaybackStateEntries();
    for (const episode of seasonData.episodes) {
      markEpisodeAsUnwatched(episode, entries);
    }
  }

  function markPreviousEpisodesAsWatched(seasonNumber: number, episodeNumber: number) {
    const previousEpisodes = getPreviousEpisodesBefore(seasonNumber, episodeNumber);
    for (const episode of previousEpisodes) {
      if (isEpisodeLocked(episode)) continue;
      markEpisodeFromCard(episode);
    }
    const currentEpisode = detailData.seasons
      ?.find(item => item.number === seasonNumber)
      ?.episodes.find(item => item.episode === episodeNumber);
    if (currentEpisode) {
      saveNextEpisodePrompt({
        query: { type: detailData.type, id: detailData.id, season: currentEpisode.season, episode: currentEpisode.episode },
        name: detailData.name,
        episodeName: currentEpisode.name,
        runtimeSeconds: (currentEpisode.runtime ?? 0) * 60,
        logo: sanitizeLogoUrl(detailData.logo) ?? cachedLogo ?? undefined,
        background: currentEpisode.still ?? detailData.backdrop,
        episodeStill: currentEpisode.still,
        poster: detailData.poster,
        entryKind: currentEpisode.season > seasonNumber ? "new" : "next",
        source: "local",
      });
    }
  }

  function markPreviousEpisodesAsUnwatched(seasonNumber: number, episodeNumber: number) {
    const entries = readPlaybackStateEntries();
    for (const episode of getPreviousEpisodesBefore(seasonNumber, episodeNumber)) {
      markEpisodeAsUnwatched(episode, entries);
    }
  }

  function getPreviousEpisodesBefore(seasonNumber: number, episodeNumber: number) {
    return regularSeasons
      .flatMap(item => item.episodes)
      .filter(episode => (
        episode.season < seasonNumber ||
        (episode.season === seasonNumber && episode.episode < episodeNumber)
      ))
      .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  }

  function arePreviousEpisodesMarked(seasonNumber: number, episodeNumber: number) {
    const previous = getPreviousEpisodesBefore(seasonNumber, episodeNumber);
    return previous.length > 0 && previous.every(item => episodeProgressMap.get(`${item.season}:${item.episode}`)?.completed);
  }

  function markShowAsWatched() {
    if (isMovie) {
      const marked = markEpisodeAsWatched({
        query: { type: detailData.type, id: detailData.id },
        name: detailData.name,
        runtimeSeconds: runtimeMinutes(detailData.runtime) ? runtimeMinutes(detailData.runtime)! * 60 : undefined,
        logo: sanitizeLogoUrl(detailData.logo) ?? cachedLogo ?? undefined,
        background: detailData.backdrop,
        poster: detailData.poster,
      });
      void syncTraktMarkedWatched(marked);
      return;
    }
    for (const episode of regularSeasons.flatMap(item => item.episodes)) {
      if (isEpisodeLocked(episode)) continue;
      markEpisodeFromCard(episode);
    }
  }

  function markShowAsUnwatched() {
    const entries = readPlaybackStateEntries();
    const targets = entries.filter(entry => detailEntryMatches(detailData, entry));
    for (const target of targets) {
      const removed = removeContinueWatchingEntry(target.key);
      void syncTraktRemovePlayback(removed ?? target);
      void syncTraktMarkedUnwatched(removed ?? target);
    }
  }

  function toggleDetailLibrary() {
    const added = toggleLibraryItem({
      id: detailData.id,
      type: detailData.type,
      name: detailData.name,
      poster: detailData.poster,
      background: detailData.backdrop,
      logo: detailData.logo,
      description: detailData.description,
      year: detailData.year,
      genres: detailData.genres,
      rating: detailData.rating,
    });
    setInLibrary(added);
  }

  // Selector de fuentes como sección embebida: no se sale del Detail (mismo
  // fondo, una sola imagen). Solo el preview en iframe navega de verdad para
  // que el padre tome el control.
  function navigateToEpisode(to: string) {
    if (inShellPreview) {
      navigate(to);
      return;
    }
    if (bigPicture && onBigPictureEpisodeNavigation) {
      onBigPictureEpisodeNavigation(to);
      return;
    }
    navigate(to);
  }

  function episodeRequestFor(season?: number, ep?: number, episodeName?: string, cont?: boolean): DetailEpisodeRequest {
    const returnParams = new URLSearchParams(location.search);
    const request: DetailEpisodeRequest = {};
    if (typeof season === "number") request.season = season;
    if (ep) request.ep = ep;
    if (episodeName) request.episodeName = episodeName;
    if (cont) request.continue = true;
    if (returnParams.get("fromSearch") === "1") {
      request.fromSearch = true;
      const searchQuery = returnParams.get("q");
      if (searchQuery) request.q = searchQuery;
    }
    return request;
  }

  function goToStreams(season?: number, ep?: number, episodeName?: string) {
    if (inShellPreview) {
      const q = new URLSearchParams({ type: data!.type, id: data!.id });
      const returnParams = new URLSearchParams(location.search);
      if (returnParams.get("fromSearch") === "1") {
        q.set("fromSearch", "1");
        const searchQuery = returnParams.get("q");
        if (searchQuery) q.set("q", searchQuery);
      }
      if (typeof season === "number") q.set("season", String(season));
      if (ep)     q.set("ep", String(ep));
      if (episodeName) q.set("epTitle", episodeName);
      navigateToEpisode(buildEpisodePath(q.toString(), location.pathname));
      return;
    }
    openEpisodeSection(episodeRequestFor(season, ep, episodeName, false));
  }

  function goToStreamsContinue(season?: number, ep?: number, episodeName?: string) {
    if (inShellPreview) {
      const q = new URLSearchParams({ type: data!.type, id: data!.id, continue: "1" });
      const returnParams = new URLSearchParams(location.search);
      if (returnParams.get("fromSearch") === "1") {
        q.set("fromSearch", "1");
        const searchQuery = returnParams.get("q");
        if (searchQuery) q.set("q", searchQuery);
      }
      if (typeof season === "number") q.set("season", String(season));
      if (ep) q.set("ep", String(ep));
      if (episodeName) q.set("epTitle", episodeName);
      navigateToEpisode(buildEpisodePath(q.toString(), location.pathname));
      return;
    }
    openEpisodeSection(episodeRequestFor(season, ep, episodeName, true));
  }

  function playFromDetail() {
    const current = data;
    if (!current) return;

    if (isMovie) {
      const movieResume = readPlaybackStateEntries()
        .filter(entry => detailEntryMatches(current, entry))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      if (movieResume && !movieResume.completed) {
        goToStreamsContinue(undefined, undefined, movieResume.episodeName);
        return;
      }
      goToStreams();
      return;
    }

    const latestEntry = readPlaybackStateEntries()
      .filter(entry => detailEntryMatches(current, entry) && typeof entry.season === "number" && Boolean(entry.episode))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

    if (latestEntry) {
      const displayEpisode = findDisplayEpisodeForEntry(current, latestEntry, episodeByKey);
      const currentSeason = displayEpisode?.season ?? latestEntry.season;
      const currentEpisode = displayEpisode?.episode ?? latestEntry.episode;
      const currentName = displayEpisode?.name ?? latestEntry.episodeName;

      if (typeof currentSeason === "number" && currentEpisode) {
        if (latestEntry.completed) {
          const nextEpisode = findNextEpisode(
            regularSeasons,
            currentSeason,
            currentEpisode,
          );
          if (nextEpisode) {
            goToStreams(nextEpisode.season, nextEpisode.episode, nextEpisode.name);
            return;
          }
          goToStreams(currentSeason, currentEpisode, currentName);
          return;
        }

        goToStreamsContinue(currentSeason, currentEpisode, currentName);
        return;
      }
    }

    const firstSeason = regularSeasons[0];
    const firstEpisode = firstSeason?.episodes?.[0];
    if (firstSeason?.number && firstEpisode?.episode) {
      goToStreams(firstSeason.number, firstEpisode.episode, firstEpisode.name);
      return;
    }

    goToStreams();
  }

  function applyDetailBackground(background: string) {
    writeDetailBackgroundOverride(detailData.type, detailData.id, background);
    writeDetailMediaMeta({
      id: detailData.id,
      type: detailData.type,
      name: detailData.name,
      poster: detailData.poster,
      background,
      logo: detailData.logo,
      description: detailData.description,
      year: detailData.year,
    });
    setData(current => {
      if (!current) return current;
      const next = { ...current, backdrop: background };
      writePageDataCache("detail", routeCacheKey, next);
      return next;
    });
    setBackgroundPickerOpen(false);
  }

  function scheduleHeroPopup(open: () => void) {
    scrollToElementGsap(heroRef.current);
    if (popupOpenTimerRef.current !== null) window.clearTimeout(popupOpenTimerRef.current);
    popupOpenTimerRef.current = window.setTimeout(() => {
      popupOpenTimerRef.current = null;
      open();
    }, 360);
  }

  function openShowMore() {
    scheduleHeroPopup(() => {
      // El popup se centra sobre el hero (no sobre toda la page): al abrir,
      // el hero ya quedó arriba del todo, se mide su centro en viewport.
      const heroEl = heroRef.current;
      if (heroEl) {
        const rect = heroEl.getBoundingClientRect();
        setSynopsisTop(rect.top + rect.height / 2);
      } else {
        setSynopsisTop(null);
      }
      setShowMore(true);
    });
  }

  function openBackgroundPicker() {
    setDetailMenuOpen(false);
    scheduleHeroPopup(() => setBackgroundPickerOpen(true));
  }

  function openLogoPicker() {
    setDetailMenuOpen(false);
    scheduleHeroPopup(() => setLogoPickerOpen(true));
  }

  function applyDetailLogo(logo: string) {
    writeDetailLogoOverride(detailData.type, detailData.id, logo);
    const nextLogo = sanitizeLogoUrl(logo);
    if (nextLogo) {
      setCachedLogo(writeCachedLogo(getDetailLogoKey(detailData.type, detailData.id), nextLogo) ?? null);
      setLogoStatus("loading");
    } else {
      writeCachedLogo(getDetailLogoKey(detailData.type, detailData.id), "");
      setCachedLogo(null);
      setLogoStatus("idle");
    }
    writeDetailMediaMeta({
      id: detailData.id,
      type: detailData.type,
      name: detailData.name,
      poster: detailData.poster,
      background: detailData.backdrop,
      logo: nextLogo,
      description: detailData.description,
      year: detailData.year,
      mdbListRatings: detailData.mdbListRatings,
    });
    setData(current => {
      if (!current) return current;
      const next = { ...current, logo: nextLogo };
      writePageDataCache("detail", routeCacheKey, next);
      return next;
    });
    setLogoPickerOpen(false);
  }

  function updateBackdropBlur(scrollTop: number) {
    const blur = Math.round(Math.min(28, Math.max(0, scrollTop / 12)));
    const vignetteOpacity = Math.round(Math.max(0, 1 - scrollTop / 240) * 100) / 100;
    const darkOpacity = Math.round(Math.min(0.55, Math.max(0, scrollTop / 400)) * 100) / 100;
    if (blur !== backdropBlurAmountRef.current) {
      backdropBlurAmountRef.current = blur;
      if (episodeWasOpenRef.current) {
        // No interrumpir el filtro grayscale que se anima sobre la imagen
        // compartida mientras la sección Episodie está visible.
      } else {
      // The hero background blur is a readability function of the detail page,
      // not decorative motion — apply it directly so it works even with
      // prefers-reduced-motion (which tweenTo would otherwise strip).
      const el = backdropImageRef.current;
      if (el) {
        gsap.killTweensOf(el);
        gsap.set(el, { filter: `blur(${blur}px)`, scale: 1 + blur * 0.0018 });
      }
      }
    }
    if (vignetteOpacity !== metadataVignetteOpacityRef.current) {
      metadataVignetteOpacityRef.current = vignetteOpacity;
      tweenTo(metadataVignetteRef.current, { opacity: vignetteOpacity }, 0.24);
    }
    if (darkOpacity !== darkOverlayOpacityRef.current) {
      darkOverlayOpacityRef.current = darkOpacity;
      tweenTo(darkOverlayRef.current, { opacity: darkOpacity }, 0.24);
    }
    // Zona de contenido: al bajar del héroe el logo se despliega y empuja las
    // tabs/episodios a su sitio (misma medida del rail).
    const heroEl = heroRef.current;
    const shellEl = detailScrollRef.current;
    if (heroEl && shellEl) {
      const heroBottom = heroEl.getBoundingClientRect().bottom;
      const shellTop = shellEl.getBoundingClientRect().top;
      const heroDistance = heroBottom - shellTop;
      detailScrollTopRef.current = scrollTop;
      // El fade del hero sigue el recorrido real del shell frame a frame:
      // empieza cuando el hero entra en el umbral de contenido y termina al
      // cruzar su borde. Vía imperativa (gsap.set inmediato, sin transiciones
      // CSS que retrasen cada frame): igual que el blur del backdrop.
      const heroFadeProgress = bigPicture
        ? Math.min(1, Math.max(0, (CONTENT_LOGO_REVEAL_DISTANCE - heroDistance) / CONTENT_LOGO_REVEAL_DISTANCE))
        : 0;
      if (bigPicture) {
        const heroFadeOpacity = 1 - heroFadeProgress;
        const heroFadeY = -26 * heroFadeProgress;
        if (heroCopyRef.current) gsap.set(heroCopyRef.current, { opacity: heroFadeOpacity, y: heroFadeY });
        if (heroCreditsRef.current) gsap.set(heroCreditsRef.current, { opacity: heroFadeOpacity, y: heroFadeY });
      }
      // Preparar el logo antes de entrar al contenido evita que aparezca unos
      // frames tarde. Mientras se esté en la zona de contenido el logo no se
      // puede ir, sin importar la dirección del scroll entre rows.
      const pastHero = scrollTop > 0 && heroDistance < CONTENT_LOGO_REVEAL_DISTANCE;
      const showContentLogo = pastHero;
      if (showContentLogo !== pastHeroRef.current) {
        pastHeroRef.current = showContentLogo;
        if (showContentLogo) {
          shellEl.setAttribute("data-past-hero", "1");
          shellEl.setAttribute("data-content-zone", "1");
        } else {
          shellEl.removeAttribute("data-past-hero");
          shellEl.removeAttribute("data-content-zone");
        }
      }
    }
  }

  // El -26 de Big Picture en colección/relacionados compensa el gutter
  // negativo del ScrollRow previo. Tras el panel de Producción (caja normal,
  // sin gutter) hay que mantener el gap: si no, el header queda pegado.
  const hasCompanyLogos = Boolean(data.networks?.length || data.productionCompanies?.length);

  return (
    <div
      className="detail-page-root"
      data-bp-detail-exiting={bigPicture && bigPictureEpisodeTransitioning ? "true" : undefined}
      style={{
        position:"relative",
        width:"100%",
        height:"100vh",
        marginTop:"calc(-1 * var(--app-shell-nav-height))",
        overflow:"hidden",
        background:"#000",
      }}
    >
      <div
        aria-hidden="true"
        data-bp-detail-background
        style={{
          position:"absolute",
          inset:0,
          zIndex:0,
          overflow:"hidden",
          background:"#000",
          pointerEvents:"none",
        }}
      >
        {bgStack.curr ? (
          <div
            style={{
              position:"absolute",
              left:"50%",
              top:"50%",
              width:"max(100vw, 177.777778vh)",
              height:"max(100vh, 56.25vw)",
              aspectRatio:"16 / 9",
              transform:"translate(-50%, -50%)",
            }}
          >
            <div
              ref={backdropImageRef}
              style={{
                position:"absolute",
                inset:0,
                filter:"blur(0px)",
                transform:"scale(1)",
              }}
            >
              {bgStack.prev && bgStack.prev !== bgStack.curr ? (
                <img
                  ref={bgPrevImageRef}
                  src={bgStack.prev}
                  alt=""
                  width="1920"
                  height="1080"
                  style={{
                    position:"absolute",
                    inset:0,
                    width:"100%",
                    height:"100%",
                    objectFit:"cover",
                    objectPosition:"center",
                    opacity:1,
                  }}
                />
              ) : null}
              <img
                ref={bgCurrImageRef}
                src={bgStack.curr}
                alt=""
                width="1920"
                height="1080"
                style={{
                  position:"absolute",
                  inset:0,
                  width:"100%",
                  height:"100%",
                  objectFit:"cover",
                  objectPosition:"center",
                  opacity:bgStack.prev ? 0 : 1,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <div
        ref={metadataVignetteRef}
        aria-hidden="true"
        data-bp-detail-background
        style={{
          position:"absolute",
          inset:0,
          zIndex:1,
          opacity:1,
          background:"radial-gradient(ellipse 55% 85% at center, transparent 44%, rgba(0,0,0,0.28) 68%, rgba(0,0,0,0.9) 100%)",
          pointerEvents:"none",
        }}
      />
      <div
        ref={darkOverlayRef}
        aria-hidden="true"
        data-bp-detail-background
        style={{
          position:"absolute",
          inset:0,
          zIndex:1,
          opacity:0,
          background:"rgba(0,0,0,1)",
          pointerEvents:"none",
        }}
      />
      <div
        ref={detailScrollRef}
        data-aetherio-scroll-shell
        onScroll={event => updateBackdropBlur(event.currentTarget.scrollTop)}
        style={{
          position:"absolute",
          inset:0,
          zIndex:2,
          overflowY:"auto",
          overflowX:"hidden",
          overscrollBehavior:"contain",
        }}
      >
      <div
        ref={detailContentRef}
        data-aetherio-detail-content
        className="detail-page-scale"
        key={`detail-content-${data.id}`}
        inert={episodeOpen || undefined}
        aria-hidden={episodeOpen || undefined}
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "transparent",
          pointerEvents: episodeOpen ? "none" : undefined,
        }}
      >
      {/* HERO full-bleed: misma altura que PC para que la sección de
            contenido (tabs de episodios) asome abajo como en la referencia. */}
      <div className="detail-page-hero" ref={heroRef} data-hero-panel={bigPicture ? true : undefined} style={{ position:"relative", width:"100vw", left:"50%", marginLeft:"-50vw", height:bigPicture ? BIG_PICTURE_DETAIL_HERO_HEIGHT : DETAIL_HERO_HEIGHT, minHeight:540, overflow:"hidden" }}>
        <div ref={heroCopyRef} data-detail-hero-copy style={{ position:"absolute",bottom:4,left:0,padding:"0 var(--app-safe-x) 22px",maxWidth:520 }}>
          {displayLogo && logoStatus !== "error" ? (
            <div style={{ minHeight:100,display:"flex",alignItems:"center",marginBottom:14,position:"relative" }}>
              {bigPicture ? (
                // En picture el logo es solo visual: ni clicable ni seleccionable
                // (sin crossfade por refs: cambio directo).
                <div
                  aria-hidden="true"
                  style={{ position:"relative",border:0,padding:0,background:"transparent",display:"block",userSelect:"none",pointerEvents:"none" }}
                >
                  <img
                    src={logoStack.curr || displayLogo}
                    alt=""
                    draggable={false}
                    onLoad={() => {
                      logoLog("logo img onLoad", { url: displayLogo });
                      setLogoStatus("loaded");
                    }}
                    onError={() => {
                      logoLog("logo img onError", { url: displayLogo });
                      setLogoStatus("error");
                    }}
                    style={{ maxHeight:100,maxWidth:300,objectFit:"contain",filter:"drop-shadow(0 2px 10px rgba(0,0,0,0.75))",display:"block",userSelect:"none",pointerEvents:"none" }}
                  />
                </div>
              ) : (
              <button
                type="button"
                onClick={() => navigate(buildDetailPath(data.type, data.id), { replace: true })}
                aria-label={`Ir al detalle de ${data.name}`}
                style={{ position:"relative", border:0,padding:0,background:"transparent",cursor:"pointer",display:"block" }}
              >
                {logoStack.prev && logoStack.prev !== logoStack.curr ? (
                  <img
                    ref={logoPrevImageRef}
                    src={logoStack.prev}
                    alt=""
                    style={{ position:"absolute",inset:0,maxHeight:100,maxWidth:300,objectFit:"contain",filter:"drop-shadow(0 2px 10px rgba(0,0,0,0.75))",opacity:1,pointerEvents:"none" }}
                  />
                ) : null}
                <img
                  ref={logoImgRef}
                  src={logoStack.curr || displayLogo}
                  alt={data.name}
                  onLoad={() => {
                    logoLog("logo img onLoad", { url: displayLogo });
                    setLogoStatus("loaded");
                  }}
                  onError={() => {
                    logoLog("logo img onError", { url: displayLogo });
                    setLogoStatus("error");
                  }}
                  style={{ maxHeight:100,maxWidth:300,objectFit:"contain",filter:"drop-shadow(0 2px 10px rgba(0,0,0,0.75))",opacity:logoStack.prev ? 0 : 1, display:"block" }}
                />
              </button>
              )}
            </div>
          ) : (
            <h1 style={{ fontSize:"2.6rem",fontWeight:900,color:"#fff",marginBottom:14,lineHeight:1.05,textShadow:"0 2px 20px rgba(0,0,0,0.8)" }}>{data.name}</h1>
          )}
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap" }}>
            <span style={{ fontSize:15,color:"rgba(255,255,255,0.8)",fontWeight:500 }}>{typeLabel}</span>
            {data.genres?.slice(0,2).map(g=><span key={g} style={{ fontSize:15,color:"rgba(255,255,255,0.75)" }}>· {g}</span>)}
          </div>
          <div style={{ marginBottom:12 }}>
            <span style={{ fontSize:15,color:"rgba(255,255,255,0.8)",lineHeight:1.6 }}>{descShort}</span>
            {hasMore&&<button onClick={openShowMore} style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.85)",background:"none",border:"none",cursor:"pointer",marginLeft:6 }}>MÁS</button>}
          </div>
          {data.mdbListRatings ? <MDBListRatingsRow ratings={data.mdbListRatings} compact /> : null}
          <div style={{ display:"flex",alignItems:"center",gap:7,marginTop:8,marginBottom:18,flexWrap:"wrap" }}>
            {data.year&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.7)" }}>{data.year}</span>}
            {data.runtime&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.7)" }}>· {formatRuntime(data.runtime) || data.runtime}</span>}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            {/* Reproducir -> /episode */}
            <button ref={playButtonRef} data-hero-primary data-hero-action onClick={playFromDetail}
              style={{ display:"flex",alignItems:"center",gap:8,padding:"11px 30px",background:"#fff",color:"#000",fontWeight:700,borderRadius:999,fontSize:15,border:"none",cursor:"pointer",boxShadow:"0 3px 12px rgba(0,0,0,0.38)",textShadow:"none" }}>
              <Play size={16} fill="black" /> {playLabel}
            </button>
            <button
              ref={detailMenuButtonRef}
              type="button"
              data-hero-action
              aria-label="Opciones del medio"
              onClick={() => setDetailMenuOpen(value => !value)}
              style={{ width:42,height:42,borderRadius:999,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.08)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 3px 12px rgba(0,0,0,0.28)" }}
            >
              <MoreHorizontal size={20} />
            </button>
            <ContextMenu
              open={detailMenuOpen}
              anchorRef={detailMenuButtonRef}
              onClose={() => setDetailMenuOpen(false)}
              placement="outside-right"
              width={238}
              items={[
                {
                  label: inLibrary ? "Quitar de la biblioteca" : "Añadir a la biblioteca",
                  icon: inLibrary ? <BookmarkMinus size={15} /> : <BookmarkPlus size={15} />,
                  onSelect: toggleDetailLibrary,
                },
                {
                  label: "Elegir fondo del medio",
                  icon: <ImageIcon size={15} />,
                  disabled: !(data.backgroundOptions?.length),
                  onSelect: openBackgroundPicker,
                },
                {
                  label: "Elegir logo del medio",
                  icon: <img src={addImageIcon} alt="" style={{ width:15,height:15,display:"block",filter:"invert(1)",opacity:0.86 }} />,
                  disabled: !(displayLogo || data.logoOptions?.length),
                  onSelect: openLogoPicker,
                },
                showMarkedWatched
                  ? {
                    label: isMovie ? "Marcar película como no vista" : "Marcar show como no visto",
                    icon: <EyeOff size={15} />,
                    onSelect: markShowAsUnwatched,
                  }
                  : {
                    label: isMovie ? "Marcar película como vista" : "Marcar show como visto",
                    icon: <Check size={15} />,
                    onSelect: markShowAsWatched,
                  },
              ]}
            />
          </div>
        </div>

        {(data.cast?.length || data.director || awards.featured)&&(
          <div ref={heroCreditsRef} className="detail-hero-credits" style={{ position:"absolute",bottom:4,right:0,padding:"0 var(--app-safe-x) 22px",textAlign:"right",maxWidth:300 }}>
            {awards.featured && (
              <div
                ref={awardBadgeRef}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginBottom: 10,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif',
                }}
              >
                <div style={{ color: "#fff", lineHeight: 1.1, textShadow: "0 2px 10px rgba(0,0,0,0.7)", textAlign: "right" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2 }}>
                    {featuredText(awards.featured)}{awards.featured.awardYear ? ` ${awards.featured.awardYear}` : ""}
                  </div>
                  {awards.featured.categoryEs && (
                    <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.75)", marginTop: 2 }}>
                      {awardCategoryLabel(awards.featured)}
                    </div>
                  )}
                </div>
                <AwardLogo
                  className="detail-award-logo-adaptive"
                  ceremony={awards.featured.ceremony}
                  height={50}
                  maxWidth={100}
                />
              </div>
            )}
            {!!data.cast?.length&&(<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)",marginBottom:5,...(bigPicture ? { userSelect:"none" as const } : null) }}><span style={{ color:"rgba(255,255,255,0.3)" }}>Reparto </span>{data.cast.slice(0,3).map((castMember, index) => (<span key={castMember.id}>{index > 0 ? ", " : ""}{bigPicture ? (<span style={{ color:"rgba(255,255,255,0.8)",userSelect:"none" }}>{castMember.name}</span>) : (<button type="button" onClick={() => navigate(`/person/${encodeURIComponent(String(castMember.id))}`)} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.8)"} style={{ background:"none",border:"none",padding:0,color:"rgba(255,255,255,0.8)",cursor:"pointer",fontSize:13,textDecoration:"none",transition:"color 0.2s ease" }}>{castMember.name}</button>)}</span>))}</p>)}
            {data.director&&<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)",...(bigPicture ? { userSelect:"none" as const } : null) }}><span style={{ color:"rgba(255,255,255,0.3)" }}>Director </span>{bigPicture ? (<span style={{ color:"rgba(255,255,255,0.8)",userSelect:"none" }}>{data.director}</span>) : (<button type="button" onClick={() => data.directorId && navigate(`/person/${encodeURIComponent(String(data.directorId))}`)} disabled={!data.directorId} onMouseEnter={data.directorId?(e)=>e.currentTarget.style.color="#fff":undefined} onMouseLeave={data.directorId?(e)=>e.currentTarget.style.color="rgba(255,255,255,0.8)":undefined} style={{ background:"none",border:"none",padding:0,color:"rgba(255,255,255,0.8)",cursor:data.directorId ? "pointer" : "default",fontSize:13,textDecoration:"none",transition:"color 0.2s ease" }}>{data.director}</button>)}</p>}
          </div>
        )}
        {showMore&&(
          <div
            onClick={()=>setShowMore(false)}
            data-aetherio-synopsis-popup={bigPicture ? "true" : undefined}
            style={{ position:"fixed",inset:0,zIndex:20,padding:"var(--app-safe-x)",background:"rgba(0,0,0,0.64)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)" }}
          >
            <div
              className="liquid-glass-dark"
              onClick={e=>e.stopPropagation()}
              style={{ position:"absolute",left:"50%",top:synopsisTop ?? "50%",transform:"translate(-50%,-50%)",borderRadius:18,padding:"28px 30px",width:"min(560px, calc(100vw - var(--app-safe-x) * 2))",maxHeight:"min(56vh, 420px)",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.58)" }}
            >
              {!bigPicture&&<button onClick={()=>setShowMore(false)} style={{ position:"absolute",top:14,right:14,width:30,height:30,border:"none",borderRadius:999,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.68)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><X size={16}/></button>}
              <p style={{ fontSize:15,color:"rgba(255,255,255,0.82)",lineHeight:1.72,paddingRight:bigPicture ? 0 : 24,fontWeight:400 }}>{normalizedDescription}</p>
            </div>
          </div>
        )}
        {pickerItem ? (
          <>
            <CardArtworkPicker
              open={backgroundPickerOpen}
              item={pickerItem}
              type={data.type}
              mode="background"
              currentUrl={data.backdrop}
              extraOptions={backgroundPickerOptions}
              fetchTmdbOptions={false}
              titleOverride="Fondo del medio"
              descriptionOverride={`Escoge el fondo para ${data.name}`}
              onSelect={applyDetailBackground}
              onClose={() => setBackgroundPickerOpen(false)}
            />
            <CardArtworkPicker
              open={logoPickerOpen}
              item={pickerItem}
              type={data.type}
              mode="logo"
              currentUrl={displayLogo ?? ""}
              extraOptions={logoPickerOptions}
              fetchTmdbOptions={false}
              emptyOptionLabel="Usar texto (sin logo)"
              titleOverride="Logo del medio"
              descriptionOverride={`Escoge el logo para ${data.name}`}
              onSelect={applyDetailLogo}
              onClose={() => setLogoPickerOpen(false)}
            />
          </>
        ) : null}
      </div>

      {/* SECCIONES INFERIORES */}
      <div className="detail-page-content" style={{ padding:"24px var(--app-safe-x)",display:"flex",flexDirection:"column",gap:28,background:"transparent" }}>

        {/* Zona de contenido: el logo se mantiene dentro de la zona, pero
            permanece colapsado mientras el hero todavía está visible para
            que el primer peek sea la row de episodios. */}
        {bigPicture && (
          <div
            data-content-logo
            aria-hidden="true"
            className="detail-content-logo"
            style={{ display:"flex",justifyContent:"center",alignItems:"center",userSelect:"none",pointerEvents:"none" }}
          >
            {(logoStack.curr || displayLogo) && logoStatus !== "error" ? (
              <img
                src={logoStack.curr || displayLogo || undefined}
                alt=""
                draggable={false}
                style={{ maxWidth:"min(504px, 70vw)",maxHeight:81,objectFit:"contain",opacity:0.9,userSelect:"none",pointerEvents:"none" }}
              />
            ) : (
              <span style={{ fontSize:22,fontWeight:800,color:"rgba(255,255,255,0.9)",lineHeight:"24px",userSelect:"none" }}>
                {data.name}
              </span>
            )}
          </div>
        )}

        {/* Episodios: tabs 1:1 nativo solo si hay >1 temporada; si no, título */}
        {!isMovie&&curSeason&&(
          <section>
            {regularSeasons.length>1 ? (
              <div className="detail-season-header" style={{ marginBottom: bigPicture ? 24 : 0 }}>
              <SeasonTabs
                seasons={regularSeasons.map(item => item.number)}
                selectedSeason={curSeason.number}
                onSeasonSelected={setSeason}
                seasonWatched={seasonNumber => seasonMarkedMap.get(seasonNumber) ?? false}
                onMarkSeasonWatched={markSeasonAsWatched}
                onMarkSeasonUnwatched={markSeasonAsUnwatched}
              />
              </div>
            ) : (
              <div className="detail-season-header" style={{ display:"flex",alignItems:"center",gap:14,marginBottom:bigPicture ? 24 : 12 }}>
                <h2 style={{ fontSize:20,fontWeight:750,color:"var(--detail-h, rgba(255,255,255,0.6))",lineHeight:1.1 }}>Temporada {curSeason.number}</h2>
              </div>
            )}
            <div style={{ marginTop: bigPicture ? 12 : 0 }}>
            <ScrollRow key={curSeason.number} rowKey={`detail:${type}:${id}:episodes:${curSeason.number}`} gap={DETAIL_EPISODE_CARD_GAP} arrowTop={DETAIL_MEDIA_ARROW_TOP} initialScrollKey={episodeScrollKey || getEpisodeKey(curSeason.episodes[0]?.season, curSeason.episodes[0]?.episode)}>
              {curSeason.episodes.map(ep=>(
                <EpCard
                  key={ep.id}
                  scrollKey={getEpisodeKey(ep.season, ep.episode)}
                  ep={ep}
                  fallbackImage={data.backdrop ?? undefined}
                  locked={isEpisodeLocked(ep)}
                  progressEntry={episodeProgressMap.get(`${ep.season}:${ep.episode}`)}
                  seasonMarked={seasonMarkedMap.get(0) ?? false}
                  previousMarked={arePreviousEpisodesMarked(ep.season, ep.episode)}
                  onPlay={()=>goToStreams(ep.season,ep.episode,ep.name)}
                  onMarkWatched={() => markEpisodeFromCard(ep)}
                  onMarkSeasonWatched={() => markSeasonAsWatched(ep.season)}
                  onMarkSeasonUnwatched={() => markSeasonAsUnwatched(ep.season)}
                  onMarkPreviousSeasonWatched={() => markPreviousEpisodesAsWatched(ep.season, ep.episode)}
                  onMarkPreviousSeasonUnwatched={() => markPreviousEpisodesAsUnwatched(ep.season, ep.episode)}
                  onShowComments={() => scrollToElementGsap(commentsSectionRef.current)}
                  hasTmdbComments={tmdbComments.length > 0}
                  onMarkUnwatched={(entry) => {
                    const removed = removeContinueWatchingEntry(entry.key);
                    void syncTraktRemovePlayback(removed ?? entry);
                    void syncTraktMarkedUnwatched(removed ?? entry);
                  }}
                />
              ))}
            </ScrollRow>
            </div>
          </section>
        )}

        {!isMovie&&Boolean(specialSeason?.episodes.length)&&(
          <section style={{ marginTop: bigPicture ? -26 : undefined }}>
            <h2 style={{ fontSize:20,fontWeight:750,color:"var(--detail-h, rgba(255,255,255,0.6))",lineHeight:1.1,marginBottom:bigPicture ? 24 : 12 }}>Especiales</h2>
            <div style={{ marginTop: bigPicture ? 12 : 0 }}>
            <ScrollRow rowKey={`detail:${type}:${id}:specials`} gap={DETAIL_EPISODE_CARD_GAP} arrowTop={DETAIL_MEDIA_ARROW_TOP}>
              {specialSeason!.episodes.map(ep=>(
                <EpCard
                  key={ep.id}
                  scrollKey={getEpisodeKey(ep.season, ep.episode)}
                  ep={ep}
                  fallbackImage={data.backdrop ?? undefined}
                  locked={isEpisodeLocked(ep)}
                  progressEntry={episodeProgressMap.get(`${ep.season}:${ep.episode}`)}
                  seasonMarked={seasonMarkedMap.get(0) ?? false}
                  previousMarked={arePreviousEpisodesMarked(ep.season, ep.episode)}
                  onPlay={()=>goToStreams(ep.season,ep.episode,ep.name)}
                  onMarkWatched={() => markEpisodeFromCard(ep)}
                  onMarkSeasonWatched={() => markSeasonAsWatched(ep.season)}
                  onMarkSeasonUnwatched={() => markSeasonAsUnwatched(ep.season)}
                  onMarkPreviousSeasonWatched={() => markPreviousEpisodesAsWatched(ep.season, ep.episode)}
                  onMarkPreviousSeasonUnwatched={() => markPreviousEpisodesAsUnwatched(ep.season, ep.episode)}
                  onShowComments={() => scrollToElementGsap(commentsSectionRef.current)}
                  hasTmdbComments={tmdbComments.length > 0}
                  onMarkUnwatched={(entry) => {
                    const removed = removeContinueWatchingEntry(entry.key);
                    void syncTraktRemovePlayback(removed ?? entry);
                    void syncTraktMarkedUnwatched(removed ?? entry);
                  }}
                />
              ))}
            </ScrollRow>
            </div>
          </section>
        )}

        {!!data.trailers?.length&&(
          <section style={{ marginTop: bigPicture && !isMovie && (curSeason || Boolean(specialSeason?.episodes.length)) ? -26 : undefined }}>
            <SectionH title="Tráilers" />
            <ScrollRow rowKey={`detail:${type}:${id}:trailers`} gap={DETAIL_EPISODE_CARD_GAP} arrowTop={DETAIL_TRAILER_ARROW_TOP} shadowGutter={DETAIL_TRAILER_ROW_SHADOW_GUTTER}>
              {data.trailers.map((t,index)=><TrailerCard key={t.key ?? `trailer-${index}`} trailer={t} media={data} />)}
            </ScrollRow>
          </section>
        )}

        <div
          ref={commentsSectionRef}
          style={!isMovie && Boolean(specialSeason?.episodes.length) && !data.trailers?.length
            ? { marginTop: bigPicture ? -76 : -32 }
            : undefined}
        >
          <TmdbCommentsSection
            comments={tmdbComments}
            loading={tmdbCommentsLoading}
            error={tmdbCommentsError}
            detailKey={data ? `${data.type}:${data.id}` : undefined}
          />
        </div>

        {!!data.cast?.length&&(
          <section>
            <SectionH title="Reparto" />
            <ScrollRow rowKey={`detail:${type}:${id}:cast`} gap={25} arrowTop={DETAIL_CAST_ARROW_TOP} initialScrollKey={`${data.id}:cast:start`}>
              {data.cast.map((c,index)=><CastCard key={c.id} member={c} scrollKey={index===0?`${data.id}:cast:start`:undefined} onPress={()=>{ navigate(buildPersonPath(c.id)); }} />)}
            </ScrollRow>
          </section>
        )}

        <CompanyLogoSection networks={data.networks} productionCompanies={data.productionCompanies} detailKey={`${data.type}:${data.id}`} background={data.backdrop ?? data.poster} />

        {!!data.collection?.length&&(
          <section style={{ marginTop: bigPicture && !hasCompanyLogos ? -26 : undefined }}>
            <SectionH title={data.collectionName || "Colección"} />
            <ScrollRow rowKey={`detail:${type}:${id}:collection`} gap={20} arrowTop={DETAIL_COLLECTION_ARROW_TOP} shadowGutter={DETAIL_COLLECTION_ROW_SHADOW_GUTTER} initialScrollKey={`${data.id}:collection`}>
              {data.collection.map(item=><CollectionCard key={`${item.type}:${item.id}`} item={item} onPress={()=>{
                writeDetailMediaMeta({
                  id:item.id,
                  type:item.type,
                  name:item.title,
                  poster:item.poster,
                  background:item.backdrop,
                  logo:item.logo,
                  description:item.description,
                  year:item.year ? Number(item.year) : undefined,
                });
                navigate(buildDetailPath(item.type, item.id));
              }} />)}
            </ScrollRow>
          </section>
        )}

        {!!data.related?.length&&(
          <section style={{ marginTop: bigPicture && !hasCompanyLogos && !data.collection?.length ? -26 : undefined }}>
            <SectionH title="Más como esto" />
            <ScrollRow rowKey={`detail:${type}:${id}:related`} gap={DETAIL_VERTICAL_CARD_GAP} shadowGutter={DETAIL_RELATED_ROW_SHADOW_GUTTER} arrowTop={DETAIL_RELATED_ARROW_TOP}>
              {data.related.map(r=>(
                <div key={r.id}
                  onClick={()=>navigate(buildDetailPath(r.media_type, `tmdb:${r.id}`))}
                  // En picture la card es foco del mando: tabIndex + escala, sin anillo blanco.
                  tabIndex={bigPicture ? 0 : undefined}
                  role={bigPicture ? "button" : undefined}
                  aria-label={bigPicture ? r.title : undefined}
                  onKeyDown={bigPicture ? (e=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(buildDetailPath(r.media_type, `tmdb:${r.id}`)); } }) : undefined}
                  onFocus={bigPicture ? (e=>{
                    const card = e.currentTarget as HTMLDivElement;
                    tweenTo(card, { y: -4, scale: 1.04, zIndex: 5 }, 0.32);
                    gsap.set(card, { boxShadow: "0 22px 46px rgba(0,0,0,0.56)" });
                  }) : undefined}
                  onBlur={bigPicture ? (e=>{
                    const card = e.currentTarget as HTMLDivElement;
                    tweenTo(card, { y: 0, scale: 1, zIndex: 1 }, 0.32);
                    gsap.set(card, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
                  }) : undefined}
                  style={{ flexShrink:0,width:197,height:296,borderRadius:10,overflow:"hidden",cursor:"pointer",background:"#1c1c1e" }}
                  onMouseEnter={e=>{
                    const card = e.currentTarget as HTMLDivElement;
                    tweenTo(card, { y: -4, scale: 1.04, zIndex: 5 }, 0.32);
                    gsap.set(card, { boxShadow: bigPicture ? "0 22px 46px rgba(0,0,0,0.56)" : "0 22px 46px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.17)" });
                  }}
                  onMouseLeave={e=>{
                    const card = e.currentTarget as HTMLDivElement;
                    tweenTo(card, { y: 0, scale: 1, zIndex: 1 }, 0.32);
                    gsap.set(card, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
                  }}
                >
                  {completedMediaKeys.has(`${r.media_type}:tmdb:${r.id}`) ? (
                    <div
                      style={{
                        position:"absolute",
                        top:10,
                        right:10,
                        zIndex:2,
                        width:28,
                        height:28,
                        borderRadius:999,
                        border:"1px solid rgba(255,255,255,0.72)",
                        background:"linear-gradient(180deg, rgba(255,255,255,0.96), rgba(242,244,247,0.88))",
                        boxShadow:"0 10px 24px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.92)",
                        display:"flex",
                        alignItems:"center",
                        justifyContent:"center",
                        backdropFilter:"blur(10px)",
                        WebkitBackdropFilter:"blur(10px)",
                      }}
                    >
                      <Check size={15} style={{ color:"rgba(16,18,20,0.94)" }} />
                    </div>
                  ) : null}
                  {r.poster_path ? (
                    <img src={r.poster_path} alt="" loading="lazy" decoding="async" style={{ width:"100%",height:"100%",objectFit:"cover",transform:"scale(1)" }} />
                  ) : (
                    <div style={{ width:"100%",height:"100%",background:"#2c2c2e" }} />
                  )}
                </div>
              ))}
            </ScrollRow>
          </section>
        )}
      </div>
      </div>

      {episodeOpen && episodeRequest && data ? (
        <div ref={episodeSectionRef} data-aetherio-episode-section="true" style={bigPicture
          ? { position:"fixed",inset:0,zIndex:4,overflow:"hidden",background:"transparent", visibility: episodeShown ? "visible" : "hidden", pointerEvents: episodeShown ? "auto" : "none" }
          : { position:"absolute",inset:0,zIndex:4,minHeight:"100vh",overflowY:"auto",overflowX:"hidden",background:"transparent", visibility: episodeShown ? "visible" : "hidden", pointerEvents: episodeShown ? "auto" : "none" }}>
          <Suspense fallback={null}>
            <EpisodeSectionErrorBoundary
              onRetry={() => setSectionAttempt(value => value + 1)}
              onClose={closeEpisodeSection}
              onError={() => setEpisodeSectionReady(true)}
            >
              <EpisodieSection
                key={sectionAttempt}
                embedded
                queryOverride={episodeQueryOverride ?? undefined}
                onReady={() => setEpisodeSectionReady(true)}
              />
            </EpisodeSectionErrorBoundary>
          </Suspense>
        </div>
      ) : null}
      </div>
    </div>
  );
}

function CompanyLogoSection({
  networks,
  productionCompanies,
  detailKey,
  background,
}: {
  networks?: MetaCompany[];
  productionCompanies?: MetaCompany[];
  detailKey: string;
  background?: string;
}) {
  const hasNetworks = Boolean(networks?.length);
  const hasProduction = Boolean(productionCompanies?.length);
  const networkItems = hasNetworks ? networks!.slice(0, 8) : [];
  const productionItems = hasProduction ? productionCompanies!.slice(0, 8) : [];
  if (!networkItems.length && !productionItems.length) return null;

  // Row espacial única (misma que ScrollRow/Home): con data-row-key el motor
  // se mueve por índice y recuerda la columna al subir/bajar. Sin esto, bajar
  // desde Reparto caía directo en "Más como esto" saltando los logos.
  return (
    <section
      data-row-key={`detail:${detailKey}:companies`}
      data-row-count={networkItems.length + productionItems.length}
      style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(340px, 1fr))",gap:18 }}
    >
      {networkItems.length ? (
        <CompanyGroup title="Cadena" kind="network" items={networkItems} startIndex={0} background={background} />
      ) : null}
      {productionItems.length ? (
        <CompanyGroup title="Producción" kind="company" items={productionItems} startIndex={networkItems.length} background={background} />
      ) : null}
    </section>
  );
}

function CompanyGroup({ title, kind, items, startIndex, background }: { title: string; kind: "network" | "company"; items: MetaCompany[]; startIndex: number; background?: string }) {
  const navigate = useNavigate();
  const bigPicture = useBigPictureActive();

  return (
    <div className="liquid-glass-dark" style={{ borderRadius:18,padding:"22px 24px",minHeight:138 }}>
    <h2 style={{ fontSize:19,fontWeight:750,color:"var(--detail-h, rgba(255,255,255,0.6))",marginBottom:16,lineHeight:1.1 }}>{title}</h2>
      <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
        {items.map((item, offset) => (
          <button
            key={`${title}-${item.id}`}
            type="button"
            title={item.name}
            aria-label={item.name}
            data-item-index={startIndex + offset}
            data-row-card=""
            onClick={() => navigate(buildEntityPath(kind, item.id), { state: { fromDetailBackground: background } })}
            style={{ height:60,minWidth:116,maxWidth:188,borderRadius:14,border:"1px solid rgba(255,255,255,0.82)",background:"linear-gradient(180deg, rgba(255,255,255,0.97), rgba(240,242,246,0.9))",display:"flex",alignItems:"center",justifyContent:"center",padding:"10px 15px",overflow:"hidden",cursor:"pointer",boxShadow:"0 10px 24px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.92)" }}
            onMouseEnter={event => {
              const el = event.currentTarget;
              tweenTo(el, { y: -2 }, 0.22);
              gsap.set(el, { background: "linear-gradient(180deg, rgba(255,255,255,1), rgba(244,246,250,0.94))" });
            }}
            onMouseLeave={event => {
              const el = event.currentTarget;
              tweenTo(el, { y: 0 }, 0.22);
              gsap.set(el, { background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(240,242,246,0.9))" });
            }}
            onFocus={bigPicture ? event => {
              const el = event.currentTarget;
              tweenTo(el, { y: -2, scale: 1.06, zIndex: 5 }, 0.32);
              gsap.set(el, { boxShadow: "0 18px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.35)" });
            } : undefined}
            onBlur={bigPicture ? event => {
              const el = event.currentTarget;
              tweenTo(el, { y: 0, scale: 1, zIndex: 1 }, 0.32);
              gsap.set(el, { boxShadow: "0 10px 24px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.92)" });
            } : undefined}
          >
            {item.logo ? (
              <img src={item.logo} alt={item.name} loading="lazy" decoding="async" style={{ maxWidth:"100%",maxHeight:"100%",objectFit:"contain",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.16))" }} />
            ) : (
              <span style={{ fontSize:13,fontWeight:700,color:"rgba(24,26,30,0.88)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{item.name}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionH({ title }:{title:string}) {
  return (
    <div className="detail-section-header" style={{ display:"flex",alignItems:"center",marginBottom:12, transition:"transform 0.32s cubic-bezier(0.16,1,0.3,1)" }}>
      <h2 style={{ fontSize:20,fontWeight:750,color:"var(--detail-h, rgba(255,255,255,0.6))",lineHeight:1.1 }}>{title}</h2>
    </div>
  );
}

function TmdbCommentsSection({
  comments,
  loading,
  error,
  detailKey,
}: {
  comments: TmdbCommentReview[];
  loading: boolean;
  error: string;
  detailKey?: string;
}) {
  const bigPicture = useBigPictureActive();
  if (!loading && !error && !comments.length) return null;
  if (loading && bigPicture) return null;

  return (
    <section>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,marginBottom:12 }}>
        <div>
          <h2 style={{ fontSize:20,fontWeight:750,color:"var(--detail-h, rgba(255,255,255,0.6))",lineHeight:1.1 }}>Comentarios de TMDB</h2>
          <p style={{ marginTop:6,fontSize:12,color:"rgba(255,255,255,0.42)" }}>Comentarios del título</p>
        </div>
      </div>
      {error ? (
        <div className="liquid-glass-dark" style={{ borderRadius:14,padding:"14px 16px",fontSize:13,fontWeight:500,color:"rgba(255,255,255,0.58)" }}>
          {error}
        </div>
      ) : loading ? (
        <div style={{ display:"flex",gap:10,overflow:"hidden" }}>
          {[0, 1, 2].map(item => <div key={item} className="skeleton" style={{ width:320,height:144,borderRadius:14,flexShrink:0 }} />)}
        </div>
      ) : (
        <ScrollRow gap={10} rowKey={detailKey ? `detail:${detailKey}:comments` : undefined} arrowTop={DETAIL_COMMENTS_ARROW_TOP} shadowGutter={DETAIL_COMMENTS_ROW_SHADOW_GUTTER}>
          {comments.slice(0, 18).map(comment => <TmdbCommentCard key={comment.id} comment={comment} />)}
        </ScrollRow>
      )}
    </section>
  );
}

function TmdbCommentCard({ comment }: { comment: TmdbCommentReview }) {
  const commentText = comment.comment;
  const bigPicture = useBigPictureActive();
  return (
    <article
      className="liquid-glass-dark"
      // En picture la card es foco del mando: tabIndex + escala, sin anillo blanco.
      // Sin esto el motor espacial no la ve (article no es focuseable) y la row
      // se saltaba al bajar desde Tráilers hacia Reparto.
      tabIndex={bigPicture ? 0 : undefined}
      aria-label={bigPicture ? `Comentario de ${comment.authorDisplayName}` : undefined}
      onFocus={bigPicture ? (e=>{
        tweenTo(e.currentTarget, { y: -4, scale: 1.04, zIndex: 5 }, 0.32);
        gsap.set(e.currentTarget, { boxShadow: "0 22px 46px rgba(0,0,0,0.56)" });
      }) : undefined}
      onBlur={bigPicture ? (e=>{
        tweenTo(e.currentTarget, { y: 0, scale: 1, zIndex: 1 }, 0.32);
        gsap.set(e.currentTarget, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
      }) : undefined}
      style={{ width:320,minHeight:144,flexShrink:0,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:10,cursor:"default",outline:"none" }}
    >
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:12 }}>
        <div style={{ minWidth:0 }}>
          <p style={{ fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.86)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
            {comment.authorDisplayName}
          </p>
          {comment.authorUsername ? (
            <p style={{ marginTop:2,fontSize:11,color:"rgba(255,255,255,0.36)" }}>@{comment.authorUsername}</p>
          ) : null}
        </div>
        {typeof comment.rating === "number" ? (
          <span style={{ flexShrink:0,borderRadius:999,background:"rgba(255,255,255,0.1)",padding:"4px 8px",fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.72)" }}>
            {comment.rating}/10
          </span>
        ) : null}
      </div>
      <p style={{ fontSize:13,lineHeight:1.5,fontWeight:400,color:"rgba(255,255,255,0.66)",display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical",overflow:"hidden" }}>
        {commentText}
      </p>
      <div style={{ marginTop:"auto",display:"flex",alignItems:"center",gap:8,fontSize:11,fontWeight:500,color:"rgba(255,255,255,0.38)" }}>
        {comment.review ? <span>Review</span> : null}
      </div>
    </article>
  );
}

function CollectionCard({ item, onPress }:{item:DetailCollectionItem;onPress:()=>void}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const bigPicture = useBigPictureActive();
  const image = item.backdrop || item.poster;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={item.title}
      onMouseEnter={event=>{
        tweenTo(event.currentTarget, { scale: 1.05, zIndex: 5 }, 0.32);
        gsap.set(event.currentTarget, { boxShadow: "0 20px 42px rgba(0,0,0,0.48)" });
      }}
      onMouseLeave={event=>{
        tweenTo(event.currentTarget, { scale: 1, zIndex: 1 }, 0.32);
        gsap.set(event.currentTarget, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
      }}
      onFocus={bigPicture ? (event=>{
        tweenTo(event.currentTarget, { scale: 1.05, zIndex: 5 }, 0.32);
        gsap.set(event.currentTarget, { boxShadow: "0 20px 42px rgba(0,0,0,0.48)" });
      }) : undefined}
      onBlur={bigPicture ? (event=>{
        tweenTo(event.currentTarget, { scale: 1, zIndex: 1 }, 0.32);
        gsap.set(event.currentTarget, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
      }) : undefined}
      style={{
        position:"relative",
        flexShrink:0,
        width:340,
        height:192,
        border:0,
        borderRadius:14,
        padding:0,
        overflow:"hidden",
        background:"#1c1c1e",
        cursor:"pointer",
        transform:"scale(1)",
        transformOrigin:"center",
        boxShadow:"0 12px 28px rgba(0,0,0,0.18)",
      }}
    >
      {image ? (
        <img src={image} alt="" loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} />
      ) : (
        <div style={{width:"100%",height:"100%",background:"#2c2c2e"}} />
      )}
      <div
        aria-hidden="true"
        style={{
          position:"absolute",
          inset:0,
          background:"linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.2) 80%, rgba(0,0,0,0.7) 100%)",
        }}
      />
      <div style={{position:"absolute",left:16,right:16,bottom:14,display:"flex",alignItems:"flex-end",justifyContent:"flex-start"}}>
        {item.logo && !logoFailed ? (
          <img
            src={item.logo}
            alt={item.title}
            onError={()=>setLogoFailed(true)}
            style={{maxWidth:220,maxHeight:48,width:"auto",height:"auto",objectFit:"contain",objectPosition:"left bottom"}}
          />
        ) : (
          <span style={{maxWidth:220,color:"#fff",fontSize:16,fontWeight:800,lineHeight:"19px",textAlign:"left",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {item.title}
          </span>
        )}
      </div>
    </button>
  );
}
function ScrollRow({ children, gap = 10, initialScrollKey, shadowGutter, arrowTop, rowKey }:{children:ReactNode;gap?:number;initialScrollKey?:string;shadowGutter?:{top:number;bottom:number};arrowTop?:number|string;rowKey?:string}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hovered, setHovered] = useState(false);
  const leftArrowRef = useRef<HTMLDivElement>(null);
  const rightArrowRef = useRef<HTMLDivElement>(null);

  // Sistema de rows del Home: la row expone data-row-key/count y cada card
  // directa lleva data-item-index + data-row-card. Así el motor espacial se
  // mueve por índice (al final de la row se queda, no baja) y recuerda la
  // columna al subir/bajar. Se asigna por DOM para no reestructurar el flex
  // ni romper el scroll inicial por data-scroll-key. Sin rowKey, geométrico.
  const rowCount = rowKey ? Children.count(children) : 0;
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !rowKey) return;
    const kids = Array.from(row.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.getAttribute("aria-hidden") !== "true",
    );
    kids.forEach((kid, index) => {
      kid.setAttribute("data-item-index", String(index));
      kid.setAttribute("data-row-card", "");
    });
    return () => {
      kids.forEach(kid => {
        kid.removeAttribute("data-item-index");
        kid.removeAttribute("data-row-card");
      });
    };
  }, [children, rowKey]);

  function updateScrollState() {
    const row = rowRef.current;
    if (!row) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxLeft = row.scrollWidth - row.clientWidth;
    setCanScrollLeft(row.scrollLeft > 2);
    setCanScrollRight(maxLeft - row.scrollLeft > 2);
  }

  useEffect(() => {
    updateScrollState();
    const row = rowRef.current;
    if (!row) return;
    const onScroll = () => updateScrollState();
    row.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => updateScrollState();
    window.addEventListener("resize", onResize);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => updateScrollState())
      : null;
    resizeObserver?.observe(row);
    return () => {
      row.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
    };
  }, [children]);

  useLayoutEffect(() => {
    if (!initialScrollKey) return;
    let cancelled = false;
    const scrollToTarget = () => {
      if (cancelled) return;
      const row = rowRef.current;
      if (!row) return;
      const target = row.querySelector<HTMLElement>(`[data-scroll-key="${initialScrollKey}"]`);
      if (!target) return;
      const left = Math.max(0, target.offsetLeft - Math.max(0, (row.clientWidth - target.offsetWidth) / 2));
      row.scrollTo({ left, behavior: "auto" });
      window.setTimeout(updateScrollState, 0);
    };
    const frame = window.requestAnimationFrame(scrollToTarget);
    const retryShort = window.setTimeout(scrollToTarget, 80);
    const retryLong = window.setTimeout(scrollToTarget, 250);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryShort);
      window.clearTimeout(retryLong);
    };
  }, [children, initialScrollKey]);

  const move = (direction:"left"|"right") => {
    const row = rowRef.current;
    if (!row) return;
    scrollByGsap(row, direction === "right" ? row.clientWidth * 0.82 : -row.clientWidth * 0.82);
  };

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && canScrollLeft ? 1 : 0 }, 0.45);
    tweenTo(rightArrowRef.current, { opacity: hovered && canScrollRight ? 1 : 0 }, 0.45);
  }, [hovered, canScrollLeft, canScrollRight]);

  // El scroller horizontal recorta por definición el desbordado vertical
  // (overflow-x:auto convierte overflow-y:visible en auto). El gutter de
  // sombra vive dentro del scrollport; el margen negativo lo compensa para
  // no alterar el ritmo entre secciones (neto: +4 arriba, +12 abajo).
  const topGutter = shadowGutter?.top ?? DETAIL_ROW_SHADOW_TOP_GUTTER;
  const bottomGutter = shadowGutter?.bottom ?? DETAIL_ROW_SHADOW_BOTTOM_GUTTER;

  return (
    <div
      style={{ position:"relative" }}
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
    >
      <div
        ref={leftArrowRef}
        className="liquid-glass-arrow row-arrow-shell"
        style={{ position:"absolute",left:0,top:arrowTop ?? "50%",zIndex:10,transform:"translate(-30%,-50%)",opacity:0,pointerEvents:hovered&&canScrollLeft?"auto":"none" }}
      >
        <button
          onClick={()=>move("left")}
          title="Anterior"
          aria-label="Anterior"
          className="row-arrow-button"
          style={{ width:36,height:60,borderRadius:18,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}
        >
          <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ transform:"rotate(180deg)", overflow:"visible" }}>
            <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
          </svg>
        </button>
      </div>
      <div
        ref={rowRef}
        data-row-scroller
        data-focus-center
        data-row-key={rowKey}
        data-row-count={rowKey ? rowCount : undefined}
        style={{
          display: "flex",
          gap,
          overflowX: "auto",
          overflowY: "visible",
          margin: `${-(topGutter - 4)}px calc(-1 * var(--app-safe-x)) ${-(bottomGutter - 12)}px`,
          // The horizontal scroller clips vertical overflow by definition. Keep
          // enough scrollport gutter for the scaled card and its shadow.
          paddingTop: topGutter,
          paddingBottom: bottomGutter,
          paddingLeft: "var(--app-safe-x)",
          paddingRight: "var(--app-safe-x)",
          scrollPaddingInline: 0,
          scrollbarWidth: "none",
        }}
      >
        {children}
        <div aria-hidden="true" style={{ flex: `0 0 var(--app-safe-x)`, width: "var(--app-safe-x)", height: 1 }} />
      </div>
      <div
        ref={rightArrowRef}
        className="liquid-glass-arrow row-arrow-shell"
        style={{ position:"absolute",right:0,top:arrowTop ?? "50%",zIndex:10,transform:"translate(30%,-50%)",opacity:0,pointerEvents:hovered&&canScrollRight?"auto":"none" }}
      >
        <button
          onClick={()=>move("right")}
          title="Siguiente"
          aria-label="Siguiente"
          className="row-arrow-button"
          style={{ width:36,height:60,borderRadius:18,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}
        >
          <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ overflow:"visible" }}>
            <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EpCard({
  ep,
  scrollKey,
  locked,
  progressEntry,
  fallbackImage,
  onPlay,
  onMarkWatched,
  seasonMarked,
  previousMarked,
  onMarkSeasonWatched,
  onMarkSeasonUnwatched,
  onMarkPreviousSeasonWatched,
  onMarkPreviousSeasonUnwatched,
  onShowComments,
  hasTmdbComments,
  onMarkUnwatched,
}:{ep:Episode; scrollKey:string; locked?:boolean; progressEntry?: ContinueWatchingEntry; fallbackImage?:string; onPlay:()=>void; onMarkWatched:()=>void; seasonMarked:boolean; previousMarked:boolean; onMarkSeasonWatched:()=>void; onMarkSeasonUnwatched:()=>void; onMarkPreviousSeasonWatched:()=>void; onMarkPreviousSeasonUnwatched:()=>void; onShowComments:()=>void; hasTmdbComments?:boolean; onMarkUnwatched:(entry: ContinueWatchingEntry)=>void}) {
  const watched = Boolean(progressEntry?.completed);
  const progress = progressEntry ? progressPercent(progressEntry) : 0;
  const showProgress = !watched && progress > 0.5;
  const timeLabel = locked
    ? ep.airDate ? `Estrena ${formatDateLabel(ep.airDate)}` : "Proximamente"
    : showProgress && progressEntry
      ? formatResumeTime(progressEntry.currentTime)
      : ep.runtime
        ? formatRuntime(ep.runtime)
        : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const bigPicture = useBigPictureActive();
  // En picture sin botón "...": A/Enter corto reproduce, mantenido
  // abre las opciones tras pulsación larga (350ms).
  const longPress = useLongPressAction(bigPicture, {
    onActivate: () => { if (!locked) onPlay(); },
    onLongPress: () => { if (!locked) setMenuOpen(true); },
  }, 350);

  return (
    <div
      ref={cardRef}
      className="detail-episode-card"
      data-scroll-key={scrollKey}
      aria-disabled={locked}
      role="button"
      // En Big Picture las bloqueadas (sin estrenar) sí pueden tener foco
      // para ver info/fecha; el onClick/onKeyDown ya bloquea reproducir.
      tabIndex={locked && !bigPicture ? -1 : 0}
      data-long-press={bigPicture ? "true" : undefined}
      onClick={() => {
        if (!locked) onPlay();
      }}
      onKeyDown={bigPicture ? (event) => {
        if (event.target !== event.currentTarget) return;
        longPress.onKeyDown(event);
      } : (event) => {
        if (event.target !== event.currentTarget || locked) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      onKeyUp={bigPicture ? (event) => {
        if (event.target !== event.currentTarget) return;
        longPress.onKeyUp(event);
      } : undefined}
      style={{ opacity:locked ? 0.58 : 1, cursor:locked ? "not-allowed" : "pointer" }}
      onMouseEnter={(e)=>{
        setFocused(true);
        const card = e.currentTarget as HTMLDivElement;
        tweenTo(card,{y:-3,scale:1.03,zIndex:4},0.28);
        gsap.set(card,{boxShadow:"0 18px 40px rgba(0,0,0,0.42)"});
      }}
      onMouseLeave={(e)=>{
        setFocused(false);
        const card = e.currentTarget as HTMLDivElement;
        tweenTo(card,{y:0,scale:1,zIndex:1},0.28);
        gsap.set(card,{boxShadow:"none"});
      }}
      // En picture el foco del mando espeja el hover: escala sin bordes.
      // Las bloqueadas también escalan al tener foco (solo no reproducen).
      onFocus={bigPicture ? (e)=>{
        setFocused(true);
        const card = e.currentTarget as HTMLDivElement;
        tweenTo(card,{y:-3,scale:1.03,zIndex:4},0.28);
        gsap.set(card,{boxShadow:"0 18px 40px rgba(0,0,0,0.42)"});
      } : undefined}
      onBlur={bigPicture ? (e)=>{
        setFocused(false);
        const card = e.currentTarget as HTMLDivElement;
        tweenTo(card,{y:0,scale:1,zIndex:1},0.28);
        gsap.set(card,{boxShadow:"none"});
      } : undefined}
    >
      <div className="detail-episode-card__media">
        {(ep.still ?? fallbackImage) ? (
          <img className="detail-episode-card__image" src={ep.still ?? fallbackImage} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="detail-episode-card__placeholder" />
        )}
        <div className="detail-episode-card__scrim" />
        {showProgress ? (
          <div className="detail-episode-card__progress" aria-hidden="true">
            <div style={{ width:`${progress}%` }} />
          </div>
        ) : null}
        {timeLabel ? <span className="detail-episode-card__runtime">{timeLabel}</span> : null}
        {watched ? (
          <span className="detail-episode-card__watched" title="Visto">
            <Check size={13} />
          </span>
        ) : null}
        {!locked && !bigPicture && <button
          ref={menuButtonRef}
          className="detail-episode-card__menu"
          type="button"
          aria-label="Más opciones"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen(prev => !prev);
          }}
        >
          ...
        </button>}
      </div>
      <div className="detail-episode-card__copy">
        <p className="detail-episode-card__eyebrow">EPISODIO {ep.episode}</p>
        <p className="detail-episode-card__title">{ep.name??`Episodio ${ep.episode}`}</p>
        {ep.overview ? (
          <p className="detail-episode-card__overview" style={focused ? { color:"rgba(255,255,255,0.92)" } : undefined}>{ep.overview}</p>
        ) : ep.airDate ? (
          <p className="detail-episode-card__overview">{formatDateLabel(ep.airDate)}</p>
        ) : null}
      </div>
      {!locked&&<ContextMenu
        open={menuOpen}
        anchorRef={bigPicture ? cardRef : menuButtonRef}
        avoidRef={cardRef}
        onClose={() => setMenuOpen(false)}
        width={210}
        items={[
          watched && progressEntry
            ? { label: "Marcar episodio como no visto", icon: <EyeOff size={15} />, onSelect: () => onMarkUnwatched(progressEntry) }
            : { label: "Marcar episodio como visto", icon: <Check size={15} />, onSelect: onMarkWatched },
          seasonMarked
            ? { label: "Marcar temporada como no vista", icon: <EyeOff size={15} />, onSelect: onMarkSeasonUnwatched }
            : { label: "Marcar temporada como vista", icon: <Check size={15} />, onSelect: onMarkSeasonWatched },
          previousMarked
            ? { label: "Marcar anteriores episodios a este como no vistos", icon: <EyeOff size={15} />, onSelect: onMarkPreviousSeasonUnwatched }
            : { label: "Marcar anteriores episodios a este como vistos", icon: <Check size={15} />, onSelect: onMarkPreviousSeasonWatched },
          ...(hasTmdbComments ? [{ label: "Mostrar comentarios de TMDB", icon: <UsersRound size={15} />, onSelect: onShowComments }] : []),
        ]}
      />}
    </div>
  );
}

function TrailerCard({ trailer, media }:{trailer:Trailer;media:DetailData}) {
  const navigate = useNavigate();
  const bigPicture = useBigPictureActive();
  const fallbackThumb = media.backdrop ?? media.poster ?? "";
  const initialThumb = trailer.thumbnail ?? (trailer.key ? `https://img.youtube.com/vi/${trailer.key}/maxresdefault.jpg` : fallbackThumb);
  const [thumbSrc, setThumbSrc] = useState(initialThumb);
  const [thumbFailed, setThumbFailed] = useState(false);

  function playTrailer() {
    const stream: MediaStream = trailer.stream ?? {
      id: `tmdb-trailer-${trailer.key}`,
      addonId: "tmdb",
      addonName: "TMDB",
      name: "Trailer",
      title: trailer.name,
      description: `Trailer - ${media.name}`,
      ytId: trailer.key,
      behaviorHints: {
        background: media.backdrop,
        poster: media.poster,
      },
    };

    sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(stream));
    sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: `${media.name} - Trailer`,
      logo: sanitizeLogoUrl(media.logo),
      background: media.backdrop ?? media.poster,
    }));

    const q = new URLSearchParams({ type: media.type, id: media.id, trailer: "1" });
    navigate(buildPlayerPath(q.toString()));
  }

  if (thumbFailed) return null;

  return (
    <button
      type="button"
      onClick={playTrailer}
      style={{ flexShrink:0,width:399,height:224,borderRadius:14,overflow:"hidden",display:"block",position:"relative",cursor:"pointer",background:"#1c1c1e",textDecoration:"none",border:"1px solid rgba(225,230,238,0.1)",boxShadow:"0 12px 28px rgba(0,0,0,0.28)",padding:0,textAlign:"left" }}
      onMouseEnter={e=>{
         tweenTo(e.currentTarget, { scale: 1.04, y: -4, zIndex: 5 }, 0.32);
         gsap.set(e.currentTarget, { boxShadow: "0 20px 42px rgba(0,0,0,0.48)" });
       }}
       onMouseLeave={e=>{
         tweenTo(e.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32);
         gsap.set(e.currentTarget, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
       }}
       onFocus={bigPicture ? (e=>{
         tweenTo(e.currentTarget, { scale: 1.04, y: -4, zIndex: 5 }, 0.32);
         gsap.set(e.currentTarget, { boxShadow: "0 20px 42px rgba(0,0,0,0.48)" });
       }) : undefined}
       onBlur={bigPicture ? (e=>{
         tweenTo(e.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32);
         gsap.set(e.currentTarget, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
       }) : undefined}
    >
      {thumbSrc ? (
        <img src={thumbSrc} alt={trailer.name}
          onError={() => {
            if (trailer.key && /maxresdefault/.test(thumbSrc)) {
              setThumbSrc(`https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`);
            } else {
              setThumbFailed(true);
            }
          }}
          loading="lazy"
          decoding="async"
          style={{ width:"100%",height:"100%",objectFit:"cover",transform:"scale(1)" }} />
      ) : null}
      <div style={{ position:"absolute",inset:0,pointerEvents:"none",background:"rgba(0,0,0,0.14)" }} />
      <div style={{ position:"absolute",left:"50%",top:"50%",width:46,height:46,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(255,255,255,0.92)",color:"#000",boxShadow:"0 14px 34px rgba(0,0,0,0.45)",transform:"translate(-50%,-50%)" }}>
        <Play size={16} fill="black" />
      </div>
    </button>
  );
}

function CastCard({ member, onPress, scrollKey }:{member:CastMember;onPress:()=>void;scrollKey?:string}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const bigPicture = useBigPictureActive();
  const portraitAvailable = Boolean(member.profile_path) && !imageFailed;
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0,2)
    .map(part=>part.charAt(0).toUpperCase())
    .join("");
  const character = member.character?.split("(")[0]?.trim();
  const setFocusedScale = (element:HTMLButtonElement,focused:boolean) => {
    setFocused(focused);
    tweenTo(element, { scale: focused ? 1.05 : 1, y: focused ? -4 : 0, zIndex: focused ? 5 : 1 }, 0.32);
    const portrait = element.querySelector<HTMLElement>("[data-cast-portrait]");
    if (portrait) {
      // En picture el foco es solo escala: sin anillo blanco.
      const ring = bigPicture ? "" : ", 0 0 0 1px rgba(255,255,255,0.18)";
      tweenTo(portrait, {
        scale: focused ? 1.05 : 1,
        boxShadow: focused
          ? `0 18px 38px rgba(0,0,0,0.48)${ring}`
          : "0 11px 26px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.1)",
      }, 0.32);
    }
  };
  return (
    <button
      type="button"
      data-scroll-key={scrollKey}
      onClick={onPress}
      onMouseEnter={event=>setFocusedScale(event.currentTarget,true)}
      onMouseLeave={event=>setFocusedScale(event.currentTarget,false)}
      onFocus={event=>setFocusedScale(event.currentTarget,true)}
      onBlur={event=>setFocusedScale(event.currentTarget,false)}
      style={{
        flexShrink:0,
        width:194,
        border:0,
        borderRadius:0,
        padding:0,
        background:"transparent",
        color:"#fff",
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        gap:9,
        cursor:"pointer",
        transform:"scale(1)",
        transformOrigin:"center",
        fontFamily:"Inter, system-ui, sans-serif",
      }}
    >
      {portraitAvailable?(
        <img
          data-cast-portrait
          src={member.profile_path}
          alt={member.name}
          loading="lazy"
          decoding="async"
          onError={()=>setImageFailed(true)}
          onLoad={(e)=>{
            const img=e.currentTarget;
            if(img.naturalWidth<10||img.naturalHeight<10) setImageFailed(true);
          }}
          style={{ width:159,height:159,borderRadius:"50%",objectFit:"cover",flexShrink:0,background:"#272A2F",boxShadow:"0 11px 26px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.1)" }}
        />
      ):(
        <div data-cast-portrait style={{
          width:159,height:159,borderRadius:"50%",
          background:"linear-gradient(180deg, rgba(154,154,154,0.96) 0%, rgba(112,112,112,0.96) 100%)",
          boxShadow:"0 11px 26px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.1)",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:42,color:"rgba(255,255,255,0.94)",fontWeight:900,letterSpacing:1,flexShrink:0,
          fontFamily:"Inter, system-ui, sans-serif"
        }}>
          {initials}
        </div>
      )}
      <span style={{ width:"100%",fontSize:14,fontWeight:600,color:"#fff",textAlign:"center",lineHeight:"18px",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden" }}>{member.name}</span>
      {character&&<span style={{ width:"100%",fontSize:12,fontWeight:500,color:focused?"rgba(255,255,255,1)":"rgba(255,255,255,0.56)",textAlign:"center",lineHeight:"16px",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",transition:"color 0.25s ease" }}>{character}</span>}
    </button>
  );
}
