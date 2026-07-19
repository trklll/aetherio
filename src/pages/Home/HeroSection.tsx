import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { useMdbListSettings, type MdbListRatings } from "../../config/mdblist";
import type { MediaItem } from "../../types/ui";
import { fetchMdbListRatingsForMedia } from "../../services/MDBListService";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { ensureOriginalTmdbImage } from "../../utils/tmdbArtwork";
import { tweenTo } from "../../utils/motion";

interface Props {
  item: MediaItem;
  items: MediaItem[];
  activeIndex: number;
  onSelect: (i: number) => void;
}

export default function HeroSection({ item, items, activeIndex, onSelect }: Props) {
  const navigate = useNavigate();
  const indicatorRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mdbListSettings = useMdbListSettings();
  const [mdbListRatings, setMdbListRatings] = useState<MdbListRatings | null>(item.mdbListRatings ?? null);
  const bg = ensureOriginalTmdbImage(item.background) ?? "";
  const logo = sanitizeLogoUrl(item.logo);

  useEffect(() => {
    indicatorRefs.current.forEach((indicator, index) => {
      tweenTo(indicator, {
        width: index === activeIndex ? 24 : 7,
        backgroundColor: index === activeIndex ? "#fff" : "rgba(255,255,255,0.34)",
      }, 0.32);
    });
  }, [activeIndex, items.length]);
  useEffect(() => {
    if (!mdbListSettings.enabled || !mdbListSettings.apiKey.trim()) {
      setMdbListRatings(null);
      return;
    }

    let cancelled = false;
    setMdbListRatings(item.mdbListRatings ?? null);
    if (item.mdbListRatings) return;
    void fetchMdbListRatingsForMedia({
      settings: mdbListSettings,
      mediaType: item.type,
      mediaId: item.id,
      imdbId: item.id,
    }).then(ratings => {
      if (!cancelled) setMdbListRatings(ratings);
    });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.type, item.mdbListRatings, mdbListSettings]);

  const openDetail = () => {
    writeDetailMediaMeta({
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
      background: item.background,
      logo: item.logo,
      description: item.description,
      year: item.year,
      mdbListRatings: mdbListRatings ?? item.mdbListRatings,
    });
    navigate(`/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`);
  };

  return (
    <div className="home-page-hero" style={{ position: "relative", width: "100vw", left: "50%", marginLeft: "-50vw", height: "calc(88vh + var(--app-shell-nav-height) - 140px)", minHeight: 420, marginTop: "calc(-1 * var(--app-shell-nav-height))", flexShrink: 0, overflow: "hidden" }}>
      {bg && (
        <img
          key={`${item.id}-${bg}`}
          className="aetherio-hero-image"
          src={bg}
          alt=""
          decoding="async"
          fetchPriority="high"
          onAnimationEnd={event => { event.currentTarget.style.willChange = "auto"; }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", willChange: "opacity, transform" }}
        />
      )}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.42) 42%,rgba(0,0,0,0.08) 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top,rgba(31,31,31,1) 0%,rgba(31,31,31,0.62) 20%,rgba(31,31,31,0.08) 55%,transparent 78%)", pointerEvents: "none" }} />

      <div
        key={item.id}
        className="aetherio-hero-content"
        onAnimationEnd={event => { event.currentTarget.style.willChange = "auto"; }}
        style={{ position: "absolute", bottom: 0, left: 0, padding: "0 var(--app-safe-x) 36px", maxWidth: 540, willChange: "opacity, transform" }}
      >
          <p style={{ marginBottom: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.58)", letterSpacing: 0 }}></p>
          {logo ? (
            <img
              src={logo}
              alt={item.name}
              decoding="async"
              style={{ maxHeight: 104, maxWidth: 330, objectFit: "contain", marginBottom: 14, filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.72))" }}
            />
          ) : (
            <div style={{ minHeight: 86, marginBottom: 14 }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {item.year && <span style={{ fontSize: 14, color: "rgba(255,255,255,0.62)" }}>{item.year}</span>}
            {item.genres?.slice(0, 2).map(g => <span key={g} style={{ fontSize: 14, color: "rgba(255,255,255,0.54)" }}>· {g}</span>)}
          </div>
          {item.description && (
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.68)", lineHeight: 1.6, marginBottom: 18, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {item.description}
            </p>
          )}
          <button
            onClick={openDetail}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 30px", background: "#fff", color: "#000", fontWeight: 800, borderRadius: 999, fontSize: 15, border: "none", cursor: "pointer", boxShadow: "0 3px 12px rgba(0,0,0,0.38)" }}
            onMouseEnter={event => { tweenTo(event.currentTarget, { opacity: 0.88 }); }}
            onMouseLeave={event => { tweenTo(event.currentTarget, { opacity: 1 }); }}
          >
            <Play size={16} fill="black" /> Reproducir
          </button>
      </div>

      {items.length > 1 && (
        <div style={{ position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)", display: "flex", gap: 7, alignItems: "center" }}>
          {items.map((entry, i) => (
            <button
              key={`${entry.id}-${i}`}
              ref={element => { indicatorRefs.current[i] = element; }}
              onClick={() => onSelect(i)}
              style={{ borderRadius: 999, background: "rgba(255,255,255,0.34)", width: 7, height: 7, border: "none", cursor: "pointer", padding: 0 }}
              title={entry.name}
              aria-label={entry.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}
