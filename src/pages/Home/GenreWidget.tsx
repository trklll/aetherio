import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchJikanGenres, type JikanGenre } from "../../services/jikan";
import { tweenTo } from "../../utils/motion";

const GENRE_COLORS: Record<string, [string, string]> = {
  Action: ["#e74c3c", "#c0392b"],
  Adventure: ["#e67e22", "#d35400"],
  Comedy: ["#f1c40f", "#f39c12"],
  Drama: ["#9b59b6", "#8e44ad"],
  Fantasy: ["#2ecc71", "#27ae60"],
  Horror: ["#1a1a2e", "#16213e"],
  Romance: ["#e84393", "#d63384"],
  "Sci-Fi": ["#00b4d8", "#0077b6"],
  Slice: ["#00b894", "#00a381"],
  Thriller: ["#636e72", "#2d3436"],
  Mystery: ["#6c5ce7", "#5a4bd1"],
  Sports: ["#fd79a8", "#e84393"],
  Music: ["#a29bfe", "#6c5ce7"],
  Seinen: ["#2d3436", "#636e72"],
  Shounen: ["#e17055", "#d63031"],
  Josei: ["#fab1a0", "#e17055"],
  Shoujo: ["#fd79a8", "#e84393"],
  Mecha: ["#00cec9", "#00b894"],
  Supernatural: ["#6c5ce7", "#a29bfe"],
  Psychological: ["#2d3436", "#1a1a2e"],
};

function genreGradient(name: string): string {
  const colors = GENRE_COLORS[name] ?? GENRE_COLORS[name.split(" ")[0]] ?? ["#636e72", "#2d3436"];
  return `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
}

function GenreWidget() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leftArrowRef = useRef<HTMLDivElement>(null);
  const rightArrowRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const showLeftRef = useRef(false);
  const showRightRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const { data: genres = [] } = useQuery({
    queryKey: ["jikan", "genres"],
    queryFn: fetchJikanGenres,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
  });

  // Filter to interesting genres and sort by count
  const displayGenres = useMemo(() => {
    const skip = new Set(["Hentai", "Ecchi", "Erotica"]);
    return genres
      .filter(g => !skip.has(g.name) && g.count > 100)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [genres]);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nextLeft = el.scrollLeft > 10;
    const nextRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 10;
    if (showLeftRef.current !== nextLeft) {
      showLeftRef.current = nextLeft;
      setShowLeft(nextLeft);
    }
    if (showRightRef.current !== nextRight) {
      showRightRef.current = nextRight;
      setShowRight(nextRight);
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
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", scheduleArrowUpdate, { passive: true });
    return () => {
      el.removeEventListener("scroll", scheduleArrowUpdate);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [scheduleArrowUpdate, updateArrows]);

  useEffect(() => {
    tweenTo(leftArrowRef.current, { opacity: hovered && showLeft ? 1 : 0 }, 0.45);
    tweenTo(rightArrowRef.current, { opacity: hovered && showRight ? 1 : 0 }, 0.45);
  }, [hovered, showLeft, showRight]);

  const scroll = useCallback((dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = dir === "right" ? 600 : -600;
    el.scrollBy({ left: amount, behavior: "smooth" });
  }, []);

  const handleGenreClick = useCallback((genre: JikanGenre) => {
    navigate(`/search?q=&genreId=${genre.mal_id}&genre=${encodeURIComponent(genre.name)}`);
  }, [navigate]);

  if (!displayGenres.length) return null;

  return (
    <section style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, paddingLeft: 48, paddingRight: 48 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Explorar por género</span>
      </div>
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={leftArrowRef}
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
            onClick={() => scroll("left")}
            title="Anterior"
            aria-label="Anterior"
            className="liquid-glass-arrow"
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
            <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ transform: "rotate(180deg)", overflow: "visible" }}>
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="scroll-row"
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            overflowY: "hidden",
            paddingLeft: 48,
            paddingRight: 48,
            paddingTop: 8,
            paddingBottom: 8,
            scrollbarWidth: "none",
          }}
        >
          {displayGenres.map(genre => (
            <GenreChip
              key={genre.mal_id}
              genre={genre}
              onClick={() => handleGenreClick(genre)}
            />
          ))}
        </div>

        <div
          ref={rightArrowRef}
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
            onClick={() => scroll("right")}
            title="Siguiente"
            aria-label="Siguiente"
            className="liquid-glass-arrow"
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
            <svg width="18" height="30" viewBox="0 -0.5 17 17" fill="#fff" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
              <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

const GenreChip = memo(function GenreChip({ genre, onClick }: { genre: JikanGenre; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const gradient = useMemo(() => genreGradient(genre.name), [genre.name]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        flex: "0 0 auto",
        minWidth: 140,
        padding: "16px 20px",
        borderRadius: 14,
        cursor: "pointer",
        background: gradient,
        boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
      }}
      onMouseEnter={e => {
        tweenTo(e.currentTarget, { scale: 1.06, y: -4, zIndex: 5 }, 0.28);
      }}
      onMouseLeave={e => {
        tweenTo(e.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.28);
      }}
    >
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1.2, textShadow: "0 1px 4px rgba(0,0,0,0.3)" }}>
          {genre.name}
        </div>
        <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.75)", marginTop: 4, textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          {genre.count.toLocaleString()} animes
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: "-30%",
          right: "-20%",
          width: 100,
          height: 100,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
});

export default memo(GenreWidget);
