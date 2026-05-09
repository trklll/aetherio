import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { getTmdbApiKey } from "../../config/apiKeys";
import PageContainer from "../../components/layout/PageContainer";

const IMG = "https://image.tmdb.org/t/p";

interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  media_type: "movie" | "tv";
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const initialQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
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

      const tmdbKey = getTmdbApiKey();
      if (!tmdbKey) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(
          `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(normalizedQuery)}&language=es-ES&page=1`
        );
        const json = await response.json();
        if (cancelled) return;
        setResults(
          (json.results ?? [])
            .filter((item: any) => item.media_type === "movie" || item.media_type === "tv")
            .slice(0, 28)
        );
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [normalizedQuery]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    if (!next) return;
    setParams({ q: next });
  }

  function openResult(item: SearchResult) {
    const type = item.media_type === "movie" ? "movie" : "series";
    navigate(`/detail/${type}/tmdb:${item.id}`);
  }

  return (
    <PageContainer fullBleed className="min-h-screen bg-[#1f1f1f] pb-12 pt-28 text-white">
      <form onSubmit={submitSearch} className="mx-auto mb-10 flex max-w-3xl items-center gap-3 rounded-full border border-white/12 bg-white/10 px-4 py-3 backdrop-blur-2xl">
        <Search size={18} className="text-white/58" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/36"
          placeholder="Busca películas, series, anime..."
        />
      </form>

      <div className="mx-auto max-w-7xl">
        <h1 className="mb-5 text-2xl font-bold">{normalizedQuery ? `Resultados para "${normalizedQuery}"` : "Buscar"}</h1>
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
            {Array.from({ length: 10 }, (_, index) => <div key={index} className="skeleton aspect-[2/3] rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
            {results.map(item => {
              const title = item.title ?? item.name ?? "Sin título";
              const year = (item.release_date ?? item.first_air_date ?? "").slice(0, 4);
              const poster = item.poster_path ? `${IMG}/w342${item.poster_path}` : null;

              return (
                <button
                  key={`${item.media_type}:${item.id}`}
                  type="button"
                  onClick={() => openResult(item)}
                  className="group overflow-hidden rounded-xl bg-white/6 text-left transition hover:scale-[1.03]"
                >
                  <div className="aspect-[2/3] bg-white/8">
                    {poster ? <img src={poster} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-bold text-white">{title}</p>
                    <p className="text-xs text-white/48">{item.media_type === "movie" ? "Película" : "Serie"}{year ? ` · ${year}` : ""}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
