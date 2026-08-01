// Logo de una ceremonia de premiaciones con tamaño controlado por props.

import type { CSSProperties } from "react";
import { ceremonyLogo, ceremonyName, type AwardCeremony } from "../../hooks/useAwards";

export function AwardLogo({
  ceremony,
  height = 50,
  maxWidth = 100,
  tone = "default",
  className,
  style,
}: {
  ceremony: AwardCeremony;
  height?: number;
  maxWidth?: number;
  tone?: "default" | "light";
  className?: string;
  style?: CSSProperties;
}) {
  const src = ceremonyLogo(ceremony);
  if (!src) return null;
  return (
    <img
      className={className}
      src={src}
      alt={ceremonyName(ceremony)}
      loading="lazy"
      decoding="async"
      style={{
        height,
        width: "auto",
        maxWidth,
        objectFit: "contain",
        flexShrink: 0,
        ...(tone === "light" ? { filter: "brightness(0) invert(1)" } : {}),
        ...style,
      }}
    />
  );
}
