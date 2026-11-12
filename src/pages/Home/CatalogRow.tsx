import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookmarkMinus, Check, ChevronRight, Image as ImageIcon, Radio } from "lucide-react";
import ContextMenu from "../../components/ui/ContextMenu";
import LibraryIcon from "../../components/ui/LibraryIcon";
import type { HomePosterLayout } from "../../config/homePreferences";
import { useHorizontalVirtualWindow } from "../../hooks/useHorizontalVirtualWindow";
import { useNearViewport } from "../../hooks/useNearViewport";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { isTopFormatRow } from "../../utils/topRows";
import { buildMediaKey, CONTINUE_WATCHING_EVENT, markMediaAsWatched, readPlaybackStateEntries } from "../../utils/continueWatching";
import {
  HOME_CARD_ARTWORK_CHANGED_EVENT,
  readHomeCardArtwork,
  writeHomeCardArtwork,
  type HomeCardArtworkMode,
} from "../../utils/homeCardArtwork";
import { resolveDetailBackground, writeDetailMediaMeta } from "../../utils/mediaMetadata";
import SpatialPosterImage from "../../components/SpatialPosterImage";
import { isSpatialPosterUrl, shouldShowTopMetaFallback, TOP_SPATIAL_POSTER_OVERRIDES } from "../../config/spatialPosters";
import { useSpatialPoster } from "../../hooks/useSpatialPoster";
import { readHiddenMediaKeys } from "../../services/watchedVisibility";
import { scrollByGsap, tweenTo } from "../../utils/motion";
import { saveHomeScroll, rowKey as makeRowKey } from "../../store/homeScrollStore";
import { isInLibrary, LIBRARY_CHANGED_EVENT, toggleLibraryItem } from "../../utils/library";
import { useBigPictureActive } from "../../navigation/spatialNav.ts";
import { useLongPressAction } from "../../hooks/useLongPressAction.ts";
import { buildDetailPath, isBigPictureLocation } from "../../utils/bigPictureDetail.ts";
import { isShellPreviewOpen, preloadArtwork } from "../../utils/shellPreview";
import type { ShellPreviewRequest } from "../../utils/shellPreview";
import { getTmdbCardImageResponsiveProps } from "../../utils/tmdbCardImage";
import CardArtworkPicker from "./CardArtworkPicker";

const HORIZONTAL_CARD = { width: 425, height: 248 };
const VERTICAL_CARD = { width: 217, height: 326 };
// Formato top (ranking): la card es EXACTAMENTE igual a las demás del Home
// (mismo tamaño, frame, borde y animaciones); el numeral gris vive sobre su
// esquina superior izquierda, estilo Top 10.
const HORIZONTAL_GAP = 18;
const ROW_SHADOW_TOP_GUTTER = 17;
const ROW_SHADOW_BOTTOM_GUTTER = 42;

