import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { LiveSource } from "./liveSports.ts";

/**
 * Cliente mínimo del protocolo de addons Stremio, limitado a lo que necesitan
 * los addons de deportes: `manifest`, `catalog` y `stream`.
 *
 * No se reutiliza el pipeline de addons general de la app a proposito: esas filas
 * se filtran por `contentOrientation` (movie/series/anime) y un tipo `sport` o
 * `tv` se descartarian antes de llegar a ninguna parte. Aqui el protocolo se
 * habla directo y el resultado alimenta el hook de directo.
 */

const REQUEST_TIMEOUT_MS = 12_000;
/**
 * El probe solo tiene que distinguir "vivo" de "muerto": son manifests cortos de
 * CDN. Con el timeout general de 12s un upstream colgado multiplicaba el tiempo
 * de carga de la pagina por el numero de eventos, asi que va con su propio.
 */
const PROBE_TIMEOUT_MS = 6_000;
const MANIFEST_CACHE_TTL_MS = 30 * 60 * 1000;
/** Mismo criterio de agente que usan los addons al servir sus manifests. */
const PROBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface StremioResource {
  name?: string;
  types?: string[];
  idPrefixes?: string[];
}

export interface StremioManifest {
  id?: string;
  version?: string;
  name?: string;
  types?: string[];
  idPrefixes?: string[];
  catalogs?: { type: string; id: string; name?: string; extra?: { name: string; isRequired?: boolean; options?: string[] }[] }[];
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean };
  resources?: (string | StremioResource)[];
}

export interface StremioMeta {
  id: string;
  type?: string;
  name?: string;
  poster?: string;
  posterShape?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  released?: string;
  genres?: string[];
  /** abused por los addons de deportes para local/visitante. */
  cast?: string[];
  behaviorHints?: Record<string, unknown>;
}

export interface StremioStream {
  name?: string;
  title?: string;
  url?: string;
  ytId?: string;
  externalUrl?: string;
  behaviorHints?: Record<string, unknown>;
  resolution?: string;
  language?: string;
  _source?: string;
}

function manifestUrl(base: string) {
  return `${base.replace(/\/+$/, "")}/manifest.json`;
}

async function fetchJson<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const manifestCache = new Map<string, { at: number; manifest: StremioManifest }>();

export async function fetchManifest(base: string): Promise<StremioManifest | null> {
  const url = manifestUrl(base);
  const cached = manifestCache.get(url);
  if (cached && Date.now() - cached.at < MANIFEST_CACHE_TTL_MS) return cached.manifest;
  const manifest = await fetchJson<StremioManifest>(url);
  if (!manifest?.id) return null;
  manifestCache.set(url, { at: Date.now(), manifest });
  return manifest;
}

