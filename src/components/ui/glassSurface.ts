import type { CSSProperties } from "react";

export const CONTEXT_GLASS_STYLE: CSSProperties = {
  border: "1px solid rgba(225,230,238,0.09)",
  background: "linear-gradient(135deg, rgba(64,64,64,0.72), rgba(28,28,30,0.82))",
  backdropFilter: "blur(22px) saturate(180%)",
  WebkitBackdropFilter: "blur(22px) saturate(180%)",
  boxShadow: "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
  willChange: "transform, opacity, backdrop-filter",
};

// §14 — reduced-transparency: solid fallback, no blur
export function getContextGlassStyle(): CSSProperties {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) {
    return {
      border: "1px solid rgba(225,230,238,0.14)",
      background: "rgba(28,28,30,0.96)",
      backdropFilter: "none",
      WebkitBackdropFilter: "none",
      boxShadow: "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
      willChange: "transform, opacity",
    };
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-contrast: more)").matches) {
    return {
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(18,18,20,0.98)",
      backdropFilter: "blur(12px) saturate(140%)",
      WebkitBackdropFilter: "blur(12px) saturate(140%)",
      boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)",
      willChange: "transform, opacity, backdrop-filter",
    };
  }
  return CONTEXT_GLASS_STYLE;
}
