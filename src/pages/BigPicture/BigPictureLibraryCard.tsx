import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { MediaItem } from "../../types/ui";
import { buildDetailPath } from "../../utils/bigPictureDetail";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { tweenTo } from "../../utils/motion";
import { getLibraryPoster } from "../Library/libraryLogic";

export default function BigPictureLibraryCard({
  item,
  index,
  itemKey,
  onBeforeOpen,
}: {
  item: MediaItem;
  index: number;
  itemKey?: string;
  onBeforeOpen?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const cardRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const poster = getLibraryPoster(item);
  const type = normalizeType(item.type);

  useEffect(() => setFailed(false), [poster]);

  useEffect(() => {
    const card = cardRef.current;
    const title = titleRef.current;
    if (card) tweenTo(card, active ? { scale: 1.05, y: -3, zIndex: 5 } : { scale: 1, y: 0, zIndex: 1 }, 0.32);
    if (title) tweenTo(title, active ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }, active ? 0.25 : 0.2);
  }, [active]);

  const openDetail = useCallback(() => {
    onBeforeOpen?.();
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster,
      background: item.background,
      logo: item.logo,
      description: item.description,
      year: item.year,
    });
    navigate(buildDetailPath(type, item.id, undefined, location.pathname));
  }, [item, location.pathname, navigate, onBeforeOpen, poster, type]);

  return (
    <div className="bp-library__cell" style={{ ["--bp-library-i" as string]: Math.min(index, 11) }}>
      <button
        ref={cardRef}
        type="button"
        className="bp-library__poster"
        aria-label={`${item.name}${item.year ? `, ${item.year}` : ""}`}
        title={item.name}
        data-library-media-key={itemKey}
        onClick={openDetail}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {poster && !failed ? (
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="bp-library__fallback">{item.name}</span>
        )}
      </button>
      <div ref={titleRef} className="bp-library__poster-title" aria-hidden="true">
        {item.name}
      </div>
    </div>
  );
}

function normalizeType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "tv" || normalized === "show" || normalized === "anime" ? "series" : normalized;
}
