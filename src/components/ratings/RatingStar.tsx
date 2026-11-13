import type { CSSProperties } from "react";
import { Star } from "lucide-react";
import "./RatingStar.css";

export default function RatingStar({ fill, size = 24 }: { fill: number; size?: number }) {
  const percentage = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <span
      className="aetherio-rating-star"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        "--rating-star-fill": `${percentage}%`,
      } as CSSProperties}
      >
      <Star className="aetherio-rating-star__outline" strokeWidth={2.15} />
      <span className="aetherio-rating-star__fill">
        <Star strokeWidth={2.15} />
      </span>
    </span>
  );
}
