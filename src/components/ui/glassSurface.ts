import type { CSSProperties } from "react";

// Mismo material que la pill de la TopNav (.liquid-glass-pill en index.css)
// y que la sidebar/rail en modo Big Picture: todos los menús contextuales
// (cards, player, diálogos) comparten este vidrio en ambas vistas.
export const CONTEXT_GLASS_STYLE: CSSProperties = {
  border: "1px solid rgba(225,230,238,0.09)",
  background: "rgba(255,255,255,0.12)",
  backdropFilter: "blur(48px) saturate(175%)",
  WebkitBackdropFilter: "blur(48px) saturate(175%)",
  boxShadow: "0 3px 14px rgba(0,0,0,0.38)",
  willChange: "transform, opacity, backdrop-filter",
};

// §14 — los fallbacks aproximan en sólido el mismo vidrio claro (el blur
// sobre fondo oscuro ≈ gris medio): si fueran oscuros, con la transparencia
// del SO desactivada el menú se vería negro junto al rail claro.
export function getContextGlassStyle(): CSSProperties {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) {
    return {
      border: "1px solid rgba(225,230,238,0.14)",
      background: "rgba(52,52,56,0.97)",
      backdropFilter: "none",
      WebkitBackdropFilter: "none",
      boxShadow: "0 3px 14px rgba(0,0,0,0.38)",
      willChange: "transform, opacity",
    };
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-contrast: more)").matches) {
    return {
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(40,40,44,0.98)",
      backdropFilter: "blur(12px) saturate(140%)",
      WebkitBackdropFilter: "blur(12px) saturate(140%)",
      boxShadow: "0 3px 14px rgba(0,0,0,0.5)",
      willChange: "transform, opacity, backdrop-filter",
    };
  }
  return CONTEXT_GLASS_STYLE;
}
