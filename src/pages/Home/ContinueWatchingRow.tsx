import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  CONTINUE_WATCHING_EVENT,
  formatResumeTime,
  getContinueWatchingRows,
  progressPercent,
  type ContinueWatchingEntry,
} from "../../utils/continueWatching";
import { sanitizeLogoUrl } from "../../utils/artwork";

const CARD_W = 302;
const CARD_H = 196;
const GAP = 10;

export default function ContinueWatchingRow() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ContinueWatchingEntry[]>(() => getContinueWatchingRows());

  useEffect(() => {
    const refresh = () => setItems(getContinueWatchingRows());
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!items.length) return null;

  function resume(entry: ContinueWatchingEntry) {
    const q = new URLSearchParams({ type: entry.type, id: entry.id });
    if (entry.season) q.set("season", String(entry.season));
    if (entry.episode) q.set("ep", String(entry.episode));
    navigate(`/streams?${q.toString()}`);
  }

  return (
    <section style={{ paddingLeft: 48, paddingRight: 48, paddingTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Continuar viendo</span>
      </div>
      <div
        ref={scrollRef}
        style={{ display: "flex", gap: GAP, overflowX: "auto", overflowY: "visible", paddingBottom: 12, scrollbarWidth: "none" }}
      >
        {items.map(entry => (
          <ContinueCard key={entry.key} entry={entry} onClick={() => resume(entry)} />
        ))}
      </div>
    </section>
  );
}

function ContinueCard({ entry, onClick }: { entry: ContinueWatchingEntry; onClick: () => void }) {
  const image = entry.background ?? entry.poster ?? "";
  const logo = sanitizeLogoUrl(entry.logo);
  const episodeLabel = entry.season && entry.episode
    ? `T${entry.season} E${entry.episode}${entry.episodeName ? ` - ${entry.episodeName}` : ""}`
    : "Pelicula";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        flexShrink: 0,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.25s, box-shadow 0.25s",
        background: "#1c1c1e",
        border: "none",
        padding: 0,
        textAlign: "left",
      }}
      onMouseEnter={event => {
        event.currentTarget.style.transform = "scale(1.04)";
        event.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.7)";
      }}
      onMouseLeave={event => {
        event.currentTarget.style.transform = "scale(1)";
        event.currentTarget.style.boxShadow = "none";
      }}
    >
      {image && <img src={image} alt={entry.name} loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.18) 58%, transparent 100%)" }} />
      <div style={{ position: "absolute", left: 10, top: 10, display: "flex", height: 34, width: 34, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.92)", color: "#000", boxShadow: "0 10px 28px rgba(0,0,0,0.45)" }}>
        <Play size={16} fill="black" />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 10px 11px" }}>
        {logo ? (
          <img src={logo} alt={entry.name} style={{ maxHeight: 28, maxWidth: 140, objectFit: "contain", filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.95))", marginBottom: 6 }} />
        ) : (
          <span style={{ display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 14, fontWeight: 700, color: "#fff", textShadow: "0 1px 8px rgba(0,0,0,0.95)" }}>
            {entry.name}
          </span>
        )}
        <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.58)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {episodeLabel} - {formatResumeTime(entry.currentTime)}
        </div>
        <div style={{ marginTop: 8, height: 3, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,0.22)" }}>
          <div style={{ width: `${progressPercent(entry)}%`, height: "100%", background: "#fff", borderRadius: 999 }} />
        </div>
      </div>
    </button>
  );
}
