import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { useMdbListSettings, type MdbListRatings } from "../../config/mdblist";
import type { MediaItem } from "../../types/ui";
import { fetchMdbListRatingsForMedia } from "../../services/MDBListService";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { ensureOriginalTmdbImage } from "../../utils/tmdbArtwork";
import { gsap, tweenTo } from "../../utils/motion";

interface Props {
  item: MediaItem;
  items: MediaItem[];
  activeIndex: number;
  onSelect: (i: number) => void;
}

export default function HeroSection({ item, items, activeIndex, onSelect }: Props) {
  const navigate = useNavigate();
  const mdbListSettings = useMdbListSettings();
  const cardRef = useRef<HTMLDivElement>(null);
  const prevActiveRef = useRef(activeIndex);
  const [displayItem, setDisplayItem] = useState(item);

  const bg = ensureOriginalTmdbImage(displayItem.background) ?? "";
  const logo = sanitizeLogoUrl(displayItem.logo);
  const [mdbListRatings, setMdbListRatings] = useState<MdbListRatings | null>(displayItem.mdbListRatings ?? null);

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

    return () => {
      cancelled = true;
    };
  }, [displayItem.id, displayItem.type, displayItem.mdbListRatings, mdbListSettings]);

  useEffect(() => {
    prevActiveRef.current = activeIndex;
    setDisplayItem(item);
  }, [items]);

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

  const prevIndex = items.length > 1 ? (activeIndex - 1 + items.length) % items.length : -1;
  const nextIndex = items.length > 1 ? (activeIndex + 1) % items.length : -1;

  return (
    <div style={{ flexShrink: 0, paddingBottom: 24, width: "100%", overflow: "hidden" }}>
      <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center", alignItems: "center", height: "clamp(340px, 42vw, 680px)", gap: 10 }}>
        {prevIndex >= 0 && (
          <div
            onClick={() => onSelect(prevIndex)}
            style={{ position: "absolute", left: 0, width: "88%", height: "78%", top: "11%", borderRadius: 16, overflow: "hidden", cursor: "pointer", flexShrink: 0 }}
          >
            {ensureOriginalTmdbImage(items[prevIndex].background) && (
              <img src={ensureOriginalTmdbImage(items[prevIndex].background)!} alt="" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
            )}
          </div>
        )}
        <div
          ref={cardRef}
          style={{ position: "relative", width: "88%", height: "100%", borderRadius: 16, overflow: "hidden", flexShrink: 0, zIndex: 1, boxShadow: "0 8px 50px rgba(0,0,0,0.65)" }}
        >
          {bg && (
            <img
              key={`${displayItem.id}-${bg}`}
              src={bg}
              alt=""
              decoding="async"
              fetchPriority="high"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
            />
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 25%, transparent 45%, transparent 55%, rgba(0,0,0,0.08) 80%, rgba(0,0,0,0.25) 100%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0.50) 100%)" }} />
          <div
            key={displayItem.id}
            style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 42px 22px 36px", display: "flex", alignItems: "flex-end" }}
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
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{displayItem.genres[0]}</span>
                    {(displayItem.year || displayItem.runtime || displayItem.certification) && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>}
                  </>
                ) : null}
                {displayItem.year ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{displayItem.year}</span>
                    {(displayItem.runtime || displayItem.certification) && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>}
                  </>
                ) : null}
                {displayItem.runtime ? (
                  <>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{displayItem.runtime}</span>
                    {displayItem.certification && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>}
                  </>
                ) : null}
                {displayItem.certification && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{displayItem.certification}</span>}
              </div>
              {displayItem.description && (
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.4, marginBottom: 12, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {displayItem.description}
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
        {nextIndex >= 0 && (
          <div
            onClick={() => onSelect(nextIndex)}
            style={{ position: "absolute", right: 0, width: "88%", height: "78%", top: "11%", borderRadius: 16, overflow: "hidden", cursor: "pointer", flexShrink: 0 }}
          >
            {ensureOriginalTmdbImage(items[nextIndex].background) && (
              <img src={ensureOriginalTmdbImage(items[nextIndex].background)!} alt="" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
