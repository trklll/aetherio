/**
 * Aetherio Party — sala de visionado sincronizado.
 *
 * El servidor NO toca video: solo retransmite eventos de control (play/pausa/seek),
 * cambios de contenido y chat entre los miembros de una sala. Cada app resuelve su
 * propio stream con sus addons para el mismo {type,id,season,episode}; por eso el
 * addon que use cada uno da igual.
 *
 * Despliegue: `npm install && npm run deploy` (requiere wrangler logueado).
 * La app apunta aquí con VITE_PARTY_SERVER_URL (https base; el WS se deriva solo).
 */

interface Env {
  PARTY_ROOMS: DurableObjectNamespace;
}

// ---------------------------------------------------------------------------
// Protocolo (espejo en src/party/protocol.ts — mantener sincronizados).
// ---------------------------------------------------------------------------

type ClientMessage =
  | { t: "hello"; name: string; clientId: string; identity?: unknown }
  | { t: "control"; kind?: unknown; position?: unknown; enc?: unknown }
  | { t: "media"; media: unknown }
  | { t: "stream"; offer: unknown }
  | { t: "presence"; buffering?: unknown; enc?: unknown }
  | { t: "chat"; text?: unknown; enc?: unknown }
  | { t: "lobby"; state?: unknown }
  | { t: "close" }
  | { t: "ping" };

interface PartyStreamOffer {
  target: string;
  kind: string;
  fileIdx?: number;
  headers?: Record<string, unknown>;
  label?: string;
}

interface PartyMedia {
  type: string;
  id: string;
  season?: number;
  episode?: number;
  title?: string;
}

interface PeerInfo {
  id: string;
  name: string;
  isOwner: boolean;
  identity?: string;
}

const MAX_CHAT_LEN = 500;
const MAX_NAME_LEN = 32;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ---------------------------------------------------------------------------
// Worker: crear sala + enrutar WS al Durable Object.
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method === "POST" && url.pathname === "/party/create") {
      let body: { code?: unknown; media?: unknown; protected?: unknown; probe?: unknown; name?: unknown } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      // El código lo genera el cliente (la clave E2E deriva de él y el
      // servidor nunca debe ver material de clave). Aquí solo se reclama.
      const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        return json({ ok: false, error: "código inválido" }, 400);
      }
      const stub = env.PARTY_ROOMS.get(env.PARTY_ROOMS.idFromName(code));
      const claim = (await stub.fetch(
        new Request("https://party/__claim", {
          method: "POST",
          body: JSON.stringify({ media: body.media ?? null, protected: body.protected === true, probe: body.probe ?? "" }),
        }),
      ).then((r) => r.json())) as { ok: boolean; error?: string };
      if (claim.ok) return json({ ok: true, code });
      return json({ ok: false, taken: true });
    }

    const socketMatch = url.pathname.match(/^\/party\/([A-Za-z0-9]{6})\/socket$/);
    if (socketMatch && request.headers.get("Upgrade") === "websocket") {
      const code = socketMatch[1].toUpperCase();
      const stub = env.PARTY_ROOMS.get(env.PARTY_ROOMS.idFromName(code));
      // Reenviar tal cual al DO (conserva query ?name=).
      return stub.fetch(request);
    }

    if (url.pathname === "/health") return json({ ok: true });

    return json({ error: "not found" }, 404);
  },
};

// ---------------------------------------------------------------------------
// Durable Object: una instancia por código de sala.
// ---------------------------------------------------------------------------

interface Peer {
  id: string;
  name: string;
  joinedAt: number;
  socket: WebSocket;
  lastPresence?: boolean;
  identity?: string;
  clientId?: string;
}

// Si el anfitrión se desconecta sin cerrar (cuelgue, app muerta), la sala
// espera su regreso este tiempo y luego MUERE (sin migrar el dueño).
const OWNER_GRACE_MS = 20_000;
const MAX_CLIENTID_LEN = 64;

export class PartyRoom implements DurableObject {
  private peers = new Map<WebSocket, Peer>();
  private ownerId: string | null = null;
  private media: PartyMedia | { enc: string } | null = null;
  /** Sala de espera: el anfitrión retiene el inicio hasta dar "Empezar". */
  private lobbyWaiting = false;
  private isProtected = false;
  private probe = "";
  /** Gracia del anfitrión: clientId esperado + cuándo se fue + timer vivo. */
  private ownerClientId: string | null = null;
  private ownerLeftAt: number | null = null;
  private destroyTimer: ReturnType<typeof setTimeout> | null = null;
  private claimed = false;
  private hydrated = false;

