/**
 * Color sólido para el tag de horario ("Cada domingo") con el mismo rol que
 * el tag #Hoy de BTTTR: tinte oscuro extraído de la franja superior del
 * póster, como hace btttr con la paleta de la película.
 *
 * - Solo muestrea image.tmdb.org (sirve CORS; cualquier otra fuente teñiría
 *   el canvas y se cae al fallback).
 * - Nunca lanza: ante cualquier duda devuelve null y el llamador usa el
 *   fallback sólido neutro.
 */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function isTmdbImageUrl(url: string | undefined | null): url is string {
  return Boolean(url && /https:\/\/image\.tmdb\.org\/t\/p\//i.test(url));
}

/** Primera URL muestreable entre las candidatas (original TMDB antes que BTTTR). */
export function pickSamplablePosterUrl(...candidates: Array<string | undefined | null>): string | null {
  return candidates.find(isTmdbImageUrl) ?? null;
}

export function getPosterTagColor(url: string | null | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = sampleTopStripColor(url).then(color => {
    if (color) cache.set(url, color);
    inflight.delete(url);
    return color;
  });
  inflight.set(url, task);
  return task;
}

function sampleTopStripColor(url: string): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (color: string | null) => {
      if (settled) return;
      settled = true;
      resolve(color);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const naturalW = img.naturalWidth || 1;
        const naturalH = img.naturalHeight || 1;
        const w = 48;
        const h = Math.max(1, Math.round((w * naturalH) / naturalW));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return finish(null);
        ctx.drawImage(img, 0, 0, w, h);
        // Franja superior (donde vive el tag), 60% central.
        const x0 = Math.floor(w * 0.2);
        const x1 = Math.ceil(w * 0.8);
        const y1 = Math.max(1, Math.floor(h * 0.14));
        const data = ctx.getImageData(x0, 0, Math.max(1, x1 - x0), y1).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (!n) return finish(null);
        // Oscurecer hacia badge (~52%) y garantizar contraste con texto blanco.
        const darken = 0.52;
        let R = (r / n) * darken;
        let G = (g / n) * darken;
        let B = (b / n) * darken;
        const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
        if (lum > 0.3) {
          const k = 0.3 / lum;
          R *= k;
          G *= k;
          B *= k;
        }
        finish(`rgb(${Math.round(R)}, ${Math.round(G)}, ${Math.round(B)})`);
      } catch {
        // Canvas teñido (sin CORS) u otro fallo: fallback sólido.
        finish(null);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    img.src = url;
  });
}
