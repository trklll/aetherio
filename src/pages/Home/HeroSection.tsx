import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { useMdbListSettings, type MdbListRatings } from "../../config/mdblist";
import type { MediaItem, TrailerSource } from "../../types/ui";
import { fetchMdbListRatingsForMedia } from "../../services/MDBListService";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { ensureOriginalTmdbImage } from "../../utils/tmdbArtwork";
import { tweenTo } from "../../utils/motion";
import {
  fetchYouTubeClip,
  getCachedClipInfo,
} from "../../services/youtubeClips";

interface Props {
  item: MediaItem;
}

const START_TIME = 60;

export default function HeroSection({ item }: Props) {
  const navigate = useNavigate();
  const mdbListSettings = useMdbListSettings();
  const [clipInfo, setClipInfo] = useState<{ videoId: string; source: TrailerSource } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [mdbListRatings, setMdbListRatings] = useState<MdbListRatings | null>(null);

  const bg = ensureOriginalTmdbImage(item.background) ?? "";
  const logo = sanitizeLogoUrl(item.logo);

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
    return () => { cancelled = true; };
  }, [item.id, item.type, item.mdbListRatings, mdbListSettings]);

  useEffect(() => {
    setVideoReady(false);
    setClipInfo(null);

    const cached = getCachedClipInfo(item);
    if (cached) {
      setClipInfo({ videoId: cached.videoId, source: cached.source });
      return;
    }
    let cancelled = false;
    void fetchYouTubeClip(item).then(result => {
      if (!cancelled && result) {
        setClipInfo({ videoId: result.videoId, source: result.source });
      }
    });
    return () => { cancelled = true; };
  }, [item]);

  useEffect(() => {
    if (!clipInfo) return;
    const timer = setTimeout(() => setVideoReady(true), 800);
    return () => clearTimeout(timer);
  }, [clipInfo]);

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

  const youtubeSrc = clipInfo
    ? `https://www.youtube.com/embed/${clipInfo.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${clipInfo.videoId}&start=${START_TIME}&rel=0&showinfo=0&iv_load_policy=3&modestbranding=1&playsinline=1`
    : "";

  return (
    <div style={{ flexShrink: 0, paddingBottom: 24, width: "100%", overflow: "hidden" }}>
      <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center", alignItems: "center", height: "clamp(340px, 42vw, 680px)" }}>
        <div
          style={{ position: "relative", width: "88%", height: "100%", borderRadius: 16, overflow: "hidden", flexShrink: 0, zIndex: 1, boxShadow: "0 8px 50px rgba(0,0,0,0.65)" }}
        >
          {bg && (
            <img
              src={bg}
              alt=""
              decoding="async"
              fetchPriority="high"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center top",
                opacity: videoReady ? 0 : 1,
                transition: "opacity 1.5s ease-in-out",
              }}
            />
          )}
          {clipInfo && (
            <iframe
              src={youtubeSrc}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
                pointerEvents: "none",
                opacity: videoReady ? 1 : 0,
                transition: "opacity 1.5s ease-in-out",
              }}
              allow="autoplay; encrypted-media"
              title=""
            />
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 25%, transparent 45%, transparent 55%, rgba(0,0,0,0.08) 80%, rgba(0,0,0,0.25) 100%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0.50) 100%)" }} />
          <div
            key={item.id}
            style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 42px 22px 36px", display: "flex", alignItems: "flex-end" }}
          >
            <div style={{ maxWidth: 560 }}>
              {logo ? (
                <img
                  src={logo}
                  alt={item.name}
                  decoding="async"
                  style={{ maxHeight: 140, maxWidth: 1024, objectFit: "contain", marginBottom: 8, transformOrigin: "left center", filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.7))" }}
                />
              ) : (
                <h2 style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 4, lineHeight: 1.1 }}>
                  {item.name}
                </h2>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
                {item.genres?.[0] ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{item.genres[0]}</span>
                    {(item.year || item.runtime || item.certification) && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>}
                  </>
                ) : null}
                {item.year ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{item.year}</span>
                    {(item.runtime || item.certification) && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>}
                  </>
                ) : null}
                {item.runtime ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{item.runtime}</span>
                    {item.certification && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>}
                  </>
                ) : null}
                {item.certification && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{item.certification}</span>}
              </div>
              {item.description && (
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.4, marginBottom: 12, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {item.description}
                </p>
              )}
              <button
                onClick={openDetail}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 26px", background: "#fff", color: "#000", fontWeight: 800, borderRadius: 999, fontSize: 14, border: "none", cursor: "pointer", boxShadow: "0 3px 12px rgba(0,0,0,0.38)" }}
                onMouseEnter={event => { tweenTo(event.currentTarget, { opacity: 0.88 }); }}
                onMouseLeave={event => { tweenTo(event.currentTarget, { opacity: 1 }); }}
              >
                <Play size={15} fill="black" /> Reproducir
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}