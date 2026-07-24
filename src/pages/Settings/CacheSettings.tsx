import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { useAddonStore } from "../../store/addonStore";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { searchMedia, type UnifiedSearchResult } from "../../utils/searchProviders";
import { scrollByGsap, useGsapState } from "../../utils/motion";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const addons = useAddonStore(state => state.addons);
  const initialQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const normalizedQuery = useMemo(() => initialQuery.trim(), [initialQuery]);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!normalizedQuery) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const nextResults = await searchMedia(normalizedQuery, addons, 80);
        if (!cancelled) setResults(nextResults);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [normalizedQuery, addons]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    if (!next) return;
    setParams({ q: next });
  }

  function openResult(item: UnifiedSearchResult) {
    writeDetailMediaMeta(item);
    const q = new URLSearchParams({ fromSearch: "1" });
    if (normalizedQuery) q.set("q", normalizedQuery);
    navigate(`/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}?${q.toString()}`);
  }

  return (
    <PageContainer fullBleed className="min-h-screen bg-[#1f1f1f] pb-12 pt-24 text-white">
      <form
        onSubmit={submitSearch}
        className="mx-auto flex items-center gap-3 rounded-full border border-white/70 bg-white/10 px-4 py-3 backdrop-blur-2xl"
        style={{ width: 768, maxWidth: "calc(100vw - 260px)", marginBottom: 34 }}
      >
        <Search size={18} className="text-white/58" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/36"
          placeholder="Busca peliculas, series, anime..."
        />
      </form>

      <div style={{ width: "calc(100vw - 260px)", maxWidth: 1600, margin: "0 auto", minWidth: 0 }}>
        {loading ? (
          <SearchSkeleton />
        ) : results.length ? (
          <SearchResultsSections results={results} onOpen={openResult} />
        ) : (
          <p className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
            {normalizedQuery ? "No se encontraron resultados en TMDB ni en los addons instalados." : "Escribe algo para buscar."}
          </p>
        )}
      </div>
    </PageContainer>
  );
}

function SearchResultsSections({
  results,
  onOpen,
}: {
  results: UnifiedSearchResult[];
  onOpen: (item: UnifiedSearchResult) => void;
}) {
  const series = results.filter(isSeriesResult);
  const movies = results.filter(item => item.type === "movie");
  const topResults = pickTopResults(results);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 42 }}>
      {!!topResults.length && (
        <section>
          <SectionHead title="Top resultados" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 20,
              width: "100%",
            }}
          >
            {topResults.map(item => <TopResultCard key={`top-${item.key}`} item={item} onOpen={() => onOpen(item)} />)}
          </div>
        </section>
      )}

      {!!series.length && (
        <section>
          <SectionHead title="Programas de TV" />
          <PosterRow>
            {series.map(item => <PosterResultCard key={`series-${item.key}`} item={item} onOpen={() => onOpen(item)} />)}
          </PosterRow>
        </section>
      )}

      {!!movies.length && (
        <section>
          <SectionHead title="Películas" />
          <PosterRow>
            {movies.map(item => <PosterResultCard key={`movie-${item.key}`} item={item} onOpen={() => onOpen(item)} />)}
          </PosterRow>
        </section>
      )}
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{title}</h2>
      <ChevronRight size={17} style={{ color: "rgba(255,255,255,0.42)", marginTop: 1 }} />
    </div>
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
    if (!row) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
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
    const row = scrollRef.current;
    if (!row) return;
    scrollByGsap(row, direction === "right" ? row.clientWidth * 0.82 : -row.clientWidth * 0.82);
  }

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <SearchRowArrow visible={hovered && canScrollLeft} side="left" onClick={() => scroll("left")} />
      <div ref={scrollRef} style={{ display: "flex", gap: 20, overflowX: "auto", overflowY: "visible", paddingBottom: 3, scrollbarWidth: "none" }}>
        {children}
      </div>
      <SearchRowFade visible={canScrollLeft} side="left" />
      <SearchRowFade visible={canScrollRight} side="right" />
      <SearchRowArrow visible={hovered && canScrollRight} side="right" onClick={() => scroll("right")} />
    </div>
  );
}

function SearchRowArrow({ visible, side, onClick }: { visible: boolean; side: "left" | "right"; onClick: () => void }) {
  const motionRef = useGsapState<HTMLButtonElement>({ opacity: visible ? 1 : 0 }, [visible], 0.2);
  return (
    <button
      ref={motionRef}
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Anterior" : "Siguiente"}
      title={side === "left" ? "Anterior" : "Siguiente"}
      style={{
        position: "absolute",
        [side]: 0,
        top: "50%",
        zIndex: 10,
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
        opacity: 0,
        pointerEvents: visible ? "auto" : "none",
        transform: `translate(${side === "left" ? "-30%" : "30%"}, -50%)`,
      }}
    >
      {side === "left" ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

function SearchRowFade({ visible, side }: { visible: boolean; side: "left" | "right" }) {
  const motionRef = useGsapState<HTMLDivElement>({ opacity: visible ? 1 : 0 }, [visible], 0.2);
  return (
    <div
      ref={motionRef}
      style={{
        position: "absolute",
        [side]: 0,
        top: 0,
        bottom: 3,
        width: 34,
        zIndex: 5,
        pointerEvents: "none",
        opacity: 0,
        background: side === "left"
          ? "linear-gradient(to right, #1f1f1f 0%, rgba(31,31,31,0) 100%)"
          : "linear-gradient(to left, #1f1f1f 0%, rgba(31,31,31,0) 100%)",
      }}
    />
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
        {poster ? <img src={poster} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 16, fontWeight: 500, color: "#fff", lineHeight: 1.15 }}>{item.name ?? "Sin titulo"}</p>
        <p style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.82)", lineHeight: 1.15 }}>
          {item.mediaLabel}{item.year ? ` - ${item.year}` : ""}{item.sourceName ? ` - ${item.sourceName}` : ""}
        </p>
      </div>
    </button>
  );
}

function PosterResultCard({ item, onOpen }: { item: UnifiedSearchResult; onOpen: () => void }) {
  const poster = item.poster ?? item.background;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        width: 180,
        height: 271,
        flex: "0 0 180px",
        overflow: "hidden",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "#242424",
        padding: 0,
        cursor: "pointer",
      }}
    >
      <div style={{ width: 180, height: 271, background: "rgba(255,255,255,0.06)" }}>
        {poster ? <img src={poster} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      </div>
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 42 }}>
      <section>
        <SectionHead title="Top resultados" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 20 }}>
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton rounded-xl" style={{ height: 100 }} />)}
        </div>
      </section>
      <section>
        <SectionHead title="Programas de TV" />
        <PosterRow>
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-[271px] w-[180px] rounded-xl" />)}
        </PosterRow>
      </section>
    </div>
  );
}

function isSeriesResult(item: UnifiedSearchResult) {
  return item.type === "series" || item.type === "anime" || item.type === "tv";
}

function pickTopResults(results: UnifiedSearchResult[]) {
  const top: UnifiedSearchResult[] = [];
  const series = results.find(isSeriesResult);
  const movie = results.find(item => item.type === "movie");
  if (series) top.push(series);
  if (movie && !top.some(item => item.key === movie.key)) top.push(movie);
  for (const item of results) {
    if (top.length >= 3) break;
    if (!top.some(existing => existing.key === item.key)) top.push(item);
  }
  return top;
}
