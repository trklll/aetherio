// Protocolo Party — espejo del servidor (party-server/src/index.ts).
// Mantener sincronizados: los mensajes que la app envía/recibe por WS.

export interface PartyMedia {
  type: string;
  id: string;
  season?: number;
  episode?: number;
  title?: string;
}

export type PartyControlKind = "play" | "pause" | "seek";

export interface PartyPeer {
  id: string;
  name: string;
  isOwner: boolean;
  /** Pública efímera (base64 SPKI). Ausente = sin verificar. */
  identity?: string;
}

export interface PartyChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  at: number;
  /** Eco local optimista aún sin confirmar por el servidor. */
  temp?: boolean;
}

export interface PartyControlEvent {
  kind: PartyControlKind;
  position: number;
  from: string;
  at: number;
}

export interface PartyMediaEvent {
  media: PartyMedia;
  from: string;
  at: number;
}

/** Puntero al stream exacto del anfitrión: misma URL/magnet para todos. */
export interface PartyStreamOffer {
  /** URL https directa o magnet:? (lo mismo que mpv abriría). */
  target: string;
  kind: "https" | "p2p";
  fileIdx?: number;
  /** Solo cabeceras saneadas (allowlist, sin credenciales). */
  headers?: Record<string, string>;
  label?: string;
}

export interface PartyStreamEvent {
  offer: PartyStreamOffer;
  from: string;
  at: number;
}

export interface PartyPresence {
  id: string;
  name: string;
  buffering: boolean;
  at: number;
}

/** Sala de espera: el anfitrión retiene el inicio hasta "Empezar". */
export type PartyLobbyState = "waiting" | "started";

export interface PartyLobbyEvent {
  state: PartyLobbyState;
  from: string;
  at: number;
}

export type PartyServerMessage =
  | { t: "welcome"; peerId: string; isOwner: boolean; serverTime: number; media: PartyMediaPayload | null; protected: boolean; lobbyWaiting?: boolean; probe?: string }
  | { t: "peers"; peers: PartyPeer[] }
  | { t: "peer-joined"; peer: PartyPeer }
  | { t: "peer-left"; peerId: string }
  | { t: "owner-changed"; peerId: string }
  | { t: "control"; kind: PartyControlKind; position: number; from: string; at: number }
  | { t: "control"; enc: string; from: string; at: number }
  | { t: "media"; media: PartyMediaPayload; from: string; at: number }
  | { t: "stream"; offer: PartyStreamPayload; from: string; at: number }
  | { t: "presence"; from: string; name: string; buffering: boolean; at: number }
  | { t: "presence"; from: string; name: string; enc: string; at: number }
  | { t: "chat"; id: string; from: string; name: string; text?: string; enc?: string; at: number }
  | { t: "lobby"; state: PartyLobbyState; from: string; at: number }
  | { t: "room-closed" }
  | { t: "pong"; serverTime: number }
  | { t: "error"; message: string };

export type PartyClientMessage =
  | { t: "hello"; name: string; clientId: string; identity?: string }
  | { t: "control"; kind: PartyControlKind; position: number }
  | { t: "control"; enc: string }
  | { t: "media"; media: PartyMediaPayload }
  | { t: "stream"; offer: PartyStreamPayload }
  | { t: "presence"; buffering: boolean }
  | { t: "presence"; enc: string }
  | { t: "chat"; text?: string; enc?: string }
  | { t: "lobby"; state: PartyLobbyState }
  | { t: "close" }
  | { t: "ping" };

import { getPartyHttpBase } from "./servers";

export { getPartyHttpBase, getPartyServers, serverHost } from "./servers";

export function partySocketUrl(code: string, name: string, base?: string): string {
  const http = getPartyHttpBase(base);
  const ws = http.replace(/^http/, "ws");
  return `${ws}/party/${code.toUpperCase()}/socket?name=${encodeURIComponent(name)}`;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código generable en cliente (el servidor solo lo reclama). */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto?.getRandomValues?.(bytes);
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    const byte = bytes[i] || Math.floor(Math.random() * 256);
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

export function isCompleteRoomCode(raw: string): boolean {
  return normalizeRoomCode(raw).length === 6;
}

/** Contenido en claro o sobre cifrado ("iv.ciphertext"). */
export type PartyMediaPayload = PartyMedia | { enc: string };
/** Oferta en claro o sobre cifrado. */
export type PartyStreamPayload = PartyStreamOffer | { enc: string };

export function isEncryptedPayload(value: unknown): value is { enc: string } {
  if (!value || typeof value !== "object") return false;
  const enc = (value as Record<string, unknown>).enc;
  return typeof enc === "string" && enc.length > 0 && (value as Record<string, unknown>).target === undefined;
}

/** Clave canónica de contenido para comparar "¿vemos lo mismo?". */
export function partyMediaKey(media: Pick<PartyMedia, "type" | "id" | "season" | "episode"> | null | undefined): string {
  if (!media) return "";
  return `${media.type}:${media.id}:${media.season ?? ""}:${media.episode ?? ""}`;
}

export function randomClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

// ---------------------------------------------------------------------------
// Anti-replay: el servidor sella `at`, pero un operador malicioso puede
// reinyectar eventos viejos o inventar futuros. Todo evento debe ser fresco
// (ventana contra relojes malos) y monótono por peer (estrictamente mayor
// que el último aceptado de ese peer).
// ---------------------------------------------------------------------------

export const PARTY_FRESH_PAST_MS = 120_000;
export const PARTY_FRESH_FUTURE_MS = 30_000;

/** ¿Aceptar un evento con sello `at` de este peer? Actualiza `seen`. */
export function acceptFreshEvent(seen: Record<string, number>, from: string, at: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(at)) return false;
  if (at < now - PARTY_FRESH_PAST_MS || at > now + PARTY_FRESH_FUTURE_MS) return false;
  if (at <= (seen[from] ?? 0)) return false;
  seen[from] = at;
  return true;
}
