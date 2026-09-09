import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyRoom } from "./index";

interface FakeSocket {
  sent: string[];
  closed: { code?: number; reason?: string } | null;
  attachment: unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  readyState: number;
}

function makeSocket(): FakeSocket {
  return {
    sent: [],
    closed: null,
    attachment: null,
    readyState: 1,
    send(data: string) { this.sent.push(data); },
    close(code?: number, reason?: string) { this.closed = { code, reason }; },
    serializeAttachment(value: unknown) { this.attachment = value; },
    deserializeAttachment() { return this.attachment; },
  };
}

function mockState() {
  const store = new Map<string, unknown>();
  const liveSockets: FakeSocket[] = [];
  return {
    store,
    liveSockets,
    storage: {
      get: async (key: string) => (store.has(key) ? store.get(key) : undefined),
      put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
        if (typeof keyOrEntries === "string") store.set(keyOrEntries, value);
        else for (const [key, entry] of Object.entries(keyOrEntries)) store.set(key, entry);
      },
      delete: async (key: string) => { store.delete(key); },
    },
    acceptWebSocket: () => { /* noop */ },
    getWebSockets: () => [...liveSockets],
  };
}

type RoomAny = {
  peers: Map<unknown, { id: string; name: string; joinedAt: number; socket: FakeSocket; clientId?: string }>;
  ownerId: string | null;
  claimed: boolean;
  handleLeave(socket: unknown): void;
  destroyRoom(): void;
  webSocketMessage(socket: unknown, raw: string): Promise<void> | void;
};

type MockState = ReturnType<typeof mockState>;

function seedRoom(state: MockState) {
  state.store.set("claimed", true);
  state.store.set("protected", false);
  state.store.set("probe", "");
  state.store.set("media", null);
  return new PartyRoom(state as never) as unknown as RoomAny;
}

function joinPeer(room: RoomAny, socket: FakeSocket, peerId: string, name: string, clientId?: string) {
  room.peers.set(socket, { id: peerId, name, joinedAt: Date.now(), socket, ...(clientId ? { clientId } : {}) });
  if (!room.ownerId) room.ownerId = peerId;
}

/**
 * Imita el camino real de accept + hello: inserta en el mapa, guarda el
 * attachment que sobreviviría a una evicción y registra el socket como
 * hibernado vivo. Si no hay dueño, el primero lo es (misma regla que el DO).
 */
function attachPeer(
  room: RoomAny,
  state: MockState,
  socket: FakeSocket,
  peerId: string,
  name: string,
  opts?: { clientId?: string; identity?: string; joinedAt?: number },
) {
  const joinedAt = opts?.joinedAt ?? Date.now();
  room.peers.set(socket, {
    id: peerId,
    name,
    joinedAt,
    socket,
    ...(opts?.clientId ? { clientId: opts.clientId } : {}),
  });
  socket.serializeAttachment({
    peerId,
    name,
    joinedAt,
    ...(opts?.clientId ? { clientId: opts.clientId } : {}),
    ...(opts?.identity ? { identity: opts.identity } : {}),
  });
  state.liveSockets.push(socket);
  if (!room.ownerId && !state.store.has("ownerClientId")) {
    room.ownerId = peerId;
    state.store.set("ownerPeerId", peerId);
  }
}

describe("muerte de sala Party", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("close del anfitrión: avisa room-closed, cierra sockets y libera el código", async () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");
    joinPeer(room, guest, "guest-1", "Invitado", "client-guest");

    await room.webSocketMessage(host, JSON.stringify({ t: "close" }));

    for (const socket of [host, guest]) {
      expect(socket.sent.map(raw => JSON.parse(raw).t)).toContain("room-closed");
      expect(socket.closed).toEqual({ code: 1000, reason: "room-closed" });
    }
    expect(room.ownerId).toBeNull();
    expect(state.store.get("claimed")).toBe(false);
    expect(state.store.get("media")).toBeNull();
  });

  it("close de un invitado: se ignora, la sala sigue viva", async () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");
    joinPeer(room, guest, "guest-1", "Invitado", "client-guest");

    await room.webSocketMessage(guest, JSON.stringify({ t: "close" }));

    expect(host.closed).toBeNull();
    expect(guest.closed).toBeNull();
    expect(room.ownerId).toBe("owner-1");
    expect(state.store.get("claimed")).toBe(true);
  });

  it("invitado que se va: la sala sobrevive y avisa peer-left", () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");
    joinPeer(room, guest, "guest-1", "Invitado", "client-guest");

    room.handleLeave(guest);

    expect(room.ownerId).toBe("owner-1");
    expect(state.store.get("claimed")).toBe(true);
    expect(host.sent.map(raw => JSON.parse(raw).t)).toContain("peer-left");
  });

  it("anfitrión que se cae con invitados: gracia y luego MUERE si no vuelve", () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");
    joinPeer(room, guest, "guest-1", "Invitado", "client-guest");

    room.handleLeave(host);

    // Gracia: la sala sigue reclamada y avisa la salida.
    expect(state.store.get("claimed")).toBe(true);
    expect(guest.sent.map(raw => JSON.parse(raw).t)).toContain("peer-left");

    vi.advanceTimersByTime(20_000);

    expect(guest.sent.map(raw => JSON.parse(raw).t)).toContain("room-closed");
    expect(guest.closed).toEqual({ code: 1000, reason: "room-closed" });
    expect(state.store.get("claimed")).toBe(false);
  });

  it("anfitrión que vuelve en la gracia (mismo clientId): recupera la sala", async () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");
    joinPeer(room, guest, "guest-1", "Invitado", "client-guest");

    room.handleLeave(host);

    const hostAgain = makeSocket();
    room.peers.set(hostAgain, { id: "owner-2", name: "Anfitrión", joinedAt: Date.now(), socket: hostAgain });
    await room.webSocketMessage(hostAgain, JSON.stringify({ t: "hello", name: "Anfitrión", clientId: "client-host" }));

    expect(room.ownerId).toBe("owner-2");

    vi.advanceTimersByTime(60_000);

    expect(state.store.get("claimed")).toBe(true);
    expect(guest.closed).toBeNull();
  });

  it("último en salir: la sala muere al instante (sin zombis)", () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");

    room.handleLeave(host);

    expect(state.store.get("claimed")).toBe(false);
  });
});

