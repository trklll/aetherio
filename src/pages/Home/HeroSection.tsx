import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Play } from "lucide-react";
import type { MediaItem } from "../../types/ui";
import { sanitizeLogoUrl } from "../../utils/artwork";

interface Props {
  item: MediaItem;
  items: MediaItem[];
  activeIndex: number;
  onSelect: (i: number) => void;
}

export default function HeroSection({ item, items, activeIndex, onSelect }: Props) {
  const navigate = useNavigate();
  const bg = item.background ?? item.poster ?? "";
  const logo = sanitizeLogoUrl(item.logo);
  const typeLabel = item.heroGroup ?? (item.type === "movie" ? "Popular Movies" : item.type === "anime" ? "Animes en emision" : "Popular Series");

  return (
    <div style={{ position: "relative", width: "100vw", left: "50%", marginLeft: "-50vw", height: "calc(88vh + var(--app-shell-nav-height))", minHeight: 560, marginTop: "calc(-1 * var(--app-shell-nav-height))", flexShrink: 0, overflow: "hidden" }}>
      <AnimatePresence initial={false} mode="sync">
        {bg && (
          <motion.img
            key={`${item.id}-${bg}`}
            src={bg}
            alt=""
            decoding="async"
            initial={{ opacity: 0, x: 96, scale: 1.025 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -96, scale: 1.01 }}
            transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
          />
        )}
      </AnimatePresence>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.42) 42%,rgba(0,0,0,0.08) 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top,rgba(31,31,31,1) 0%,rgba(31,31,31,0.62) 20%,rgba(31,31,31,0.08) 55%,transparent 78%)", pointerEvents: "none" }} />

      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, x: 44 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -34 }}
          transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: "absolute", bottom: 0, left: 0, padding: "0 var(--app-safe-x) 36px", maxWidth: 540 }}
        >
          <p style={{ marginBottom: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.58)", letterSpacing: 0, textTransform: "uppercase" }}>{typeLabel}</p>
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
            {(item.rating ?? item.imdbRating) && (
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.64)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 4, padding: "2px 7px" }}>
                {item.rating ?? item.imdbRating}
              </span>
            )}
          </div>
          {item.description && (
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.68)", lineHeight: 1.6, marginBottom: 18, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {item.description}
            </p>
          )}
          <button
            onClick={() => navigate(`/detail/${item.type}/${item.id}`)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 30px", background: "#fff", color: "#000", fontWeight: 800, borderRadius: 999, fontSize: 15, border: "none", cursor: "pointer", boxShadow: "0 3px 12px rgba(0,0,0,0.38)" }}
            onMouseEnter={event => { event.currentTarget.style.opacity = "0.88"; }}
            onMouseLeave={event => { event.currentTarget.style.opacity = "1"; }}
          >
            <Play size={16} fill="black" /> Reproducir
          </button>
        </motion.div>
      </AnimatePresence>

      {items.length > 1 && (
        <div style={{ position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)", display: "flex", gap: 7, alignItems: "center" }}>
          {items.map((entry, i) => (
            <button
              key={`${entry.id}-${i}`}
              onClick={() => onSelect(i)}
              style={{ borderRadius: 999, background: i === activeIndex ? "#fff" : "rgba(255,255,255,0.34)", width: i === activeIndex ? 24 : 7, height: 7, border: "none", cursor: "pointer", transition: "width 0.34s cubic-bezier(0.16,1,0.3,1), background 0.2s", padding: 0 }}
              title={entry.name}
              aria-label={entry.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}
