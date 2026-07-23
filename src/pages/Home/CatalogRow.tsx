import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import ContextMenu from "../../components/ui/ContextMenu";
import type { HomePosterLayout } from "../../config/homePreferences";
import { supportsAiringSchedule, useAiringSchedule } from "../../hooks/useAiringSchedule";
import { useHorizontalVirtualWindow } from "../../hooks/useHorizontalVirtualWindow";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { buildMediaKey, CONTINUE_WATCHING_EVENT, readPlaybackStateEntries } from "../../utils/continueWatching";
import {
  HOME_CARD_ARTWORK_CHANGED_EVENT,
  readHomeCardArtwork,
  writeHomeCardArtwork,
  type HomeCardArtworkMode,
} from "../../utils/homeCardArtwork";
import { resolveDetailBackground, writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { scrollByGsap, tweenTo, useGsapState } from "../../utils/motion";
import CardArtworkPicker from "./CardArtworkPicker";

const HORIZONTAL_CARD = { width: 302, height: 196 };
const VERTICAL_CARD = { width: 180, height: 271 };
const RANKED_CARD = { width: 248, height: 252 };
const RANKED_DOUBLE_CARD = { width: 298, height: 252 };
const RANKED_POSTER = { width: 168, height: 252, singleLeft: 80, doubleLeft: 130 };
const HORIZONTAL_GAP = 22;
const RANKED_GAP = 10;
const ROW_SHADOW_GUTTER = 32;

const RANKED_CATALOG_IDS = new Set([
  "tmdb.trending_movie",
  "tmdb.trending_series",
  "mal.top_anime",
  "jikan.top_movies",
  "jikan.top_favorites",
  "jikan.most_popular",
  "mal.last_year_best",
]);

function isTrendingRow(row: Pick<CatalogRowData, "catalogId" | "name">) {
  if (RANKED_CATALOG_IDS.has(row.catalogId)) return true;
  const name = row.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return name.includes("trending") || name.includes("tendencia") || name.startsWith("top ");
}

function homeRailTitle(title: string, type: string) {
  const catalogTitle = title.trim() || "Catalogo";
  if (/\s-\s(Pel[ií]culas|Series|Anime)$/i.test(catalogTitle)) return catalogTitle;
  const typeLabel = (() => {
    switch (type.toLowerCase()) {
      case "movie":
        return "Películas";
      case "series":
      case "tv":
        return "Series";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  })();
  return `${catalogTitle} - ${typeLabel}`;
}

interface CatalogRowProps {
  row: CatalogRowData;
  posterLayout: HomePosterLayout;
  hideHeader?: boolean;
  embedded?: boolean;
  onScrollOriginChange?: (atOrigin: boolean) => void;
}

function CatalogRow({ row, posterLayout, hideHeader = false, embedded = false, onScrollOriginChange }: CatalogRowProps) {
  const navigate = useNavigate();
  const rafRef = useRef<number | null>(null);
  const measureTimerRef = useRef<number | null>(null);
  const showLeftRef = useRef(false);
  const showRightRef = useRef(false);
  const atScrollOriginRef = useRef(true);
  const [hovered, setHovered] = useState(false);
  const leftArrowRef = useRef<HTMLDivElement>(null);
  const rightArrowRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [watchedVersion, setWatchedVersion] = useState(0);
  const title = useMemo(() => homeRailTitle(row.name, row.type), [row.name, row.type]);
  const ranked = useMemo(() => isTrendingRow(row), [row]);
  const maxCards = ranked ? 10 : 7;
  const rowItems = useMemo(() => row.items.slice(0, maxCards), [row.items, maxCards]);
  const cardSize = ranked ? RANKED_CARD : posterLayout === "vertical" ? VERTICAL_CARD : HORIZONTAL_CARD;
  const virtualWindow = useHorizontalVirtualWindow({
    itemCount: rowItems.length,
    itemWidth: cardSize.width,
    gap: ranked ? RANKED_GAP : HORIZONTAL_GAP,
    overscan: 4,
  });
  const visibleStart = ranked ? 0 : virtualWindow.start;
  const visibleEnd = ranked ? rowItems.length : virtualWindow.end;
  const beforeWidth = ranked ? 0 : virtualWindow.beforeWidth;
  const afterWidth = ranked ? 0 : virtualWindow.afterWidth;
  const visibleItems = useMemo(
    () => rowItems.slice(visibleStart, visibleEnd),
    [rowItems, visibleEnd, visibleStart],
  );
  const watchedMediaKeys = useMemo(() => new Set(
    readPlaybackStateEntries()
      .filter(entry => entry.completed)
      .map(entry => entry.mediaKey),
  ), [watchedVersion]);
  const openCatalog = useCallback(() => {
    const params = new URLSearchParams({
      addon: row.addonId,
      type: row.type,
      catalog: row.catalogId,
      title,
    });
    if (row.extraParams && Object.keys(row.extraParams).length) {
      params.set("extras", JSON.stringify(row.extraParams));
    }
    navigate(`/catalog?${params.toString()}`);
  }, [navigate, row.addonId, row.catalogId, row.extraParams, row.type, title]);

  const applyArrowState = useCallback((nextLeft: boolean, nextRight: boolean) => {
    if (showLeftRef.current !== nextLeft) {
      showLeftRef.current = nextLeft;
      setShowLeft(nextLeft);
    }
    if (showRightRef.current !== nextRight) {
      showRightRef.current = nextRight;
      setShowRight(nextRight);
    }
  }, []);

  const applyScrollOriginState = useCallback((atOrigin: boolean) => {
    if (atScrollOriginRef.current === atOrigin) return;
    atScrollOriginRef.current = atOrigin;
    onScrollOriginChange?.(atOrigin);
  }, [onScrollOriginChange]);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    applyScrollOriginState(el.scrollLeft <= 2);
    applyArrowState(
      el.scrollLeft > 10,
      el.scrollLeft < el.scrollWidth - el.clientWidth - 10,
    );
  }, [applyArrowState, applyScrollOriginState]);

  const scheduleArrowUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateArrows();
    });
  }, [updateArrows]);

  useEffect(() => {
    measureTimerRef.current = window.setTimeout(updateArrows, 100);
    return () => {
      if (measureTimerRef.current !== null) {
        window.clearTimeout(measureTimerRef.current);
        measureTimerRef.current = null;
      }
    };
  }, [rowItems.length, updateArrows]);

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
  }, [scheduleArrowUpdate]);

  useEffect(() => {
    const refresh = () => setWatchedVersion(version => version + 1);
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const scroll = useCallback((dir: "left" | "right") => {
    scrollByGsap(scrollRef.current, dir === "right" ? (cardSize.width + (ranked ? RANKED_GAP : HORIZONTAL_GAP)) * 3 : -(cardSize.width + (ranked ? RANKED_GAP : HORIZONTAL_GAP)) * 3);
  }, [cardSize.width]);

  const { scrollRef } = virtualWindow;

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && showLeft ? 1 : 0 }, 0.2);
    tweenTo(rightArrowRef.current, { opacity: hovered && showRight ? 1 : 0 }, 0.2);
  }, [hovered, showLeft, showRight]);

  return (
    <section style={{ paddingLeft: 0, paddingRight: 0, contentVisibility: "auto" }}>
      {!hideHeader ? (
        <button
          onClick={openCatalog}
          style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 14, background: "none", border: "none", cursor: "pointer", paddingLeft: 48, paddingRight: 48 }}
        >
          <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>{title}</span>
          <ChevronRight size={15} style={{ color: "rgba(255,255,255,0.4)", marginTop: 1 }} />
        </button>
      ) : null}

      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={leftArrowRef}
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            zIndex: 10,
            transform: "translate(-30%,-50%)",
            opacity: 0,
            pointerEvents: hovered && showLeft ? "auto" : "none",
          }}
        >
          <button
            onClick={() => scroll("left")}
            title="Anterior"
            aria-label="Anterior"
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.18)",
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
            <ChevronLeft size={18} />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="scroll-row"
          style={{
            display: "flex",
            gap: 0,
            overflowX: "auto",
            overflowY: "hidden",
            marginTop: embedded ? -12 : -18,
            marginLeft: 0,
            marginRight: 0,
            paddingLeft: embedded ? 0 : 48,
            paddingRight: embedded ? 0 : 48,
            paddingTop: ROW_SHADOW_GUTTER + 8,
            paddingBottom: ROW_SHADOW_GUTTER + 8,
            scrollbarWidth: "none",
          }}
        >
          {beforeWidth > 0 ? <div aria-hidden="true" style={{ flex: `0 0 ${beforeWidth}px` }} /> : null}
          {visibleItems.map((item, offset) => {
            const idx = visibleStart + offset;
            return (
              <div
                key={`${item.id}-${row.catalogId}-${idx}`}
                style={{
                  flex: "0 0 auto",
                  paddingLeft: idx === 0 ? 10 : 0,
                  marginRight: idx === rowItems.length - 1 ? 0 : ranked ? RANKED_GAP : HORIZONTAL_GAP,
                }}
              >
                <CinematicCard
                  item={item}
                  type={row.type}
                  posterLayout={posterLayout}
                  watched={watchedMediaKeys.has(buildMediaKey(row.type, item.id))}
                  rank={ranked ? idx + 1 : undefined}
                />
              </div>
            );
          })}
          {afterWidth > 0 ? <div aria-hidden="true" style={{ flex: `0 0 ${afterWidth}px` }} /> : null}
        </div>

        <div
          ref={rightArrowRef}
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            zIndex: 10,
            transform: "translate(30%,-50%)",
            opacity: 0,
            pointerEvents: hovered && showRight ? "auto" : "none",
          }}
        >
          <button
            onClick={() => scroll("right")}
            title="Siguiente"
            aria-label="Siguiente"
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.18)",
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
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}