function homeRailTitle(title: string, type: string, includeType = true) {
  const catalogTitle = (title.trim() || "Catalogo").replace(/\s*-\s*(?:Pel[ií]culas|Series|Anime)$/i, "").trim() || "Catalogo";
  const normalizedType = type.toLowerCase();
  const typeLabel = (() => {
    switch (normalizedType) {
      case "movie":
        return "Películas";
      case "series":
      case "tv":
        return "Series";
      case "anime":
        return "Anime";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  })();
  const lower = catalogTitle.toLowerCase();
  const isMediaTop = normalizedType === "movie" || normalizedType === "series" || normalizedType === "tv";
  if (isMediaTop && (lower === "tendencias" || lower === "trending" || lower === "en tendencia" || lower.startsWith("top ") || /^(?:Pel[ií]culas|Series) en tendencia$/i.test(catalogTitle))) {
    return `Top ${typeLabel}`;
  }
  const naturalTypeTitle = /^(?:Pel[ií]culas nuevas|Series nuevas|Anime nuevo) de \d{4}$/i.test(catalogTitle)
    || /^(?:Pel[ií]culas|Series) popular(?:es)?$/i.test(catalogTitle)
    || /^Anime (?:en tendencia|en emisión|recomendado por la comunidad|más queridas del momento|que viene|popular)$/i.test(catalogTitle);
  if (naturalTypeTitle) return catalogTitle;

  const pluralSuffix = typeLabel === "Películas" || typeLabel === "Series" ? "es" : "";
  if (lower === "popular") return `${typeLabel} popular${pluralSuffix}`;
  if (/^(Netflix|Disney\+|HBO Max|Prime Video|Apple TV\+)$/i.test(catalogTitle)) return `${catalogTitle}: ${typeLabel}`;

  const newYear = catalogTitle.match(/^New\s*-\s*(\d{4})$/i);
  if (newYear) {
    const year = newYear[1];
    if (normalizedType === "movie") return `Películas nuevas de ${year}`;
    if (normalizedType === "series" || normalizedType === "tv") return `Series nuevas de ${year}`;
    if (normalizedType === "anime") return `Anime nuevo de ${year}`;
  }
  if (!includeType) {
    if (lower === "en emisión") return "Anime en emisión";
    if (lower === "la comunidad lo recomienda") return "Anime recomendado por la comunidad";
    if (lower === "las más queridas del momento" || lower === "anime más queridas del momento" || lower === "los animes más queridos del momento") return "Los animes más queridos del momento";
    if (lower === "lo que viene" || lower === "anime que viene" || lower === "próximos animes a estrenar") return "Próximos animes a estrenar";
    if (lower === "las que están arrasando") return "Anime en tendencia";
    if (lower === "fenómenos populares") return "Anime popular";
    return catalogTitle;
  }
  return `${catalogTitle} - ${typeLabel}`;
}

function withoutSpatialRankingBadge(url?: string) {
  if (!url || !isSpatialPosterUrl(url)) return url;
  try {
    const posterUrl = new URL(url);
    posterUrl.searchParams.set("ranking", "0");
    return posterUrl.toString();
  } catch {
    return url;
  }
}

interface CatalogRowProps {
  row: CatalogRowData;
  posterLayout: HomePosterLayout;
  hideHeader?: boolean;
  embedded?: boolean;
  onScrollOriginChange?: (atOrigin: boolean) => void;
  restoreScrollLeft?: number;
  disableHeaderNavigation?: boolean;
  titleOverride?: string;
  persistHomeScroll?: boolean;
  onOpenPreview?: (request: ShellPreviewRequest) => void;
  /** Alternate activation for live events, keeping Home's cards and navigation. */
  onOpenItem?: (item: MediaItem) => void;
  onFocusItem?: (item: MediaItem) => void;
  onChooseSources?: (item: MediaItem) => void;
  /** A specialized card can reuse this row's virtualization and spatial navigation. */
  renderCard?: (item: MediaItem) => ReactNode;
  showViewMore?: boolean;
  deferOffscreenRendering?: boolean;
  /** Space between cards; defaults to the Home rail spacing. */
  itemGap?: number;
  /** Override the ordinary catalog cap for specialized rows with a terminal action. */
  maxItems?: number;
}

function CatalogRow({ row, posterLayout, hideHeader = false, embedded = false, onScrollOriginChange, restoreScrollLeft, disableHeaderNavigation = false, titleOverride, persistHomeScroll = true, onOpenPreview, onOpenItem, onFocusItem, onChooseSources, renderCard, showViewMore: allowViewMore = true, deferOffscreenRendering = false, itemGap = HORIZONTAL_GAP, maxItems = 200 }: CatalogRowProps) {
  const navigate = useNavigate();
  const location = useLocation();
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
  const pendingWatchedFocusIndexRef = useRef<number | null>(null);
  const [viewMoreFocused, setViewMoreFocused] = useState(false);
  // En picture los heads no son seleccionables (como en el TV nativo).
  const bigPicture = useBigPictureActive();
  const nativeRow = row.addonId === "aetherio-starter" || row.addonId === "tmdb";
  const title = useMemo(() => titleOverride?.trim() || homeRailTitle(row.name, row.type, !nativeRow), [nativeRow, row.name, row.type, titleOverride]);
  const ranked = useMemo(() => isTopFormatRow(row), [row]);
  const sportsRow = row.type === "live" || row.type === "sports-replay";
  // Replays page within this virtualized row instead of the generic catalog.
  const maxCards = ranked ? 10 : row.type === "sports-replay" ? row.items.length : maxItems;
  // Vistos fuera: los completados sin episodios nuevos no ocupan las rows
  // (el filtro va ANTES del slice para que la row se rellene con el resto).
  const hiddenMediaKeys = useMemo(() => readHiddenMediaKeys(), [watchedVersion]);
  const rowItems = useMemo(
    () => row.items
      .filter(item => sportsRow || !hiddenMediaKeys.has(buildMediaKey(row.type, item.id)))
      .slice(0, maxCards),
    [row.items, maxCards, hiddenMediaKeys, sportsRow, row.type],
  );
  const showViewMore = allowViewMore && rowItems.length > 0;
  const rowKey = makeRowKey(row.addonId, row.catalogId, row.type);
  const cardSize = ranked ? VERTICAL_CARD : posterLayout === "vertical" ? VERTICAL_CARD : HORIZONTAL_CARD;
  // Match the existing header, hover-title and shadow gutters. Chromium then
  // remembers each row's measured size, keeping the scrollbar/restoration stable
  // while skipping layout and paint for rows outside its look-ahead region.
  const intrinsicHeight = cardSize.height
    + ROW_SHADOW_TOP_GUTTER + ROW_SHADOW_BOTTOM_GUTTER + 16
    + (hideHeader ? 0 : (bigPicture ? 22 : 30) + 14)
    - (embedded ? 12 : 18)
    + (posterLayout === "vertical" && !ranked ? 29.5 : 0);
  const viewMoreSize = Math.min(cardSize.width, cardSize.height, 160);
  const virtualWindow = useHorizontalVirtualWindow({
    itemCount: rowItems.length,
    itemWidth: cardSize.width,
    gap: itemGap,
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
  const rememberWatchedFocusPosition = useCallback((card: HTMLElement | null) => {
    if (!card) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".media-card-frame"));
    const index = cards.indexOf(card);
    if (index >= 0) pendingWatchedFocusIndexRef.current = index;
  }, []);

  useLayoutEffect(() => {
    const index = pendingWatchedFocusIndexRef.current;
    if (index === null) return;
    pendingWatchedFocusIndexRef.current = null;

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".media-card-frame"));
    const target = cards[Math.min(index, cards.length - 1)];
    target?.focus({ preventScroll: true });
  }, [rowItems]);

  const openCatalog = useCallback(() => {
    try {
      const params = new URLSearchParams({
        addon: String(row.addonId ?? ""),
        type: String(row.type ?? ""),
        catalog: String(row.catalogId ?? ""),
        title: String(title ?? ""),
      });
      if (row.extraParams && typeof row.extraParams === "object" && Object.keys(row.extraParams).length) {
        try {
          params.set("extras", JSON.stringify(row.extraParams));
        } catch {
          // extraParams no serializables: navegar igual sin ellos.
        }
      }
      const catalogPath = bigPicture ? "/big-picture/catalog" : "/catalog";
      const url = `${catalogPath}?${params.toString()}`;
      try {
        navigate(url);
      } catch {
        window.location.assign(url);
      }
    } catch {
      // Ningún dato de row debe dejar el header muerto sin feedback.
      window.location.assign(bigPicture ? "/big-picture/catalog" : "/catalog");
    }
  }, [bigPicture, navigate, row.addonId, row.catalogId, row.extraParams, row.type, title]);

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
    if (restoreScrollLeft == null || !rowItems.length) return;
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      if (el.scrollWidth >= restoreScrollLeft) {
        el.scrollTo({ left: restoreScrollLeft, behavior: "instant" as ScrollBehavior });
        updateArrows();
      }
    };
    apply();
    const id = window.setTimeout(apply, 50);
    return () => window.clearTimeout(id);
  }, [restoreScrollLeft, rowItems.length, updateArrows]);

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
    scrollByGsap(scrollRef.current, dir === "right" ? (cardSize.width + itemGap) * 3 : -(cardSize.width + itemGap) * 3);
  }, [cardSize.width, itemGap]);

  const { scrollRef } = virtualWindow;

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && showLeft ? 1 : 0 }, 0.45);
    tweenTo(rightArrowRef.current, { opacity: hovered && showRight ? 1 : 0 }, 0.45);
  }, [hovered, showLeft, showRight]);

  // Fila vacía tras ocultar vistos: no pinta ni cabecera.
  if (rowItems.length === 0) return null;

  return (
    <section data-row-key={rowKey} data-row-count={rowItems.length + (showViewMore ? 1 : 0)} data-row-hovered={hovered ? "true" : undefined} style={{ paddingLeft: 0, paddingRight: 0, marginBottom: row.type === "sports-replay" ? 0 : -24, contentVisibility: deferOffscreenRendering ? "auto" : undefined, containIntrinsicBlockSize: deferOffscreenRendering ? `auto ${intrinsicHeight}px` : undefined }}>
      {!hideHeader ? (
        bigPicture ? (
          <div
            data-row-header
            style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 4, marginBottom: 14, paddingLeft: "var(--app-gutter-x)", paddingRight: "var(--app-gutter-x)" }}
          >
            <span className="home-row-title" style={{ fontSize: 20, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,0.38)" }}>{title}</span>
          </div>
        ) : (
        <div
          data-row-header
          style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 12, marginBottom: 14, paddingLeft: "var(--app-gutter-x)", paddingRight: "var(--app-gutter-x)" }}
        >
          <button
            type="button"
            onClick={disableHeaderNavigation ? undefined : openCatalog}
            style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: 1, background: "none", border: "none", color: "inherit", cursor: disableHeaderNavigation ? "default" : "pointer", padding: 0, textAlign: "left" }}
          >
            <span className="home-row-title" style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
            {!disableHeaderNavigation ? <ChevronRight size={15} style={{ color: "rgba(255,255,255,0.4)", marginTop: 1 }} /> : null}
          </button>
        </div>
        )
      ) : null}

      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={leftArrowRef}
          className="liquid-glass-arrow row-arrow-shell"
          style={{
            position: "absolute",
            left: embedded ? 0 : 20,
            top: "50%",
            zIndex: 10,
            transform: "translate(-35%,-50%)",
            opacity: 0,
            pointerEvents: hovered && showLeft ? "auto" : "none",
          }}
        >
          <button
            onClick={() => scroll("left")}
            title="Anterior"
            aria-label="Anterior"
            className="row-arrow-button"
            style={{
              width: 36,
              height: 60,
              borderRadius: 18,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ transform: "rotate(180deg)", overflow:"visible" }}>
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="scroll-row"
          data-row-scroller
          data-focus-center
          style={{
            display: "flex",
            gap: 0,
            overflowX: "auto",
            overflowY: "hidden",
            marginTop: embedded ? -12 : -18,
            marginLeft: 0,
            marginRight: 0,
            paddingLeft: embedded ? 0 : "var(--app-gutter-x)",
            paddingRight: embedded ? 0 : "var(--app-gutter-x)",
            paddingTop: ROW_SHADOW_TOP_GUTTER + 8,
            paddingBottom: ROW_SHADOW_BOTTOM_GUTTER + 8,
            scrollbarWidth: "none",
          }}
        >
          {beforeWidth > 0 ? <div aria-hidden="true" style={{ flex: `0 0 ${beforeWidth}px` }} /> : null}
          {visibleItems.map((item, offset) => {
            const idx = visibleStart + offset;
            const itemDetailPath = buildDetailPath(row.type, item.id, undefined, location.pathname);
            return (
              <div
                key={`${item.id}-${row.catalogId}-${idx}`}
                data-row-card
                data-item-index={idx}
                data-detail-path={onOpenItem ? undefined : itemDetailPath}
                onFocusCapture={() => onFocusItem?.(item)}
                onClickCapture={() => {
                  if (!persistHomeScroll) return;
                  const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
                  saveHomeScroll({
                    vertical: shell?.scrollTop ?? 0,
                    rows: { [makeRowKey(row.addonId, row.catalogId, row.type)]: scrollRef.current?.scrollLeft ?? 0 },
                  });
                }}
                style={{
                  flex: "0 0 auto",
                  marginRight: idx === rowItems.length - 1 ? 0 : itemGap,
                }}
              >
                {renderCard ? renderCard(item) : <CinematicCard
                  item={item}
                  type={row.type}
                  posterLayout={posterLayout}
                  watched={watchedMediaKeys.has(buildMediaKey(row.type, item.id))}
                  rank={ranked ? idx + 1 : undefined}
                  onMarkWatched={rememberWatchedFocusPosition}
                  onOpenItem={onOpenItem}
                  onChooseSources={onChooseSources}
                  onOpenPreview={onOpenPreview ? request => {
                    const sourceScrollLeft = scrollRef.current?.scrollLeft ?? 0;
                    const items = rowItems.map((rowItem, index) => {
                      const background = resolveDetailBackground(row.type, rowItem.id, rowItem.background);
                      writeDetailMediaMeta({
                        id: rowItem.id,
                        type: row.type,
                        name: rowItem.name,
                        poster: rowItem.poster,
                        background,
                        logo: rowItem.logo,
                        description: rowItem.description,
                        year: rowItem.year,
                      });
                      return {
                        detailPath: buildDetailPath(row.type, rowItem.id, undefined, location.pathname),
                        title: rowItem.name,
                        background,
                        // El fondo crudo de la card: es el mismo <img> que la fila
                        // ya tiene en caché, así el shell puede pintarlo al
                        // instante mientras entra el `original` del Detail.
                        cardBackground: rowItem.background,
                        cardElement: index === idx ? request.cardElement : scrollRef.current?.querySelector<HTMLElement>(
                          `[data-item-index="${index}"] [data-row-card]`,
                        ) ?? null,
                        restoreFocus: () => {
                          const rail = scrollRef.current;
                          if (!rail?.isConnected) return;
                          // Preserve the card's on-screen slot rather than snapping
                          // it to the leading edge when the preview closes.
                          const left = sourceScrollLeft + (index - idx) * (cardSize.width + itemGap);
                          rail.scrollTo({ left, behavior: "instant" });
                          window.setTimeout(() => {
                            if (!rail.isConnected || isShellPreviewOpen()) return;
                            rail.querySelector<HTMLElement>(`[data-item-index="${index}"] [data-row-card]`)?.focus({ preventScroll: true });
                          }, 80);
                        },
                      };
                    });
                    onOpenPreview({ ...request, items, initialIndex: idx });
                  } : undefined}
                />}
              </div>
            );
          })}
          {afterWidth > 0 ? <div aria-hidden="true" style={{ flex: `0 0 ${afterWidth}px` }} /> : null}
          {showViewMore ? (
            <button
              type="button"
              data-row-card
              data-item-index={rowItems.length}
              data-row-view-more
              aria-label={`Ver más: ${title}`}
              onClick={openCatalog}
              onFocus={() => setViewMoreFocused(true)}
              onBlur={() => setViewMoreFocused(false)}
              onMouseEnter={event => tweenTo(event.currentTarget, { scale: 1.025, y: -2 }, 0.28)}
              onMouseLeave={event => tweenTo(event.currentTarget, { scale: 1, y: 0 }, 0.28)}
              onPointerDown={event => {
                if (event.button !== 0) return;
                tweenTo(event.currentTarget, { scale: 0.97, y: 0 }, 0.1);
              }}
              onPointerUp={event => tweenTo(event.currentTarget, { scale: 1, y: 0 }, 0.24)}
              onPointerCancel={event => tweenTo(event.currentTarget, { scale: 1, y: 0 }, 0.24)}
              style={{
                flex: `0 0 ${viewMoreSize}px`,
                width: viewMoreSize,
                height: viewMoreSize,
                alignSelf: "center",
                marginLeft: itemGap,
                border: `1px solid ${viewMoreFocused ? "rgba(255,255,255,0.12)" : "transparent"}`,
                borderRadius: 16,
                background: viewMoreFocused ? "linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.035))" : "transparent",
                color: "rgba(255,255,255,0.82)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                boxShadow: viewMoreFocused ? "0 16px 40px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
    backdropFilter: viewMoreFocused ? "var(--lg-filter-md)" : "none",
    WebkitBackdropFilter: viewMoreFocused ? "var(--lg-filter-md)" : "none",
                transition: "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Ver más</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.48)", fontSize: 12, fontWeight: 600, opacity: viewMoreFocused ? 1 : 0, transform: viewMoreFocused ? "translateY(0)" : "translateY(4px)", transition: "opacity 180ms ease, transform 180ms ease" }}>
                Explorar
                <ChevronRight size={14} />
              </span>
            </button>
          ) : null}
        </div>

        <div
          ref={rightArrowRef}
          className="liquid-glass-arrow row-arrow-shell"
          style={{
            position: "absolute",
            right: embedded ? 0 : 20,
            top: "50%",
            zIndex: 10,
            transform: "translate(35%,-50%)",
            opacity: 0,
            pointerEvents: hovered && showRight ? "auto" : "none",
          }}
        >
          <button
            onClick={() => scroll("right")}
            title="Siguiente"
            aria-label="Siguiente"
            className="row-arrow-button"
            style={{
              width: 36,
              height: 60,
              borderRadius: 18,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ overflow:"visible" }}>
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

