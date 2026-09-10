import type { MediaStream } from "../types/stream";
import { extractHttpHeaders, getPlaybackTarget, getStreamKind } from "../pages/Player/utils";
import type { PartyStreamOffer } from "./protocol";

// Cabeceras que sí viajan con la oferta: solo las necesarias para que el
// servidor del stream acepte la petición. Nunca credenciales (ver saneo).
const SHAREABLE_HEADERS = new Set(["referer", "user-agent", "origin", "accept", "accept-language", "range"]);
const MAX_TARGET_LEN = 4096;
const MAX_HEADERS = 10;
const MAX_SHARED_SUBTITLES = 8;
const MAX_SHARED_SUBTITLE_URL_LEN = 512;

function isPrivateTorrent(hints: Record<string, unknown>): boolean {
  const value = hints.private;
  if (value === true || value === 1) return true;
  return typeof value === "string" && /^(?:1|true|yes)$/i.test(value.trim());
}

function magnetHasCredentials(magnet: string): boolean {
  try {
    const parsed = new URL(magnet);
    for (const tracker of parsed.searchParams.getAll("tr")) {
      if (tracker.includes("@")) return true;
      try {
        const trackerUrl = new URL(tracker);
        if (trackerUrl.username || trackerUrl.password) return true;
      } catch {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

/** Quita todo lo que huela a sesión/credencial antes de compartir. Allowlist. */
export function sanitizeSharedHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Object.keys(clean).length >= MAX_HEADERS) break;
    const normalizedKey = key.trim();
    if (!SHAREABLE_HEADERS.has(normalizedKey.toLowerCase())) continue;
    const normalizedValue = value.trim().slice(0, 512);
    if (!normalizedKey || !normalizedValue || normalizedKey.length > 64) continue;
    clean[normalizedKey] = normalizedValue;
  }
  return clean;
}

export type UnshareableReason =
  | "sin stream"
  | "archivo local"
  | "iframe"
  | "no portable"
  | "torrent privado"
  | "magnet con credenciales"
  | "destino inválido";

/**
 * Construye la oferta compartible del stream actual, o explica por qué no se
 * puede compartir. Reglas:
 * - Solo https directo y magnet público (mismo `getPlaybackTarget` que mpv usa).
 * - Nunca: archivos locales, iframes, torrents privados, magnets con
 *   credenciales en trackers, ni cabeceras fuera de la allowlist.
 * - Los enlaces debrid firmados por cuenta/IP normalmente fallan en el
 *   invitado: se comparten igual (son https "normales") y el invitado cae a
 *   sus addons si no abren (fallback automático).
 */
export function buildShareableOffer(stream: MediaStream | null): { offer?: PartyStreamOffer; reason?: UnshareableReason } {
  if (!stream) return { reason: "sin stream" };
  // Los streams "party" SÍ se re-comparten: al migrar el anfitrión, el nuevo
  // owner comparte la misma fuente (mismo target → los miembros lo ignoran
  // como no-op). Solo el owner emite, así que no hay bucles.
  const hints = (stream.behaviorHints ?? {}) as Record<string, unknown>;
  if (hints.localFile === true) return { reason: "archivo local" };
  if (hints.scraperPlayback === "iframe") return { reason: "iframe" };

  const kind = getStreamKind(stream);
  if (kind !== "https" && kind !== "p2p") return { reason: "no portable" };
  if (kind === "p2p" && isPrivateTorrent(hints)) return { reason: "torrent privado" };

  const target = getPlaybackTarget(stream);
  if (!target || target.length > MAX_TARGET_LEN) return { reason: "destino inválido" };
  if (kind === "https" && !/^https?:/i.test(target)) return { reason: "destino inválido" };
  if (kind === "p2p") {
    if (!/^magnet:/i.test(target)) return { reason: "destino inválido" };
    if (magnetHasCredentials(target)) return { reason: "magnet con credenciales" };
  }

  const headers = sanitizeSharedHeaders(extractHttpHeaders(stream));
  const label = String(stream.title ?? stream.name ?? "").trim().slice(0, 120);
  const offer: PartyStreamOffer = { target, kind };
  if (typeof stream.fileIdx === "number" && Number.isFinite(stream.fileIdx)) offer.fileIdx = stream.fileIdx;
  if (Object.keys(headers).length > 0) offer.headers = headers;
  if (label) offer.label = label;
  const sharedSubtitles = sanitizeSharedSubtitles(stream.subtitles);
  if (sharedSubtitles.length > 0) offer.subtitles = sharedSubtitles;
  return { offer };
}

/** Subtítulos portables de la fuente: solo https directas, con topes. */
export function sanitizeSharedSubtitles(subtitles: unknown): Array<{ url: string; lang?: string; title?: string }> {
  if (!Array.isArray(subtitles)) return [];
  const clean: Array<{ url: string; lang?: string; title?: string }> = [];
  for (const item of subtitles) {
    if (clean.length >= MAX_SHARED_SUBTITLES) break;
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    if (!url || !/^https?:/i.test(url) || url.length > MAX_SHARED_SUBTITLE_URL_LEN) continue;
    const entry: { url: string; lang?: string; title?: string } = { url };
    const lang = typeof raw.lang === "string" ? raw.lang.trim().slice(0, 16)
      : typeof raw.language === "string" ? raw.language.trim().slice(0, 16) : "";
    if (lang) entry.lang = lang;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 64) : "";
    if (title) entry.title = title;
    if (clean.some(existing => existing.url === url)) continue;
    clean.push(entry);
  }
  return clean;
}

/** Motivo legible de por qué una fuente no se puede compartir en la sala. */
export function describeUnshareableReason(reason: UnshareableReason | undefined): string {
  switch (reason) {
    case "sin stream":
      return "aún no hay fuente cargada";
    case "archivo local":
      return "es un archivo local de este dispositivo";
    case "iframe":
      return "solo se ve en este dispositivo (reproductor web)";
    case "no portable":
      return "no es un enlace portable";
    case "torrent privado":
      return "es un torrent privado";
    case "magnet con credenciales":
      return "el magnet trae credenciales";
    case "destino inválido":
      return "el enlace no es válido o es demasiado largo";
    default:
      return "no es compartible";
  }
}

/** Reconstruye un MediaStream reproducible desde una oferta del grupo. */
export function partyOfferToMediaStream(offer: PartyStreamOffer, from: string): MediaStream {
  return {
    id: `party:${from}`,
    addonId: "party",
    addonName: "Party",
    name: offer.label || "Stream del grupo",
    title: offer.label,
    url: offer.target,
    fileIdx: offer.fileIdx,
    behaviorHints: {
      filename: offer.label,
      ...(offer.headers ? { headers: offer.headers } : {}),
    },
    ...(offer.subtitles?.length
      ? { subtitles: offer.subtitles.map(item => ({ url: item.url, lang: item.lang, title: item.title })) }
      : {}),
  };
}
