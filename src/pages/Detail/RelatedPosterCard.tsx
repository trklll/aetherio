import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { animateDetailCardFocus } from "./detailFocus";
import { tweenTo } from "../../utils/motion";

// Card de "Más como esto": idéntica a la card vertical del Home
// (VERTICAL_CARD de CatalogRow: 217x326). Al pasar el cursor la card escala
// como en Home y el nombre aparece debajo con la misma animación.
export const RELATED_CARD_SIZE = { width: 217, height: 326 };

interface RelatedPosterCardProps {
  name: string;
  poster?: string;
  completed?: boolean;
  bigPicture?: boolean;
  onOpen: () => void;
}

export default function RelatedPosterCard({ name, poster, completed = false, bigPicture = false, onOpen }: RelatedPosterCardProps) {
  const [hovered, setHovered] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);

  const enterCard = (target: HTMLDivElement) => {
    setHovered(true);
    animateDetailCardFocus(target, true);
  };
  const leaveCard = (target: HTMLDivElement) => {
    setHovered(false);
    animateDetailCardFocus(target, false);
  };

  // Aparición/ocultación del nombre, igual que el título bajo la card del Home.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    if (hovered) {
      tweenTo(el, { opacity: 1, y: 0 }, 0.25);
    } else {
      tweenTo(el, { opacity: 0, y: 8 }, 0.2);
    }
  }, [hovered]);

  return (
    <div style={{ flexShrink: 0, width: RELATED_CARD_SIZE.width }}>
      <div
        className="media-card-frame"
        onClick={onOpen}
        tabIndex={bigPicture ? 0 : undefined}
        role={bigPicture ? "button" : undefined}
        aria-label={bigPicture ? name : undefined}
        onKeyDown={bigPicture ? (event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }) : undefined}
        onFocus={bigPicture ? event => enterCard(event.currentTarget) : undefined}
        onBlur={bigPicture ? event => leaveCard(event.currentTarget) : undefined}
        style={{ position: "relative", zIndex: 1, width: RELATED_CARD_SIZE.width, height: RELATED_CARD_SIZE.height, borderRadius: 12, overflow: "hidden", cursor: "pointer", background: "#1c1c1e", border: "1px solid rgba(225,230,238,0.10)" }}
        onMouseEnter={event => enterCard(event.currentTarget)}
        onMouseLeave={event => leaveCard(event.currentTarget)}
      >
        {completed ? (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 2,
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.72)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(242,244,247,0.88))",
              boxShadow: "0 10px 24px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.92)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check size={15} style={{ color: "rgba(16,18,20,0.94)" }} />
          </div>
        ) : null}
        {poster ? (
          <img src={poster} alt={name} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1)" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "#2c2c2e" }} />
        )}
      </div>
      <div
        ref={titleRef}
        style={{
          marginTop: 10,
          opacity: 0,
          transform: "translateY(4px)",
          fontSize: 13,
          fontWeight: 500,
          color: "#fff",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: RELATED_CARD_SIZE.width,
          padding: "0 2px",
        }}
      >
        {name}
      </div>
    </div>
  );
}
