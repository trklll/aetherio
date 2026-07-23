import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Volume2, VolumeX } from "lucide-react";
import { useMdbListSettings, type MdbListRatings } from "../../config/mdblist.ts";
import type { MediaItem } from "../../types/ui.ts";
import { fetchMdbListRatingsForMedia } from "../../services/MDBListService.ts";
import { sanitizeLogoUrl } from "../../utils/artwork.ts";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata.ts";
import { tmdbImage } from "../../utils/tmdbArtwork.ts";
import { gsap, tweenTo } from "../../utils/motion.ts";
import {
  fetchYouTubeClip,
  getCachedClipInfo,
  getTrailerSkipEnd,
  type YouTubeClipCandidate,
} from "../../services/youtubeClips.ts";
import { useYouTubePlayer } from "../../hooks/useYouTubePlayer.ts";

interface Props {
  item: MediaItem;
  items: MediaItem[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onVideoEnd?: () => void;
}

const START_TIME = 60;

function NeighborCard({ item, onClick, side }: { item: MediaItem; onClick: () => void; side: "left" | "right" }) {
  const bg = tmdbImage(item.background, "w780") ?? "";
  if (!bg) return null;
  return (
    <div
      onClick={onClick}
      className="hero-neighbor"
      style={{
        height: "92%",
        width: "11vw",
        borderRadius: side === "left" ? "0 20px 20px 0" : "20px 0 0 20px",
        overflow: "hidden",
        cursor: "pointer",
        opacity: 0.65,
        filter: "brightness(0.55)",
        transition: "all 0.3s ease",
        position: "absolute",
        top: "4%",
        zIndex: 1,
        left: side === "left" ? "0.2vw" : "auto",
        right: side === "right" ? "0.2vw" : "auto",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "0.9";
        e.currentTarget.style.filter = "brightness(0.8)";
        e.currentTarget.style.transform = "scale(1.02)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "0.65";
        e.currentTarget.style.filter = "brightness(0.55)";
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <img
        src={bg}
        alt=""
        decoding="async"
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "10px",
          background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
          color: "white",
          fontSize: "12px",
          fontWeight: "600",
          transform: "translateY(100%)",
          transition: "transform 0.3s ease",
        }}
        className="neighbor-title"
      >
        {item.name}
      </div>
    </div>
  );
}

export default function HeroSection({ item, items, activeIndex, onSelect, onVideoEnd }: Props) {
  const navigate = useNavigate();
  const mdbListSettings = useMdbListSettings();
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const prevActiveRef = useRef(activeIndex);
  const [displayItem, setDisplayItem] = useState(item);
  const [clipCandidates, setClipCandidates] = useState<YouTubeClipCandidate[]>([]);
  const [clipIndex, setClipIndex] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoEndHandledRef = useRef(false);

  const bg = tmdbImage(displayItem.background, "w1280") ?? "";
  const logo = sanitizeLogoUrl(displayItem.logo);
  const [mdbListRatings, setMdbListRatings] = useState<MdbListRatings | null>(displayItem.mdbListRatings ?? null);

  const clipInfo = clipCandidates[clipIndex] ?? null;
  const { stream, loading: streamLoading, error: streamError } = useYouTubePlayer(
    clipInfo ? clipInfo.videoId : null
  );

  useEffect(() => {
    if (!mdbListSettings.enabled || !mdbListSettings.apiKey.trim()) {
      setMdbListRatings(null);
      return;
    }
    let cancelled = false;
    setMdbListRatings(displayItem.mdbListRatings ?? null);
    if (displayItem.mdbListRatings) return;
    void fetchMdbListRatingsForMedia({
      settings: mdbListSettings,
      mediaType: displayItem.type,
      mediaId: displayItem.id,
      imdbId: displayItem.id,
    }).then(ratings => {
      if (!cancelled) setMdbListRatings(ratings);
    });
    return () => { cancelled = true; };
  }, [displayItem.id, displayItem.type, displayItem.mdbListRatings, mdbListSettings]);

  useEffect(() => {
    setVideoReady(false);
    setClipCandidates([]);
    setClipIndex(0);

    const cached = getCachedClipInfo(displayItem);
    if (cached) {
      setClipCandidates([
        { videoId: cached.videoId, source: cached.source, duration: cached.duration },
        ...(cached.fallbacks ?? []),
      ]);
      return;
    }
    let cancelled = false;
    void fetchYouTubeClip(displayItem).then(result => {
      if (!cancelled && result) {
        setClipCandidates([
          { videoId: result.videoId, source: result.source, duration: result.duration },
          ...(result.fallbacks ?? []),
        ]);
      }
    });
    return () => { cancelled = true; };
  }, [displayItem]);

  useEffect(() => {
    videoEndHandledRef.current = false;
    setIsMuted(true);
  }, [clipInfo?.videoId]);

  useEffect(() => {
    if (!streamError) return;
    setVideoReady(false);
    setClipIndex(index => Math.min(index + 1, Math.max(clipCandidates.length - 1, 0)));
  }, [streamError, clipCandidates.length]);

  // Handle displayItem changes
  useEffect(() => {
    prevActiveRef.current = activeIndex;
    setDisplayItem(item);
  }, [items]);

  // GSAP animations
  useLayoutEffect(() => {
    if (activeIndex === prevActiveRef.current) return;
    const dir = activeIndex > prevActiveRef.current ? 1 : -1;
    prevActiveRef.current = activeIndex;

    const card = cardRef.current;
    if (!card) {
      setDisplayItem(item);
      return;
    }

    gsap.killTweensOf(card);

    gsap.to(card, {
      x: -60 * dir,
      duration: 0.18,
      ease: "power2.in",
      onComplete: () => {
        setDisplayItem(item);
        requestAnimationFrame(() => {
          gsap.set(card, { x: 60 * dir });
          requestAnimationFrame(() => {
            gsap.to(card, {
              x: 0,
              duration: 0.28,
              ease: "power3.out",
            });
          });
        });
      },
    });
  }, [activeIndex, item]);

  const openDetail = () => {
    writeDetailMediaMeta({
      id: displayItem.id,
      type: displayItem.type,
      name: displayItem.name,
      poster: displayItem.poster,
      background: displayItem.background,
      logo: displayItem.logo,
      description: displayItem.description,
      year: displayItem.year,
      mdbListRatings: mdbListRatings ?? displayItem.mdbListRatings,
    });
    navigate(`/detail/${encodeURIComponent(displayItem.type)}/${encodeURIComponent(displayItem.id)}`);
  };

  const hasNeighbors = items.length > 1;
  const prevIndex = hasNeighbors ? (activeIndex - 1 + items.length) % items.length : -1;
  const nextIndex = hasNeighbors ? (activeIndex + 1) % items.length : -1;

  const finishVideo = () => {
    if (videoEndHandledRef.current) return;
    videoEndHandledRef.current = true;
    audioRef.current?.pause();
    setVideoReady(false);
    onVideoEnd?.();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !stream?.hasAudio) return;
    const nextMuted = !isMuted;
    if (stream.audioUrl && audio) {
      video.muted = true;
      audio.muted = nextMuted;
      audio.volume = 0.78;
    } else {
      video.muted = nextMuted;
      if (!nextMuted) video.volume = 0.78;
    }
    setIsMuted(nextMuted);
    const playback = stream.audioUrl && audio ? audio.play() : video.play();
    void playback.catch(() => {
      if (audio) audio.muted = true;
      video.muted = true;
      setIsMuted(true);
    });
  };

