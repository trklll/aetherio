/**
 * Cache persistente de posters en Cloudflare R2.
 *
 * SpatialPosters guarda los posters renderizados solo en memoria: cuando
 * Aetherio se cierra, la cache se va con el server. En el siguiente arranque
 * vuelve a pedir ~260 posters a TMDB, que es lento y satura el proxy.
 *
 * Con R2 los posters quedan guardados y el arranque siguiente los lee de ahi:
 * cero llamadas a TMDB y posters instantaneos.
 *
 * Las credenciales NO van en el binario: se guardan en el almacen de
 * credenciales de Windows, igual que las demas claves de la app.
 */

import { readSecureCredential, writeSecureCredential } from "../auth/secureCredentialStore";

export interface PosterCacheConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export const DEFAULT_POSTER_CACHE_BUCKET = "spatialposters";

/** Lo que se muestra en el lugar de la clave ya guardada. */
const MASK = "•".repeat(12);

/** Textos de error pensados para mostrar tal cual en Ajustes. */
export const POSTER_CACHE_MESSAGES = {
  store: "No se pudo guardar en el almacen seguro de Windows.",
  missing: "Faltan el Account ID y las claves de acceso de R2.",
} as const;

const FIELDS = [
  { key: "accountId" as const, credential: "r2-account-id" as const, legacy: "aetherio-r2-account-id" },
  { key: "accessKeyId" as const, credential: "r2-access-key-id" as const, legacy: "aetherio-r2-access-key-id" },
  { key: "secretAccessKey" as const, credential: "r2-secret-access-key" as const, legacy: "aetherio-r2-secret-access-key" },
  { key: "bucketName" as const, credential: "r2-bucket-name" as const, legacy: "aetherio-r2-bucket" },
];

/**
 * Lee la configuracion guardada.
 *
 * `secretAccessKey` vuelve como cadena vacia a proposito: no se vuelve a
 * mostrar en la interfaz una vez guardada, igual que la clave de la API de
 * TMDB. Para poder guardarla de nuevo el usuario tiene que volver a escribirla.
 */
export async function readPosterCacheConfig(): Promise<PosterCacheConfig> {
  const [accountId, accessKeyId, secretAccessKey, bucketName] = await Promise.all(
    FIELDS.map(field => readSecureCredential(field.credential, field.legacy)),
  );
  return {
    accountId: accountId ?? "",
    accessKeyId: accessKeyId ?? "",
    secretAccessKey: secretAccessKey ? MASK : "",
    bucketName: bucketName || DEFAULT_POSTER_CACHE_BUCKET,
  };
}

/** Booleano simple para la UI: hay algo configurado? */
export async function hasPosterCacheConfig(): Promise<boolean> {
  const [accountId, accessKeyId, secretAccessKey] = await Promise.all(
    FIELDS.slice(0, 3).map(field => readSecureCredential(field.credential, field.legacy)),
  );
  return Boolean(accountId?.trim() && accessKeyId?.trim() && secretAccessKey?.trim());
}

/**
 * Guarda la configuracion. Los campos vacios no se tocan: si el usuario solo
 * cambia el bucket, la clave que ya estaba guardada se conserva.
 */
export async function savePosterCacheConfig(input: Partial<PosterCacheConfig>): Promise<void> {
  for (const field of FIELDS) {
    const value = input[field.key]?.trim();
    if (!value) continue;
    // La mascara de puntos vuelve a la clave real: si el usuario no la
    // reescribio, no hay nada que guardar de nuevo.
    if (field.key !== "bucketName" && value === MASK) continue;
    await writeSecureCredential(field.credential, field.legacy, value);
  }
}
