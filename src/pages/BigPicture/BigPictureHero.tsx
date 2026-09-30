import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Play } from "lucide-react";
import type { MediaItem } from "../../types/ui.ts";
import { saveHomeScroll } from "../../store/homeScrollStore.ts";
import { buildDetailPath } from "../../utils/bigPictureDetail.ts";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata.ts";
import { prefersReducedMotion, tweenTo } from "../../utils/motion.ts";
import { HERO_NEXT_EVENT } from "../../navigation/spatialNav.ts";

/**
 * Info del hero en modo picture: sin tarjetero (no hay carousel, vecinos,
 * trailer ni dots), solo logo/título + meta + sinopsis + Reproducir sobre el
 * background maximizado. Hace scroll junto al contenido como el header de Detail.
 */
function BigPictureHeroText({ item }: { item: MediaItem }) {
  return (
    <div className="bp-hero-copy-layer__content" style={{ maxWidth: 640 }}>
      <div style={{ minHeight: 140, display: "flex", alignItems: "flex-end", marginBottom: 8, overflow: "visible", paddingTop: 16, marginTop: -16, paddingLeft: 16, marginLeft: -16, paddingRight: 16, marginRight: -16 }}>
        {item.logo ? (
          <img
            src={item.logo}
            alt={item.name}
            decoding="async"
            draggable={false}
            style={{ maxHeight: 140, maxWidth: "100%", objectFit: "contain", objectPosition: "left bottom", transformOrigin: "left center", filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.7))", display: "block" }}
          />
        ) : (
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: 0, lineHeight: 1.1 }}>
            {item.name}
          </h2>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
        {item.genres?.[0] ? (
          <>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
              {item.genres[0]}
            </span>
            {(item.year || item.runtime || item.certification) && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
            )}
          </>
        ) : null}
        {item.year ? (
          <>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
              {item.year}
            </span>
            {(item.runtime || item.certification) && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
            )}
          </>
        ) : null}
        {item.runtime ? (
          <>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
              {item.runtime}
            </span>
            {item.certification && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
            )}
          </>
        ) : null}
        {item.certification && (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            {item.certification}
          </span>
        )}
      </div>
      <div style={{ minHeight: 59, marginBottom: 12 }}>
        {item.description && (
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.4, margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {item.description}
          </p>
        )}
      </div>
    </div>
  );
}

export default function BigPictureHero({ item, contentVisible = true }: { item: MediaItem | undefined; contentVisible?: boolean }) {
  const navigate = useNavigate();
  const [displayItem, setDisplayItem] = useState(item);
  const [transitionItem, setTransitionItem] = useState<MediaItem | undefined>();

  useEffect(() => {
    if (!item) {
      setDisplayItem(undefined);
      setTransitionItem(undefined);
      return;
    }
    if (displayItem?.id === item.id && displayItem.type === item.type) return;
    if (!displayItem || prefersReducedMotion()) {
      setDisplayItem(item);
      setTransitionItem(undefined);
      return;
    }
    setTransitionItem(item);
    const timer = window.setTimeout(() => {
      setDisplayItem(item);
      setTransitionItem(undefined);
    }, 850);
    return () => window.clearTimeout(timer);
  // The media identity is the cross-fade trigger; displayItem is held during it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.type]);

  if (!item) return null;

  const openDetail = (targetItem: MediaItem) => {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    saveHomeScroll({
      vertical: shell?.scrollTop ?? 0,
      hero: { kind: "single", index: 0 },
    });
    writeDetailMediaMeta({
      id: targetItem.id,
      type: targetItem.type,
      name: targetItem.name,
      poster: targetItem.poster,
      background: targetItem.background,
      logo: targetItem.logo,
      description: targetItem.description,
      year: targetItem.year,
      mdbListRatings: targetItem.mdbListRatings,
    });
    navigate(buildDetailPath(targetItem.type, targetItem.id));
  };

  const currentItem = displayItem ?? item;
  const activeTarget = transitionItem ?? currentItem;
  return (
    <div
      data-hero-panel
      data-home-entrance
      className="bp-hero-copy-stage"
      style={{
        minHeight: "min(62vh, 640px)",
        position: "relative",
        display: "flex",
        alignItems: "flex-end",
        padding: "0 var(--app-gutter-x) var(--app-gutter-bottom)",
        visibility: contentVisible ? "visible" : "hidden",
        pointerEvents: contentVisible ? "auto" : "none",
      }}
    >
      <div style={{ position: "relative", width: "100%", maxWidth: 640 }}>
        <div style={{ display: "grid", minHeight: 250 }}>
          <div
            style={{ gridArea: "1 / 1", alignSelf: "start" }}
            className={`${transitionItem ? "bp-hero-copy-layer--out" : ""}`}
            aria-hidden={Boolean(transitionItem)}
          >
            <BigPictureHeroText item={currentItem} />
          </div>
          {transitionItem && (
            <div
              style={{ gridArea: "1 / 1", alignSelf: "start" }}
              className="bp-hero-copy-layer--in"
            >
              <BigPictureHeroText item={transitionItem} />
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button
            onClick={() => openDetail(activeTarget)}
            data-hero-primary
            data-hero-cycle
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 26px", background: "#fff", color: "#000", fontWeight: 800, borderRadius: 999, fontSize: 14, border: "none", cursor: "pointer", boxShadow: "0 3px 12px rgba(0,0,0,0.38)" }}
            onMouseEnter={event => {
              tweenTo(event.currentTarget, { opacity: 0.88 });
            }}
            onMouseLeave={event => {
              tweenTo(event.currentTarget, { opacity: 1 });
            }}
          >
            <Play size={15} fill="black" />
            Reproducir
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(HERO_NEXT_EVENT))}
            aria-label="Siguiente"
            title="Siguiente"
            tabIndex={-1}
            data-spatial-ignore
            style={{ width: 44, height: 44, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
            onMouseEnter={event => {
              tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.16)" });
            }}
            onMouseLeave={event => {
              tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.08)" });
            }}
          >
            <ChevronRight size={19} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
