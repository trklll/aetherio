import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyRoom } from "./index";

interface FakeSocket {
  sent: string[];
  closed: { code?: number; reason?: string } | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(_value: unknown): void;
  readyState: number;
}

function makeSocket(): FakeSocket {
  return {
    sent: [],
    closed: null,
    readyState: 1,
    send(data: string) { this.sent.push(data); },
    close(code?: number, reason?: string) { this.closed = { code, reason }; },
    serializeAttachment() { /* noop */ },
  };
}

function mockState() {
  const store = new Map<string, unknown>();
  return {
    store,
    storage: {
      get: async (key: string) => (store.has(key) ? store.get(key) : undefined),
      put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
        if (typeof keyOrEntries === "string") store.set(keyOrEntries, value);
        else for (const [key, entry] of Object.entries(keyOrEntries)) store.set(key, entry);
      },
      delete: async (key: string) => { store.delete(key); },
    },
    acceptWebSocket: () => { /* noop */ },
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

function seedRoom(state: ReturnType<typeof mockState>) {
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