export async function fetchCatalogMetas(
  base: string,
  type: string,
  catalogId: string,
  extras?: Record<string, string>,
): Promise<StremioMeta[]> {
  const query = Object.entries(extras ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("/");
  const url = `${base.replace(/\/+$/, "")}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}${query ? `/${query}` : ""}.json`;
  const payload = await fetchJson<{ metas?: StremioMeta[] }>(url);
  return Array.isArray(payload?.metas) ? payload.metas.filter(meta => meta?.id) : [];
}

export async function fetchStreams(
  base: string,
  type: string,
  id: string,
): Promise<StremioStream[]> {
  const url = `${base.replace(/\/+$/, "")}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  const payload = await fetchJson<{ streams?: StremioStream[] }>(url);
  return Array.isArray(payload?.streams) ? payload.streams : [];
}

/**
 * Verifica que un stream sea realmente un directo SERVIBLE ahora mismo.
 *
 * Sin esta comprobacion el usuario descubre tarde, ya con el reproductor
 * abierto, que la fuente esta muerta. Lo que devuelve un addon de deportes es un
 * mapa de tres casos y solo uno sirve:
 *
 * - El upstream ya rotó: el manifest responde 404/403. Se descarta.
 * - El addon devolvio una repeticion: el playlist trae `#EXT-X-ENDLIST`. Se
 *   descarta, porque una repeticion no es un partido en curso.
 * - Sigue en directo: playlist con segmentos y sin `ENDLIST`. Se acepta.
 *
 * Se sigue master -> media porque `ENDLIST` solo aparece en el playlist de medios,
 * no en el master. Ante un fallo de red (no un rechazo explicito) se acepta el
 * stream: no se descarta un evento que quiza funciona solo por un timeout de
 * nuestra parte.
 */
export type LiveProbeVerdict = "live" | "dead" | "replay" | "unknown";

export async function probeLiveSource(
  source: LiveSource,
  maxRequests = 3,
): Promise<LiveProbeVerdict> {
  const headers = source.headers ?? {};
  let url = source.url;

  // mpv no abre http:// contra una IP suelta, asi que ofrecerla es garantizar un
  // fallo. Se descarta aqui y no en el reproductor.
  if (isBlockedInsecureUrl(url)) return "dead";

  for (let step = 0; step < maxRequests; step += 1) {
    const response = await fetchText(url, headers);
    // Status 0 = no hubo respuesta (DNS, TLS, timeout). Es lo unico que se admite
    // como duda; cualquier codigo de error real es una muerte definitiva.
    if (!response.ok) return response.status === 0 ? "unknown" : "dead";
    if (response.drm) return "dead";

    const body = response.body;
    // Una pagina de error o de interstitio (Cloudflare, portal de，继captive) llega
    // con 200 y sin una linea de HLS. Antes esto caia en "unknown" y se aceptaba:
    // era exactamente lo que hacia el proxy de Nuvio con su 502 en HTML.
    if (!body.includes("#EXTM3U")) return "dead";
    if (body.includes("#EXT-X-ENDLIST")) return "replay";

    if (!body.includes("#EXT-X-STREAM-INF")) {
      // Playlist de medios. Sin ningun segmento no hay nada que reproducir.
      if (!body.includes("#EXTINF")) return "dead";
      const segment = firstMediaUri(body);
      if (!segment) return "dead";
      const finalUrl = absoluteUrl(segment, url);
      if (!finalUrl) return "dead";
      return isBlockedInsecureUrl(finalUrl) ? "dead" : probeSegment(finalUrl, headers);
    }

    // Es un master: hay que bajar a una variante para ver el ENDLIST real.
    const variant = firstMediaUri(body);
    const next = variant ? absoluteUrl(variant, url) : null;
    if (!next) return "dead";
    url = next;
  }
  return "unknown";
}

/** Primera entrada que no es comentario ni etiqueta: el segmento o la variante. */
function firstMediaUri(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line;
  }
  return null;
}

function absoluteUrl(reference: string, base: string): string | null {
  try {
    return new URL(reference, base).toString();
  } catch {
    return null;
  }
}

/**
 * Un User-Agent de navegador siempre. Estos CDNs rechazan clientes sin él, y
 * ademas el navegador no permite fijarlo: en el webview hay que pasarlo al
 * puente nativo, que es justo lo que hace `fetchTextNatively`.
 */
function withBrowserUserAgent(headers: Record<string, string>): Record<string, string> {
  const hasUserAgent = Object.keys(headers).some(name => name.toLowerCase() === "user-agent");
  return {
    Accept: "*/*",
    ...(hasUserAgent ? headers : { "User-Agent": PROBE_USER_AGENT }),
    ...headers,
  };
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; body: string; drm: boolean }> {
  // En Tauri se resuelve por el comando nativo: `fetch` en el webview esta sujeto
  // a CORS, y como estos CDNs no envian `Access-Control-Allow-Origin` TODA
  // validacion caia en "unknown" y se aceptaba cualquier stream, muerto o no. Era
  // el motivo de que el usuario siguiera viendo partidos ya acabados.
  if (isTauriRuntime()) return fetchTextNatively(url, headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: withBrowserUserAgent(headers),
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, status: response.status, body: "", drm: false };
    const body = await response.text();
    return { ok: true, status: response.status, body, drm: detectDrm(body) };
  } catch {
    return { ok: false, status: 0, body: "", drm: false };
  } finally {
    clearTimeout(timer);
  }
}

