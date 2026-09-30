import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invokeCommand } from "../../../runtime/platform";
import {
  buildSeekrLookupPath,
  createSeekrTrack,
  findSeekrCueIndex,
  parseSeekrVtt,
  seekrTimelineMsForPosition,
  stepSeekrOffsetMs,
  type SeekrContent,
  type SeekrPreviewCue,
  type SeekrTrack,
} from "./seekr";
import { seekrLog, seekrWarn, stamp } from "./seekrDebug";

interface SeekrLoadResponse {
  vtt: string;
  scale: number;
  sourceDurationMs: number;
}

interface SeekrSpriteResponse {
  base64: string;
  mimeType: string;
}

export interface SeekrPreviewFrame {
  cueStartTimeMs: number;
  dataUrl: string;
}

export interface SeekrPreviewFrames {
  previous: SeekrPreviewFrame | null;
  center: SeekrPreviewFrame | null;
  next: SeekrPreviewFrame | null;
}

interface UseSeekrPreviewOptions {
  apiKey: string;
  content: SeekrContent | null;
  durationMs: number;
  enabled: boolean;
}

type SeekrImage = ImageBitmap | HTMLImageElement;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeImage(dataUrl: string): Promise<SeekrImage> {
  if (typeof createImageBitmap === "function") {
    const blob = dataUrlToBlob(dataUrl);
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo decodificar el sprite de Seekr."));
    image.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",", 2);
  const mimeType = header.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  return new Blob([decodeBase64(payload)], { type: mimeType });
}

function imageSize(image: SeekrImage): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return { width: image.width, height: image.height };
}

