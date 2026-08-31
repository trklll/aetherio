import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import { useAddonStore } from "../../store/addonStore";
import { useMediaSearch } from "../../hooks/useMediaSearch";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import type { UnifiedSearchResult } from "../../utils/searchProviders";
import { gsap, scrollByGsap, tweenTo, useGsapState } from "../../utils/motion";

const POSTER_CARD = { width: 207, height: 312 };
const ROW_GAP = 22;
const TOP_RESULTS_LIMIT = 3;

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const addons = useAddonStore(state => state.addons);
  const { gradient } = useProfileGradient();
  const normalizedQuery = useMemo(() => (params.get("q") ?? "").trim(), [params]);
  const literal = params.get("literal") === "1";
  const { results, loading, correction, response } = useMediaSearch({
    query: normalizedQuery,
    mode: "full",
    addons,
    limit: 80,
    allowCorrection: !literal,
  });
  const headingQuery = correction && !literal ? correction.correctedQuery : normalizedQuery;

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient);
    }
    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    };
  }, [gradient]);

  function openResult(item: UnifiedSearchResult) {
    writeDetailMediaMeta(item);
    const q = new URLSearchParams({ fromSearch: "1" });
    if (normalizedQuery) q.set("q", normalizedQuery);
    navigate(`/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}?${q.toString()}`);
  }

  return (
    <main className="home-page-scale min-h-screen pb-14 text-white">
      <header style={{ padding: "42px 48px 28px" }}>
        <h1 style={{ fontSize: 28, lineHeight: 1.12, fontWeight: 750, letterSpacing: -0.6 }}>
          {headingQuery ? `Resultados para “${headingQuery}”` : "Encuentra algo para ver"}
        </h1>
        {correction && !literal ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12, color: "rgba(255,255,255,0.64)", fontSize: 14 }}>
            <span>Mostrando resultados para <strong style={{ color: "#fff" }}>“{correction.correctedQuery}”</strong>.</span>
            <button
              type="button"
              onClick={() => navigate(`/search?q=${encodeURIComponent(normalizedQuery)}&literal=1`)}
              style={{ border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderRadius: 999, padding: "6px 10px", cursor: "pointer" }}
            >
              Buscar literalmente
            </button>
          </div>
        ) : null}
      </header>

      {loading && !results.length ? (
        <SearchSkeleton />
      ) : results.length ? (
        <SearchResultsSections results={results} onOpen={openResult} />
      ) : (
        <div style={{ padding: "10px 48px" }}>
          <p style={{ maxWidth: 520, fontSize: 15, lineHeight: 1.5, color: "rgba(255,255,255,0.5)" }}>
            {normalizedQuery
              ? Object.values(response.providerStatus).filter(status => status.state !== "idle").length > 0
                && Object.values(response.providerStatus).filter(status => status.state !== "idle").every(status => status.state === "error")
                ? "No pudimos consultar las fuentes de búsqueda. Inténtalo de nuevo."
                : "No encontramos resultados en TMDB ni en tus fuentes instaladas."
              : "Usa la búsqueda de la barra superior para encontrar películas, series y anime."}
          </p>
        </div>
      )}
    </main>
  );
}