  const failCurrentStream = () => {
    setVideoReady(false);
    setClipIndex(index => Math.min(index + 1, Math.max(clipCandidates.length - 1, 0)));
  };

  return (
    <div style={{ position: "relative", flexShrink: 0, paddingBottom: 24, width: "100vw", marginLeft: "-50vw", left: "50%", overflow: "visible" }}>
      <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", height: "clamp(340px, 42vw, 680px)", width: "100%", overflow: "visible" }}>
        {hasNeighbors && prevIndex >= 0 && (
          <NeighborCard item={items[prevIndex]} onClick={() => onSelect(prevIndex)} side="left" />
        )}
        <div
          ref={cardRef}
          style={{ width: "76%", height: "100%", borderRadius: 24, overflow: "hidden", position: "relative", boxShadow: "0 8px 50px rgba(0,0,0,0.65)", minWidth: 0, zIndex: 2 }}
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

          {stream && !streamLoading && (
            <video
              ref={videoRef}
              key={clipInfo ? clipInfo.videoId : "placeholder"}
              src={stream.url}
              autoPlay
              muted={stream.audioUrl ? true : isMuted}
              playsInline
              preload="auto"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
                objectFit: "cover",
                opacity: videoReady ? 1 : 0,
                transition: "opacity 1.5s ease-in-out",
              }}
              onLoadedMetadata={event => {
                const video = event.currentTarget;
                video.muted = stream.audioUrl ? true : isMuted;
                if (!stream.audioUrl && !isMuted) video.volume = 0.78;
                const duration = Number.isFinite(video.duration) ? video.duration : (stream.duration ?? clipInfo?.duration ?? 0);
                const startAt = duration > START_TIME + 20
                  ? START_TIME
                  : Math.max(0, Math.min(12, duration * 0.15));
                if (startAt > 0 && startAt < duration) {
                  video.currentTime = startAt;
                  if (audioRef.current) audioRef.current.currentTime = startAt;
                }
              }}
              onPlaying={event => {
                const audio = audioRef.current;
                if (stream.audioUrl && audio) {
                  if (Math.abs(audio.currentTime - event.currentTarget.currentTime) > 0.2) {
                    audio.currentTime = event.currentTarget.currentTime;
                  }
                  audio.muted = isMuted;
                  audio.volume = 0.78;
                  void audio.play().catch(failCurrentStream);
                }
                setVideoReady(true);
              }}
              onPause={() => audioRef.current?.pause()}
              onEnded={finishVideo}
              onTimeUpdate={event => {
                const skipEnd = clipInfo ? getTrailerSkipEnd(clipInfo.source) : 0;
                const video = event.currentTarget;
                const audio = audioRef.current;
                if (stream.audioUrl && audio && Math.abs(audio.currentTime - video.currentTime) > 0.35) {
                  audio.currentTime = video.currentTime;
                }
                if (skipEnd > 0 && Number.isFinite(video.duration) && video.duration - video.currentTime <= skipEnd) {
                  finishVideo();
                }
              }}
              onError={() => {
                console.warn("[Aetherio:YouTube] El elemento de video rechazo el stream resuelto.");
                failCurrentStream();
              }}
            />
          )}

          {stream?.audioUrl && !streamLoading && (
            <audio
              ref={audioRef}
              key={`${clipInfo?.videoId ?? "placeholder"}-audio`}
              src={stream.audioUrl}
              muted={isMuted}
              preload="auto"
              onCanPlay={event => {
                const video = videoRef.current;
                if (video && Math.abs(event.currentTarget.currentTime - video.currentTime) > 0.2) {
                  event.currentTarget.currentTime = video.currentTime;
                }
              }}
              onError={() => {
                console.warn("[Aetherio:YouTube] La pista de audio fue rechazada; usando el siguiente fallback.");
                failCurrentStream();
              }}
            />
          )}

          {stream && !streamLoading && (
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? "Desmutear escena" : "Mutear escena"}
              title={stream.hasAudio ? (isMuted ? "Desmutear" : "Mutear") : "Este stream no trae audio integrado"}
              disabled={!stream.hasAudio}
              style={{
                position: "absolute",
                top: 18,
                right: 18,
                zIndex: 12,
                width: 42,
                height: 42,
                display: "grid",
                placeItems: "center",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(0,0,0,0.42)",
                color: "rgba(255,255,255,0.92)",
                boxShadow: "0 6px 22px rgba(0,0,0,0.32)",
                backdropFilter: "blur(14px)",
                cursor: stream.hasAudio ? "pointer" : "default",
                opacity: stream.hasAudio ? 1 : 0.42,
              }}
              onMouseEnter={event => {
                if (stream.hasAudio) tweenTo(event.currentTarget, { opacity: 0.86 });
              }}
              onMouseLeave={event => {
                if (stream.hasAudio) tweenTo(event.currentTarget, { opacity: 1 });
              }}
            >
              {isMuted || !stream.hasAudio ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
          )}

          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 25%, transparent 45%, transparent 55%, rgba(0,0,0,0.08) 80%, rgba(0,0,0,0.25) 100%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0.50) 100%)" }} />
          <div
            key={displayItem.id}
            style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 42px 22px 36px", display: "flex", alignItems: "flex-end", zIndex: 11 }}
          >
            <div style={{ maxWidth: 560 }}>
              {logo ? (
                <img
                  src={logo}
                  alt={displayItem.name}
                  decoding="async"
                  style={{ maxHeight: 140, maxWidth: 1024, objectFit: "contain", marginBottom: 8, transformOrigin: "left center", filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.7))" }}
                />
              ) : (
                <h2 style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 4, lineHeight: 1.1 }}>
                  {displayItem.name}
                </h2>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
                {displayItem.genres?.[0] ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                      {displayItem.genres[0]}
                    </span>
                    {(displayItem.year || displayItem.runtime || displayItem.certification) && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
                    )}
                  </>
                ) : null}
                {displayItem.year ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                      {displayItem.year}
                    </span>
                    {(displayItem.runtime || displayItem.certification) && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
                    )}
                  </>
                ) : null}
                {displayItem.runtime ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                      {displayItem.runtime}
                    </span>
                    {displayItem.certification && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
                    )}
                  </>
                ) : null}
                {displayItem.certification && (
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    {displayItem.certification}
                  </span>
                )}
              </div>
              {displayItem.description && (
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.4, marginBottom: 12, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {displayItem.description}
                </p>
              )}
              <button
                onClick={openDetail}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 26px", background: "#fff", color: "#000", fontWeight: 800, borderRadius: 999, fontSize: 14, border: "none", cursor: "pointer", boxShadow: "0 3px 12px rgba(0,0,0,0.38)" }}
                onMouseEnter={event => {
                  tweenTo(event.currentTarget, { opacity: 0.88 });
                }}
                onMouseLeave={event => {
                  tweenTo(event.currentTarget, { opacity: 1 });
                }}
              >
                <Play size={15} fill="black" />
                Reproducir
              </button>
            </div>
          </div>
        </div>
        {hasNeighbors && nextIndex >= 0 && (
          <NeighborCard item={items[nextIndex]} onClick={() => onSelect(nextIndex)} side="right" />
        )}
      </div>
    </div>
  );
}
