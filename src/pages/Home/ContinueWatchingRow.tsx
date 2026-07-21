import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, Info, MinusCircle, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { tmdbFetch } from "../../config/apiKeys";
import ContextMenu from "../../components/ui/ContextMenu";
import { useHorizontalVirtualWindow } from "../../hooks/useHorizontalVirtualWindow";
import {
  CONTINUE_WATCHING_EVENT,
  formatResumeTime,
  getContinueWatchingRows,
  markContinueWatchingEntryAsWatched,
  progressPercent,
  removeContinueWatchingEntry,
  saveNextEpisodePrompt,
  updateContinueWatchingEntryArtwork,
  type ContinueWatchingEntry,
} from "../../utils/continueWatching";
import { sanitizeLogoUrl } from "../../utils/artwork";
import {
  HOME_CARD_ARTWORK_CHANGED_EVENT,
  readHomeCardArtwork,
  writeHomeCardArtwork,
} from "../../utils/homeCardArtwork";
import { readDetailMediaMeta, writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { scrollByGsap, tweenTo, useGsapState } from "../../utils/motion";
import { syncTraktMarkedWatched, syncTraktRemovePlayback } from "../../trakt";
import type { MediaItem } from "../../types/ui";
import CardArtworkPicker from "./CardArtworkPicker";

const IMG = "https://image.tmdb.org/t/p";
const CARD_W = 302;
const CARD_H = 196;
const GAP = 10;
const ROW_SHADOW_GUTTER = 32;

export default function ContinueWatchingRow() {
  const navigate = useNavigate();
  const artworkRequestsRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const measureTimerRef = useRef<number | null>(null);
  const showLeftRef = useRef(false);
  const showRightRef = useRef(false);
  const [items, setItems] = useState<ContinueWatchingEntry[]>(() => getContinueWatchingRows());
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const virtualWindow = useHorizontalVirtualWindow({
    itemCount: items.length,
    itemWidth: CARD_W,
    gap: GAP,
    overscan: 4,
  });
  const visibleItems = useMemo(
    () => items.slice(virtualWindow.start, virtualWindow.end),
    [items, virtualWindow.end, virtualWindow.start],
  );
  const { scrollRef } = virtualWindow;

  useEffect(() => {
    const refresh = () => setItems(getContinueWatchingRows());
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const missingArtwork = items.filter(needsArtworkEnrichment);
    if (!missingArtwork.length) return;
    let cancelled = false;

    async function enrichMissingArtwork() {
      for (const entry of missingArtwork.slice(0, 8)) {
        if (cancelled) return;
        if (artworkRequestsRef.current.has(entry.key)) continue;
        artworkRequestsRef.current.add(entry.key);
        const shouldFetchEpisodeStill = entry.type !== "movie" && Boolean(entry.season && entry.episode);
        const cached = readDetailMediaMeta(entry.type, entry.id);
        if (cached?.background || cached?.poster || cached?.logo) {
          updateContinueWatchingEntryArtwork(entry.key, {
            name: cached.name,
            logo: entry.logo ?? cached.logo,
            background: shouldFetchEpisodeStill ? undefined : cached.background,
            poster: cached.poster,
          });
          if (!shouldFetchEpisodeStill) {
            artworkRequestsRef.current.delete(entry.key);
            continue;
          }
        }

        try {
          const artwork = await fetchContinueWatchingArtwork(entry);
          if (!cancelled && artwork) updateContinueWatchingEntryArtwork(entry.key, artwork);
        } catch (error) {
          console.warn("[AETHERIO:CONTINUE:ARTWORK] enrichment failed", {
            key: entry.key,
            error: String(error),
          });
        } finally {
          artworkRequestsRef.current.delete(entry.key);
        }
      }
    }

    void enrichMissingArtwork();
    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    const pending = items.filter(entry => entry.type !== "movie" && (entry.entryKind === "next" || entry.entryKind === "new"));
    if (!pending.length) return;
    let cancelled = false;

    async function sanitizeUpcomingEntries() {
      for (const entry of pending.slice(0, 12)) {
        if (cancelled) return;
        const available = await isPromptEpisodeAvailable(entry).catch(() => false);
        if (cancelled || available) continue;
        removeContinueWatchingEntry(entry.key);
      }
    }

    void sanitizeUpcomingEntries();
    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    measureTimerRef.current = window.setTimeout(updateArrows, 100);
    return () => {
      if (measureTimerRef.current !== null) {
        window.clearTimeout(measureTimerRef.current);
        measureTimerRef.current = null;
      }
    };
  }, [items.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", scheduleArrowUpdate, { passive: true });
    return () => {
      el.removeEventListener("scroll", scheduleArrowUpdate);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  if (!items.length) return null;

  function applyArrowState(nextLeft: boolean, nextRight: boolean) {
    if (showLeftRef.current !== nextLeft) {
      showLeftRef.current = nextLeft;
      setShowLeft(nextLeft);
    }
    if (showRightRef.current !== nextRight) {
      showRightRef.current = nextRight;
      setShowRight(nextRight);
    }
  }

  function updateArrows() {
    const el = scrollRef.current;
    if (!el) return;
    applyArrowState(
      el.scrollLeft > 10,
      el.scrollLeft < el.scrollWidth - el.clientWidth - 10,
    );
  }

  function scheduleArrowUpdate() {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateArrows();
    });
  }

  function scroll(dir: "left" | "right") {
    scrollByGsap(scrollRef.current, dir === "right" ? (CARD_W + GAP) * 3 : -(CARD_W + GAP) * 3);
  }

  async function resume(entry: ContinueWatchingEntry) {
    const cached = readDetailMediaMeta(entry.type, entry.id);
    writeDetailMediaMeta({
      id: entry.id,
      type: entry.type,
      name: entry.name || cached?.name || entry.id,
      logo: sanitizeLogoUrl(entry.logo) ?? cached?.logo,
      background: entry.background ?? cached?.background,
      poster: entry.poster ?? cached?.poster,
      description: cached?.description,
      year: cached?.year,
    });

    if (entry.type !== "movie" && entry.completed && typeof entry.season === "number" && entry.episode) {
      const next = await createNextEpisodePromptFromEntry(entry);
      if (next) {
        const q = new URLSearchParams({ type: entry.type, id: entry.id });
        q.set("season", String(next.query.season));
        q.set("ep", String(next.query.episode));
        if (next.episodeName) q.set("epTitle", next.episodeName);
        navigate(`/episode?${q.toString()}`);
        return;
      }
    }

    const q = new URLSearchParams({ type: entry.type, id: entry.id, continue: "1" });
    if (typeof entry.season === "number") q.set("season", String(entry.season));
    if (entry.episode) q.set("ep", String(entry.episode));
    if (entry.episodeName) q.set("epTitle", entry.episodeName);
    navigate(`/episode?${q.toString()}`);
  }

  function removeWithAnimation(entry: ContinueWatchingEntry) {
    setRemovingKeys(keys => new Set(keys).add(entry.key));
    window.setTimeout(() => {
      const removed = removeContinueWatchingEntry(entry.key);
      void syncTraktRemovePlayback(removed);
      setRemovingKeys(keys => {
        const next = new Set(keys);
        next.delete(entry.key);
        return next;
      });
    }, 220);
  }

  return (
    <section style={{ paddingLeft: 48, paddingRight: 48, paddingTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Continuar viendo</span>
      </div>
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <ScrollArrow visible={hovered && showLeft} side="left" onClick={() => scroll("left")} />

        <div
          ref={scrollRef}
          className="scroll-row"
          style={{
            display: "flex",
            gap: 0,
            overflowX: "auto",
            overflowY: "hidden",
            marginTop: -18,
            marginLeft: -ROW_SHADOW_GUTTER,
            marginRight: -ROW_SHADOW_GUTTER,
            paddingLeft: ROW_SHADOW_GUTTER,
            paddingRight: ROW_SHADOW_GUTTER,
            paddingTop: ROW_SHADOW_GUTTER - 8,
            paddingBottom: ROW_SHADOW_GUTTER - 4,
            scrollbarWidth: "none",
          }}
        >
          {virtualWindow.beforeWidth > 0 ? <div aria-hidden="true" style={{ flex: `0 0 ${virtualWindow.beforeWidth}px` }} /> : null}
          {visibleItems.map((entry, offset) => {
            const index = virtualWindow.start + offset;
            return (
              <div key={entry.key} style={{ flex: "0 0 auto", marginRight: index === items.length - 1 ? 0 : GAP }}>
                <ContinueCard
                  entry={entry}
                  removing={removingKeys.has(entry.key)}
                  onClick={() => { void resume(entry); }}
                  onRemove={() => removeWithAnimation(entry)}
                />
              </div>
            );
          })}
          {virtualWindow.afterWidth > 0 ? <div aria-hidden="true" style={{ flex: `0 0 ${virtualWindow.afterWidth}px` }} /> : null}
        </div>

        <ScrollArrow visible={hovered && showRight} side="right" onClick={() => scroll("right")} />
      </div>
    </section>
  );
}

function ScrollArrow({ visible, side, onClick }: { visible: boolean; side: "left" | "right"; onClick: () => void }) {
  const motionRef = useGsapState<HTMLDivElement>({ opacity: visible ? 1 : 0 }, [visible]);
  return (
    <div
      ref={motionRef}
      style={{
        position: "absolute",
        [side]: 0,
        top: "50%",
        zIndex: 10,
        transform: `translate(${side === "left" ? "-30%" : "30%"},-50%)`,
        opacity: 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <button
        onClick={onClick}
        title={side === "left" ? "Anterior" : "Siguiente"}
        aria-label={side === "left" ? "Anterior" : "Siguiente"}
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: "1px solid rgba(225,230,238,0.09)",
          background: "rgba(18,18,18,0.72)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {side === "left" ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </div>
  );
}

async function fetchContinueWatchingArtwork(entry: ContinueWatchingEntry) {
  const tmdbType = entry.type === "movie" ? "movie" : "tv";
  const tmdbId = await resolveTmdbId(entry, tmdbType);
  if (!tmdbId) {
    console.info("[AETHERIO:CONTINUE:ARTWORK] no TMDB match", {
      key: entry.key,
      type: entry.type,
      id: entry.id,
      name: entry.name,
      tried: titleSearchVariants(entry.name),
    });
    return null;
  }

  const [details, images] = await Promise.all([
    tmdbFetch<{ title?: string; name?: string; backdrop_path?: string; poster_path?: string }>(`/${tmdbType}/${tmdbId}`, { params: { language: "es-ES" } }),
    entry.logo ? Promise.resolve(null) : tmdbFetch<{ logos?: unknown }>(`/${tmdbType}/${tmdbId}/images`, { params: { include_image_language: "es,en,null" } }),
  ]);
  const logoPath = entry.logo ? undefined : pickTmdbLogoPath(images?.logos);
  const episodeDetails = entry.type !== "movie" && entry.season && entry.episode
    ? await fetchTmdbEpisodeDetails(tmdbId, entry.season, entry.episode)
    : null;

  return {
    name: details?.title ?? details?.name ?? entry.name,
    background: entry.type === "movie"
      ? tmdbImage(details?.backdrop_path, "original")
      : tmdbImage(episodeDetails?.still_path, "original"),
    episodeStill: entry.type !== "movie" ? tmdbImage(episodeDetails?.still_path, "original") : undefined,
    poster: tmdbImage(details?.poster_path, "w780"),
    logo: entry.logo ?? sanitizeLogoUrl(tmdbImage(logoPath, "w500")),
    episodeName: episodeDetails?.name ?? entry.episodeName,
  };
}

function needsArtworkEnrichment(entry: ContinueWatchingEntry) {
  if (entry.type !== "movie" && entry.season && entry.episode) {
    return !entry.episodeStill || !entry.logo || !entry.episodeName || entry.source === "trakt";
  }
  return !entry.background || !entry.poster || !entry.logo;
}

async function fetchTmdbEpisodeDetails(tmdbId: number, season: number, episode: number) {
  return tmdbFetch(`/tv/${tmdbId}/season/${season}/episode/${episode}`, { params: { language: "es-ES" } });
}

async function resolveTmdbId(entry: ContinueWatchingEntry, tmdbType: "movie" | "tv") {
  if (entry.id.startsWith("tmdb:")) {
    const id = Number(entry.id.slice(5).split(":")[0]);
    return Number.isFinite(id) && id > 0 ? id : undefined;
  }

  if (entry.id.startsWith("tt")) {
    const data = await tmdbFetch<{ movie_results?: Array<{ id?: number }>; tv_results?: Array<{ id?: number }> }>(
      `/find/${encodeURIComponent(entry.id.split(":")[0])}`,
      { params: { external_source: "imdb_id", language: "es-ES" } },
    );
    if (data) {
      const results = tmdbType === "movie" ? data.movie_results : data.tv_results;
      const id = Number(results?.[0]?.id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }

  const foundByName = await searchTmdbIdByTitle(entry.name, tmdbType);
  if (foundByName) return foundByName;

  if (tmdbType === "movie") {
    const tvFallback = await searchTmdbIdByTitle(entry.name, "tv");
    if (tvFallback) return tvFallback;
  }

  return undefined;
}

async function createNextEpisodePromptFromEntry(entry: ContinueWatchingEntry | null | undefined) {
  if (!entry || entry.type === "movie" || !entry.season || !entry.episode) return null;
  const tmdbId = await resolveTmdbId(entry, "tv");
  if (!tmdbId) return null;

  const details = await tmdbFetch<{ seasons?: Array<{ season_number?: number }> }>(`/tv/${tmdbId}`, { params: { language: "es-ES" } });
  if (!details) return null;
  const seasonNumbers = (details?.seasons ?? [])
    .map((season: any) => Number(season?.season_number))
    .filter((season: number) => Number.isFinite(season) && season > 0 && season >= entry.season!)
    .sort((a: number, b: number) => a - b);

  const today = Date.now();
  for (const seasonNumber of seasonNumbers) {
    const season = await tmdbFetch<{ episodes?: Array<{ episode_number?: number; name?: string; still_path?: string; air_date?: string; runtime?: number }> }>(`/tv/${tmdbId}/season/${seasonNumber}`, { params: { language: "es-ES" } });
    if (!season) continue;
    const episodes = (season?.episodes ?? [])
      .map((episode: any) => ({
        number: Number(episode?.episode_number),
        name: typeof episode?.name === "string" ? episode.name : undefined,
        stillPath: typeof episode?.still_path === "string" ? episode.still_path : undefined,
        airDate: typeof episode?.air_date === "string" ? episode.air_date : undefined,
        runtime: Number(episode?.runtime),
      }))
      .filter((episode: { number: number }) => Number.isFinite(episode.number) && episode.number > 0)
      .sort((a: { number: number }, b: { number: number }) => a.number - b.number);

    for (const episode of episodes) {
      if (seasonNumber === entry.season && episode.number <= entry.episode) continue;
      if (!episode.airDate) continue;
      const airAt = parseTmdbAirDate(episode.airDate);
      if (!airAt) continue;
      if (airAt && airAt > today) continue;
      const nextQuery = {
        type: entry.type,
        id: entry.id,
        season: seasonNumber,
        episode: episode.number,
      } as const;
      saveNextEpisodePrompt({
        query: nextQuery,
        name: entry.name,
        logo: entry.logo,
        background: tmdbImage(episode.stillPath, "original"),
        episodeStill: tmdbImage(episode.stillPath, "original"),
        poster: entry.poster,
        episodeName: episode.name,
        runtimeSeconds: Number.isFinite(episode.runtime) && episode.runtime > 0 ? episode.runtime * 60 : undefined,
        entryKind: "next",
        source: "local",
      });
      return { query: nextQuery, episodeName: episode.name };
    }
  }
  return null;
}

async function isPromptEpisodeAvailable(entry: ContinueWatchingEntry) {
  if (entry.type === "movie" || typeof entry.season !== "number" || !entry.episode) return true;
  const promptEntry = entry.entryKind === "next" || entry.entryKind === "new";
  const tmdbId = await resolveTmdbId(entry, "tv");
  if (!tmdbId) return !promptEntry;
  const episode = await tmdbFetch<{ air_date?: string }>(`/tv/${tmdbId}/season/${entry.season}/episode/${entry.episode}`, { params: { language: "es-ES" } });
  if (!episode) return !promptEntry;
  const airDate = typeof episode?.air_date === "string" ? episode.air_date : "";
  const airAt = parseTmdbAirDate(airDate);
  if (!airDate || !airAt) return false;
  return airAt <= Date.now();
}

function parseTmdbAirDate(value: string | undefined) {
  if (!value) return 0;
  const local = Date.parse(`${value}T00:00:00`);
  if (Number.isFinite(local)) return local;
  const utc = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(utc) ? utc : 0;
}

async function searchTmdbIdByTitle(title: string, tmdbType: "movie" | "tv") {
  if (!title.trim()) return undefined;
  const searchPath = tmdbType === "movie" ? "search/movie" : "search/tv";
  const queries = titleSearchVariants(title);
  for (const query of queries) {
    for (const language of ["es-ES", "en-US"]) {
      const data = await tmdbFetch<{ results?: Array<{ id?: number }> }>(`/${searchPath}`, { params: { query, language, page: "1" } });
      if (!data) continue;
      const id = Number(data.results?.[0]?.id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  for (const query of queries) {
    for (const language of ["es-ES", "en-US"]) {
      const data = await tmdbFetch<{ results?: Array<{ id?: number; media_type?: string }> }>("/search/multi", { params: { query, language, page: "1" } });
      if (!data) continue;
      const match = (data.results ?? []).find((item: any) => item?.media_type === tmdbType)
        ?? (data.results ?? []).find((item: any) => item?.media_type === "movie" || item?.media_type === "tv");
      const id = Number(match?.id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  return undefined;
}

function titleSearchVariants(title: string) {
  const clean = title
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [
    clean,
    clean.replace(/\s*-\s*/g, " "),
    clean.replace(/:\s*/g, " "),
    clean.replace(/\s*-\s*The Movie\s*:\s*/i, ": "),
    clean.replace(/\s*-\s*The Movie\s*:\s*/i, " "),
    clean.replace(/\s*-\s*The Movie\b/i, ""),
    clean.replace(/\bThe Movie\s*:\s*/i, ""),
    clean.replace(/\bThe Movie\b/ig, ""),
    clean.split(":")[0]?.trim(),
  ];
  return Array.from(new Set(variants.filter(Boolean)));
}

function tmdbImage(path: string | undefined | null, size: "original" | "w780" | "w500") {
  return path ? `${IMG}/${size}${path}` : undefined;
}

function pickTmdbLogoPath(logos: unknown) {
  if (!Array.isArray(logos)) return undefined;
  const logo = logos.find((item: any) => item?.iso_639_1 === "es" && typeof item?.file_path === "string")
    ?? logos.find((item: any) => item?.iso_639_1 === "en" && typeof item?.file_path === "string")
    ?? logos.find((item: any) => item?.iso_639_1 === null && typeof item?.file_path === "string")
    ?? logos.find((item: any) => typeof item?.file_path === "string");
  return logo?.file_path;
}

const ContinueCard = memo(function ContinueCard({
  entry,
  removing,
  onClick,
  onRemove,
}: {
  entry: ContinueWatchingEntry;
  removing: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const baseArtwork = getContinueCardArtwork(entry);
  const [, setArtworkVersion] = useState(0);
  const artwork = {
    ...baseArtwork,
    image: readHomeCardArtwork("background", entry.type, entry.id, baseArtwork.image) ?? "",
  };
  const logo = artwork.showLogo ? sanitizeLogoUrl(entry.logo) : undefined;
  const badgeLabel = entry.entryKind === "new"
    ? "Nuevo episodio"
    : entry.entryKind === "next"
      ? "Siguiente episodio"
      : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const episodeLabel = entry.season && entry.episode
    ? `T${entry.season} E${entry.episode}${entry.episodeName ? ` - ${entry.episodeName}` : ""}`
    : "Película";

  useEffect(() => {
    tweenTo(cardRef.current, { opacity: removing ? 0 : 1, scale: removing ? 0.96 : 1 });
  }, [removing]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; id?: string }>).detail;
      if (detail?.type === entry.type && detail.id === entry.id) {
        setArtworkVersion(version => version + 1);
      }
    };
    window.addEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, refresh);
  }, [entry.id, entry.type]);

  const pickerItem = useMemo<MediaItem>(() => ({
    id: entry.id,
    type: entry.type,
    name: entry.name,
    poster: entry.poster,
    background: entry.background,
    logo: entry.logo,
  }), [entry.background, entry.id, entry.logo, entry.name, entry.poster, entry.type]);

  function applyCardBackground(url: string) {
    writeHomeCardArtwork("background", entry.type, entry.id, url);
    writeDetailMediaMeta({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      poster: entry.poster,
      background: url,
      logo: entry.logo,
    });
    setArtworkPickerOpen(false);
  }

  function openEntry() {
    onClick();
  }

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(true);
      }}
      style={{
        position: "relative",
        zIndex: 1,
        flexShrink: 0,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        opacity: 1,
        transform: "scale(1)",
        marginRight: removing ? -CARD_W - GAP : 0,
        background: "#1c1c1e",
        border: "1px solid rgba(225,230,238,0.10)",
        boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
        padding: 0,
        textAlign: "left",
      }}
      onMouseEnter={event => {
        tweenTo(event.currentTarget, removing ? { scale: 0.96 } : { y: -3, zIndex: 5, boxShadow: "0 20px 42px rgba(0,0,0,0.48)" });
        const img = event.currentTarget.querySelector("img");
        if (img) tweenTo(img, { scale: 1.04 });
      }}
      onMouseLeave={event => {
        tweenTo(event.currentTarget, removing ? { scale: 0.96, y: 0 } : { scale: 1, y: 0, zIndex: 1, boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
        const img = event.currentTarget.querySelector("img");
        if (img) tweenTo(img, { scale: 1 });
      }}
    >
      {artwork.image && <img src={artwork.image} alt={entry.name} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1)" }} />}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.52) 24%, rgba(0,0,0,0.08) 68%, transparent 100%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.08) 46%, rgba(0,0,0,0.18) 100%)" }} />
      {badgeLabel && (
        <div
          style={{
            position: "absolute",
            top: 11,
            left: 14,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 125,
            height: 29,
            boxSizing: "border-box",
            padding: "0 10px",
            borderRadius: 8,
            background: entry.entryKind === "new"
              ? "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(236,239,244,0.76))"
              : "rgba(35,35,37,0.72)",
            border: entry.entryKind === "new"
              ? "1px solid rgba(255,255,255,0.82)"
              : "1px solid rgba(255,255,255,0.23)",
            backdropFilter: "blur(5px) saturate(150%)",
            WebkitBackdropFilter: "blur(10px) saturate(150%)",
            boxShadow: entry.entryKind === "new"
              ? "0 10px 22px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.96)"
              : "0 5px 16px rgba(0,0,0,0.22)",
            color: entry.entryKind === "new" ? "rgba(18,18,18,0.96)" : "rgba(255,255,255,0.94)",
            fontSize: 12,
            fontWeight: 400,
            fontFamily: "Inter, system-ui, sans-serif",
            lineHeight: 1.1,
            letterSpacing: 0,
            whiteSpace: "nowrap",
            textTransform: "none",
          }}
        >
          {badgeLabel}
        </div>
      )}

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 12px 10px" }}>
        {logo ? (
          <img src={logo} alt={entry.name} loading="lazy" decoding="async" style={{ maxHeight: 40, maxWidth: 172, objectFit: "contain", filter: "drop-shadow(0 1px 8px rgba(0,0,0,0.95))", marginBottom: 17 }} />
        ) : (
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 20, fontWeight: 500, color: "#fff", textShadow: "0 1px 8px rgba(0,0,0,0.95)", marginBottom: 18 }}>
            {entry.name}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 7, paddingRight: 34 }}>
          <Play size={11} fill="rgba(255,255,255,0.9)" style={{ color: "rgba(255,255,255,0.9)", flexShrink: 0 }} />
          <div style={{ width: 24, height: 4, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,0.42)", flexShrink: 0 }}>
            <div style={{ width: `${progressPercent(entry)}%`, height: "100%", background: "#fff", borderRadius: 999 }} />
          </div>
          <div style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {episodeLabel.includes(" - ") ? episodeLabel.split(" - ")[0] : episodeLabel}{entry.entryKind === "next" || entry.entryKind === "new" ? "" : `, ${formatResumeTime(entry.currentTime)}`}
          </div>
        </div>
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        aria-label="Más opciones"
        onClick={event => {
          event.stopPropagation();
          setMenuOpen(value => !value);
        }}
        style={{ position: "absolute", right: 9, bottom: 7, zIndex: 3, width: 28, height: 24, border: "none", background: "transparent", color: "rgba(255,255,255,0.82)", fontSize: 20, fontWeight: 800, lineHeight: 1, letterSpacing: 1.2, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer" }}
      >
        ...
      </button>
      <ContextMenu
        open={menuOpen}
        anchorRef={menuButtonRef}
        avoidRef={cardRef}
        onClose={() => setMenuOpen(false)}
        width={204}
        items={[
          { label: "Elegir fondo de la card", icon: <ImageIcon size={15} />, onSelect: () => setArtworkPickerOpen(true) },
          { label: "Eliminar de la lista", icon: <MinusCircle size={15} />, onSelect: onRemove },
          { label: "Marcar como visto", icon: <Check size={15} />, onSelect: () => {
            const marked = markContinueWatchingEntryAsWatched(entry.key);
            void syncTraktMarkedWatched(marked);
            void createNextEpisodePromptFromEntry(marked ?? entry);
          } },
          { label: entry.type === "movie" ? "Ir a la pelicula" : "Ir al episodio", icon: <Info size={15} />, onSelect: openEntry },
        ]}
      />
      <CardArtworkPicker
        open={artworkPickerOpen}
        item={pickerItem}
        type={entry.type}
        mode="background"
        currentUrl={artwork.image}
        onSelect={applyCardBackground}
        onClose={() => setArtworkPickerOpen(false)}
      />
    </div>
  );
});

function getContinueCardArtwork(entry: ContinueWatchingEntry) {
  if (entry.type !== "movie") {
    return {
      image: entry.episodeStill ?? "",
      showLogo: Boolean(entry.episodeStill),
    };
  }
  if (entry.background) {
    return {
      image: entry.background,
      showLogo: true,
    };
  }
  return {
    image: entry.poster ?? "",
    showLogo: false,
  };
}