const CinematicCard = memo(function CinematicCard({ item, type, posterLayout, watched, rank, onMarkWatched, onOpenPreview, onOpenItem, onChooseSources }: { item: MediaItem; type: string; posterLayout: HomePosterLayout; watched: boolean; rank?: number; onMarkWatched?: (card: HTMLElement | null) => void; onOpenPreview?: (request: ShellPreviewRequest) => void; onOpenItem?: (item: MediaItem) => void; onChooseSources?: (item: MediaItem) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  const artworkActive = useNearViewport(cardRef);
  // El horario de emisión ("Cada domingo") lo dibuja ahora SpatialPosters dentro
  // del propio póster, así que ya no hace falta calcularlo ni superponerlo acá.
  const sportsContent = type === "live" || type === "sports-replay";
  const effectiveWatched = !sportsContent && watched;
  const [menuOpen, setMenuOpen] = useState(false);
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  // La biblioteca no admite deportes (menú deshabilitado); evitar consultarla.
  const [inLibrary, setInLibrary] = useState(() => sportsContent ? false : isInLibrary(type, item.id));
  const [, setArtworkVersion] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);
  // Si el póster SpatialPosters falla (offline, 404, rate-limit), volver al original TMDB/Cinemeta.
  const [posterFailed, setPosterFailed] = useState(false);
  const posterLoadedRef = useRef(false);
  const detailBackground = resolveDetailBackground(type, item.id, item.background);
  const ranked = typeof rank === "number";
  const effectivePosterLayout = ranked ? "vertical" : posterLayout;
  const artworkMode: HomeCardArtworkMode = effectivePosterLayout === "vertical" ? "poster" : "background";
  const cardBackground = readHomeCardArtwork("background", type, item.id, detailBackground);
  const cardPoster = readHomeCardArtwork("poster", type, item.id, item.poster);
  // Override manual del usuario → no tocar. Solo se resuelve SpatialPosters en vertical.
  const hasCustomPoster = Boolean(readHomeCardArtwork("poster", type, item.id) || cardPoster && cardPoster !== item.poster);
  // SpatialPosters compone artwork, logo del título y badge de género/año;
  // Aetherio conserva el número grande de ranking, no el badge del póster.
  const posterOverrides = ranked ? TOP_SPATIAL_POSTER_OVERRIDES : undefined;
  const resolvedPoster = useSpatialPoster(item.id, type, cardPoster, hasCustomPoster || effectivePosterLayout !== "vertical", posterOverrides, item.originalPoster, artworkActive);
  const posterSource = resolvedPoster.url ?? cardPoster;
  const verticalPoster = ranked ? withoutSpatialRankingBadge(posterSource) : posterSource;
  const fallbackPoster = item.originalPoster ?? resolvedPoster.original;
  const image = effectivePosterLayout === "vertical"
    ? verticalPoster ?? cardBackground ?? ""
    : cardBackground ?? cardPoster ?? "";
  const displayImage = effectivePosterLayout === "vertical" && resolvedPoster.pending
    ? ""
    : sportsContent && posterFailed
      ? fallbackPoster && fallbackPoster !== image ? fallbackPoster : ""
    : effectivePosterLayout === "vertical" && posterFailed && fallbackPoster
      ? fallbackPoster
      : image;
  const topMeta = ranked && shouldShowTopMetaFallback(displayImage, resolvedPoster.pending)
    ? [item.genres?.filter(Boolean).slice(0, 2).join(" · "), item.year ? String(item.year) : ""]
      .filter(Boolean)
      .join(" · ")
    : "";
  const customLogo = sanitizeLogoUrl(readHomeCardArtwork("logo", type, item.id));
  const logo = customLogo || sanitizeLogoUrl(item.logo);
  const showLogo = Boolean(logo && !logoFailed);
  // En picture la card es foco espacial con la misma animación del hover.
  const bigPicture = useBigPictureActive();
  // Al enfocar/pasar sobre la card se precalientan los bytes finales del
  // backdrop: si el usuario abre la shell, la imagen ya está en caché.
  const warmArtwork = useCallback(() => {
    preloadArtwork(detailBackground);
  }, [detailBackground]);

  const cardSize = ranked
    ? VERTICAL_CARD
    : posterLayout === "vertical" ? VERTICAL_CARD : HORIZONTAL_CARD;
  const responsiveArtwork = getTmdbCardImageResponsiveProps(displayImage, cardSize.width);
  const openDetail = useCallback(() => {
    if (onOpenItem) {
      onOpenItem(item);
      return;
    }
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
    const detailPath = buildDetailPath(type, item.id, undefined, location.pathname);
    if (isBigPictureLocation(location.pathname) && onOpenPreview) {
      onOpenPreview({ detailPath, title: item.name, cardElement: cardRef.current });
      return;
    }
    navigate(detailPath);
  }, [detailBackground, item, location.pathname, navigate, onOpenPreview, onOpenItem, type]);

  // En picture el anticlick no existe: A/Enter corto abre, mantenido (500ms)
  // abre las opciones tras pulsación larga.
  const longPress = useLongPressAction(bigPicture, {
    onActivate: openDetail,
    onLongPress: () => { if (!sportsContent) setMenuOpen(true); },
  });

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

  // El logo puede llegar tarde (enrich de fase 2) y NO debe resetear el
  // estado del póster: antes, su cambio disparaba este efecto, ponía
  // posterLoadedRef a false y el timer de 15s degradaba a TMDB pósters
  // BTTTR ya verificados y cargados (ola BTTTR→normal a los ~15s).
  useEffect(() => {
    setLogoFailed(false);
  }, [logo]);

  useEffect(() => {
    setPosterFailed(false);
    posterLoadedRef.current = false;
  }, [item.poster, item.background, resolvedPoster.url]);

  // SpatialPosters genera pósters bajo demanda y a veces la petición se queda colgada
  // sin error: si en 15s no cargó, caer al póster original.
  // (No se resetea posterLoadedRef aquí: el reset vive en el efecto que
  // observa cambios de URL; resetear aquí degradaba imágenes ya cargadas
  // desde caché cuyo onLoad corrió antes que este efecto.)
  // Al armar se consulta el estado real del <img>: con BTTTR verificado la
  // imagen suele estar ya completa (caché) y su onLoad puede haber corrido
  // ANTES que los efectos — sin este cheque el timer la degradaba igual.
  const imgElRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!artworkActive || !isSpatialPosterUrl(displayImage) || !fallbackPoster) return;
    const el = imgElRef.current;
    if (el && el.currentSrc === displayImage && el.complete && el.naturalWidth > 0) {
      posterLoadedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      if (!posterLoadedRef.current) setPosterFailed(true);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [artworkActive, displayImage, fallbackPoster]);

  useEffect(() => {
    const refresh = () => setInLibrary(sportsContent ? false : isInLibrary(type, item.id));
    window.addEventListener(LIBRARY_CHANGED_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
    };
  }, [item.id, sportsContent, type]);

  const openArtworkMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!sportsContent) setMenuOpen(true);
  }, [sportsContent]);

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
  // Los pósters BTTTR no se pueden cambiar; solo cuando cae al fallback
  // (TMDB o nuestro) se permite elegir póster.
  const canChangeCardArtwork = artworkMode !== "poster" || !isSpatialPosterUrl(displayImage);

  const artworkControls = (
    <>
      <ContextMenu
        open={menuOpen}
        anchorRef={cardRef}
        onClose={() => setMenuOpen(false)}
        placement="below-start"
        width={238}
        items={[
          ...(isHorizontal ? [{
            label: inLibrary ? "Quitar de la biblioteca" : "Añadir a la biblioteca",
            icon: inLibrary ? <BookmarkMinus size={15} /> : <LibraryIcon size={15} />,
            onSelect: () => {
              const added = toggleLibraryItem({
                ...item,
                type,
                background: detailBackground,
              });
              setInLibrary(added);
            },
          }] : []),
          ...(!effectiveWatched ? [{
            label: "Marcar como visto",
            icon: <Check size={15} />,
            onSelect: () => {
              onMarkWatched?.(cardRef.current);
              markMediaAsWatched({
                type,
                id: item.id,
                name: item.name,
                logo: item.logo,
                background: detailBackground,
                poster: item.poster,
                originalPoster: item.originalPoster,
              });
            },
          }] : []),
          ...(canChangeCardArtwork ? [{
            label: artworkMode === "poster" ? "Elegir póster de la card" : "Elegir fondo de la card",
            icon: <ImageIcon size={15} />,
            onSelect: () => setArtworkPickerOpen(true),
          }] : []),
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

  const [hovered, setHovered] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  // GSAP promotes active transforms; idle cards must not reserve hundreds of
  // offscreen compositor layers with permanent will-change hints.
  const enterCard = (target: HTMLDivElement) => {
    setHovered(true);
    tweenTo(target, { scale: 1.05, y: -3, zIndex: 5 }, 0.32);
  };
  const leaveCard = (target: HTMLDivElement) => {
    setHovered(false);
    tweenTo(target, { scale: 1, y: 0, zIndex: 1 }, 0.32);
  };

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    if (hovered) {
      tweenTo(el, { opacity: 1, y: 0 }, 0.25);
    } else {
      tweenTo(el, { opacity: 0, y: 8 }, 0.2);
    }
  }, [hovered]);

  return (
    <div style={{ flexShrink: 0, width: cardSize.width, position: onChooseSources ? "relative" : undefined }}>
      <div
        ref={cardRef}
        onClick={event => {
          if ((event.target as HTMLElement).closest("[data-aetherio-context-menu]")) {
            event.stopPropagation();
            return;
          }
          openDetail();
        }}
        onContextMenu={openArtworkMenu}
        data-row-card
        data-long-press
        className="media-card-frame"
        aria-label={bigPicture ? (ranked ? `${rank}. ${item.name}` : item.name) : undefined}
        tabIndex={bigPicture ? 0 : -1}
        role={bigPicture ? "button" : undefined}
        onKeyDown={bigPicture ? longPress.onKeyDown : undefined}
        onKeyUp={bigPicture ? longPress.onKeyUp : undefined}
        onFocus={bigPicture ? e => { warmArtwork(); enterCard(e.currentTarget); } : undefined}
        onBlur={bigPicture ? e => leaveCard(e.currentTarget) : undefined}
        style={{ position: "relative", zIndex: 1, width: cardSize.width, height: cardSize.height, borderRadius: 12, overflow: "hidden", cursor: "pointer", background: "#1c1c1e", border: "1px solid rgba(225,230,238,0.10)" }}
        onMouseEnter={e => {
          warmArtwork();
          enterCard(e.currentTarget);
        }}
        onMouseLeave={e => {
          leaveCard(e.currentTarget);
        }}
      >
        {effectiveWatched ? (
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
            }}
          >
            <Check size={15} style={{ color: "rgba(16,18,20,0.94)" }} />
          </div>
        ) : null}
          {artworkActive && displayImage ? <SpatialPosterImage ref={imgElRef} src={responsiveArtwork?.fallbackSrc ?? displayImage} srcSet={responsiveArtwork?.srcSet} sizes={responsiveArtwork?.sizes} alt={item.name} decoding="async" loading="lazy" onLoad={() => { posterLoadedRef.current = true; }} onError={() => { if (sportsContent || (effectivePosterLayout === "vertical" && fallbackPoster)) setPosterFailed(true); }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1)" }} /> : null}

          {ranked ? (
            <div
              data-rank-number
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 16,
                top: 7,
                zIndex: 1,
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
                fontSize: 72,
                lineHeight: 0.78,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: "#b7bdc6",
                WebkitTextStroke: "1px rgba(15,18,24,0.34)",
                textShadow: "0 2px 6px rgba(0,0,0,0.46), 0 10px 26px rgba(0,0,0,0.36)",
                userSelect: "none",
              }}
            >
              {rank}
            </div>
          ) : null}

          {topMeta ? (
            <div
              data-top-card-meta
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 2,
                padding: "30px 12px 11px",
                background: "linear-gradient(transparent, rgba(0,0,0,0.82))",
                color: "rgba(255,255,255,0.92)",
                fontSize: 12,
                lineHeight: 1.25,
                fontWeight: 650,
                letterSpacing: "0.015em",
                textShadow: "0 1px 5px rgba(0,0,0,0.9)",
                textAlign: "center",
              }}
            >
              {topMeta}
            </div>
          ) : null}

          {posterLayout !== "vertical" && !ranked ? <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 10px 9px", transform: "translateZ(0)", background: sportsContent ? "linear-gradient(transparent, rgba(0,0,0,0.82))" : undefined }}>
           {sportsContent && <span style={{ display: "block", paddingTop: 18, marginBottom: 5, color: "rgba(255,255,255,0.82)", fontSize: 12, fontWeight: 600 }}>{item.genres?.join(" · ")}{item.runtime ? ` · ${item.runtime}` : ""}</span>}
          {showLogo ? (
            <img src={artworkActive ? logo : undefined} alt={item.name}
              decoding="async"
              loading="lazy"
              onError={() => setLogoFailed(true)}
              style={{ maxHeight: 48, maxWidth: 206, objectFit: "contain", filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.95))", marginBottom: 3 }} />
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", textShadow: "0 1px 8px rgba(0,0,0,0.95)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {item.name}
            </span>
          )}
        </div> : null}
          {!sportsContent && artworkControls}
      </div>

      {onChooseSources && <button type="button" className="sports-card-sources" aria-label={`Elegir fuentes para ${item.name}`} onClick={event => { event.stopPropagation(); onChooseSources(item); }}><Radio size={16} aria-hidden="true" />Fuentes</button>}

      {posterLayout === "vertical" && !ranked && (
        <div
          ref={titleRef}
          style={{
            marginTop: 10,
            opacity: 0,
            transform: "translateY(4px)",
            fontSize: 13,
            fontWeight: 500,
            color: "#fff",
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: cardSize.width,
            padding: "0 2px",
          }}
        >
          {item.name}
        </div>
      )}
    </div>
  );
});

export default memo(CatalogRow);