async function cropCue(image: SeekrImage, cue: SeekrPreviewCue): Promise<string> {
  const size = imageSize(image);
  const x = Math.max(0, Math.min(cue.x, Math.max(0, size.width - 1)));
  const y = Math.max(0, Math.min(cue.y, Math.max(0, size.height - 1)));
  const sourceWidth = Math.max(1, Math.min(cue.width, size.width - x));
  const sourceHeight = Math.max(1, Math.min(cue.height, size.height - y));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar el preview de Seekr.");
  context.drawImage(image, x, y, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function emptyFrames(): SeekrPreviewFrames {
  return { previous: null, center: null, next: null };
}

// Cache de hojas de sprites a nivel de modulo, no de componente: asi sobrevive a
// remontajes del reproductor (cambio de pestana, big picture, re-render de
// controles) y no vuelve a pegarle a la CDN ni a la API para el mismo sprite.
const sheetCache = new Map<string, Promise<SeekrImage>>();
const SHEET_CACHE_MAX = 24;

function closeImage(image: SeekrImage) {
  if ("close" in image && typeof image.close === "function") image.close();
}

function getSheet(url: string): Promise<SeekrImage> {
  const cached = sheetCache.get(url);
  if (cached) return cached;
  const pending = invokeCommand<SeekrSpriteResponse>("seekr_fetch_sprite", { url })
    .then(response => decodeImage(`data:${response.mimeType};base64,${response.base64}`))
    .catch(error => {
      // Un fallo no debe quedar cacheado para siempre: se reintenta al proximo hover.
      sheetCache.delete(url);
      throw error;
    });
  sheetCache.set(url, pending);
  if (sheetCache.size > SHEET_CACHE_MAX) {
    const oldest = sheetCache.keys().next();
    if (!oldest.done) {
      const evicted = sheetCache.get(oldest.value);
      sheetCache.delete(oldest.value);
      if (evicted) void evicted.then(closeImage).catch(() => undefined);
    }
  }
  return pending;
}

export function useSeekrPreview({ apiKey, content, durationMs, enabled }: UseSeekrPreviewOptions) {
  const [track, setTrack] = useState<SeekrTrack | null>(null);
  const [frames, setFrames] = useState<SeekrPreviewFrames>(emptyFrames);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const trackRef = useRef<SeekrTrack | null>(null);
  const requestIdRef = useRef(0);
  const frameKeyRef = useRef("");
  const offsetRef = useRef(0);
  const lastPositionRef = useRef(0);
  const contentKey = content ? JSON.stringify(content) : "";
  // La duracion que mpv reporta puede refilarse unos milisegundos segun va
  // leyendo el contenedor. Como duration_ms va dentro del lookup, cada matiz
  // regeneraba la URL y disparaba otra consulta a /sprites. Cuantizamos al
  // segundo: el matched de la API no depende de milisegundos y asi una sola
  // peticion por bucke de duracion.
  const durationBucketMs = durationMs > 0 ? Math.round(durationMs / 1000) * 1000 : 0;
  const lookupPath = useMemo(
    () => content && durationBucketMs > 0 ? buildSeekrLookupPath(content, durationBucketMs) : "",
    [content, contentKey, durationBucketMs],
  );

  useEffect(() => {
    trackRef.current = null;
    frameKeyRef.current = "";
    offsetRef.current = 0;
    lastPositionRef.current = 0;
    setOffsetMs(0);
    setTrack(null);
    setFrames(emptyFrames());
    setAvailable(false);
    seekrLog("arrancando", {
      enabled,
      hayClave: Boolean(apiKey),
      lookupPath: lookupPath || "(vacio)",
      duracionMs: durationMs,
      contenido: content ? `${content.kind}` : "sin titulo",
      pista: content ? JSON.stringify(content) : "(ninguna)",
    });
    if (!enabled || !apiKey || !lookupPath) {
      const motivos: string[] = [];
      if (!enabled) motivos.push(durationMs > 0 ? "reproductor bloqueado (party)" : "duracion 0 o transporte bloqueado");
      if (!apiKey) motivos.push("sin clave");
      if (!lookupPath) {
        motivos.push(!content
          ? "el reproductor no tiene titulo con id de catalogo"
          : "duracion desconocida");
      }
      seekrWarn("no se consulta nada", { motivos });
      setLoading(false);
      return;
    }

    const generation = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    const startedAt = performance.now();
    void invokeCommand<SeekrLoadResponse>("seekr_load_track", { apiKey, lookupPath })
      .then(response => {
        if (cancelled || generation !== requestIdRef.current) return;
        const nextTrack = createSeekrTrack(
          parseSeekrVtt(response.vtt),
          response.scale,
          response.sourceDurationMs,
        );
        if (!nextTrack.cues.length) {
          seekrWarn("la API no devolvio previews utilizables", {
            lookupPath,
            vttBytes: response.vtt?.length ?? 0,
            cues: 0,
            ms: Math.round(performance.now() - startedAt),
          });
          throw new Error("Seekr no devolvio previews utilizables.");
        }
        trackRef.current = nextTrack;
        setTrack(nextTrack);
        setAvailable(true);
        seekrLog("pista lista", {
          cues: nextTrack.cues.length,
          escala: nextTrack.scale,
          duracionOrigen: stamp(nextTrack.sourceDurationMs),
          hojas: nextTrack.sheetUrls.length,
          primerCue: stamp(nextTrack.cues[0].startTimeMs),
          ultimoCue: stamp(nextTrack.cues[nextTrack.cues.length - 1].startTimeMs),
          ms: Math.round(performance.now() - startedAt),
        });
      })
      .catch(error => {
        if (!cancelled && generation === requestIdRef.current) {
          trackRef.current = null;
          setTrack(null);
          setFrames(emptyFrames());
          setAvailable(false);
          seekrWarn("fallo la consulta (preview desactivado)", {
            lookupPath,
            error: String(error).slice(0, 200),
          });
        }
      })
      .finally(() => {
        if (!cancelled && generation === requestIdRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, content, durationMs, enabled, lookupPath]);

  const loadFrame = useCallback(async (cue: SeekrPreviewCue): Promise<SeekrPreviewFrame> => {
    const image = await getSheet(cue.sheetUrl);
    return {
      cueStartTimeMs: cue.startTimeMs,
      dataUrl: await cropCue(image, cue),
    };
  }, []);

  const loadFrames = useCallback(async (positionSeconds: number) => {
    const activeTrack = trackRef.current;
    if (!activeTrack?.cues.length) return;
    lastPositionRef.current = positionSeconds;
    // La barra da SEGUNDOS y los cues de Seekr vienen en MILISEGUNDOS. Sin esta
    // conversion la posicion siempre cae dentro del primer cue y el preview se
    // queda clavado en el inicial durante toda la pelicula.
    const timelineMs = seekrTimelineMsForPosition(positionSeconds, offsetRef.current, activeTrack.scale);
    const coveringIndex = findSeekrCueIndex(activeTrack.cues, timelineMs);
    if (coveringIndex < 0) return;
    const covering = activeTrack.cues[coveringIndex];
    // El punto medio va en milisegundos: se compara contra timelineMs, no contra
    // los segundos de la barra.
    const midpoint = covering.startTimeMs + (covering.endTimeMs - covering.startTimeMs) / 2;
    const centerIndex = timelineMs > midpoint && coveringIndex + 1 < activeTrack.cues.length
      ? coveringIndex + 1
      : coveringIndex;
    const previousIndex = Math.max(0, centerIndex - 1);
    const nextIndex = Math.min(activeTrack.cues.length - 1, centerIndex + 1);
    const frameKey = `${activeTrack.cues[previousIndex].startTimeMs}|${activeTrack.cues[centerIndex].startTimeMs}|${activeTrack.cues[nextIndex].startTimeMs}`;
    if (frameKey === frameKeyRef.current) return;
    frameKeyRef.current = frameKey;
    const generation = ++requestIdRef.current;
    setLoading(true);
    seekrLog("recortando fotogramas", {
      posicion: stamp(positionSeconds * 1000),
      centro: stamp(activeTrack.cues[centerIndex].startTimeMs),
      anterior: activeTrack.cues[previousIndex].startTimeMs === activeTrack.cues[centerIndex].startTimeMs
        ? "mismo cue"
        : stamp(activeTrack.cues[previousIndex].startTimeMs),
      siguiente: activeTrack.cues[nextIndex].startTimeMs === activeTrack.cues[centerIndex].startTimeMs
        ? "mismo cue"
        : stamp(activeTrack.cues[nextIndex].startTimeMs),
      escala: activeTrack.scale,
      correccion: `${offsetRef.current / 1000}s`,
    });
    try {
      const [previous, center, next] = await Promise.all([
        loadFrame(activeTrack.cues[previousIndex]),
        loadFrame(activeTrack.cues[centerIndex]),
        loadFrame(activeTrack.cues[nextIndex]),
      ]);
      if (generation !== requestIdRef.current) return;
      setFrames({ previous, center, next });
      setAvailable(true);
      seekrLog("fotogramas listos", { centro: stamp(activeTrack.cues[centerIndex].startTimeMs) });
    } catch (error) {
      seekrWarn("no se pudieron recortar los fotogramas", { error: String(error).slice(0, 200) });
      if (generation === requestIdRef.current) {
        frameKeyRef.current = "";
        setAvailable(Boolean(trackRef.current?.cues.length));
      }
    } finally {
      if (generation === requestIdRef.current) setLoading(false);
    }
  }, [loadFrame]);

  const nudgeOffset = useCallback((direction: -1 | 1, stepMs?: number) => {
    const next = stepSeekrOffsetMs(offsetRef.current, direction, stepMs);
    if (next === offsetRef.current) return;
    offsetRef.current = next;
    setOffsetMs(next);
    seekrLog("correccion manual", { offset: `${next / 1000}s` });
    // El popup sigue abierto: recargamos los frames con la correccion nueva.
    frameKeyRef.current = "";
    void loadFrames(lastPositionRef.current);
  }, [loadFrames]);

  const resetOffset = useCallback(() => {
    if (offsetRef.current === 0) return;
    offsetRef.current = 0;
    setOffsetMs(0);
    frameKeyRef.current = "";
    void loadFrames(lastPositionRef.current);
  }, [loadFrames]);

  return {
    available,
    loading,
    frames,
    offsetMs,
    sourceDurationMs: track?.sourceDurationMs ?? 0,
    nudgeOffset,
    resetOffset,
    loadFrames,
  };
}
