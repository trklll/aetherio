import type { MediaStream } from "../types/stream";
import { extractHttpHeaders, getPlaybackTarget, getStreamKind } from "../pages/Player/utils";
import type { PartyStreamOffer } from "./protocol";

// Cabeceras que sí viajan con la oferta: solo las necesarias para que el
// servidor del stream acepte la petición. Nunca credenciales (ver saneo).
const SHAREABLE_HEADERS = new Set(["referer", "user-agent", "origin", "accept", "accept-language", "range"]);
const MAX_TARGET_LEN = 4096;
const MAX_HEADERS = 10;

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
  return { offer };
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
  };
}