describe("evicción del DO con sockets hibernados", () => {
  function peersMessage(socket: FakeSocket) {
    const found = socket.sent.map(raw => JSON.parse(raw)).filter(msg => msg.t === "peers");
    return found[found.length - 1];
  }

  it("despertar: conserva UN solo dueño y re-sincroniza a todos (sin doble anfitrión)", async () => {
    const state = mockState();
    const before = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    attachPeer(before, state, host, "owner-1", "Anfitrión", { clientId: "client-host", joinedAt: 1000 });
    attachPeer(before, state, guest, "guest-1", "Invitado", { clientId: "client-guest", joinedAt: 2000 });

    // Evicción: instancia nueva con la memoria vacía, misma storage y mismos sockets vivos.
    const after = new PartyRoom(state as never) as unknown as RoomAny;
    expect(after.ownerId).toBeNull();
    expect(after.peers.size).toBe(0);
    host.sent = [];
    guest.sent = [];

    // Cualquier evento (aquí un ping) despierta y reconcilia.
    await after.webSocketMessage(host, JSON.stringify({ t: "ping" }));

    expect(after.peers.size).toBe(2);
    expect(after.ownerId).toBe("owner-1");
    // El fantasma sanó: el ping vuelve a responderse.
    expect(host.sent.map(raw => JSON.parse(raw).t)).toContain("pong");
    for (const socket of [host, guest]) {
      const msg = peersMessage(socket);
      expect(msg.peers).toHaveLength(2);
      expect(msg.peers.find((peer: { id: string }) => peer.id === "owner-1").isOwner).toBe(true);
      expect(msg.peers.find((peer: { id: string }) => peer.id === "guest-1").isOwner).toBe(false);
    }
  });

  it("despertar con la gracia vencida: la sala muere en vez de pudrirse", async () => {
    const state = mockState();
    state.store.set("claimed", true);
    state.store.set("protected", false);
    state.store.set("media", null);
    state.store.set("ownerClientId", "client-host");
    state.store.set("ownerLeftAt", Date.now() - 60_000);
    const guest = makeSocket();
    guest.serializeAttachment({ peerId: "guest-1", name: "Invitado", joinedAt: 2000, clientId: "client-guest" });
    state.liveSockets.push(guest);

    const after = new PartyRoom(state as never) as unknown as RoomAny;
    await after.webSocketMessage(guest, JSON.stringify({ t: "ping" }));

    expect(guest.sent.map(raw => JSON.parse(raw).t)).toContain("room-closed");
    expect(state.store.get("claimed")).toBe(false);
  });

  it("hello del dueño persiste ownerPeerId para sobrevivir evicciones", async () => {
    const state = mockState();
    const room = seedRoom(state);
    const host = makeSocket();
    const guest = makeSocket();
    joinPeer(room, host, "owner-1", "Anfitrión", "client-host");
    joinPeer(room, guest, "guest-1", "Invitado", "client-guest");

    room.handleLeave(host);

    const hostAgain = makeSocket();
    room.peers.set(hostAgain, { id: "owner-2", name: "Anfitrión", joinedAt: Date.now(), socket: hostAgain });
    await room.webSocketMessage(hostAgain, JSON.stringify({ t: "hello", name: "Anfitrión", clientId: "client-host" }));

    expect(room.ownerId).toBe("owner-2");
    expect(state.store.get("ownerPeerId")).toBe("owner-2");
  });
});