function SearchResultsSections({
  results,
  onOpen,
}: {
  results: UnifiedSearchResult[];
  onOpen: (item: UnifiedSearchResult) => void;
}) {
  const rows = useMemo(() => {
    const movies = results.filter(item => item.type === "movie");
    const series = results.filter(isSeriesResult);
    return [
      { key: "movies", title: "Películas", items: movies },
      { key: "series", title: "Programas de TV", items: series },
    ]
      .filter(row => row.items.length > 0)
      .sort((a, b) => resultScore(b.items[0]) - resultScore(a.items[0]));
  }, [results]);
  const topResults = results.slice(0, TOP_RESULTS_LIMIT);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <section style={{ padding: "0 48px 42px" }}>
        <SectionHead title="Top resultados" inset={false} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 20,
            width: "100%",
          }}
        >
          {topResults.map(item => (
            <TopResultCard key={`top-${item.key}`} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      </section>
      {rows.map(row => (
        <ResultSection key={row.key} title={row.title} items={row.items} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ResultSection({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: UnifiedSearchResult[];
  onOpen: (item: UnifiedSearchResult) => void;
}) {
  return (
    <section>
      <SectionHead title={title} />
      <PosterRow>
        {items.map(item => (
          <PosterResultCard key={`${title}-${item.key}`} item={item} onOpen={() => onOpen(item)} />
        ))}
      </PosterRow>
    </section>
  );
}

function SectionHead({ title, inset = true }: { title: string; inset?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: inset ? "0 48px" : 0, marginBottom: 14 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{title}</h2>
      <ChevronRight size={15} style={{ color: "rgba(255,255,255,0.4)", marginTop: 1 }} />
    </div>
  );
}

function TopResultCard({ item, onOpen }: { item: UnifiedSearchResult; onOpen: () => void }) {
  const poster = item.poster ?? item.background;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 100,
        minWidth: 0,
        borderRadius: 12,
        border: "none",
        background: "rgb(54,54,54)",
        padding: "0 16px",
        textAlign: "left",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <div style={{ width: 48, height: 72, flexShrink: 0, overflow: "hidden", borderRadius: 6, background: "rgba(255,255,255,0.08)" }}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 16, fontWeight: 500, color: "#fff", lineHeight: 1.15 }}>
          {item.name ?? "Sin título"}
        </p>
        <p style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.82)", lineHeight: 1.15 }}>
          {item.mediaLabel}{item.year ? ` · ${item.year}` : ""}
        </p>
      </div>
    </button>
  );
}

function PosterRow({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const row = scrollRef.current;
    if (!row) return;
    setCanScrollLeft(row.scrollLeft > 10);
    setCanScrollRight(row.scrollLeft < row.scrollWidth - row.clientWidth - 10);
  }

  function scheduleScrollState() {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateScrollState();
    });
  }

  useEffect(() => {
    updateScrollState();
    const row = scrollRef.current;
    if (!row) return;
    row.addEventListener("scroll", scheduleScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(row);
    const timer = window.setTimeout(updateScrollState, 120);
    return () => {
      row.removeEventListener("scroll", scheduleScrollState);
      resizeObserver.disconnect();
      window.clearTimeout(timer);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [children]);

  function scroll(direction: "left" | "right") {
    const amount = (POSTER_CARD.width + ROW_GAP) * 3;
    scrollByGsap(scrollRef.current, direction === "right" ? amount : -amount);
  }

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <SearchRowArrow visible={hovered && canScrollLeft} side="left" onClick={() => scroll("left")} />
      <div
        ref={scrollRef}
        className="scroll-row"
        style={{
          display: "flex",
          gap: ROW_GAP,
          overflowX: "auto",
          overflowY: "hidden",
          marginTop: -18,
          padding: "25px 48px 50px",
          scrollbarWidth: "none",
        }}
      >
        {children}
      </div>
      <SearchRowArrow visible={hovered && canScrollRight} side="right" onClick={() => scroll("right")} />
    </div>
  );
}

function SearchRowArrow({
  visible,
  side,
  onClick,
}: {
  visible: boolean;
  side: "left" | "right";
  onClick: () => void;
}) {
  const motionRef = useGsapState<HTMLDivElement>({ opacity: visible ? 1 : 0 }, [visible], 0.45);
  return (
    <div
      ref={motionRef}
      className="liquid-glass-arrow row-arrow-shell"
      style={{
        position: "absolute",
        [side]: 20,
        top: "50%",
        zIndex: 10,
        opacity: 0,
        pointerEvents: visible ? "auto" : "none",
        transform: `translate(${side === "left" ? "-35%" : "35%"}, -50%)`,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={side === "left" ? "Anterior" : "Siguiente"}
        title={side === "left" ? "Anterior" : "Siguiente"}
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
        <svg
          width="18"
          height="30"
          viewBox="0 -0.5 17 17"
          fill="#fff"
          xmlns="http://www.w3.org/2000/svg"
          style={{ transform: side === "left" ? "rotate(180deg)" : undefined, overflow: "visible" }}
        >
          <path
            d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z"
            transform="scale(1.15,1.9) translate(-1.3,-3.5)"
          />
        </svg>
      </button>
    </div>
  );
}

function PosterResultCard({ item, onOpen }: { item: UnifiedSearchResult; onOpen: () => void }) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const poster = item.poster ?? item.background;

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onOpen}
      aria-label={`${item.name ?? "Sin título"}${item.year ? `, ${item.year}` : ""}`}
      style={{
        position: "relative",
        zIndex: 1,
        width: POSTER_CARD.width,
        height: POSTER_CARD.height,
        flex: `0 0 ${POSTER_CARD.width}px`,
        overflow: "hidden",
        borderRadius: 10,
        border: "none",
        background: "#1c1c1e",
        padding: 0,
        cursor: "pointer",
        boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
        willChange: "transform",
      }}
      onMouseEnter={() => {
        tweenTo(cardRef.current, { scale: 1.05, zIndex: 5 }, 0.32);
        gsap.set(cardRef.current, { boxShadow: "0 20px 42px rgba(0,0,0,0.48)" });
      }}
      onMouseLeave={() => {
        tweenTo(cardRef.current, { scale: 1, zIndex: 1 }, 0.32);
        gsap.set(cardRef.current, { boxShadow: "0 12px 28px rgba(0,0,0,0.28)" });
      }}
    >
      {poster ? (
        <img
          src={poster}
          alt={item.name ?? ""}
          loading="lazy"
          decoding="async"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span style={{ display: "grid", height: "100%", placeItems: "center", padding: 18, fontSize: 13, color: "rgba(255,255,255,0.46)" }}>
          {item.name ?? "Sin imagen"}
        </span>
      )}
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <section style={{ padding: "0 48px 42px" }}>
        <SectionHead title="Top resultados" inset={false} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 20 }}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 100, borderRadius: 12 }} />
          ))}
        </div>
      </section>
      {["Películas", "Programas de TV"].map(title => (
        <section key={title}>
          <SectionHead title={title} />
          <PosterRow>
            {Array.from({ length: 7 }, (_, index) => (
              <div
                key={index}
                className="skeleton"
                style={{
                  width: POSTER_CARD.width,
                  height: POSTER_CARD.height,
                  flex: `0 0 ${POSTER_CARD.width}px`,
                  borderRadius: 10,
                }}
              />
            ))}
          </PosterRow>
        </section>
      ))}
    </div>
  );
}

function isSeriesResult(item: UnifiedSearchResult) {
  return item.type === "series" || item.type === "anime" || item.type === "tv";
}

function resultScore(item?: UnifiedSearchResult) {
  return item?.searchScore ?? item?.popularity ?? 0;
}