  constructor(private state: DurableObjectState) {}

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    this.claimed = (await this.state.storage.get<boolean>("claimed")) ?? false;
    this.isProtected = (await this.state.storage.get<boolean>("protected")) ?? false;
    this.probe = (await this.state.storage.get<string>("probe")) ?? "";
    this.media = (await this.state.storage.get<PartyMedia | { enc: string }>("media")) ?? null;
    this.ownerClientId = (await this.state.storage.get<string>("ownerClientId")) ?? null;
    this.ownerLeftAt = (await this.state.storage.get<number>("ownerLeftAt")) ?? null;
  }

  /** La gracia venció (tras evicción del DO el timer en memoria muere: se evalúa perezoso). */
  private ownerGraceExpired(): boolean {
    return (
      this.ownerId === null &&
      this.ownerClientId !== null &&
      this.ownerLeftAt !== null &&
      Date.now() - this.ownerLeftAt > OWNER_GRACE_MS
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    await this.hydrate();
    if (this.ownerGraceExpired()) this.destroyRoom();

    // Reclamo interno desde /party/create.
    if (url.pathname === "/__claim" && request.method === "POST") {
      if (this.claimed) {
        return json({ ok: false });
      }
      let body: { media?: unknown; protected?: boolean; probe?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const media = sanitizeMediaPayload(body.media);
      if (body.media !== undefined && body.media !== null && !media) {
        return json({ ok: false, error: "contenido inválido" });
      }
      const isProtected = body.protected === true;
      const probe = typeof body.probe === "string" ? body.probe.slice(0, 1024) : "";
      if (isProtected && !probe) {
        return json({ ok: false, error: "falta probe" });
      }
      this.claimed = true;
      this.media = media;
      this.isProtected = isProtected;
      this.probe = probe;
      await this.state.storage.put("claimed", true);
      await this.state.storage.put("protected", isProtected);
      if (probe) await this.state.storage.put("probe", probe);
      if (media) await this.state.storage.put("media", media);
      return json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    if (!this.claimed) {
      return new Response("sala inexistente", { status: 404 });
    }

    const name = sanitizeName(url.searchParams.get("name") ?? "Invitado");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const peerId = crypto.randomUUID();

    this.state.acceptWebSocket(server);
    const peer: Peer = { id: peerId, name, joinedAt: Date.now(), socket: server };
    this.peers.set(server, peer);
    // Durante la gracia del anfitrión nadie roba la propiedad: solo el
    // anfitrión que vuelve (mismo clientId, ver "hello") la recupera.
    if (!this.ownerId && !this.ownerClientId) this.ownerId = peerId;

    server.serializeAttachment({ peerId });
    this.send(server, {
      t: "welcome",
      peerId,
      isOwner: peerId === this.ownerId,
      serverTime: Date.now(),
      media: this.media,
      protected: this.isProtected,
      lobbyWaiting: this.lobbyWaiting,
      ...(this.probe ? { probe: this.probe } : {}),
    });
    this.broadcastPeers();
    this.broadcast({ t: "peer-joined", peer: this.info(peer) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const peer = this.peers.get(socket);
    if (!peer || typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const now = Date.now();

    switch (msg.t) {
      case "hello": {
        peer.name = sanitizeName(msg.name || peer.name);
        const clientId = sanitizeClientId(msg.clientId);
        if (clientId) peer.clientId = clientId;
        if (this.ownerClientId && clientId && clientId === this.ownerClientId && !this.ownerId) {
          // El anfitrión volvió dentro de la gracia: recupera su sala.
          this.ownerId = peer.id;
          this.clearOwnerGrace();
        }
        const identity = sanitizeIdentity(msg.identity);
        if (identity) peer.identity = identity;
        this.send(socket, {
          t: "welcome",
          peerId: peer.id,
          isOwner: peer.id === this.ownerId,
          serverTime: now,
          media: this.media,
          protected: this.isProtected,
          lobbyWaiting: this.lobbyWaiting,
          ...(this.probe ? { probe: this.probe } : {}),
        });
        this.broadcastPeers();
        break;
      }
      case "lobby": {
        // Solo el anfitrión retiene/libera el inicio. Estado en claro: no
        // lleva nombres ni contenido, solo "waiting" | "started".
        if (peer.id !== this.ownerId) return;
        if (msg.state !== "waiting" && msg.state !== "started") return;
        this.lobbyWaiting = msg.state === "waiting";
        this.broadcast({ t: "lobby", state: msg.state, from: peer.id, at: now }, socket);
        break;
      }
      case "control": {        // Variante cifrada (salas protegidas): el servidor no la puede leer
        // ni forjar; solo la sella y reenvía. Variante clásica validada.
        const enc = typeof msg.enc === "string" ? msg.enc.slice(0, MAX_ENC_LEN) : "";
        if (enc) {
          this.broadcast({ t: "control", enc, from: peer.id, at: now });
          break;
        }
        if (msg.kind !== "play" && msg.kind !== "pause" && msg.kind !== "seek") return;
        if (!Number.isFinite(msg.position) || (msg.position as number) < 0) return;
        // El servidor solo sella tiempo: el cliente aplica last-writer-wins con `at`.
        this.broadcast({ t: "control", kind: msg.kind, position: msg.position, from: peer.id, at: now });
        break;
      }
      case "media": {
        const media = sanitizeMediaPayload(msg.media);
        if (!media) return;
        this.media = media;
        await this.state.storage.put("media", media);
        this.broadcast({ t: "media", media, from: peer.id, at: now });
        break;
      }
      case "chat": {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, MAX_CHAT_LEN) : "";
        const enc = typeof msg.enc === "string" ? msg.enc.slice(0, MAX_ENC_LEN) : "";
        if (!text && !enc) return;
        this.broadcast({
          t: "chat",
          id: crypto.randomUUID(),
          from: peer.id,
          name: peer.name,
          ...(text ? { text } : { enc }),
          at: now,
        });
        break;
      }
      case "stream": {
        const offer = sanitizeStreamPayload(msg.offer);
        if (!offer) return;
        this.broadcast({ t: "stream", offer, from: peer.id, at: now });
        break;
      }
      case "presence": {
        // Variante cifrada (salas protegidas) o clásica con dedup.
        const presenceEnc = typeof msg.enc === "string" ? msg.enc.slice(0, MAX_ENC_LEN) : "";
        if (presenceEnc) {
          this.broadcast({ t: "presence", from: peer.id, name: peer.name, enc: presenceEnc, at: now });
          break;
        }
        // Solo reenviar cambios (el cliente ya filtra, esto es cinturón).
        if (typeof msg.buffering !== "boolean") return;
        if (peer.lastPresence === msg.buffering) return;
        peer.lastPresence = msg.buffering;
        this.broadcast({ t: "presence", from: peer.id, name: peer.name, buffering: msg.buffering, at: now });
        break;
      }
      case "close": {
        // Solo el anfitrión puede matar la sala (sale de reproducción).
        if (peer.id !== this.ownerId) return;
        this.destroyRoom();
        break;
      }
      case "ping": {
        this.send(socket, { t: "pong", serverTime: now });
        break;
      }
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.handleLeave(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.handleLeave(socket);
  }

  private handleLeave(socket: WebSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    try {
      socket.close();
    } catch {
      // Ya cerrado.
    }
    if (this.peers.size === 0) {
      // Nadie conectado: la sala muere (no quedan códigos reclamados zombis).
      this.destroyRoom();
      return;
    }
    if (peer.id === this.ownerId) {
      // El anfitrión se fue: la sala MUERE (sin migración de dueño). Gracia
      // corta por si vuelve (mismo clientId); si no, se destruye.
      this.ownerId = null;
      this.ownerClientId = peer.clientId ?? null;
      this.ownerLeftAt = Date.now();
      void this.state.storage.put("ownerClientId", this.ownerClientId ?? "");
      void this.state.storage.put("ownerLeftAt", this.ownerLeftAt);
      this.broadcast({ t: "peer-left", peerId: peer.id });
      this.broadcastPeers();
      if (this.destroyTimer) clearTimeout(this.destroyTimer);
      this.destroyTimer = setTimeout(() => {
        this.destroyTimer = null;
        this.destroyRoom();
      }, OWNER_GRACE_MS);
      return;
    }
    this.broadcast({ t: "peer-left", peerId: peer.id });
    this.broadcastPeers();
  }

  private clearOwnerGrace(): void {
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    this.ownerClientId = null;
    this.ownerLeftAt = null;
    void this.state.storage.delete("ownerClientId");
    void this.state.storage.delete("ownerLeftAt");
  }

  /** Mata la sala: avisa a los conectados, cierra sockets y libera el código. */
  private destroyRoom(): void {
    this.clearOwnerGrace();
    // Limpiar el mapa ANTES de cerrar: los onclose reentrantes no hacen nada.
    const sockets = [...this.peers.keys()];
    this.peers.clear();
    for (const socket of sockets) {
      try {
        socket.send(JSON.stringify({ t: "room-closed" }));
      } catch {
        // Se cierra igual abajo.
      }
      try {
        socket.close(1000, "room-closed");
      } catch {
        // Ya cerrado.
      }
    }
    this.ownerId = null;
    this.media = null;
    this.isProtected = false;
    this.probe = "";
    this.lobbyWaiting = false;
    this.claimed = false;
    void this.state.storage.put("claimed", false);
    void this.state.storage.put("protected", false);
    void this.state.storage.put("probe", "");
    void this.state.storage.put("media", null);
  }

  private info(peer: Peer): PeerInfo {
    return {
      id: peer.id,
      name: peer.name,
      isOwner: peer.id === this.ownerId,
      ...(peer.identity ? { identity: peer.identity } : {}),
    };
  }

  private broadcastPeers(): void {
    this.broadcast({ t: "peers", peers: [...this.peers.values()].map((p) => this.info(p)) });
  }

  private broadcast(payload: unknown, except?: WebSocket): void {
    const text = JSON.stringify(payload);
    for (const socket of this.peers.keys()) {
      if (socket === except) continue;
      try {
        socket.send(text);
      } catch {
        // Se limpia en el close.
      }
    }
  }

  private send(socket: WebSocket, payload: unknown): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // Se limpia en el close.
    }
  }
}

function sanitizeName(raw: string): string {
  const clean = raw.trim().slice(0, MAX_NAME_LEN);
  return clean || "Invitado";
}

function sanitizeClientId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_CLIENTID_LEN);
}

const MAX_IDENTITY_LEN = 256;
const IDENTITY_RE = /^[A-Za-z0-9+/=_-]+$/;

/** Pública efímera del miembro: forma y tamaño; el fingerprint lo verifica el cliente. */
function sanitizeIdentity(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_IDENTITY_LEN) return "";
  return IDENTITY_RE.test(raw) ? raw : "";
}

const MAX_STREAM_TARGET_LEN = 4096;
const MAX_STREAM_HEADERS = 10;
const MAX_ENC_LEN = 8192;

function isEncEnvelope(raw: unknown): raw is { enc: string } {
  if (!raw || typeof raw !== "object") return false;
  const enc = (raw as Record<string, unknown>).enc;
  return typeof enc === "string" && enc.length > 0 && enc.length <= MAX_ENC_LEN;
}

/** Acepta contenido en claro validado o sobre cifrado opaco. */
function sanitizeMediaPayload(raw: unknown): PartyMedia | { enc: string } | null {
  if (isEncEnvelope(raw)) return { enc: (raw as { enc: string }).enc };
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.type !== "string" || typeof input.id !== "string") return null;
  const media: PartyMedia = { type: input.type, id: input.id };
  if (typeof input.season === "number" && Number.isFinite(input.season)) media.season = Math.trunc(input.season);
  if (typeof input.episode === "number" && Number.isFinite(input.episode)) media.episode = Math.trunc(input.episode);
  if (typeof input.title === "string" && input.title.trim()) media.title = input.title.trim().slice(0, 120);
  return media;
}

