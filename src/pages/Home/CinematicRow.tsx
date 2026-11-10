import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { buildDetailPath, isBigPictureLocation } from "../../utils/bigPictureDetail";
import { HOME_CARD_ARTWORK_CHANGED_EVENT, readHomeCardArtwork } from "../../utils/homeCardArtwork";
import { resolveDetailBackground, writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { scrollByGsap, tweenTo } from "../../utils/motion";
import { captureCardRect, setSharedElementName } from "../../utils/sharedElementTransition";
import { saveHomeScroll, rowKey as makeRowKey } from "../../store/homeScrollStore";
import { isShellPreviewOpen, type ShellPreviewItem, type ShellPreviewRequest } from "../../utils/shellPreview";
import { getTmdbCardImageResponsiveProps } from "../../utils/tmdbCardImage";
import "./CinematicRow.css";

interface CinematicRowProps {
  row: CatalogRowData;
  restoreScrollLeft?: number;
  onOpenPreview?: (request: ShellPreviewRequest) => void;
}

export default function CinematicRow({ row, restoreScrollLeft, onOpenPreview }: CinematicRowProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [, setArtworkVersion] = useState(0);
  const leftArrowRef = useRef<HTMLDivElement>(null);
  const rightArrowRef = useRef<HTMLDivElement>(null);
  const [failedArtwork, setFailedArtwork] = useState<Set<string>>(() => new Set());
  const rowKey = makeRowKey(row.addonId, row.catalogId, row.type);
  const items = row.items;
  useEffect(() => {
    const itemIds = new Set(items.map(item => item.id));
    const normalizeType = (type?: string) => type === "tv" ? "series" : type;
    const refreshArtwork = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string; type?: string; id?: string }>).detail;
      const itemId = detail?.id;
      if (
        detail?.mode !== "background"
        || !itemId
        || !itemIds.has(itemId)
        || normalizeType(detail.type) !== normalizeType(row.type)
      ) return;

      setFailedArtwork(current => {
        if (!current.has(itemId)) return current;
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
      setArtworkVersion(version => version + 1);
    };

    window.addEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, refreshArtwork);
    return () => window.removeEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, refreshArtwork);
  }, [items, row.type]);

  const updateActiveIndex = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const viewportCenter = scroller.getBoundingClientRect().left + scroller.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    slideRefs.current.forEach((slide, index) => {
      if (!slide) return;
      const rect = slide.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setActiveIndex(current => current === nearestIndex ? current : nearestIndex);
  }, []);

  const updateArrowState = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    setShowLeft(scroller.scrollLeft > 10);
    setShowRight(scroller.scrollLeft < maxScroll - 10);
  }, []);

  const updateRailState = useCallback(() => {
    updateActiveIndex();
    updateArrowState();
  }, [updateActiveIndex, updateArrowState]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const track = scroller.firstElementChild;
    const observer = new ResizeObserver(updateRailState);
    observer.observe(scroller);
    if (track) observer.observe(track);
    updateRailState();
    return () => observer.disconnect();
  }, [items.length, updateRailState]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || restoreScrollLeft == null || restoreScrollLeft <= 0) return;
    scroller.scrollTo({ left: restoreScrollLeft, behavior: "instant" as ScrollBehavior });
    window.requestAnimationFrame(updateRailState);
  }, [restoreScrollLeft, updateRailState]);

  const scroll = useCallback((direction: "left" | "right") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const track = scroller.firstElementChild as HTMLElement | null;
    const slideWidth = slideRefs.current.find(Boolean)?.getBoundingClientRect().width ?? 425;
    const gap = track ? Number.parseFloat(getComputedStyle(track).columnGap) || 0 : 0;
    const distance = (slideWidth + gap) * 3;
    scrollByGsap(scroller, direction === "right" ? distance : -distance);
  }, []);

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && showLeft ? 1 : 0 }, 0.45);
    tweenTo(rightArrowRef.current, { opacity: hovered && showRight ? 1 : 0 }, 0.45);
  }, [hovered, showLeft, showRight]);

  const openItem = (item: MediaItem, card: HTMLButtonElement, selectedIndex: number) => {
    const background = resolveDetailBackground(row.type, item.id, item.background);
    writeDetailMediaMeta({
      id: item.id,
      type: row.type,
      name: item.name,
      poster: item.poster,
      background,
      description: item.description,
      year: item.year,
    });

    const detailPath = buildDetailPath(row.type, item.id, undefined, location.pathname);
    if (isBigPictureLocation(location.pathname) && onOpenPreview) {
      const sourceScrollLeft = scrollerRef.current?.scrollLeft ?? 0;
      const sourceOffset = card.offsetLeft;
      const previewItems: ShellPreviewItem[] = items.map((previewItem, index) => {
        const previewBackground = resolveDetailBackground(row.type, previewItem.id, previewItem.background);
        writeDetailMediaMeta({
          id: previewItem.id,
          type: row.type,
          name: previewItem.name,
          poster: previewItem.poster,
          background: previewBackground,
          logo: previewItem.logo,
          description: previewItem.description,
          year: previewItem.year,
        });

        return {
          detailPath: buildDetailPath(row.type, previewItem.id, undefined, location.pathname),
          title: previewItem.name,
          background: previewBackground,
          cardBackground: readHomeCardArtwork("background", row.type, previewItem.id, previewBackground) || previewItem.poster,
          cardElement: index === selectedIndex ? card : slideRefs.current[index],
          restoreFocus: () => {
            const rail = scrollerRef.current;
            const target = slideRefs.current[index];
            if (!rail?.isConnected || !target?.isConnected) return;

            rail.scrollTo({
              left: sourceScrollLeft + target.offsetLeft - sourceOffset,
              behavior: "instant" as ScrollBehavior,
            });
            window.setTimeout(() => {
              if (!rail.isConnected || isShellPreviewOpen()) return;
              target.focus({ preventScroll: true });
            }, 80);
          },
        };
      });
      onOpenPreview({ ...previewItems[selectedIndex], items: previewItems, initialIndex: selectedIndex });
      return;
    }

    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    saveHomeScroll({
      vertical: shell?.scrollTop ?? 0,
      rows: { [rowKey]: scrollerRef.current?.scrollLeft ?? 0 },
    });
    setSharedElementName(row.type, item.id);
    captureCardRect(card);
    navigate(detailPath);
  };

  if (!items.length) return null;

  return (
    <section
      className="cinematic-row"
      data-row-key={rowKey}
      data-row-count={items.length}
      data-row-hovered={hovered ? "true" : undefined}
      role="region"
      aria-label={row.name}
    >
      <div className="cinematic-row__header">
        <h2 className="cinematic-row__heading home-row-title">{row.name}</h2>
      </div>

      <div
        className="cinematic-row__rail"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={scrollerRef}
          className="cinematic-row__viewport"
          data-row-scroller
          data-focus-center
          onScroll={updateRailState}
        >
          <div className="cinematic-row__track">
            {items.map((item, index) => {
              const detailBackground = resolveDetailBackground(row.type, item.id, item.background);
              const cardBackground = readHomeCardArtwork("background", row.type, item.id, detailBackground);
              const image = failedArtwork.has(item.id) ? item.poster : cardBackground || item.poster;
              const responsiveArtwork = getTmdbCardImageResponsiveProps(image, 425);
              return (
                <button
                  key={item.id}
                  ref={element => { slideRefs.current[index] = element; }}
                  type="button"
                  className="cinematic-row__card"
                  data-row-card
                  data-item-index={index}
                  aria-label={item.year ? `${item.name}, ${item.year}` : item.name}
                  onClick={event => openItem(item, event.currentTarget, index)}
                >
                  {image ? (
                    <img
                      className="cinematic-row__artwork"
                      srcSet={responsiveArtwork?.srcSet}
                      sizes={responsiveArtwork?.sizes}
                      src={responsiveArtwork?.fallbackSrc ?? image}
                      alt=""
                      loading={index === activeIndex ? "eager" : "lazy"}
                      decoding="async"
                      onError={() => setFailedArtwork(current => {
                        if (current.has(item.id)) return current;
                        return new Set(current).add(item.id);
                      })}
                    />
                  ) : null}
                  <span className="cinematic-row__wash" aria-hidden="true" />
                  <span className="cinematic-row__caption">
                    <span className="cinematic-row__title">{item.name}</span>
                    {item.year ? <span className="cinematic-row__year">{item.year}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={leftArrowRef}
          className="liquid-glass-arrow row-arrow-shell"
          style={{ position: "absolute", left: 20, top: "50%", zIndex: 10, transform: "translate(-35%,-50%)", opacity: 0, pointerEvents: hovered && showLeft ? "auto" : "none" }}
        >
          <button type="button" onClick={() => scroll("left")} title="Anterior" aria-label="Anterior" className="row-arrow-button" style={{ width: 36, height: 60, borderRadius: 18, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ transform: "rotate(180deg)", overflow: "visible" }} aria-hidden="true">
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>

        <div
          ref={rightArrowRef}
          className="liquid-glass-arrow row-arrow-shell"
          style={{ position: "absolute", right: 20, top: "50%", zIndex: 10, transform: "translate(35%,-50%)", opacity: 0, pointerEvents: hovered && showRight ? "auto" : "none" }}
        >
          <button type="button" onClick={() => scroll("right")} title="Siguiente" aria-label="Siguiente" className="row-arrow-button" style={{ width: 36, height: 60, borderRadius: 18, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }} aria-hidden="true">
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
