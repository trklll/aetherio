export interface UpNextMiniRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Fuente única de verdad para la posición/tamaño del mini reproductor de
// UpNext. Se usa tanto en UpNext.tsx (hueco del backdrop + caja) como en
// Player/index.tsx (parámetros video-zoom/align de MPV), de modo que ambos
// lados NUNCA pueden desalinearse, incluso tras cambiar de resolución/DPR.
export function getUpNextMiniRect(): UpNextMiniRect {
  const vw = window.innerWidth;
  const style = getComputedStyle(document.documentElement);
  const safeX = parseFloat(style.getPropertyValue("--app-safe-x")) || 24;
  const safeTop = parseFloat(style.getPropertyValue("--app-safe-top")) || 24;
  // debajo del botón back (32px alto aprox + margen) — con espacio para no pegarlo
  const w = Math.max(340, Math.min(520, vw * 0.28));
  const h = w * (9 / 16);
  return { x: safeX, y: safeTop + 88, w, h };
}