/** Acepta oferta en claro validada o sobre cifrado opaco. */
function sanitizeStreamPayload(raw: unknown): PartyStreamOffer | { enc: string } | null {
  if (isEncEnvelope(raw)) return { enc: (raw as { enc: string }).enc };
  return sanitizeStreamOffer(raw);
}

// Topes al puntero compartido: el saneo fino (nada local/privado, sin
// credenciales) lo hace el cliente antes de enviar; aquí solo forma y tamaño.
function sanitizeStreamOffer(raw: unknown): PartyStreamOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const target = typeof input.target === "string" ? input.target.trim() : "";
  if (!target || target.length > MAX_STREAM_TARGET_LEN) return null;
  if (input.kind !== "https" && input.kind !== "p2p") return null;
  if (input.kind === "https" && !/^https?:/i.test(target)) return null;
  if (input.kind === "p2p" && !/^magnet:/i.test(target)) return null;
  const offer: PartyStreamOffer = { target, kind: input.kind };
  if (typeof input.fileIdx === "number" && Number.isFinite(input.fileIdx)) offer.fileIdx = Math.trunc(input.fileIdx);
  if (typeof input.label === "string" && input.label.trim()) offer.label = input.label.trim().slice(0, 120);
  if (input.headers && typeof input.headers === "object") {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.headers as Record<string, unknown>)) {
      if (Object.keys(headers).length >= MAX_STREAM_HEADERS) break;
      if (typeof value !== "string") continue;
      const cleanKey = key.trim().slice(0, 64);
      const cleanValue = value.trim().slice(0, 512);
      if (cleanKey && cleanValue) headers[cleanKey] = cleanValue;
    }
    if (Object.keys(headers).length > 0) offer.headers = headers;
  }
  return offer;
}
