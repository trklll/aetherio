import {
  deleteSecureCredential,
  readSecureCredential,
  writeSecureCredential,
} from "../auth/secureCredentialStore";
import { seekrLog } from "../pages/Player/seekPreview/seekrDebug";

export const SEEKR_API_KEY_STORAGE_KEY = "aetherio-seekr-api-key";

const SEEKR_CREDENTIAL_KEY = "seekr-api-key";
const SEEKR_API_KEY_MIN_LENGTH = 8;
const SEEKR_API_KEY_MAX_LENGTH = 512;

export function getSeekrApiKey(): string {
  const value = import.meta.env.VITE_SEEKR_API_KEY;
  return typeof value === "string" ? value.trim() : "";
}

// Mismo contrato que `seekr_load_track` en src-tauri: si el backend rechaza la
// clave, el previsualizado se apaga en silencio y es mejor fallar al guardar.
export function isValidSeekrApiKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= SEEKR_API_KEY_MIN_LENGTH
    && trimmed.length <= SEEKR_API_KEY_MAX_LENGTH
    && !trimmed.includes("\r")
    && !trimmed.includes("\n");
}

// El Credential Manager de Windows puede tardar o quedarse colgado (primer
// arranque, permisos). Si esperamos a el antes de mirar la clave de compilacion,
// un cuelgue deja el previsualizado apagado en silencio. El almacen solo puede
// MEJORAR la clave ya disponible, nunca bloquearla.
const CREDENTIAL_READ_TIMEOUT_MS = 1_500;

async function readWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function readSeekrApiKey(): Promise<string> {
  // Una clave de compilacion es una respuesta inmediata y explicita. Consultar
  // antes el Credential Manager solo puede hacer peor el asunto: si el almacen
  // del sistema se cuelga, la funcion no resuelve nunca y el previsualizado se
  // queda apagado sin dejar rastro. El almacen sigue siendo el camino cuando no
  // hay clave de compilacion, que es el caso de cualquier build distribuida.
  const env = getSeekrApiKey();
  if (env) {
    seekrLog("clave desde compilacion", { caracteres: env.length });
    return env;
  }

  const stored = await readWithTimeout(
    readSecureCredential(SEEKR_CREDENTIAL_KEY, SEEKR_API_KEY_STORAGE_KEY),
    CREDENTIAL_READ_TIMEOUT_MS,
  );
  const value = stored?.trim() || "";
  seekrLog(value ? "clave desde almacen seguro" : "sin clave configurada", {
    caracteres: value.length,
  });
  return value;
}

export async function saveSeekrApiKey(value: string): Promise<string> {
  const trimmed = value.trim();
  if (!isValidSeekrApiKey(trimmed)) {
    throw new Error("Clave de Seekr invalida.");
  }
  await writeSecureCredential(SEEKR_CREDENTIAL_KEY, SEEKR_API_KEY_STORAGE_KEY, trimmed);
  return trimmed;
}

export async function clearSeekrApiKey(): Promise<void> {
  await deleteSecureCredential(SEEKR_CREDENTIAL_KEY, SEEKR_API_KEY_STORAGE_KEY);
}
