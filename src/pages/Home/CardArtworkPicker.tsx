import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Image as ImageIcon, X } from "lucide-react";
import { tmdbFetch } from "../../config/apiKeys";
import type { MediaItem } from "../../types/ui";
import type { HomeCardArtworkMode } from "../../utils/homeCardArtwork";
import { tweenTo } from "../../utils/motion";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

interface ArtworkOption {
  url: string;
  preview: string;
  label: string;
  score: number;
}

interface CardArtworkPickerProps {
  open: boolean;
  item: MediaItem;
  type: string;
  mode: HomeCardArtworkMode;
  currentUrl?: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}

function directTmdbId(id: string) {
  const match = id.match(/^tmdb:(\d+)$/i);
  if (match) return Number(match[1]);
  return null;
}

function imdbId(id: string) {
  const match = id.match(/^(tt\d+)/i);
  return match?.[1];
}

function tmdbMediaType(type: string) {
  return type === "movie" ? "movie" : "tv";
}

async function resolveTmdbId(item: MediaItem, type: string) {
  const direct = directTmdbId(item.id);
  if (direct) return direct;

  const imdb = imdbId(item.id);
  if (imdb) {
    const result = await tmdbFetch<any>(`/find/${imdb}`, {
      params: { external_source: "imdb_id", language: "es-ES" },
    });
    const values = type === "movie" ? result?.movie_results : result?.tv_results;
    const found = Number(values?.[0]?.id);
    if (Number.isFinite(found) && found > 0) return found;
  }

  const tmdbMediaType = type === "movie" ? "movie" : "tv";
  const searchParams: Record<string, string> = {
    query: item.name,
    language: "es-ES",
  };
  if (item.year) {
    if (tmdbMediaType === "movie") searchParams.year = String(item.year);
    else searchParams.first_air_date_year = String(item.year);
  }
  let result = await tmdbFetch<any>(`/search/${tmdbMediaType}`, { params: searchParams });
  let found = Number(result?.results?.[0]?.id);
  if (Number.isFinite(found) && found > 0) return found;
  if (tmdbMediaType === "tv") {
    result = await tmdbFetch<any>(`/search/movie`, { params: searchParams });
    found = Number(result?.results?.[0]?.id);
    if (Number.isFinite(found) && found > 0) return found;
  }
  return null;
}

