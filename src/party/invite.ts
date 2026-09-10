import { isCompleteRoomCode, normalizeRoomCode } from "./protocol";

/**
 * Invitaciones a salas Party: además del código de 6 caracteres se puede
 * compartir un link https que abre la app directo en la sala.
 *
 * - Web (para Discord/compartir): https://trkll.aetherio.workers.dev/join/ABC123[?server=...]
 * - Deep link (la app, protocolo registrado en Tauri): aetherio://party/join?code=ABC123[&server=...]
 *
 * El `server` es la base https de la sala (necesario cuando el anfitrión no
 * usa el servidor por defecto). Al entrar, el invitado se une y va directo
 * al reproductor con la fuente del anfitrión.
 */

export const PARTY_INVITE_WEB_BASE = "https://trkll.aetherio.workers.dev";
const PARTY_JOIN_STORAGE_KEY = "aetherio-party-pending-join";
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

export interface PartyInvite {
  code: string;
  /** Base https saneada o "" (usar la lista configurada). */
  server: string;
}

/** Solo https (más http en localhost para desarrollo). */
export function sanitizePartyServerUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clean = raw.trim().replace(/\/$/, "");
  if (!clean) return "";
  try {
    const url = new URL(clean);
    if (url.protocol === "https:") return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
    }
  } catch {
    // URL inválida.
  }
  return "";
}

export function normalizeInviteCode(raw: unknown): string {
  const code = normalizeRoomCode(typeof raw === "string" ? raw : "");
  return ROOM_CODE_RE.test(code) ? code : "";
}

/** Link web compartible (el que va en Discord y mensajes). */
export function buildPartyInviteLink(code: string, server?: string): string | null {
  const cleanCode = normalizeInviteCode(code);
  if (!cleanCode) return null;
  const cleanServer = sanitizePartyServerUrl(server ?? "");
  const params = cleanServer ? `?server=${encodeURIComponent(cleanServer)}` : "";
  return `${PARTY_INVITE_WEB_BASE}/join/${cleanCode}${params}`;
}

/** Deep link que abre la app directo en la sala. */
export function buildPartyJoinDeepLink(code: string, server?: string): string | null {
  const cleanCode = normalizeInviteCode(code);
  if (!cleanCode) return null;
  const cleanServer = sanitizePartyServerUrl(server ?? "");
  const params = new URLSearchParams({ code: cleanCode });
  if (cleanServer) params.set("server", cleanServer);
  return `aetherio://party/join?${params.toString()}`;
}

/** Acepta el deep link aetherio://party/join?code=ABC123[&server=...]. */
export function parsePartyJoinDeepLink(rawUrl: string): PartyInvite | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "aetherio:" || url.hostname !== "party") return null;
    if (url.pathname.replace(/\/$/, "") !== "/join") return null;
    const code = normalizeInviteCode(url.searchParams.get("code") ?? "");
    if (!isCompleteRoomCode(code)) return null;
    return { code, server: sanitizePartyServerUrl(url.searchParams.get("server") ?? "") };
  } catch {
    return null;
  }
}

/** Ruta del reproductor para el contenido de una sala (invitado directo). */
export function buildPlayerPathForMedia(media: { type: string; id: string; season?: number; episode?: number } | null): string | null {
  if (!media || !media.type || !media.id) return null;
  const params = new URLSearchParams({ type: media.type, id: media.id });
  if (media.season != null) params.set("season", String(media.season));
  if (media.episode != null) params.set("ep", String(media.episode));
  return `/player?${params.toString()}`;
}

export function writePendingPartyJoin(invite: PartyInvite): void {
  try {
    sessionStorage.setItem(PARTY_JOIN_STORAGE_KEY, JSON.stringify(invite));
  } catch {
    // Solo memoria del proceso: se pierde al cerrar, aceptable.
  }
}

/** Lee y consume la invitación pendiente (un solo uso). */
export function takePendingPartyJoin(): PartyInvite | null {
  try {
    const raw = sessionStorage.getItem(PARTY_JOIN_STORAGE_KEY);
    sessionStorage.removeItem(PARTY_JOIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PartyInvite>;
    const code = normalizeInviteCode(parsed.code ?? "");
    if (!isCompleteRoomCode(code)) return null;
    return { code, server: sanitizePartyServerUrl(parsed.server ?? "") };
  } catch {
    return null;
  }
}
