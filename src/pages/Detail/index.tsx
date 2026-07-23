import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Image as ImageIcon, MoreHorizontal, Play, X, ChevronLeft, ChevronRight, ChevronDown, Check, EyeOff, UsersRound } from "lucide-react";
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
import { pickPreferredTmdbBackdrop, sortTmdbBackdropsByPreference } from "../../utils/tmdbArtwork";
import {
  readDetailBackgroundOverride,
  readDetailLogoOverride,
  readDetailMediaMeta,
  writeDetailBackgroundOverride,
  writeDetailLogoOverride,
  writeDetailMediaMeta,
} from "../../utils/mediaMetadata";
import {
  fetchTraktCommentsForMedia,
  syncTraktMarkedUnwatched,
  syncTraktMarkedWatched,
  syncTraktRemovePlayback,
  type TraktCommentReview,
} from "../../trakt";
import { SELECTED_ENGINE_KEY, SELECTED_MEDIA_META_KEY, SELECTED_STREAM_KEY } from "../Player/utils";
import { scrollByGsap, scrollToElementGsap, tweenTo } from "../../utils/motion";
const IMG      = "https://image.tmdb.org/t/p";
const DEBUG_LOGO = false;
const DETAIL_LOGO_KEY = "aetherio-detail-logo";

function preloadImage(url?: string | null) {
  if (!url) return Promise.resolve();
  return new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
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

interface CastMember { id:number|string;name:string;character:string;profile_path?:string; }
interface Trailer    { key?:string;name:string;thumbnail?:string;stream?:MediaStream; }
interface Related    { id:number;title?:string;poster_path?:string;media_type:string; }
interface Episode    { id:string;episode:number;season:number;name?:string;overview?:string;still?:string;runtime?:number;airDate?:string; }
interface MetaCompany { id:number|string;name:string;logo?:string; }
interface BackgroundOption { url:string;label:string;source:"addon"|"tmdb"|"cache"; }
interface LogoOption { url:string;label:string;source:"addon"|"tmdb"|"cache"; }
interface DetailData {
  id:string;name:string;type:string;
  ids?:{ tmdb?:number; imdb?:string; trakt?:number };
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

type TraktCommentsMode = "title" | "episode";

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
  return releaseMs > today.getTime();
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

function getSearchReturnPath(params: URLSearchParams) {
  if (params.get("fromSearch") !== "1") return null;
  const query = params.get("q")?.trim();
  return query ? `/search?q=${encodeURIComponent(query)}` : "/search";
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

export default function DetailPage() {
  const { type, id } = useParams<{type:string;id:string}>();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData]         = useState<DetailData|null>(null);
  const [loading, setLoading]   = useState(true);
  const [season, setSeason]     = useState(1);
  const [showMore, setShowMore] = useState(false);
  const [progressVersion, setProgressVersion] = useState(0);
  const [logoStatus, setLogoStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [cachedLogo, setCachedLogo] = useState<string | null>(() => readCachedLogo(getDetailLogoKey(type, id)));
  const [commentsMode, setCommentsMode] = useState<TraktCommentsMode>("title");
  const [commentsEpisodeTarget, setCommentsEpisodeTarget] = useState<Episode | null>(null);
  const [traktComments, setTraktComments] = useState<TraktCommentReview[]>([]);
  const [traktCommentsLoading, setTraktCommentsLoading] = useState(false);
  const [traktCommentsError, setTraktCommentsError] = useState("");
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [backgroundPickerOpen, setBackgroundPickerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const popupOpenTimerRef = useRef<number | null>(null);
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const detailMenuButtonRef = useRef<HTMLButtonElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const getEnabled = useAddonStore(s => s.getEnabledAddons);
  const { allowTmdbArtworkFallback } = useHomePreferences();
  const mdbListSettings = useMdbListSettings();
  const fullMdbListSettings = ({
    ...mdbListSettings,
    showTrakt: true,
    showImdb: true,
    showTmdb: true,
    showLetterboxd: true,
    showTomatoes: true,
    showMetacritic: true,
  });

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
    if (type && id) load(type, id);
  }, [
    type,
    id,
    allowTmdbArtworkFallback,
    mdbListSettings.enabled,
    mdbListSettings.apiKey,
  ]);

  useEffect(() => {
    setCommentsMode("title");
    setCommentsEpisodeTarget(null);
  }, [type, id]);

  useEffect(() => {
    if (!showMore && !backgroundPickerOpen && !logoPickerOpen) return;
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const shellScroll = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
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

  useEffect(() => {
    if (data?.logo || cachedLogo) setLogoStatus("loaded");
    else setLogoStatus("idle");
  }, [data?.id, data?.logo, cachedLogo]);

  useEffect(() => {
    setCachedLogo(readCachedLogo(getDetailLogoKey(type, id)));
  }, [type, id]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("fromStreams") !== "1") return;
    window.history.pushState({ aetherioDetailFromStreams: true }, "");
    const onPopState = () => {
      const searchPath = getSearchReturnPath(params);
      navigate(searchPath ?? "/home", { replace: true });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [location.search, navigate]);

  useEffect(() => {
    const onUpdated = () => setProgressVersion(prev => prev + 1);
    window.addEventListener(CONTINUE_WATCHING_EVENT, onUpdated as EventListener);
    return () => window.removeEventListener(CONTINUE_WATCHING_EVENT, onUpdated as EventListener);
  }, []);

  async function load(t:string, mediaId:string) {
    setLoading(true);
    const shouldUseTmdbArtwork = allowTmdbArtworkFallback || mediaId.startsWith("tmdb:");
    const logoOverride = readDetailLogoOverride(t, mediaId);
    const hasLogoOverride = logoOverride !== undefined;
    const overrideLogo = sanitizeLogoUrl(logoOverride);
    const cachedMediaLogo = hasLogoOverride ? overrideLogo : readCachedLogo(getDetailLogoKey(t, mediaId)) ?? undefined;
    const seededMeta = readDetailMediaMeta(t, mediaId);
    const backgroundOverride = readDetailBackgroundOverride(t, mediaId);
    let d:DetailData = {
      id: mediaId,
      name: seededMeta?.name ?? "",
      type: t,
      ids: parseMediaIds(mediaId),
      aliases: uniqueAliases(seededMeta?.name, mediaId),
      backdrop: backgroundOverride ?? seededMeta?.background,
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
    const finish = async (next: DetailData) => {
      logoLog("detail data ready", { resolvedLogo: next.logo ?? null });
      if (next.logo) setCachedLogo(writeCachedLogo(getDetailLogoKey(t, mediaId), next.logo) ?? null);
      else setCachedLogo(null);
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
      setData(next);
      setLoading(false);
      void Promise.all([
        preloadImage(next.backdrop),
        preloadImage(next.poster),
        preloadImage(next.logo),
      ]);
    };
    const finishWithRatings = async (next: DetailData) => {
      if (!fullMdbListSettings.enabled || !fullMdbListSettings.apiKey.trim()) {
        await finish(next);
        return;
      }
      const ratings = await fetchMdbListRatingsForMedia({
        settings: fullMdbListSettings,
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
          backdrop: backgroundOverride ?? pickAddonArtwork(m.background, m.backdrop, m.fanart) ?? d.backdrop,
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
      let resolvedType: string | null = null;
      if (mediaId.startsWith("tt")) {
        const fd = await tmdbFetch<any>(`/find/${mediaId}`, { params: { external_source: "imdb_id", language: "es-ES" } });
        const rs = fd?.movie_results?.length ? fd.movie_results : fd?.tv_results ?? [];
        tmdbId = rs[0]?.id??null;
      } else if (mediaId.startsWith("tmdb:")) {
        tmdbId = parseInt(mediaId.replace("tmdb:",""),10);
      }
      if (!tmdbId && d.name) {
        const isAnime = t === "anime";
        const searchTypes = t === "movie" ? ["movie"] : isAnime ? ["tv", "movie"] : ["tv"];
        for (const searchType of searchTypes) {
          const sd = await tmdbFetch<any>(`/search/${searchType}`, { params: { query: d.name, language: "es-ES" } })
            ?? await tmdbFetch<any>(`/search/${searchType}`, { params: { query: d.name, language: "en-US" } });
          tmdbId = sd?.results?.[0]?.id ?? null;
          if (tmdbId) { if (isAnime) resolvedType = searchType; break; }
        }
      }
      if (!tmdbId) { await finishWithRatings(d); return; }

      let ep2 = (t === "movie" || resolvedType === "movie") ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
      let [mainEs,imgRes,mainEn]=await Promise.all([
        tmdbFetch<any>(`${ep2}`, { params: { language: "es-ES", append_to_response: "credits,aggregate_credits,videos,similar,recommendations,external_ids" } }),
        tmdbFetch<any>(`${ep2}/images`, { params: { include_image_language: "en,es,null" } }),
        tmdbFetch<any>(`${ep2}`, { params: { language: "en-US", append_to_response: "credits,aggregate_credits,videos,similar,recommendations,external_ids" } }),
      ]);
      if (!mainEs && !mainEn && ep2.startsWith("/tv/")) {
        ep2 = `/movie/${tmdbId}`;
        [mainEs,imgRes,mainEn]=await Promise.all([
          tmdbFetch<any>(`${ep2}`, { params: { language: "es-ES", append_to_response: "credits,aggregate_credits,videos,similar,recommendations,external_ids" } }),
          tmdbFetch<any>(`${ep2}/images`, { params: { include_image_language: "en,es,null" } }),
          tmdbFetch<any>(`${ep2}`, { params: { language: "en-US", append_to_response: "credits,aggregate_credits,videos,similar,recommendations,external_ids" } }),
        ]);
        resolvedType = "movie";
      }
      const main=mainEs ?? mainEn;
      const imgs=imgRes ?? {};
      if (!main) { await finishWithRatings(d); return; }
      d.ids = {
        ...d.ids,
        tmdb: tmdbId,
        imdb: main.external_ids?.imdb_id ?? d.ids?.imdb,
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
      if (!d.description||t==="anime") d.description=main.overview;
      if (!d.year) d.year=parseInt((main.release_date??main.first_air_date??"").slice(0,4),10)||undefined;
      if (!d.genres?.length) d.genres=main.genres?.map((g:any)=>g.name);
      if (!d.name) d.name=main.title??main.name??"";
      if (typeof main.vote_average === "number") d.voteAverage=main.vote_average;
      if (!d.runtime){ const mins=t==="movie"?main.runtime:main.episode_run_time?.[0]; if(mins) d.runtime=formatRuntime(mins); }
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
      if (!d.director){ const dir=(main.credits?.crew??[]).find((c:any)=>c.job==="Director"); if(dir) { d.director=dir.name; d.directorId=dir.id; } }
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
    if (!data) {
      setTraktComments([]);
      setTraktCommentsError("");
      setTraktCommentsLoading(false);
      return;
    }

    let cancelled = false;
    const targetEpisode = commentsMode === "episode" ? commentsEpisodeTarget : null;
    if (commentsMode === "episode" && !targetEpisode) {
      setCommentsMode("title");
      return;
    }

    setTraktCommentsLoading(true);
    setTraktCommentsError("");
    void fetchTraktCommentsForMedia({
      type: data.type,
      id: data.id,
      ids: data.ids,
      season: targetEpisode?.season,
      episode: targetEpisode?.episode,
    }).then(page => {
      if (cancelled) return;
      setTraktComments(page.items);
      setTraktCommentsError("");
    }).catch(error => {
      if (cancelled) return;
      setTraktComments([]);
      setTraktCommentsError(String(error instanceof Error ? error.message : error));
    }).finally(() => {
      if (!cancelled) setTraktCommentsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    commentsMode,
    data?.id,
    data?.ids?.imdb,
    data?.ids?.tmdb,
    data?.ids?.trakt,
    data?.type,
    commentsEpisodeTarget?.episode,
    commentsEpisodeTarget?.season,
  ]);

  useEffect(() => {
    const targetSeason = focusTargetEpisode?.season;
    if (!targetSeason) return;
    setSeason(current => current === targetSeason ? current : targetSeason);
  }, [focusTargetEpisode?.season]);

  if (loading) return <div className="skeleton" style={{ width:"100vw", height:"100vh", marginTop:"calc(-1 * var(--app-shell-nav-height))" }} />;
  if (!data)   return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"80vh",color:"rgba(255,255,255,0.4)" }}>Error cargando.</div>;
  const detailData = data;

  const isMovie = detailData.type==="movie";
  const typeLabel = isMovie ? "Película" : data.type === "anime" ? "Anime" : "Programa de TV";
  const DESC_MAX  = 180;
  const normalizedDescription = normalizeMojibakeText(data.description ?? "");
  const descShort = normalizedDescription.length > DESC_MAX ? normalizedDescription.slice(0, DESC_MAX) + "..." : normalizedDescription;
  const hasMore   = (data.description ?? "").length>DESC_MAX;
  const regularSeasons = data.seasons?.filter(s=>s.number>0) ?? [];
  const specialSeason = data.seasons?.find(s=>s.number===0);
  const curSeason = regularSeasons.find(s=>s.number===season) ?? regularSeasons[0];
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
        entryKind: "next",
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
        entryKind: "next",
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
        entryKind: "next",
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

  // Navegar al selector de fuentes
  function goToStreams(season?: number, ep?: number, episodeName?: string) {
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
    navigate(`/episode?${q.toString()}`);
  }

  function goToStreamsContinue(season?: number, ep?: number, episodeName?: string) {
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
    navigate(`/episode?${q.toString()}`);
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

  function showEpisodeTraktComments(episode: Episode) {
    setCommentsEpisodeTarget(episode);
    setCommentsMode("episode");
    window.setTimeout(() => {
      scrollToElementGsap(commentsSectionRef.current);
    }, 80);
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
    setData(current => current ? { ...current, backdrop: background } : current);
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
    scheduleHeroPopup(() => setShowMore(true));
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
    setData(current => current ? { ...current, logo: nextLogo } : current);
    setLogoPickerOpen(false);
  }

  return (
    <div className="detail-page-scale" style={{ minHeight:"100vh", background:"#1f1f1f" }}>
      {/* HERO full-bleed */}
      <div className="detail-page-hero" ref={heroRef} style={{ position:"relative", width:"100vw", left:"50%", marginLeft:"-50vw", height:"calc(92vh + var(--app-shell-nav-height) - 150px)", minHeight:450, marginTop:"calc(-1 * var(--app-shell-nav-height))", overflow:"hidden" }}>
        {(data.backdrop??data.poster)&&(
          <img src={data.backdrop??data.poster} alt="" width="1920" height="1080"
            style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top",aspectRatio:"1920/1080" }} />
        )}
        <div style={{ position:"absolute",inset:0,background:"linear-gradient(to right,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.4) 40%,transparent 65%)",pointerEvents:"none" }} />
        <div style={{ position:"absolute",inset:0,background:"linear-gradient(to top,rgba(31,31,31,1) 0%,rgba(31,31,31,0.55) 22%,transparent 52%)",pointerEvents:"none" }} />

        <div style={{ position:"absolute",bottom:20,left:0,padding:"0 var(--app-safe-x) 36px",maxWidth:520 }}>
          {displayLogo && logoStatus !== "error" ? (
            <div style={{ minHeight:100,display:"flex",alignItems:"center",marginBottom:14,position:"relative" }}>
              <button
                type="button"
                onClick={() => navigate(`/detail/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}`, { replace: true })}
                aria-label={`Ir al detalle de ${data.name}`}
                style={{ border:0,padding:0,background:"transparent",cursor:"pointer",display:"block" }}
              >
                <img
                  src={displayLogo}
                  alt={data.name}
                  onLoad={() => {
                    logoLog("logo img onLoad", { url: displayLogo });
                    setLogoStatus("loaded");
                  }}
                  onError={() => {
                    logoLog("logo img onError", { url: displayLogo });
                    setLogoStatus("error");
                  }}
                  style={{ maxHeight:100,maxWidth:300,objectFit:"contain",filter:"drop-shadow(0 2px 10px rgba(0,0,0,0.75))",opacity:1, display:"block" }}
                />
              </button>
            </div>
          ) : (
            <h1 style={{ fontSize:"2.6rem",fontWeight:900,color:"#fff",marginBottom:14,lineHeight:1.05,textShadow:"0 2px 20px rgba(0,0,0,0.8)" }}>{data.name}</h1>
          )}
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap" }}>
            <span style={{ fontSize:15,color:"rgba(255,255,255,0.65)",fontWeight:500 }}>{typeLabel}</span>
            {data.genres?.slice(0,2).map(g=><span key={g} style={{ fontSize:15,color:"rgba(255,255,255,0.55)" }}>· {g}</span>)}
          </div>
          <div style={{ marginBottom:12 }}>
            <span style={{ fontSize:15,color:"rgba(255,255,255,0.65)",lineHeight:1.6 }}>{descShort}</span>
            {hasMore&&<button onClick={openShowMore} style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.7)",background:"none",border:"none",cursor:"pointer",marginLeft:6 }}>MÁS</button>}
          </div>
          {data.mdbListRatings ? <MDBListRatingsRow ratings={data.mdbListRatings} compact /> : null}
          <div style={{ display:"flex",alignItems:"center",gap:7,marginTop:8,marginBottom:18,flexWrap:"wrap" }}>
            {data.year&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.5)" }}>{data.year}</span>}
            {data.runtime&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.5)" }}>· {formatRuntime(data.runtime) || data.runtime}</span>}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            {/* Reproducir -> /episode */}
            <button onClick={playFromDetail}
              style={{ display:"flex",alignItems:"center",gap:8,padding:"11px 30px",background:"#fff",color:"#000",fontWeight:700,borderRadius:999,fontSize:15,border:"none",cursor:"pointer",boxShadow:"0 3px 12px rgba(0,0,0,0.38)" }}>
              <Play size={16} fill="black" /> {playLabel}
            </button>
            <button
              ref={detailMenuButtonRef}
              type="button"
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

        {(data.cast?.length||data.director)&&(
          <div style={{ position:"absolute",bottom:20,right:0,padding:"0 var(--app-safe-x) 36px",textAlign:"right",maxWidth:300 }}>
            {!!data.cast?.length&&(<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)",marginBottom:5 }}><span style={{ color:"rgba(255,255,255,0.3)" }}>Reparto </span>{data.cast.slice(0,3).map((castMember, index) => (<span key={castMember.id}>{index > 0 ? ", " : ""}<button type="button" onClick={() => navigate(`/person/${encodeURIComponent(String(castMember.id))}`)} style={{ background:"none",border:"none",padding:0,color:"rgba(255,255,255,0.8)",cursor:"pointer",fontSize:13,textDecoration:"underline",textUnderlineOffset:2 }}>{castMember.name}</button></span>))}</p>)}
            {data.director&&<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)" }}><span style={{ color:"rgba(255,255,255,0.3)" }}>Dirección </span><button type="button" onClick={() => data.directorId && navigate(`/person/${encodeURIComponent(String(data.directorId))}`)} disabled={!data.directorId} style={{ background:"none",border:"none",padding:0,color:"rgba(255,255,255,0.8)",cursor:data.directorId ? "pointer" : "default",fontSize:13,textDecoration:data.directorId ? "underline" : "none",textUnderlineOffset:2 }}>{data.director}</button></p>}
          </div>
        )}
        {showMore&&(
          <div
            onClick={()=>setShowMore(false)}
            style={{ position:"absolute",inset:0,zIndex:20,display:"flex",alignItems:"center",justifyContent:"center",padding:"var(--app-safe-x)",background:"rgba(0,0,0,0.64)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)" }}
          >
            <div
              className="liquid-glass-dark"
              onClick={e=>e.stopPropagation()}
              style={{ borderRadius:18,padding:"28px 30px",width:"min(560px, calc(100vw - var(--app-safe-x) * 2))",maxHeight:"min(56vh, 420px)",overflowY:"auto",position:"relative",boxShadow:"0 24px 80px rgba(0,0,0,0.58)" }}
            >
              <button onClick={()=>setShowMore(false)} style={{ position:"absolute",top:14,right:14,width:30,height:30,border:"none",borderRadius:999,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.68)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><X size={16}/></button>
              <p style={{ fontSize:15,color:"rgba(255,255,255,0.82)",lineHeight:1.72,paddingRight:24,fontWeight:400 }}>{normalizedDescription}</p>
            </div>
          </div>
        )}
        {backgroundPickerOpen&&(
          <div
            onClick={()=>setBackgroundPickerOpen(false)}
            style={{ position:"absolute",inset:0,zIndex:22,display:"flex",alignItems:"center",justifyContent:"center",padding:"var(--app-safe-x)",background:"rgba(0,0,0,0.66)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)" }}
          >
            <div
              className="liquid-glass-dark"
              onClick={event=>event.stopPropagation()}
              style={{ borderRadius:20,padding:"28px",width:"min(860px, calc(100vw - var(--app-safe-x) * 2))",maxHeight:"min(72vh, 620px)",overflowY:"auto",position:"relative",boxShadow:"0 26px 90px rgba(0,0,0,0.62)" }}
            >
              <button onClick={()=>setBackgroundPickerOpen(false)} style={{ position:"absolute",top:14,right:14,width:30,height:30,border:"none",borderRadius:999,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.68)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><X size={16}/></button>
              <div style={{ paddingRight:42,marginBottom:20 }}>
                <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#fff",letterSpacing:0 }}>Fondo del medio</h2>
                <p style={{ margin:"8px 0 0",fontSize:13,lineHeight:1.5,color:"rgba(255,255,255,0.58)" }}>Elige una imagen de fondo disponible desde los addons o TMDB.</p>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(210px, 1fr))",gap:12 }}>
                {(data.backgroundOptions ?? []).map((option, index) => {
                  const active = option.url === data.backdrop;
                  return (
                    <button
                      key={`${option.url}-${index}`}
                      type="button"
                      onClick={() => applyDetailBackground(option.url)}
                      style={{ position:"relative",height:118,borderRadius:14,overflow:"hidden",border:active ? "1px solid rgba(255,255,255,0.82)" : "1px solid rgba(255,255,255,0.12)",background:"#151515",padding:0,cursor:"pointer",boxShadow:active ? "0 0 0 2px rgba(255,255,255,0.14)" : "none",textAlign:"left" }}
                    >
                      <img src={backgroundPreviewUrl(option.url)} alt="" loading="lazy" decoding="async" style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover" }} />
                      <div style={{ position:"absolute",inset:0,background:"linear-gradient(to top, rgba(0,0,0,0.74), rgba(0,0,0,0.08))" }} />
                      <div style={{ position:"absolute",left:10,right:10,bottom:9,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10 }}>
                        <span style={{ minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.9)" }}>{option.label}</span>
                        {active ? <Check size={16} style={{ color:"#fff",flexShrink:0 }} /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {logoPickerOpen&&(
          <div
            onClick={()=>setLogoPickerOpen(false)}
            style={{ position:"absolute",inset:0,zIndex:22,display:"flex",alignItems:"center",justifyContent:"center",padding:"var(--app-safe-x)",background:"rgba(0,0,0,0.66)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)" }}
          >
            <div
              className="liquid-glass-dark"
              onClick={event=>event.stopPropagation()}
              style={{ borderRadius:20,padding:"28px",width:"min(860px, calc(100vw - var(--app-safe-x) * 2))",maxHeight:"min(72vh, 620px)",overflowY:"auto",position:"relative",boxShadow:"0 26px 90px rgba(0,0,0,0.62)" }}
            >
              <button onClick={()=>setLogoPickerOpen(false)} style={{ position:"absolute",top:14,right:14,width:30,height:30,border:"none",borderRadius:999,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.68)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><X size={16}/></button>
              <div style={{ paddingRight:42,marginBottom:20 }}>
                <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#fff",letterSpacing:0 }}>Logo del medio</h2>
                <p style={{ margin:"8px 0 0",fontSize:13,lineHeight:1.5,color:"rgba(255,255,255,0.58)" }}>{data.name} · Elige un logo disponible desde los addons, TMDB o usa texto.</p>
              </div>
              <button
                type="button"
                onClick={() => applyDetailLogo("")}
                style={{ width:"100%",minHeight:48,borderRadius:14,border:!displayLogo ? "1px solid rgba(255,255,255,0.82)" : "1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.1)",color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"0 16px",marginBottom:16,textAlign:"left",boxShadow:!displayLogo ? "0 0 0 2px rgba(255,255,255,0.14)" : "none" }}
              >
                <span style={{ fontSize:15,fontWeight:650,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>Usar texto (sin logo)</span>
                {!displayLogo ? <Check size={16} style={{ color:"#fff",flexShrink:0 }} /> : null}
              </button>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(210px, 1fr))",gap:12 }}>
                {(data.logoOptions ?? []).map((option, index) => {
                  const active = sanitizeLogoUrl(option.url) === displayLogo;
                  return (
                    <button
                      key={`${option.url}-${index}`}
                      type="button"
                      onClick={() => applyDetailLogo(option.url)}
                      style={{ position:"relative",height:118,borderRadius:14,overflow:"hidden",border:active ? "1px solid rgba(255,255,255,0.82)" : "1px solid rgba(255,255,255,0.12)",background:"#151515",padding:0,cursor:"pointer",boxShadow:active ? "0 0 0 2px rgba(255,255,255,0.14)" : "none",textAlign:"left" }}
                    >
                      <img src={option.url} alt="" loading="lazy" decoding="async" style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",padding:18 }} />
                      <div style={{ position:"absolute",left:0,right:0,bottom:0,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"8px 10px",background:"rgba(0,0,0,0.7)" }}>
                        <span style={{ minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.9)" }}>{option.label}</span>
                        {active ? <Check size={16} style={{ color:"#fff",flexShrink:0 }} /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECCIONES INFERIORES */}
      <div style={{ padding:"36px var(--app-safe-x)",display:"flex",flexDirection:"column",gap:44,background:"#1f1f1f" }}>

        {/* Episodios */}
        {!isMovie&&curSeason&&(
          <section>
            <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:18 }}>
              {regularSeasons.length>1&&(
                <SeasonMenu
                  seasons={regularSeasons}
                  value={season}
                  onChange={setSeason}
                />
              )}
              {regularSeasons.length<=1&&(
                <h2 style={{ fontSize:19,fontWeight:750,color:"#fff",lineHeight:1.1 }}>Temporada {curSeason.number}</h2>
              )}
            </div>
            <ScrollRow gap={10} initialScrollKey={episodeScrollKey || getEpisodeKey(curSeason.episodes[0]?.season, curSeason.episodes[0]?.episode)}>
              {curSeason.episodes.map(ep=>(
                <EpCard
                  key={ep.id}
                  scrollKey={getEpisodeKey(ep.season, ep.episode)}
                  ep={ep}
                  fallbackImage={data.backdrop ?? undefined}
                  locked={isEpisodeLocked(ep)}
                  progressEntry={episodeProgressMap.get(`${ep.season}:${ep.episode}`)}
                  seasonMarked={seasonMarkedMap.get(curSeason.number) ?? false}
                  previousMarked={arePreviousEpisodesMarked(ep.season, ep.episode)}
                  onPlay={()=>goToStreams(ep.season,ep.episode,ep.name)}
                  onMarkWatched={() => markEpisodeFromCard(ep)}
                  onMarkSeasonWatched={() => markSeasonAsWatched(ep.season)}
                  onMarkSeasonUnwatched={() => markSeasonAsUnwatched(ep.season)}
                  onMarkPreviousSeasonWatched={() => markPreviousEpisodesAsWatched(ep.season, ep.episode)}
                  onMarkPreviousSeasonUnwatched={() => markPreviousEpisodesAsUnwatched(ep.season, ep.episode)}
                  onShowTraktComments={() => showEpisodeTraktComments(ep)}
                  onMarkUnwatched={(entry) => {
                    const removed = removeContinueWatchingEntry(entry.key);
                    void syncTraktRemovePlayback(removed ?? entry);
                    void syncTraktMarkedUnwatched(removed ?? entry);
                  }}
                />
              ))}
            </ScrollRow>
          </section>
        )}

        {!isMovie&&Boolean(specialSeason?.episodes.length)&&(
          <section>
            <h2 style={{ fontSize:19,fontWeight:750,color:"#fff",lineHeight:1.1,marginBottom:18 }}>Especiales</h2>
            <ScrollRow gap={10}>
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
                  onShowTraktComments={() => showEpisodeTraktComments(ep)}
                  onMarkUnwatched={(entry) => {
                    const removed = removeContinueWatchingEntry(entry.key);
                    void syncTraktRemovePlayback(removed ?? entry);
                    void syncTraktMarkedUnwatched(removed ?? entry);
                  }}
                />
              ))}
            </ScrollRow>
          </section>
        )}

        {!!data.trailers?.length&&(
          <section>
            <SectionH title="Tráilers" />
            <ScrollRow gap={10}>
              {data.trailers.map((t,index)=><TrailerCard key={t.key ?? `trailer-${index}`} trailer={t} media={data} />)}
            </ScrollRow>
          </section>
        )}

        <div ref={commentsSectionRef}>
          <TraktCommentsSection
            comments={traktComments}
            loading={traktCommentsLoading}
            error={traktCommentsError}
            mode={commentsMode}
            episodeLabel={commentsEpisodeTarget ? `T${commentsEpisodeTarget.season} E${commentsEpisodeTarget.episode}` : ""}
            canSwitchMode={Boolean(commentsEpisodeTarget)}
            onModeChange={setCommentsMode}
          />
        </div>

        {!!data.cast?.length&&(
          <section>
            <SectionH title="Reparto" />
            <ScrollRow gap={25} initialScrollKey={`${data.id}:cast:start`}>
              {data.cast.map((c,index)=><CastCard key={c.id} member={c} scrollKey={index===0?`${data.id}:cast:start`:undefined} onPress={()=>navigate(`/person/${encodeURIComponent(String(c.id))}`)} />)}
            </ScrollRow>
          </section>
        )}

        <CompanyLogoSection networks={data.networks} productionCompanies={data.productionCompanies} />

        {!!data.collection?.length&&(
          <section>
            <SectionH title={data.collectionName || "Colección"} />
            <ScrollRow gap={20} initialScrollKey={`${data.id}:collection`}>
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
                navigate(`/detail/${item.type}/${item.id}`);
              }} />)}
            </ScrollRow>
          </section>
        )}

        {!!data.related?.length&&(
          <section>
            <SectionH title="Más como esto" />
            <ScrollRow gap={8}>
              {data.related.map(r=>(
                <div key={r.id}
                  onClick={()=>navigate(`/detail/${r.media_type}/tmdb:${r.id}`)}
                  style={{ flexShrink:0,width:180,height:271,borderRadius:10,overflow:"hidden",cursor:"pointer",background:"#1c1c1e" }}
                  onMouseEnter={e=>{
                    const card = e.currentTarget as HTMLDivElement;
                    tweenTo(card, { boxShadow: "0 18px 44px rgba(0,0,0,0.32)" }, 0.25);
                    const image = card.querySelector("img") as HTMLImageElement | null;
                    if (image) tweenTo(image, { scale: 1.05 }, 0.25);
                  }}
                  onMouseLeave={e=>{
                    const card = e.currentTarget as HTMLDivElement;
                    tweenTo(card, { boxShadow: "0 0 0 rgba(0,0,0,0)" }, 0.25);
                    const image = card.querySelector("img") as HTMLImageElement | null;
                    if (image) tweenTo(image, { scale: 1 }, 0.25);
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
  );
}

function CompanyLogoSection({
  networks,
  productionCompanies,
}: {
  networks?: MetaCompany[];
  productionCompanies?: MetaCompany[];
}) {
  const hasNetworks = Boolean(networks?.length);
  const hasProduction = Boolean(productionCompanies?.length);
  if (!hasNetworks && !hasProduction) return null;

  return (
    <section style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(340px, 1fr))",gap:18 }}>
      {hasNetworks ? (
        <CompanyGroup title="Cadena" kind="network" items={networks!} />
      ) : null}
      {hasProduction ? (
        <CompanyGroup title="Producción" kind="company" items={productionCompanies!} />
      ) : null}
    </section>
  );
}

function CompanyGroup({ title, kind, items }: { title: string; kind: "network" | "company"; items: MetaCompany[] }) {
  const navigate = useNavigate();

  return (
    <div className="liquid-glass-dark" style={{ borderRadius:18,padding:"22px 24px",minHeight:138 }}>
      <h2 style={{ fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.62)",marginBottom:18,letterSpacing:0 }}>{title}</h2>
      <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
        {items.slice(0, 8).map(item => (
          <button
            key={`${title}-${item.id}`}
            type="button"
            title={item.name}
            onClick={() => navigate(`/entity/${kind}/${encodeURIComponent(String(item.id))}`)}
            style={{ height:60,minWidth:116,maxWidth:188,borderRadius:14,border:"1px solid rgba(255,255,255,0.82)",background:"linear-gradient(180deg, rgba(255,255,255,0.97), rgba(240,242,246,0.9))",display:"flex",alignItems:"center",justifyContent:"center",padding:"10px 15px",overflow:"hidden",cursor:"pointer",boxShadow:"0 10px 24px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.92)" }}
            onMouseEnter={event => {
              tweenTo(event.currentTarget, { y: -2, background: "linear-gradient(180deg, rgba(255,255,255,1), rgba(244,246,250,0.94))" });
            }}
            onMouseLeave={event => {
              tweenTo(event.currentTarget, { y: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(240,242,246,0.9))" });
            }}
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

function SectionH({ title, onClick }:{title:string;onClick?:()=>void}) {
  const navigate = useNavigate();
  const { type, id } = useParams<{type:string;id:string}>();
  const fallbackClick = () => {
    if (!type || !id) return;
    const lowerTitle = title.toLowerCase();
    const section = lowerTitle.startsWith("tr")
      ? "trailers"
      : lowerTitle.includes("reparto")
        ? "cast"
        : lowerTitle.includes("relacion")
          ? "related"
          : "";
    if (!section) return;
    navigate(`/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${section}`);
  };
  const handleClick = onClick ?? fallbackClick;
  return (
    <button type="button" onClick={handleClick} style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16,background:"none",border:"none",padding:0,cursor:"pointer" }}>
      <h2 style={{ fontSize:19,fontWeight:750,color:"#fff",lineHeight:1.1 }}>{title}</h2>
      <ChevronRight size={16} style={{ color:"rgba(255,255,255,0.35)",marginTop:1 }} />
    </button>
  );
}

function TraktCommentsSection({
  comments,
  loading,
  error,
  mode,
  episodeLabel,
  canSwitchMode,
  onModeChange,
}: {
  comments: TraktCommentReview[];
  loading: boolean;
  error: string;
  mode: TraktCommentsMode;
  episodeLabel: string;
  canSwitchMode: boolean;
  onModeChange: (mode: TraktCommentsMode) => void;
}) {
  if (!loading && !error && !comments.length) return null;

  return (
    <section>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:19,fontWeight:750,color:"#fff",lineHeight:1.1 }}>Comentarios de Trakt</h2>
          <p style={{ marginTop:6,fontSize:12,color:"rgba(255,255,255,0.42)" }}>
            {mode === "episode" && episodeLabel ? `Comentarios del episodio ${episodeLabel}` : "Comentarios del título"}
          </p>
        </div>
        {canSwitchMode ? (
          <div className="liquid-glass-pill" style={{ display:"flex",alignItems:"center",gap:4,padding:4 }}>
            <CommentModeButton active={mode === "title"} onClick={() => onModeChange("title")}>Título</CommentModeButton>
            <CommentModeButton active={mode === "episode"} onClick={() => onModeChange("episode")}>{episodeLabel || "Episodio"}</CommentModeButton>
          </div>
        ) : null}
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
        <ScrollRow gap={10}>
          {comments.slice(0, 18).map(comment => <TraktCommentCard key={comment.id} comment={comment} />)}
        </ScrollRow>
      )}
    </section>
  );
}

function CommentModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth:80,
        border:"none",
        borderRadius:999,
        padding:"7px 12px",
        background:active ? "rgba(255,255,255,0.92)" : "transparent",
        color:active ? "#111" : "rgba(255,255,255,0.62)",
        fontSize:12,
        fontWeight:600,
        cursor:"pointer",
      }}
    >
      {children}
    </button>
  );
}

function TraktCommentCard({ comment }: { comment: TraktCommentReview }) {
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const spoilerHidden = comment.hasSpoilerContent && !spoilerRevealed;
  const commentText = spoilerHidden
    ? "Comentario con spoiler oculto."
    : comment.comment;
  return (
    <article
      className="liquid-glass-dark"
      role={comment.hasSpoilerContent ? "button" : undefined}
      tabIndex={comment.hasSpoilerContent ? 0 : undefined}
      onClick={() => {
        if (comment.hasSpoilerContent) setSpoilerRevealed(true);
      }}
      onKeyDown={event => {
        if (!comment.hasSpoilerContent) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSpoilerRevealed(true);
        }
      }}
      style={{ width:320,minHeight:144,flexShrink:0,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:10,cursor:comment.hasSpoilerContent ? "pointer" : "default" }}
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
      <p style={{ fontSize:13,lineHeight:1.5,fontWeight:400,color:spoilerHidden ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.66)",display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical",overflow:"hidden" }}>
        {commentText}
      </p>
      <div style={{ marginTop:"auto",display:"flex",alignItems:"center",gap:8,fontSize:11,fontWeight:500,color:"rgba(255,255,255,0.38)" }}>
        {comment.review ? <span>Review</span> : null}
        {comment.likes > 0 ? <span>{comment.likes} likes</span> : null}
      </div>
    </article>
  );
}

function SeasonMenu({
  seasons,
  value,
  onChange,
}: {
  seasons: NonNullable<DetailData["seasons"]>;
  value: number;
  onChange: (season: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(current => !current)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: 0,
          border: "none",
          background: "transparent",
          color: "#fff",
          borderRadius: 0,
          padding: 0,
          fontSize: 19,
          fontWeight: 800,
          lineHeight: 1,
          cursor: "pointer",
          fontFamily: "Inter, system-ui, sans-serif",
          boxShadow: "none",
          outline: "none",
        }}
      >
        Temporada {value}
        <ChevronDown size={16} style={{ color: "rgba(80,150,255,0.95)", flexShrink: 0 }} />
      </button>
      <ContextMenu
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
        placement="below-start"
        width={154}
        items={seasons.map(season => ({
          label: `Temporada ${season.number}`,
          icon: season.number === value ? <Check size={14} /> : undefined,
          onSelect: () => onChange(season.number),
        }))}
      />
    </>
  );
}

function CollectionCard({ item, onPress }:{item:DetailCollectionItem;onPress:()=>void}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const image = item.backdrop || item.poster;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={item.title}
      onMouseEnter={event=>tweenTo(event.currentTarget,{scale:1.06},0.24)}
      onMouseLeave={event=>tweenTo(event.currentTarget,{scale:1},0.24)}
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
function ScrollRow({ children, gap = 10, initialScrollKey }:{children:ReactNode;gap?:number;initialScrollKey?:string}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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

  return (
    <div style={{ position:"relative" }}>
      {canScrollLeft ? (
        <button
          onClick={()=>move("left")}
          title="Anterior"
          aria-label="Anterior"
          style={{ position:"absolute",left:0,top:"50%",zIndex:3,width:38,height:38,transform:"translate(-30%,-50%)",borderRadius:"50%",border:"1px solid rgba(255,255,255,0.18)",background:"rgba(18,18,18,0.72)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}
        >
          <ChevronLeft size={18} />
        </button>
      ) : null}
      <div
        ref={rowRef}
        style={{
          display: "flex",
          gap,
          overflowX: "auto",
          overflowY: "visible",
          margin: "0 calc(-1 * var(--app-safe-x))",
          paddingTop: 20,
          paddingBottom: 20,
          paddingLeft: "var(--app-safe-x)",
          paddingRight: 0,
          scrollPaddingInline: 0,
          scrollbarWidth: "none",
        }}
      >
        {children}
        <div aria-hidden="true" style={{ flex: `0 0 var(--app-safe-x)`, width: "var(--app-safe-x)", height: 1 }} />
      </div>
      {canScrollRight ? (
        <button
          onClick={()=>move("right")}
          title="Siguiente"
          aria-label="Siguiente"
          style={{ position:"absolute",right:0,top:"50%",zIndex:3,width:38,height:38,transform:"translate(30%,-50%)",borderRadius:"50%",border:"1px solid rgba(255,255,255,0.18)",background:"rgba(18,18,18,0.72)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}
        >
          <ChevronRight size={18} />
        </button>
      ) : null}
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
  onShowTraktComments,
  onMarkUnwatched,
}:{ep:Episode; scrollKey:string; locked?:boolean; progressEntry?: ContinueWatchingEntry; fallbackImage?:string; onPlay:()=>void; onMarkWatched:()=>void; seasonMarked:boolean; previousMarked:boolean; onMarkSeasonWatched:()=>void; onMarkSeasonUnwatched:()=>void; onMarkPreviousSeasonWatched:()=>void; onMarkPreviousSeasonUnwatched:()=>void; onShowTraktComments:()=>void; onMarkUnwatched:(entry: ContinueWatchingEntry)=>void}) {
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
  const cardRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={cardRef}
      className="detail-episode-card"
      data-scroll-key={scrollKey}
      aria-disabled={locked}
      role="button"
      tabIndex={locked ? -1 : 0}
      onClick={() => {
        if (!locked) onPlay();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || locked) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      style={{ opacity:locked ? 0.58 : 1, cursor:locked ? "not-allowed" : "pointer" }}
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
        {!locked&&<button
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
          <p className="detail-episode-card__overview">{ep.overview}</p>
        ) : ep.airDate ? (
          <p className="detail-episode-card__overview">{formatDateLabel(ep.airDate)}</p>
        ) : null}
      </div>
      {!locked&&<ContextMenu
        open={menuOpen}
        anchorRef={menuButtonRef}
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
          { label: "Mostrar comentarios de Trakt", icon: <UsersRound size={15} />, onSelect: onShowTraktComments },
        ]}
      />}
    </div>
  );
}

function TrailerCard({ trailer, media }:{trailer:Trailer;media:DetailData}) {
  const navigate = useNavigate();
  const fallbackThumb = media.backdrop ?? media.poster ?? "";
  const [thumbSrc, setThumbSrc] = useState(
    trailer.thumbnail ?? (trailer.key ? `https://img.youtube.com/vi/${trailer.key}/maxresdefault.jpg` : fallbackThumb)
  );

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
    navigate(`/player?${q.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={playTrailer}
      style={{ flexShrink:0,width:302,height:196,borderRadius:14,overflow:"hidden",display:"block",position:"relative",cursor:"pointer",background:"#1c1c1e",textDecoration:"none",border:"1px solid rgba(225,230,238,0.1)",padding:0,textAlign:"left" }}
      onMouseEnter={e=>{
        tweenTo(e.currentTarget, { boxShadow:"0 5px 18px rgba(0,0,0,0.5)", borderColor:"rgba(225,230,238,0.16)" }, 0.25);
        const img=(e.currentTarget as HTMLButtonElement).querySelector("img");
        if(img) tweenTo(img, { scale:1.03 }, 0.25);
      }}
      onMouseLeave={e=>{
        tweenTo(e.currentTarget, { boxShadow:"0 0 0 rgba(0,0,0,0)", borderColor:"rgba(225,230,238,0.1)" }, 0.25);
        const img=(e.currentTarget as HTMLButtonElement).querySelector("img");
        if(img) tweenTo(img, { scale:1 }, 0.25);
      }}
    >
      {thumbSrc ? (
        <img src={thumbSrc} alt={trailer.name}
          onError={() => setThumbSrc(trailer.key ? `https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg` : fallbackThumb)}
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
  const portraitAvailable = Boolean(member.profile_path) && !imageFailed;
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0,2)
    .map(part=>part.charAt(0).toUpperCase())
    .join("");
  const character = member.character?.split("(")[0]?.trim();
  const setFocusedScale = (element:HTMLButtonElement,focused:boolean) => {
    tweenTo(element,{scale:focused?1.04:1},0.18);
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
        width:188,
        border:0,
        borderRadius:14,
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
          src={member.profile_path}
          alt={member.name}
          loading="lazy"
          decoding="async"
          onError={()=>setImageFailed(true)}
          style={{ width:154,height:154,borderRadius:"50%",objectFit:"cover",flexShrink:0,background:"#2c2c2e" }}
        />
      ):(
        <div style={{ width:154,height:154,borderRadius:"50%",background:"linear-gradient(180deg, rgba(154,154,154,0.96), rgba(112,112,112,0.96))",boxShadow:"0 10px 22px rgba(0,0,0,0.28)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,color:"rgba(255,255,255,0.94)",fontWeight:800,flexShrink:0 }}>
          {initials}
        </div>
      )}
      <span style={{ width:"100%",fontSize:14,fontWeight:600,color:"#fff",textAlign:"center",lineHeight:"18px",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden" }}>{member.name}</span>
      {character&&<span style={{ width:"100%",fontSize:12,fontWeight:500,color:"rgba(255,255,255,0.56)",textAlign:"center",lineHeight:"16px",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden" }}>{character}</span>}
    </button>
  );
}
