import type { MpvEventPayload } from "./types.ts";

export const LIVE_LOAD_FAILURE_TIMEOUT_MS = 45_000;
export const LIVE_FIRST_FRAME_TIMEOUT_MS = 20_000;
export const LIVE_STALL_TIMEOUT_MS = 20_000;

export interface PlaybackFailure {
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

export function failureFromMpvEvent(event: MpvEventPayload, live: boolean): PlaybackFailure | null {
  if (event.event !== "end-file" || ["stop", "quit", "redirect"].includes(event.endReason ?? "")) return null;
  if (event.endReason === "eof" && !live) return null;
  const status = event.httpStatus;
  const prefix = "MPV no pudo cargar esta fuente. ";
  if (status === 401 || status === 403) return { message: `${prefix}El servidor denegó el acceso (HTTP ${status}). Revisa los permisos o el bloqueo regional.`, retryable: false, httpStatus: status };
  if (status === 404 || status === 410) return { message: `${prefix}El servidor respondió HTTP ${status}: el enlace del canal no está disponible. Prueba otra fuente.`, retryable: false, httpStatus: status };
  if (status === 429) return { message: `${prefix}El servidor limita las conexiones (HTTP 429). Espera antes de reintentarlo.`, retryable: false, httpStatus: status };
  if (status && status >= 400 && status < 500 && status !== 408) return { message: `${prefix}El servidor rechazó la petición (HTTP ${status}).`, retryable: false, httpStatus: status };
  if (event.errorCode === -14 || event.errorCode === -15) return { message: `${prefix}No se pudo inicializar la salida de audio o vídeo.`, retryable: false };
  if (event.errorCode === -17 || event.errorCode === -18 || event.errorCode === -16) return { message: `${prefix}La fuente no contiene medios compatibles o requiere un formato no admitido.`, retryable: false };
  if (event.endReason === "eof") return { message: `${prefix}La emisión terminó o se interrumpió.`, retryable: live };
  return {
    message: status ? `${prefix}El servidor está fallando temporalmente (HTTP ${status}).` : `${prefix}Se interrumpió la conexión o no se recibieron medios reproducibles.`,
    retryable: live,
    ...(status ? { httpStatus: status } : {}),
  };
}

/** Budget is per source, not per first frame: a flapping stream cannot loop. */
export function liveRetryDelay(failure: PlaybackFailure | null, attempts: number): number | null {
  if (!failure?.retryable || !Number.isInteger(attempts) || attempts < 0) return null;
  return [1500, 4000][attempts] ?? null;
}
