import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Puzzle, Settings } from "lucide-react";
import clsx from "clsx";
import { getTmdbApiKey } from "../../config/apiKeys";
import {
  getActiveProfile,
  getProfileInitial,
  LOCAL_PROFILES_CHANGED_EVENT,
  type LocalProfile,
} from "../../utils/localProfiles";

const NAV_ITEMS = [
  { label: "Inicio", to: "/home", type: null },
  { label: "Peliculas", to: "/home?type=movie", type: "movie" },
  { label: "Series", to: "/home?type=series", type: "series" },
  { label: "Anime", to: "/home?type=anime", type: "anime" },
  { label: "Biblioteca", to: "/library", type: null },
];

interface Suggestion {
  id: number;
  title: string;
  media_type: "movie" | "tv";
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
}

export default function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [profile, setProfile] = useState<LocalProfile | null>(() => getActiveProfile());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = (to: string) => {
    const [path, qs] = to.split("?");
    const params = new URLSearchParams(qs ?? "");
    const type = params.get("type");
    const curParams = new URLSearchParams(location.search);
    const curType = curParams.get("type");
    if (location.pathname !== path) return false;
    if (type) return curType === type;
    return !curType;
  };

  function openSearch() {
    setSearching(true);
    setTimeout(() => inputRef.current?.focus(), 300);
  }

  function closeSearch() {
    setSearching(false);
    setQuery("");
    setSuggestions([]);
    setShowSugg(false);
  }

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      setShowSugg(false);
      return;
    }
    try {
      const tmdbKey = getTmdbApiKey();
      if (!tmdbKey) {
        setSuggestions([]);
        setShowSugg(false);
        return;
      }
      const res = await fetch(
        `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&language=es-ES&page=1`
      );
      const data = await res.json();
      const filtered = (data.results ?? [])
        .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 6);
      setSuggestions(filtered);
      setShowSugg(filtered.length > 0);
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleInput(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 280);
  }

  function handleSearch(q = query) {
    if (!q.trim()) return;
    setShowSugg(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  function handleSuggestion(s: Suggestion) {
    const type = s.media_type === "movie" ? "movie" : "series";
    const id = `tmdb:${s.id}`;
    closeSearch();
    navigate(`/detail/${type}/${id}`);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSearch();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const refresh = () => setProfile(getActiveProfile());
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div className="relative z-50 flex items-center justify-center" data-tauri-drag-region>
      <div
        className="relative liquid-glass-pill px-2 py-1.5 flex items-center min-w-0"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }}
      >
        <button
          onClick={() => {
            closeSearch();
            navigate("/settings?tab=profile");
          }}
          className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 mr-2 hover:scale-105 transition-transform"
          title="Perfil"
        >
          {profile?.avatarDataUrl ? (
            <img src={profile.avatarDataUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-black font-black text-sm">{getProfileInitial(profile)}</span>
          )}
        </button>

        <AnimatePresence>
          {!searching && (
            <motion.div
              className="flex items-center gap-0.5"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              {NAV_ITEMS.map(({ label, to }) => (
                <button
                  key={to}
                  onClick={() => navigate(to)}
                  className={clsx(
                    "px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap",
                    isActive(to)
                      ? "bg-atv-selected text-white font-semibold"
                      : "text-atv-secondary hover:text-white hover:bg-atv-hover"
                  )}
                >
                  {label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {searching && (
            <motion.div
              className="flex items-center"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 320 }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <Search size={15} className="text-atv-secondary shrink-0 ml-1 mr-2" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => handleInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Buscar peliculas, series, anime..."
                className="flex-1 bg-transparent text-sm text-white placeholder-atv-secondary focus:outline-none min-w-0"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-px h-4 bg-white/10 mx-2 shrink-0" />

        <div className="flex items-center gap-1 shrink-0">
          {!searching ? (
            <button
              onClick={openSearch}
              className="p-2 rounded-full text-atv-secondary hover:text-white hover:bg-atv-hover transition-all duration-200"
            >
              <Search size={15} />
            </button>
          ) : (
            <button
              onClick={closeSearch}
              className="p-2 rounded-full text-atv-secondary hover:text-white hover:bg-atv-hover transition-all duration-200"
            >
              <X size={15} />
            </button>
          )}
          <button
            onClick={() => {
              closeSearch();
              navigate("/addons");
            }}
            className="p-2 rounded-full text-atv-secondary hover:text-white hover:bg-atv-hover transition-all duration-200"
            title="Add-ons"
          >
            <Puzzle size={15} />
          </button>
          <button
            onClick={() => {
              closeSearch();
              navigate("/settings");
            }}
            className="p-2 rounded-full text-atv-secondary hover:text-white hover:bg-atv-hover transition-all duration-200"
            title="Ajustes"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {searching && showSugg && suggestions.length > 0 && (
          <motion.div
            className="absolute top-[56px] liquid-glass-dark rounded-lg2 overflow-hidden min-w-[320px]"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
          >
            {suggestions.map((s, i) => {
              const title = s.title ?? (s as any).name ?? "";
              const year = (s.release_date ?? s.first_air_date ?? "").slice(0, 4);
              const typeLabel = s.media_type === "movie" ? "Pelicula" : "Serie";
              return (
                <button
                  key={s.id}
                  onClick={() => handleSuggestion(s)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3 hover:bg-atv-hover transition-colors text-left",
                    i < suggestions.length - 1 && "border-b border-white/5"
                  )}
                >
                  {s.poster_path ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w92${s.poster_path}`}
                      alt=""
                      className="w-8 h-12 object-cover rounded"
                    />
                  ) : (
                    <div className="w-8 h-12 bg-atv-surface rounded flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{title}</p>
                    <p className="text-xs text-atv-secondary">{typeLabel}{year ? ` · ${year}` : ""}</p>
                  </div>
                  <Search size={13} className="text-atv-muted shrink-0" />
                </button>
              );
            })}
            <button
              onClick={() => handleSearch()}
              className="w-full px-4 py-3 text-sm text-atv-secondary hover:text-white hover:bg-atv-hover transition-colors text-left border-t border-white/5"
            >
              Ver todos los resultados de "<span className="text-white">{query}</span>"
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
