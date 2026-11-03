import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { StreamingPlatformCollection } from "../../services/streamingPlatforms";
import { scrollByGsap, tweenTo } from "../../utils/motion";
import { getStreamingPlatformArrowState } from "../Home/streamingPlatformsRowLogic";
import "./StreamingCollectionsRow.css";

interface StreamingCollectionsRowProps {
  platformId: string;
  collections: StreamingPlatformCollection[];
}

export default function StreamingCollectionsRow({ platformId, collections }: StreamingCollectionsRowProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const leftArrowRef = useRef<HTMLDivElement>(null);
  const rightArrowRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [arrows, setArrows] = useState({ left: false, right: false });
  const bigPicture = location.pathname.startsWith("/big-picture/");
  const scroller = bigPicture ? "/big-picture/catalog" : "/catalog";

  const animateCard = (card: HTMLButtonElement, active: boolean) => {
    tweenTo(card, active
      ? { scale: 1.05, y: -3, zIndex: 5 }
      : { scale: 1, y: 0, zIndex: 1 }, 0.18);
  };

  const scroll = (direction: "left" | "right") => {
    const scroller = scrollerRef.current;
    const firstCard = scroller?.firstElementChild as HTMLElement | null;
    if (!scroller || !firstCard) return;
    const gap = Number.parseFloat(getComputedStyle(scroller).columnGap) || 0;
    const distance = (firstCard.offsetWidth + gap) * 3;
    scrollByGsap(scroller, direction === "right" ? distance : -distance);
  };

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const state = getStreamingPlatformArrowState(el);
    setArrows({ left: state.showLeft, right: state.showRight });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      observer.disconnect();
    };
  }, [collections.length, updateArrows]);

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && arrows.left ? 1 : 0 }, 0.45);
    tweenTo(rightArrowRef.current, { opacity: hovered && arrows.right ? 1 : 0 }, 0.45);
  }, [arrows.left, arrows.right, hovered]);

  if (collections.length === 0) return null;

  return (
    <section
      className="streaming-collections"
      aria-label={`Colecciones de ${platformId}`}
      data-row-key={`streaming-${platformId}-collections`}
      data-streaming-collections-row
    >
      <header className="streaming-collections__header" data-row-header>
        <div>
          <h2>Sagas y colecciones</h2>
          <p>Historias que continúan película tras película</p>
        </div>
      </header>
      <div
        className="streaming-collections__rail"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div ref={leftArrowRef} className="liquid-glass-arrow row-arrow-shell streaming-collections__arrow streaming-collections__arrow--left" style={{ opacity: 0, pointerEvents: hovered && arrows.left ? "auto" : "none" }}>
          <button type="button" className="row-arrow-button" aria-label="Anterior" title="Anterior" onClick={() => scroll("left")}>
            <svg width="18" height="30" viewBox="-0.5 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ transform: "rotate(180deg)", overflow: "visible" }}><path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>
        <div ref={rightArrowRef} className="liquid-glass-arrow row-arrow-shell streaming-collections__arrow streaming-collections__arrow--right" style={{ opacity: 0, pointerEvents: hovered && arrows.right ? "auto" : "none" }}>
          <button type="button" className="row-arrow-button" aria-label="Siguiente" title="Siguiente" onClick={() => scroll("right")}>
            <svg width="18" height="30" viewBox="-0.5 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}><path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>
      <div ref={scrollerRef} className="streaming-collections__scroller" data-row-scroller>
        {collections.map((collection, index) => {
          const artwork = collection.background || collection.poster;
          const params = new URLSearchParams({
            addon: "tmdb",
            type: "movie",
            catalog: `tmdb.collection.${collection.id}`,
            title: collection.name,
          });
          return (
            <button
              key={collection.id}
              type="button"
              className="streaming-collection-card"
              data-row-card
              data-item-index={index}
              aria-label={`Abrir colección ${collection.name}`}
              onClick={() => navigate(`${scroller}?${params.toString()}`)}
              onMouseEnter={event => animateCard(event.currentTarget, true)}
              onMouseLeave={event => {
                if (document.activeElement !== event.currentTarget) animateCard(event.currentTarget, false);
              }}
              onFocus={event => animateCard(event.currentTarget, true)}
              onBlur={event => {
                if (!event.currentTarget.matches(":hover")) animateCard(event.currentTarget, false);
              }}
              style={{
                backgroundImage: artwork
                  ? `url("${artwork}")`
                  : "linear-gradient(130deg, #252936, #101218)",
              }}
            >
              <span className="streaming-collection-card__title">{collection.name}</span>
              <span className="streaming-collection-card__meta">
                {collection.itemCount} {collection.itemCount === 1 ? "película" : "películas"}
              </span>
            </button>
          );
        })}
      </div>
      </div>
    </section>
  );
}
