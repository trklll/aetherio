import type { CSSProperties } from "react";

export const CONTEXT_GLASS_STYLE: CSSProperties = {
  border: "1px solid rgba(225,230,238,0.09)",
  background: "linear-gradient(135deg, rgba(64,64,64,0.72), rgba(28,28,30,0.82))",
  backdropFilter: "blur(22px) saturate(180%)",
  WebkitBackdropFilter: "blur(22px) saturate(180%)",
  boxShadow: "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
};
