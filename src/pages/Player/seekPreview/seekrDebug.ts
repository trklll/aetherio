/**
 * Traza de diagnostico de Seekr, solo en desarrollo.
 *
 * Responde a "esta usandose Seekr?" mostrando cada paso de la cadena: clave,
 * consulta, cues recibidos, fotogramas recortados. Nunca imprime la clave: solo
 * su longitud y de donde salio.
 */
const PREFIX = "[SEEKR]";

export type SeekrKeyOrigin = "compilacion" | "almacen" | "ninguna";

function enabled() {
  return Boolean(import.meta.env.DEV);
}

export function seekrLog(event: string, detail?: Record<string, unknown>) {
  if (!enabled()) return;
  if (detail) console.info(`${PREFIX} ${event}`, detail);
  else console.info(`${PREFIX} ${event}`);
}

export function seekrWarn(event: string, detail?: Record<string, unknown>) {
  if (!enabled()) return;
  if (detail) console.warn(`${PREFIX} ${event}`, detail);
  else console.warn(`${PREFIX} ${event}`);
}

export function describeKey(origin: SeekrKeyOrigin, length: number): string {
  if (!length) return "sin clave";
  return `${length} caracteres (${origin})`;
}

/** Convierte milisegundos en m:ss para que la traza se lea como el reproductor. */
export function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
