import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isBigPictureLocation } from "../../utils/bigPictureDetail";
import { saveHomeScroll } from "../../store/homeScrollStore";
import { scrollByGsap, tweenTo } from "../../utils/motion";
import {
  getStreamingPlatformPath,
  STREAMING_PLATFORMS,
  type StreamingPlatform,
} from "../../services/streamingPlatforms";
import {
  getStreamingPlatformArrowState,
  getStreamingPlatformScrollDelta,
  STREAMING_PLATFORM_CARD_GAP,
  STREAMING_PLATFORM_CARD_WIDTH,
} from "./streamingPlatformsRowLogic";
import "./StreamingPlatformsRow.css";

export default function StreamingPlatformsRow() {
  const location = useLocation();
  const navigate = useNavigate();
  const bigPicture = isBigPictureLocation(location.pathname);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leftArrowRef = useRef<HTMLDivElement>(null);
  const rightArrowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const showLeftRef = useRef(false);
  const showRightRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const updateArrows = useCallback(() => {
    const next = getStreamingPlatformArrowState(scrollRef.current);
    if (showLeftRef.current !== next.showLeft) {
      showLeftRef.current = next.showLeft;
      setShowLeft(next.showLeft);
    }
    if (showRightRef.current !== next.showRight) {
      showRightRef.current = next.showRight;
      setShowRight(next.showRight);
    }
  }, []);

  const scheduleArrowUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateArrows();
    });
  }, [updateArrows]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    updateArrows();
    scroller.addEventListener("scroll", scheduleArrowUpdate, { passive: true });
    window.addEventListener("resize", scheduleArrowUpdate);
    const measureTimer = window.setTimeout(updateArrows, 100);

    return () => {
      scroller.removeEventListener("scroll", scheduleArrowUpdate);
      window.removeEventListener("resize", scheduleArrowUpdate);
      window.clearTimeout(measureTimer);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleArrowUpdate, updateArrows]);

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && showLeft ? 1 : 0 }, 0.45);
    tweenTo(rightArrowRef.current, { opacity: hovered && showRight ? 1 : 0 }, 0.45);
  }, [hovered, showLeft, showRight]);

  const scroll = (direction: "left" | "right") => {
    scrollByGsap(scrollRef.current, getStreamingPlatformScrollDelta(direction));
  };

  return (
    <section
      data-row-key="streaming-platforms"
      data-row-count={STREAMING_PLATFORMS.length}
      className="streaming-platforms-row"
      aria-labelledby="streaming-platforms-title"
      data-row-hovered={hovered ? "true" : undefined}
      style={{
        "--streaming-platform-card-width": `${STREAMING_PLATFORM_CARD_WIDTH}px`,
        "--streaming-platform-card-gap": `${STREAMING_PLATFORM_CARD_GAP}px`,
      } as CSSProperties}
    >
      <div className="streaming-platforms-row__header" data-row-header>
        <h2 id="streaming-platforms-title" className="home-row-title">Explora por plataforma</h2>
      </div>
      <div
        className="streaming-platforms-row__viewport"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={leftArrowRef}
          className="liquid-glass-arrow row-arrow-shell"
          style={{
            position: "absolute",
            left: 20,
            top: "50%",
            zIndex: 10,
            transform: "translate(-35%,-50%)",
            opacity: 0,
            pointerEvents: hovered && showLeft ? "auto" : "none",
          }}
        >
          <button
            type="button"
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
            <svg width="18" height="30" viewBox="-0.5 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ transform: "rotate(180deg)", overflow: "visible" }}>
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>

        <div ref={scrollRef} className="streaming-platforms-row__scroller scroll-row" data-row-scroller data-focus-center>
          {STREAMING_PLATFORMS.map((platform, index) => (
            <StreamingPlatformCard
              key={platform.id}
              platform={platform}
              index={index}
              onClick={() => {
                if (bigPicture) {
                  saveHomeScroll({
                    vertical: document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]")?.scrollTop ?? 0,
                    rows: { "streaming-platforms": scrollRef.current?.scrollLeft ?? 0 },
                    focus: { rowKey: "streaming-platforms", itemIndex: index, platformId: platform.id },
                  });
                }
                navigate(getStreamingPlatformPath(platform.id, bigPicture));
              }}
            />
          ))}
        </div>

        <div
          ref={rightArrowRef}
          className="liquid-glass-arrow row-arrow-shell"
          style={{
            position: "absolute",
            right: 20,
            top: "50%",
            zIndex: 10,
            transform: "translate(35%,-50%)",
            opacity: 0,
            pointerEvents: hovered && showRight ? "auto" : "none",
          }}
        >
          <button
            type="button"
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
            <svg width="18" height="30" viewBox="-0.5 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

function StreamingPlatformCard({ platform, index, onClick }: { platform: StreamingPlatform; index: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="streaming-platform-card"
      data-row-card
      data-item-index={index}
      data-platform-id={platform.id}
      aria-label={`Explorar películas y series de ${platform.name}`}
      onClick={onClick}
      style={{ "--platform-accent": platform.accent } as CSSProperties}
    >
      <img
        className="streaming-platform-card__image"
        src={platform.cardImage}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={event => { event.currentTarget.style.display = "none"; }}
      />
    </button>
  );
}
