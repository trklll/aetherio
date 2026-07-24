import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, X } from "lucide-react";
import clsx from "clsx";
import { useAddonStore } from "../../store/addonStore";
import {
  getActiveProfile,
  getProfileInitial,
  LOCAL_PROFILES_CHANGED_EVENT,
  type LocalProfile,
} from "../../utils/localProfiles";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { searchMedia, type UnifiedSearchResult } from "../../utils/searchProviders";

const NAV_ITEMS = [
  { label: "Inicio", to: "/home", type: null },
  { label: "Biblioteca", to: "/library", type: null },
];

export default function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const addons = useAddonStore(state => state.addons);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UnifiedSearchResult[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [profile, setProfile] = useState<LocalProfile | null>(() => getActiveProfile());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [hovering, setHovering] = useState(false);
  const collapsed = scrolled && !hovering && !searching;

  useEffect(() => {
    function onScroll() {
      const shell = document.querySelector("[data-aetherio-scroll-shell]");
      const el = (shell as HTMLElement) ?? document.scrollingElement ?? document.documentElement;
      const y = el.scrollTop;
      setScrolled(y > 180);
    }
    const shell = document.querySelector("[data-aetherio-scroll-shell]");
    const target = (shell as HTMLElement) ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

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
      const filtered = await searchMedia(q, addons, 6);
      setSuggestions(filtered);
      setShowSugg(filtered.length > 0);
    } catch {
      setSuggestions([]);
      setShowSugg(false);
    }
  }, [addons]);

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

  function handleSuggestion(s: UnifiedSearchResult) {
    writeDetailMediaMeta(s);
    closeSearch();
    navigate(`/detail/${encodeURIComponent(s.type)}/${encodeURIComponent(s.id)}`);
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
    <div
      className="relative z-50 flex items-center justify-center"
      data-tauri-drag-region
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        className={clsx(
          "relative liquid-glass-pill flex items-center min-w-0 gsap-transition",
          collapsed ? "p-1" : "px-2 py-1.5"
        )}
        style={{ boxShadow: "0 3px 14px rgba(0,0,0,0.38)", transition: "padding 0.28s ease, width 0.28s ease" }}
      >
        <button
          onClick={() => {
            closeSearch();
            navigate("/settings?tab=account");
          }}
          className={clsx(
            "rounded-full bg-white flex items-center justify-center shrink-0 hover:scale-105 gsap-transition",
            collapsed ? "w-9 h-9" : "w-8 h-8 mr-2"
          )}
          title="Perfil"
        >
          {profile?.avatarDataUrl ? (
            <img src={profile.avatarDataUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-black font-black text-sm">{getProfileInitial(profile)}</span>
          )}
        </button>

        {!searching && !collapsed && (
          <div className="flex items-center gap-0.5 aetherio-nav-pop">
            {NAV_ITEMS.map(({ label, to }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={clsx(
                  "px-4 py-1.5 rounded-full text-sm font-medium gsap-transition whitespace-nowrap",
                  isActive(to)
                    ? "bg-atv-selected text-white font-semibold"
                    : "text-atv-secondary hover:text-white hover:bg-atv-hover"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {searching && !collapsed && (
          <div className="flex items-center aetherio-nav-pop" style={{ width: 320 }}>
            <Search size={15} className="text-atv-secondary shrink-0 ml-1 mr-2" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Buscar contenido..."
              className="flex-1 bg-transparent text-sm text-white placeholder-atv-secondary focus:outline-none min-w-0"
            />
          </div>
        )}

        {!collapsed && <div className="w-px h-4 bg-white/10 mx-2 shrink-0" />}

        {!collapsed && (
          <div className="flex items-center gap-1 shrink-0">
            {!searching ? (
              <button
                onClick={openSearch}
                className="p-2 rounded-full text-atv-secondary hover:text-white hover:bg-atv-hover gsap-transition"
                title="Buscar"
              >
                <Search size={15} />
              </button>
            ) : (
              <button
                onClick={closeSearch}
                className="p-2 rounded-full text-atv-secondary hover:text-white hover:bg-atv-hover gsap-transition"
                title="Cerrar busqueda"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {searching && showSugg && suggestions.length > 0 && (
        <div
          className="absolute top-[56px] liquid-glass-dark rounded-lg2 overflow-hidden min-w-[320px] aetherio-nav-pop"
          style={{ boxShadow: "0 10px 28px rgba(0,0,0,0.56)" }}
        >
            {suggestions.map((s, i) => {
              const title = s.name ?? "Sin titulo";
              const poster = s.poster ?? s.background;
              return (
                <button
                  key={s.key}
                  onClick={() => handleSuggestion(s)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3 hover:bg-atv-hover gsap-transition text-left",
                    i < suggestions.length - 1 && "border-b border-white/5"
                  )}
                >
                  {poster ? (
                    <img
                      src={poster}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-8 h-12 object-cover rounded"
                    />
                  ) : (
                    <div className="w-8 h-12 bg-atv-surface rounded flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{title}</p>
                    <p className="text-xs text-atv-secondary truncate">
                      {s.mediaLabel}{s.year ? ` · ${s.year}` : ""}{s.sourceName ? ` · ${s.sourceName}` : ""}
                    </p>
                  </div>
                  <Search size={13} className="text-atv-muted shrink-0" />
                </button>
              );
            })}
            <button
              onClick={() => handleSearch()}
              className="w-full px-4 py-3 text-sm text-atv-secondary hover:text-white hover:bg-atv-hover gsap-transition text-left border-t border-white/5"
            >
              Ver todos los resultados de "<span className="text-white">{query}</span>"
            </button>
        </div>
      )}
    </div>
  );
}