function detectDrm(body: string): boolean {
  // FairPlay / Widevine: el addon podria devolver una variante cifrada que el
  // reproductor no puede abrir. Se descarta igual que una muerta.
  return /com\.apple\.streamingkeydelivery|com\.widevine\.alpha|skd:\/\//.test(body)
    || /#EXT-X-SESSION-KEY/.test(body);
}

function decodeBase64(value: string): string {
  if (!value) return "";
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Peticion por el puente nativo. Devuelve el codigo real, que es lo que permite
 * distinguir "el CDN me ha rechazado" de "no he podido saber nada".
 */
async function fetchTextNatively(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string; drm: boolean }> {
  try {
    const response = await invokeCommand<{
      status: number;
      statusText: string;
      bodyBase64: string;
    }>("provider_http_request", {
      request: {
        url,
        method: "GET",
        headers: withBrowserUserAgent(headers),
      },
    });
    const status = response?.status ?? 0;
    if (status < 200 || status >= 300) return { ok: false, status, body: "", drm: false };
    const body = decodeBase64(response?.bodyBase64 ?? "");
    return { ok: true, status, body, drm: detectDrm(body) };
  } catch {
    return { ok: false, status: 0, body: "", drm: false };
  }
}

/** Una IP suelta en http:// casi siempre es un origen que mpv no va a abrir. */
function isBlockedInsecureUrl(url: string): boolean {
  if (/^https:/i.test(url)) return false;
  if (!/^http:/i.test(url)) return false;
  return !/^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
}

/**
 * Peticion de un solo byte al primer segmento. Es la unica prueba que vale: un
 * manifest puede responder 200 y里面的 texto estar perfecto mientras el token ya
 * expiro y el segmento real da 403. Con un `Range` no se descarga el segmento
 * entero (varios MB), solo lo justo para saber que existe.
 */
async function probeSegment(
  url: string,
  headers: Record<string, string>,
): Promise<LiveProbeVerdict> {
  try {
    const response = await fetchText(url, { ...headers, Range: "bytes=0-1" });
    if (response.ok) return "live";
    // Status 0 = no hubo respuesta, no se sabe nada. Cualquier codigo de error es
    // una muerte: es el token caducado del CDN en un partido ya acabado.
    return response.status === 0 ? "unknown" : "dead";
  } catch {
    return "unknown";
  }
}

/* ------------------------------------------------------------------ *
 * Utilidades compartidas por los mappers
 * ------------------------------------------------------------------ */

const EMOJI_PREFIX = /^[^A-Za-z0-9¡¿]+/;

export function cleanMetaName(raw: string | undefined, fallback: string): string {
  const value = String(raw ?? "")
    // "🔴 LIVE: China U23 vs Thailand U23" -> "China U23 vs Thailand U23"
    .replace(EMOJI_PREFIX, "")
    .replace(/^LIVE:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return value || fallback;
}

/** "MOTORSPORT" -> "Motorsport": el addon entrega el deporte en mayusculas. */
export function humanizeSport(raw: string | undefined): string {
  const value = String(raw ?? "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "Deportes";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** El catalogo `sports_today` de Sports Streams no trae ISO: solo texto. */
const TEXT_DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s*[·\-]\s*(\d{1,2}):(\d{2})\s*UTC)?$/;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function parseTextDate(raw: string | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const match = TEXT_DATE_RE.exec(value);
  if (!match) return null;
  const monthIndex = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
  if (monthIndex < 0) return null;
  const [, day, , year, hour, minute] = match;
  const stamp = Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
  );
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}

/** "LIVE" (o variantes) marca que el evento esta en curso. */
export function isLiveReleaseInfo(raw: string | undefined): boolean {
  return /^\s*live\b/i.test(String(raw ?? ""));
}

/** Separa "Seattle Mariners vs Los Angeles Angels" en los dos equipos. */
export function splitVersus(raw: string): [string, string] | null {
  // `v`, `v.`, `vs` y `vs.`: los addons escriben las cuatro variantes.
  const match = /^(.+?)\s+v\.?s?\.?\s+(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const home = match[1].trim();
  const away = match[2].trim();
  if (!home || !away) return null;
  return [home, away];
}

/* ------------------------------------------------------------------ *
 * Mapeo de streams
 * ------------------------------------------------------------------ */

const OFFLINE_SENTINEL = /^(?:https?:\/\/)?(?:www\.)?(?:google\.com|example\.com)\/?$/i;

/**
 * Convierte un `StremioStream` en `LiveSource`.
 *
 * Dos decisiones criticas:
 *
 * 1. `notWebReady` se descarta. Esa bandera significa "un navegador o WebView no
 *    puede reproducir esto", y ambos addons marcan HLS servido por un proxy
 *    porque un `<video>` sin CORS no lo abre. Aetherio reproduce con mpv, que es
 *    nativo: si se respetara la bandera,
 *    `playableMedia.ts` rechazaria la fuente y el reproductor la filtraria de la lista.
 *
 * 2. `behaviorHints.proxyHeaders.request` se copia a `headers`. Esos referers y
 *    origins no son cosmeticos: sin ellos el CDN de destino responde 403 y el
 *    stream muere al primer segmento. El reproductor ya los traduce a las
 *    opciones `referrer`/`user-agent` dedicadas de mpv.
 */
export function stremioStreamToLiveSource(
  stream: StremioStream,
  eventId: string,
  index: number,
): LiveSource | null {
  const url = String(stream.url ?? "").trim();
  if (!url || OFFLINE_SENTINEL.test(url)) return null;

  const requestHeaders = readRequestHeaders(stream.behaviorHints?.proxyHeaders);
  const label = String(stream.name ?? stream._source ?? `Fuente ${index + 1}`).trim();

  return {
    id: `${eventId}:${index}`,
    label,
    url,
    quality: String(stream.resolution ?? "").trim() || undefined,
    language: String(stream.language ?? "").trim() || undefined,
    headers: Object.keys(requestHeaders).length ? requestHeaders : undefined,
    isDefault: index === 0,
  };
}

function readRequestHeaders(proxyHeaders: unknown): Record<string, string> {
  if (!proxyHeaders || typeof proxyHeaders !== "object") return {};
  const request = (proxyHeaders as { request?: unknown }).request;
  if (!request || typeof request !== "object") return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const name = key.trim();
    const content = value.trim();
    if (name && content) headers[name] = content;
  }
  return headers;
}

/**
 * Titulo del evento.
 *
 * `cast` solo se interpreta como local/visitante cuando el propio titulo
 * describe un enfrentamiento. En deportes sin rival (F1, motociclismo, golf,
 *ilege) el addon mete la descripcion del evento en `cast` —un researched del
 * prompt dio `cast: ["Formula 1 Grand Prix Baku", "Race | Baku, Azerbaijan"]`— y
 * unirlo con "vs" produciria "Baku vs Race". En ese caso gana el nombre limpio.
 */
export function metaTitle(meta: StremioMeta): string {
  const fallback = cleanMetaName(meta.name, "Evento en directo");
  if (/\s+v\.?s?\.?\s+/i.test(fallback)) {
    const teams = (meta.cast ?? []).map(team => String(team ?? "").trim()).filter(Boolean);
    if (teams.length >= 2) return `${teams[0]} vs ${teams[1]}`;
  }
  return fallback;
}