function optionFromUrl(url: string | undefined, label: string): ArtworkOption | null {
  if (!url) return null;
  return {
    url,
    preview: url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${TMDB_IMAGE_BASE}/w500/`),
    label,
    score: Number.MAX_SAFE_INTEGER,
  };
}

function uniqueOptions(options: Array<ArtworkOption | null>) {
  const seen = new Set<string>();
  return options.filter((option): option is ArtworkOption => {
    if (!option || seen.has(option.url)) return false;
    seen.add(option.url);
    return true;
  });
}

function imageScore(image: any) {
  const language = image?.iso_639_1;
  const languageScore = language === "es" ? 30 : language === "en" ? 20 : language == null ? 10 : 0;
  return languageScore + Number(image?.vote_average ?? 0) + Math.log10(Number(image?.vote_count ?? 0) + 1);
}

export default function CardArtworkPicker({
  open,
  item,
  type,
  mode,
  currentUrl,
  onSelect,
  onClose,
}: CardArtworkPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<ArtworkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    tweenTo(panelRef.current, { opacity: 1, scale: 1 }, 0.22);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadOptions() {
      setLoading(true);
      setError("");
      const initial = optionFromUrl(currentUrl, "Actual");
      setOptions(uniqueOptions([initial]));

      try {
        const tmdbId = await resolveTmdbId(item, type);
        if (!tmdbId) throw new Error("No se pudo identificar este medio en TMDB.");
        let data = await tmdbFetch<any>(`/${tmdbMediaType(type)}/${tmdbId}/images`, {
          params: { include_image_language: "es,en,null" },
        });
        if (!data && tmdbMediaType(type) === "tv") {
          data = await tmdbFetch<any>(`/movie/${tmdbId}/images`, {
            params: { include_image_language: "es,en,null" },
          });
        }
        const images = mode === "poster" ? data?.posters : mode === "logo" ? data?.logos : data?.backdrops;
        const fetched = (Array.isArray(images) ? images : [])
          .filter(image => typeof image?.file_path === "string")
          .map((image, index): ArtworkOption => ({
            url: `${TMDB_IMAGE_BASE}/original${image.file_path}`,
            preview: `${TMDB_IMAGE_BASE}/${mode === "poster" ? "w342" : mode === "logo" ? "w500" : "w780"}${image.file_path}`,
            label: `TMDB ${index + 1}`,
            score: imageScore(image),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 36);
        if (!cancelled) {
          const merged = uniqueOptions([initial, ...fetched]);
          setOptions(merged);
          if (!merged.length) setError("TMDB no devolvió imágenes para este medio.");
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "No se pudieron cargar las imágenes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOptions();
    return () => { cancelled = true; };
  }, [currentUrl, item, mode, open, type]);

  const title = mode === "poster" ? "Póster de la card" : mode === "logo" ? "Logo de la card" : "Fondo de la card";
  const description = mode === "poster"
    ? "Elige el póster vertical que se mostrará en las rows del Home."
    : mode === "logo"
    ? "Elige el logo que se mostrará en las cards del Home."
    : "Elige el fondo horizontal que se mostrará en las rows del Home.";
  const gridStyle = useMemo(() => mode === "poster"
    ? { gridTemplateColumns: "repeat(auto-fill, minmax(138px, 1fr))" }
    : mode === "logo"
    ? { gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }
    : { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }, [mode]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        background: "rgba(0,0,0,0.66)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <div
        ref={panelRef}
        className="liquid-glass-dark"
        onClick={event => event.stopPropagation()}
        style={{
          width: "min(920px, calc(100vw - 80px))",
          maxHeight: "min(78vh, 680px)",
          overflowY: "auto",
          position: "relative",
          borderRadius: 20,
          padding: 28,
          boxShadow: "0 26px 90px rgba(0,0,0,0.62)",
          opacity: 0,
          transform: "scale(0.985)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar selector"
          style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, border: "none", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.68)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <X size={16} />
        </button>
        <div style={{ paddingRight: 42, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ImageIcon size={18} style={{ color: "rgba(255,255,255,0.72)" }} />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>{title}</h2>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.58)" }}>{item.name} · {description}</p>
        </div>

        {loading && !options.length ? (
          <div style={{ minHeight: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.58)", fontSize: 13 }}>
            Cargando imágenes de TMDB…
          </div>
        ) : null}
        {error ? <p style={{ margin: "0 0 14px", color: "rgba(255,190,190,0.84)", fontSize: 13 }}>{error}</p> : null}
        <div style={{ display: "grid", gap: 12, ...gridStyle }}>
          {options.map((option, index) => {
            const active = option.url === currentUrl;
            return (
              <button
                key={`${option.url}-${index}`}
                type="button"
                onClick={() => onSelect(option.url)}
                style={{
                  position: "relative",
                  aspectRatio: mode === "poster" ? "2 / 3" : "16 / 9",
                  minHeight: mode === "poster" ? 210 : 122,
                  overflow: "hidden",
                  borderRadius: 14,
                  border: active ? "1px solid rgba(255,255,255,0.84)" : "1px solid rgba(255,255,255,0.12)",
                  background: "#151515",
                  padding: 0,
                  cursor: "pointer",
                  boxShadow: active ? "0 0 0 2px rgba(255,255,255,0.14)" : "none",
                }}
              >
                <img src={option.preview} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.72), transparent 46%)" }} />
                <div style={{ position: "absolute", left: 10, right: 10, bottom: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{option.label}</span>
                  {active ? <Check size={16} style={{ color: "#fff", flexShrink: 0 }} /> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
