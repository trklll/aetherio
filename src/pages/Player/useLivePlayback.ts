import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { seekNativePlaybackToLive } from "../../runtime/platform";

/**
 * Por debajo de este retraso el usuario esta "en el directo": el salto al
 * borde solo se dispara cuando ya se ha salido de ahi, porque en sports un
 * salto de 1.5s en mitad de una jugada se ve, mientras que 3s de retraso no.
 */
export const LIVE_EDGE_TOLERANCE_SECONDS = 1.5;

/** Segundos de historico que la barra de DVR muestra como maximo. */
export const DVR_WINDOW_SECONDS = 60 * 30;

export interface UseLivePlaybackArgs {
  enabled: boolean;
  timePos: number;
  /** `demuxer-cache-duration`: lo que hay demultiplexado por delante. */
  demuxerCacheDuration: number;
  eofReached: boolean;
  playing: boolean;
}

export interface LivePlaybackState {
  /** Instante del directo alcanzable con el buffer actual. */
  liveEdge: number;
  /** Segundos de retraso respecto al directo. */
  latency: number;
  /** El playhead esta pegado al borde. */
  atLiveEdge: boolean;
  /** Fin de la transmision (el host cerro el stream). */
  ended: boolean;
  /** Historicidad hacia atras disponible, en segundos. */
  dvrWindow: number;
  /** Fraccion 0..1 del DVR donde esta el playhead. */
  dvrProgress: number;
  goLive: () => void;
}

export function useLivePlayback({
  enabled,
  timePos,
  demuxerCacheDuration,
  eofReached,
  playing,
}: UseLivePlaybackArgs): LivePlaybackState {
  // El buffer del demuxer avanza a saltos (llega un segmento, se consume poco a
  // poco). El borde se trackea de forma monotona: si el buffer se recorta (recorte
  // de manifiesto, salto del host) se conserva el maximo, para que la barra no
  // retroceda mientras se reproduce.
  const [liveEdge, setLiveEdge] = useState(0);
  const lastEdgeRef = useRef(0);
  const [atLiveEdge, setAtLiveEdge] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setLiveEdge(0);
      setAtLiveEdge(true);
      lastEdgeRef.current = 0;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const candidate = Number.isFinite(timePos) ? timePos + Math.max(0, demuxerCacheDuration) : 0;
    if (candidate > lastEdgeRef.current) {
      lastEdgeRef.current = candidate;
      setLiveEdge(candidate);
    }
  }, [demuxerCacheDuration, enabled, timePos]);

  const latency = useMemo(() => {
    if (!enabled) return 0;
    return Math.max(0, liveEdge - timePos);
  }, [enabled, liveEdge, timePos]);

  // Solo se recalcula el flag "en vivo" mientras se reproduce: en pausa el
  // playhead se queda quieto a proposito y marcalo como desincronizado seria
  // mentira.
  useEffect(() => {
    if (!enabled || !playing || liveEdge <= 0) return;
    const isAtEdge = latency <= LIVE_EDGE_TOLERANCE_SECONDS;
    setAtLiveEdge(prev => (prev === isAtEdge ? prev : isAtEdge));
  }, [enabled, latency, liveEdge, playing]);

  const dvrWindow = Math.min(DVR_WINDOW_SECONDS, Math.max(0, liveEdge));
  const dvrProgress = useMemo(() => {
    if (!enabled || dvrWindow <= 0) return 1;
    const start = Math.max(0, liveEdge - dvrWindow);
    return Math.min(1, Math.max(0, (timePos - start) / dvrWindow));
  }, [dvrWindow, enabled, timePos]);

  const goLive = useCallback(() => {
    setAtLiveEdge(true);
    void seekNativePlaybackToLive().catch(() => undefined);
  }, []);

  return {
    liveEdge,
    latency,
    atLiveEdge,
    // `eof-reached` se mantiene tras un corte: es la unica senal de que el host
    // cerro la transmision y hay que decirlo, no dejar una pantalla congelada.
    ended: enabled && eofReached,
    dvrWindow,
    dvrProgress,
    goLive,
  };
}