const CinematicCard = memo(function CinematicCard({ item, type, posterLayout, watched, rank }: { item: MediaItem; type: string; posterLayout: HomePosterLayout; watched: boolean; rank?: number }) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const scheduleEligible = supportsAiringSchedule(type, item.id);
  const [scheduleNearViewport, setScheduleNearViewport] = useState(false);
  const airingSchedule = useAiringSchedule(type, item.id, scheduleNearViewport);
  const [menuOpen, setMenuOpen] = useState(false);
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [, setArtworkVersion] = useState(0);
  const detailBackground = resolveDetailBackground(type, item.id, item.background);
  const ranked = typeof rank === "number";
  const effectivePosterLayout = ranked ? "vertical" : posterLayout;
  const artworkMode: HomeCardArtworkMode = effectivePosterLayout === "vertical" ? "poster" : "background";
  const cardBackground = readHomeCardArtwork("background", type, item.id, detailBackground);
  const cardPoster = readHomeCardArtwork("poster", type, item.id, item.poster);
  const image = effectivePosterLayout === "vertical"
    ? cardPoster ?? cardBackground ?? ""
    : cardBackground ?? cardPoster ?? "";
  const logo = readHomeCardArtwork("logo", type, item.id) || sanitizeLogoUrl(item.logo);
  const doubleDigitRank = ranked && rank >= 10;
  const rankedPosterLeft = doubleDigitRank ? RANKED_POSTER.doubleLeft : RANKED_POSTER.singleLeft;
  const cardSize = ranked
    ? doubleDigitRank ? RANKED_DOUBLE_CARD : RANKED_CARD
    : posterLayout === "vertical" ? VERTICAL_CARD : HORIZONTAL_CARD;
  const openDetail = useCallback(() => {
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster: item.poster,
      background: detailBackground,
      logo: item.logo,
      description: item.description,
      year: item.year,
    });
    navigate(`/detail/${encodeURIComponent(type)}/${encodeURIComponent(item.id)}`);
  }, [detailBackground, item.description, item.id, item.logo, item.name, item.poster, item.year, navigate, type]);

  useEffect(() => {
    if (!scheduleEligible || scheduleNearViewport) return;
    const card = cardRef.current;
    if (!card) return;
    if (typeof IntersectionObserver === "undefined") {
      setScheduleNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setScheduleNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "280px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, [scheduleEligible, scheduleNearViewport]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; id?: string }>).detail;
      if (detail?.type === type && detail.id === item.id) {
        setArtworkVersion(version => version + 1);
      }
    };
    window.addEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, refresh);
  }, [item.id, type]);

  const openArtworkMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(true);
  }, []);

  const applyCardArtwork = useCallback((url: string) => {
    writeHomeCardArtwork(artworkMode, type, item.id, url);
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster: artworkMode === "poster" ? url : item.poster,
      background: artworkMode === "background" ? url : detailBackground,
      logo: item.logo,
      description: item.description,
      year: item.year,
    });
    setArtworkPickerOpen(false);
  }, [artworkMode, detailBackground, item.description, item.id, item.logo, item.name, item.poster, item.year, type]);

  const applyCardLogo = useCallback((url: string) => {
    writeHomeCardArtwork("logo", type, item.id, url);
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster: item.poster,
      background: detailBackground,
      logo: url,
      description: item.description,
      year: item.year,
    });
    setLogoPickerOpen(false);
  }, [detailBackground, item.description, item.id, item.logo, item.name, item.poster, item.year, type]);

  const isHorizontal = effectivePosterLayout !== "vertical" && !ranked;

  const artworkControls = (
    <>
      <ContextMenu
        open={menuOpen}
        anchorRef={cardRef}
        onClose={() => setMenuOpen(false)}
        placement="below-start"
        width={238}
        items={[
          {
            label: artworkMode === "poster" ? "Elegir póster de la card" : "Elegir fondo de la card",
            icon: <ImageIcon size={15} />,
            onSelect: () => setArtworkPickerOpen(true),
          },
          ...(isHorizontal ? [{
            label: "Elegir logo de la card",
            icon: <ImageIcon size={15} />,
            onSelect: () => setLogoPickerOpen(true),
          }] : []),
        ]}
      />
      <CardArtworkPicker
        open={artworkPickerOpen}
        item={item}
        type={type}
        mode={artworkMode}
        currentUrl={image}
        onSelect={applyCardArtwork}
        onClose={() => setArtworkPickerOpen(false)}
      />
      {isHorizontal && (
        <CardArtworkPicker
          open={logoPickerOpen}
          item={item}
          type={type}
          mode="logo"
          currentUrl={logo}
          onSelect={applyCardLogo}
          onClose={() => setLogoPickerOpen(false)}
        />
      )}
    </>
  );

  if (ranked) {
    return (
      <div
        ref={cardRef}
        onClick={openDetail}
        onContextMenu={openArtworkMenu}
        aria-label={`${rank}. ${item.name}`}
        style={{ position: "relative", zIndex: 1, flexShrink: 0, width: cardSize.width, height: cardSize.height, cursor: "pointer" }}
        onMouseEnter={e => {
          tweenTo(e.currentTarget, { y: -4, zIndex: 5 });
          const poster = (e.currentTarget as HTMLDivElement).querySelector<HTMLElement>("[data-ranked-poster]");
          const artwork = (e.currentTarget as HTMLDivElement).querySelector<HTMLElement>("[data-card-artwork]");
          const number = (e.currentTarget as HTMLDivElement).querySelector<HTMLElement>("[data-rank-number]");
          tweenTo(poster, { boxShadow: "0 22px 46px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.17)" });
          tweenTo(artwork, { scale: 1.04 });
          tweenTo(number, { x: -3 });
        }}
        onMouseLeave={e => {
          tweenTo(e.currentTarget, { y: 0, zIndex: 1 });
          const poster = (e.currentTarget as HTMLDivElement).querySelector<HTMLElement>("[data-ranked-poster]");
          const artwork = (e.currentTarget as HTMLDivElement).querySelector<HTMLElement>("[data-card-artwork]");
          const number = (e.currentTarget as HTMLDivElement).querySelector<HTMLElement>("[data-rank-number]");
          tweenTo(poster, { boxShadow: "0 14px 34px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.10)" });
          tweenTo(artwork, { scale: 1 });
          tweenTo(number, { x: 0 });
        }}
      >
        <div
          data-rank-number
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: rankedPosterLeft,
            textAlign: "right",
            fontFamily: "'Inter', sans-serif",
            fontSize: 176,
            lineHeight: 0.86,
            fontWeight: 800,
            letterSpacing: -5,
            color: "rgba(10,12,16,0.92)",
            WebkitTextStroke: "2px rgba(255,255,255,0.30)",
            textShadow: "0 18px 36px rgba(0,0,0,0.72), 0 0 18px rgba(255,255,255,0.05)",
            userSelect: "none",
          }}
        >
          {rank}
        </div>

        <div
          data-ranked-poster
          style={{
            position: "absolute",
            left: rankedPosterLeft,
            top: 0,
            width: RANKED_POSTER.width,
            height: RANKED_POSTER.height,
            overflow: "hidden",
            borderRadius: 12,
            background: "rgba(28,28,30,0.94)",
            boxShadow: "0 14px 34px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.10)",
          }}
        >
          {watched ? (
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                zIndex: 2,
                width: 28,
                height: 28,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.72)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(242,244,247,0.88))",
                boxShadow: "0 10px 24px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.92)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
            >
              <Check size={15} style={{ color: "rgba(16,18,20,0.94)" }} />
            </div>
          ) : null}
          {airingSchedule ? <AiringScheduleBadge label={airingSchedule.label} watched={watched} compact /> : null}
          {image ? (
            <img
              data-card-artwork
              src={image}
              alt={item.name}
              decoding="async"
              loading="lazy"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1)" }}
            />
          ) : null}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 28%, rgba(0,0,0,0.16) 100%)",
            }}
          />
        </div>
        {artworkControls}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      onClick={openDetail}
      onContextMenu={openArtworkMenu}
      style={{ position: "relative", zIndex: 1, flexShrink: 0, width: cardSize.width, height: cardSize.height, borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "#1c1c1e", boxShadow: "0 12px 28px rgba(0,0,0,0.28)" }}
      onMouseEnter={e => {
        tweenTo(e.currentTarget, { scale: 1.05, zIndex: 5, boxShadow: "0 20px 42px rgba(0,0,0,0.48)" }, 0.32);
      }}
      onMouseLeave={e => {
        tweenTo(e.currentTarget, { scale: 1, zIndex: 1, boxShadow: "0 12px 28px rgba(0,0,0,0.28)" }, 0.32);
      }}
    >
      {watched ? (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 2,
            width: 28,
            height: 28,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.72)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(242,244,247,0.88))",
            boxShadow: "0 10px 24px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <Check size={15} style={{ color: "rgba(16,18,20,0.94)" }} />
        </div>
      ) : null}
      {airingSchedule ? <AiringScheduleBadge label={airingSchedule.label} watched={watched} compact={posterLayout === "vertical"} /> : null}
      {image && <img src={image} alt={item.name} decoding="async" loading="lazy"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1)" }} />}
      {posterLayout !== "vertical" ? <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "45%", background: "linear-gradient(to top,rgba(0,0,0,0.82) 0%,transparent 100%)", pointerEvents: "none" }} /> : null}
      {posterLayout !== "vertical" ? <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 10px 9px" }}>
        {logo ? (
          <img src={logo} alt={item.name}
            decoding="async"
            loading="lazy"
            style={{ maxHeight: 48, maxWidth: 206, objectFit: "contain", filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.95))", marginBottom: 3 }} />
        ) : (
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", textShadow: "0 1px 8px rgba(0,0,0,0.95)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {item.name}
          </span>
        )}
      </div> : null}
      {artworkControls}
    </div>
  );
});

function AiringScheduleBadge({ label, watched, compact }: { label: string; watched: boolean; compact: boolean }) {
  const badgeRef = useGsapState<HTMLDivElement>({ opacity: 1, y: 0 }, [label], 0.28);
  return (
    <div
      ref={badgeRef}
      data-airing-schedule
      title={label}
      style={{
        position: "absolute",
        top: watched ? 48 : 10,
        right: 10,
        zIndex: 4,
        minHeight: compact ? 24 : 26,
        maxWidth: "calc(100% - 20px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: compact ? "5px 7px" : "6px 9px",
        borderRadius: 10,
        border: "none",
        background: "#fff",
        color: "#111",
        textShadow: "none",
        boxShadow: "none",
        opacity: 0,
        fontSize: compact ? 10 : 11,
        lineHeight: 1.15,
        fontWeight: 700,
        letterSpacing: -0.1,
        pointerEvents: "none",
      }}
    >
      <span style={{ minWidth: 0 }}>{label}</span>
    </div>
  );
}

export default memo(CatalogRow);
