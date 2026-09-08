import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  acceptFreshEvent,
  generateRoomCode,
  getPartyHttpBase,
  isCompleteRoomCode,
  isEncryptedPayload,
  normalizeRoomCode,
  partySocketUrl,
  randomClientId,
  type PartyChatMessage,
  type PartyClientMessage,
  type PartyControlEvent,
  type PartyMedia,
  type PartyMediaEvent,
  type PartyMediaPayload,
  type PartyLobbyEvent,
  type PartyLobbyState,
  type PartyPeer,
  type PartyPresence,
  type PartyServerMessage,
  type PartyStreamEvent,
  type PartyStreamOffer,
  type PartyStreamPayload,
} from "./protocol";
import {
  createRoomProbe,
  decryptRoomJson,
  deriveRoomKey,
  encryptRoomJson,
  fingerprintIdentity,
  generateRoomIdentity,
  verifyRoomProbe,
  type IdentityFingerprint,
} from "./crypto";
import { pickHealthyServer, getPartyServers, probePartyServer } from "./servers";

export type PartyStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

interface PartyContextValue {
  status: PartyStatus;
  roomCode: string;
  displayName: string;
  selfId: string;
  isOwner: boolean;
  peers: PartyPeer[];
  media: PartyMedia | null;
  lastControl: PartyControlEvent | null;
  lastMediaEvent: PartyMediaEvent | null;
  /** Último puntero de stream compartido (siempre la fuente del anfitrión). */
  lastStreamOffer: PartyStreamEvent | null;
  /** Miembros en buffering ahora mismo (para esperarlos). */
  bufferingPeers: PartyPresence[];
  /** Sala de espera activa: inicio retenido hasta que el anfitrión da "Empezar". */
  lobby: boolean;
  /** Último evento de sala de espera (waiting/started). */
  lastLobbyEvent: PartyLobbyEvent | null;
  /** Anuncia sala de espera (el servidor solo lo acepta del anfitrión). */
  sendLobby: (state: PartyLobbyState) => void;
  /** La sala cifra chat/contenido/stream de extremo a extremo. */
  roomProtected: boolean;
  /** Fingerprints de identidades vistas (verificación fuera de banda). */
  peerPrints: Record<string, IdentityFingerprint>;
  /** Fingerprints completos marcados como verificados por el usuario. */
  verifiedPrints: string[];
  toggleVerifiedPrint: (full: string) => void;
  /** Aviso transitorio (spam, ofertas, etc.). */
  notice: string | null;
  notify: (message: string) => void;
  chat: PartyChatMessage[];
  error: string | null;
  /** Crea la sala en el servidor (el anfitrión la "hostea") y conecta. */
  createRoom: (media: PartyMedia | null, name: string, password?: string) => Promise<string>;
  /** Entra a una sala existente con el código (+ contraseña si la tiene). */
  joinRoom: (code: string, name: string, password?: string, server?: string) => void;
  /** Servidor actual de la sala (base https). */
  roomServer: string;
  /** Reintenta la conexión con la misma sala (tras un error). */
  retryConnection: () => void;
  /**
   * Migra la sala a otro servidor sano con el mismo contenido y contraseña.
   * Devuelve el nuevo código (hay que compartirlo fuera de la app).
   */
  migrateRoom: () => Promise<string | null>;
  leaveRoom: () => void;
  /**
   * Mata la sala (solo anfitrión): avisa al servidor para que la destruya y
   * sale localmente. Si se sale de reproducción siendo anfitrión, la sala MUERE.
   */
  closeRoom: () => void;
  setDisplayName: (name: string) => void;
  sendControl: (kind: "play" | "pause" | "seek", position: number) => void;
  sendMedia: (media: PartyMedia) => void;
  sendStream: (offer: PartyStreamOffer) => void;
  sendPresence: (buffering: boolean) => void;
  sendChat: (text: string) => void;
  /** Marca que se acaba de aplicar una acción remota (ventana anti-eco del player). */
  noteRemoteApplied: () => void;
  lastRemoteAppliedAt: () => number;
}

const PartyContext = createContext<PartyContextValue | null>(null);

const PING_INTERVAL_MS = 25_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECTS = 3;
const ROOM_IDENTITY_PREFIX = "aetherio-party-identity:";
const VERIFIED_PRINTS_KEY = "aetherio-party-verified";

function readVerifiedPrints(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(VERIFIED_PRINTS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Identidad estable por dispositivo y sala (TOFU): se compara fuera de banda. */
async function getRoomIdentity(code: string): Promise<string | undefined> {
  try {
    const stored = localStorage.getItem(ROOM_IDENTITY_PREFIX + code);
    if (stored) return stored;
    const { spkiB64 } = await generateRoomIdentity();
    localStorage.setItem(ROOM_IDENTITY_PREFIX + code, spkiB64);
    return spkiB64;
  } catch {
    return undefined;
  }
}

export function PartyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PartyStatus>("idle");
  const [roomCode, setRoomCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selfId, setSelfId] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [peers, setPeers] = useState<PartyPeer[]>([]);
  const [media, setMedia] = useState<PartyMedia | null>(null);
  const [lastControl, setLastControl] = useState<PartyControlEvent | null>(null);
  const [lastMediaEvent, setLastMediaEvent] = useState<PartyMediaEvent | null>(null);
  const [lastStreamOffer, setLastStreamOffer] = useState<PartyStreamEvent | null>(null);
  const [bufferingPeers, setBufferingPeers] = useState<PartyPresence[]>([]);
  const [lobby, setLobby] = useState(false);
  const [lastLobbyEvent, setLastLobbyEvent] = useState<PartyLobbyEvent | null>(null);
  const [roomProtected, setRoomProtected] = useState(false);
  const [peerPrints, setPeerPrints] = useState<Record<string, IdentityFingerprint>>({});
  const [verifiedPrints, setVerifiedPrints] = useState<string[]>(readVerifiedPrints);
  const [notice, setNotice] = useState<string | null>(null);
  const [roomServer, setRoomServer] = useState<string>("");
  const [chat, setChat] = useState<PartyChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef(randomClientId());
  const nameRef = useRef("");
  const codeRef = useRef("");
  const reconnectsRef = useRef(0);
  const reconnectTimerRef = useRef(0);
  const pingTimerRef = useRef(0);
  const lastRemoteAppliedRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  // Clave E2E de la sala (solo memoria, nunca se envía) + contraseña
  // pendiente de verificar al entrar.
  const roomKeyRef = useRef<CryptoKey | null>(null);
  const pendingPasswordRef = useRef<string | null>(null);
  const usedPasswordRef = useRef<string | null>(null);
  const identityRef = useRef<string | undefined>(undefined);
  const baseRef = useRef<string>("");
  // Pongs pendientes (detección de degradado).
  const pingsSentRef = useRef(0);
  const pongsGotRef = useRef(0);
  const degradedNotifiedRef = useRef(false);
  // Sellos `at` aceptados por peer (anti-replay) + avisos transitorios.
  const freshRef = useRef<Record<string, number>>({});
  const noticeTimerRef = useRef(0);
  const statusRef = useRef<PartyStatus>("idle");
  statusRef.current = status;
  // Espejo de miembros para filtrar ofertas por anfitrión dentro de handlers.
  const peersRef = useRef<PartyPeer[]>([]);
  peersRef.current = peers;

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);

  const cleanupSocket = useCallback(() => {
    window.clearTimeout(reconnectTimerRef.current);
    window.clearInterval(pingTimerRef.current);
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close();
      } catch {
        // Ya cerrado.
      }
    }
  }, []);

  const send = useCallback((message: PartyClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Se reintentará en la reconexión.
    }
  }, []);

  const lastSentPresenceRef = useRef<boolean | null>(null);

  const sendPresence = useCallback((buffering: boolean) => {
    // Solo cambios: evita spamear a la sala con el mismo estado.
    if (lastSentPresenceRef.current === buffering) return;
    lastSentPresenceRef.current = buffering;
    const key = roomKeyRef.current;
    if (!key) {
      send({ t: "presence", buffering });
      return;
    }
    void encryptRoomJson(key, { buffering })
      .then(enc => send({ t: "presence", enc }))
      .catch(() => setError("No se pudo cifrar la presencia."));
  }, [send]);

  const sendLobby = useCallback((state: PartyLobbyState) => {
    // Estado en claro a propósito: no lleva nombres ni contenido.
    send({ t: "lobby", state });
    setLobby(state === "waiting");
    setLastLobbyEvent({ state, from: selfIdRefSafe(), at: Date.now() });
  }, [send]);

  // Aplica contenido/stream/chat entrantes, descifrando si la sala es protegida.
  const applyMediaPayload = (payload: PartyMediaPayload, from: string, at: number) => {
    if (isEncryptedPayload(payload)) {
      const key = roomKeyRef.current;
      if (!key) return;
      void decryptRoomJson<PartyMedia>(key, payload.enc)
        .then(media => {
          setMedia(media);
          setLastMediaEvent({ media, from, at });
        })
        .catch(() => setError("No se pudo descifrar el contenido."));
      return;
    }
    setMedia(payload);
    setLastMediaEvent({ media: payload, from, at });
  };

  const applyStreamPayload = (payload: PartyStreamPayload, from: string, at: number) => {
    if (isEncryptedPayload(payload)) {
      const key = roomKeyRef.current;
      if (!key) return;
      void decryptRoomJson<PartyStreamOffer>(key, payload.enc)
        .then(offer => {
          if (offer && typeof offer.target === "string") setLastStreamOffer({ offer, from, at });
        })
        .catch(() => setError("No se pudo descifrar el stream."));
      return;
    }
    if (payload && typeof payload.target === "string") setLastStreamOffer({ offer: payload, from, at });
  };

  const pushChatMessage = (id: string, from: string, name: string, text: string, at: number, temp = false) => {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    setChat(current => {
      // Al confirmar el eco del servidor, retirar el optimista equivalente.
      const rest = temp
        ? current
        : current.filter(entry => !(entry.temp && entry.from === from && entry.text === clean && at - entry.at < 10_000));
      return [...rest.slice(-99), { id, from, name, text: clean, at, ...(temp ? { temp: true as const } : {}) }];
    });
  };

  const applyPresence = (from: string, name: string, buffering: boolean, at: number) => {
    const entry: PartyPresence = { id: from, name, buffering, at };
    setBufferingPeers(current => {
      const rest = current.filter(peer => peer.id !== entry.id);
      return entry.buffering ? [...rest, entry] : rest;
    });
  };

  const openSocket = useCallback((code: string, name: string, identity: string | undefined, base: string) => {
    cleanupSocket();
    intentionalCloseRef.current = false;
    codeRef.current = code;
    nameRef.current = name;
    baseRef.current = base;
    degradedNotifiedRef.current = false;
    lastSentPresenceRef.current = null;
    setRoomCode(code);
    setRoomServer(base);
    setStatus(reconnectsRef.current > 0 ? "reconnecting" : "connecting");
    setError(null);

    let socket: WebSocket;
    try {
      socket = new WebSocket(partySocketUrl(code, name, base));
    } catch {
      setStatus("error");
      setError("No se pudo abrir la conexión con el servidor Party.");
      return;
    }
    socketRef.current = socket;

    const sendPing = () => {
      pingsSentRef.current += 1;
      // 2 pings sin pong = degradado (el servidor filtra o va mal).
      if (pingsSentRef.current - pongsGotRef.current >= 3 && !degradedNotifiedRef.current) {
        degradedNotifiedRef.current = true;
        notify("Conexión con la sala inestable: si se corta, migren con el botón de la sala. El video sigue en local.");
      }
      send({ t: "ping" });
    };

    socket.onopen = () => {
      reconnectsRef.current = 0;
      pingsSentRef.current = 0;
      pongsGotRef.current = 0;
      setStatus("connected");
      send({ t: "hello", name: nameRef.current, clientId: clientIdRef.current, ...(identity ? { identity } : {}) });
      window.clearInterval(pingTimerRef.current);
      sendPing();
      pingTimerRef.current = window.setInterval(sendPing, PING_INTERVAL_MS);
    };

    socket.onmessage = (event: MessageEvent) => {
      let msg: PartyServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as PartyServerMessage;
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          setSelfId(msg.peerId);
          setIsOwner(msg.isOwner);
          setRoomProtected(msg.protected === true);
          if (msg.protected === true) {
            const password = pendingPasswordRef.current;
            if (!password) {
              intentionalCloseRef.current = true;
              cleanupSocket();
              setStatus("error");
              setError("Esta sala tiene contraseña: escríbela para entrar.");
            } else {
              setStatus("connecting");
              void (async () => {
                try {
                  const key = await deriveRoomKey(password, codeRef.current);
                  const ok = msg.probe ? await verifyRoomProbe(key, msg.probe) : false;
                  if (intentionalCloseRef.current) return;
                  if (!ok) {
                    intentionalCloseRef.current = true;
                    cleanupSocket();
                    setStatus("error");
                    setError("Contraseña incorrecta.");
                    return;
                  }
                  roomKeyRef.current = key;
                  if (msg.media) applyMediaPayload(msg.media, "", msg.serverTime);
                  if (msg.lobbyWaiting === true) {
                    setLobby(true);
                    setLastLobbyEvent({ state: "waiting", from: "", at: msg.serverTime });
                  }
                  setStatus("connected");
                } catch {
                  if (intentionalCloseRef.current) return;
                  intentionalCloseRef.current = true;
                  cleanupSocket();
                  setStatus("error");
                  setError("No se pudo verificar la contraseña en este dispositivo.");
                }
              })();
            }
          } else if (pendingPasswordRef.current) {
            // Anti-downgrade: diste contraseña pero el servidor dice que la
            // sala no es cifrada. No enviar nada en claro: abortar.
            intentionalCloseRef.current = true;
            cleanupSocket();
            setStatus("error");
            setError("Diste contraseña pero el servidor dice que la sala no es cifrada: posible degradación. Abortado por seguridad.");
          } else {
            roomKeyRef.current = null;
            if (msg.media) applyMediaPayload(msg.media, "", msg.serverTime);
            if (msg.lobbyWaiting === true) {
              setLobby(true);
              setLastLobbyEvent({ state: "waiting", from: "", at: msg.serverTime });
            }
          }
          break;
        case "peers":
          setPeers(msg.peers);
          setIsOwner(msg.peers.some(peer => peer.id === selfIdRefSafe() && peer.isOwner));
          break;
        case "peer-joined":
          setPeers(current => (current.some(peer => peer.id === msg.peer.id) ? current : [...current, msg.peer]));
          break;
        case "peer-left":
          setPeers(current => current.filter(peer => peer.id !== msg.peerId));
          setBufferingPeers(current => current.filter(peer => peer.id !== msg.peerId));
          break;
        case "owner-changed":
          setPeers(current => current.map(peer => ({ ...peer, isOwner: peer.id === msg.peerId })));
          setIsOwner(msg.peerId === selfIdRefSafe());
          break;
        case "lobby": {
          // Solo el anfitrión emite (el servidor lo filtra); anti-replay igual.
          if (!acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
          if (msg.state !== "waiting" && msg.state !== "started") break;
          setLobby(msg.state === "waiting");
          setLastLobbyEvent({ state: msg.state, from: msg.from, at: msg.at });
          break;
        }
        case "control": {
          // Anti-replay + anti-forja: en salas cifradas solo vale el sobre
          // (el servidor no tiene la clave); en abiertas, el claro.
          if ("enc" in msg && typeof msg.enc === "string") {
            const key = roomKeyRef.current;
            if (!key || !acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
            void decryptRoomJson<{ kind?: unknown; position?: unknown }>(key, msg.enc)
              .then(data => {
                if (data && (data.kind === "play" || data.kind === "pause" || data.kind === "seek") && Number.isFinite(data.position)) {
                  setLastControl({ kind: data.kind, position: Math.max(0, Number(data.position)), from: msg.from, at: msg.at });
                }
              })
              .catch(() => {
                // Forjado o corrupto: se ignora en silencio.
              });
          } else if ("kind" in msg) {
            if (roomKeyRef.current) break;
            if (!acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
            if ((msg.kind === "play" || msg.kind === "pause" || msg.kind === "seek") && Number.isFinite(msg.position)) {
              setLastControl({ kind: msg.kind, position: Math.max(0, Number(msg.position)), from: msg.from, at: msg.at });
            }
          }
          break;
        }
        case "media":
          if (!acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
          if (roomKeyRef.current && !isEncryptedPayload(msg.media)) break;
          if (!roomKeyRef.current && isEncryptedPayload(msg.media)) break;
          applyMediaPayload(msg.media, msg.from, msg.at);
          break;
        case "stream":
          if (!msg.offer || !acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
          // Siempre la fuente del anfitrión: se ignoran ofertas de no-owners.
          // Cifrada: solo vale el sobre (el claro sería forjado). Abierta: el
          // claro validado (el anfitrión es de confianza: tienes su código).
          if (msg.from !== peersRef.current.find(peer => peer.isOwner)?.id) break;
          if (roomKeyRef.current) {
            if (isEncryptedPayload(msg.offer)) applyStreamPayload(msg.offer, msg.from, msg.at);
          } else if (!isEncryptedPayload(msg.offer) && typeof msg.offer.target === "string") {
            applyStreamPayload(msg.offer, msg.from, msg.at);
          }
          break;
        case "presence": {
          if ("enc" in msg && typeof msg.enc === "string") {
            const key = roomKeyRef.current;
            if (!key || !acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
            void decryptRoomJson<{ buffering?: unknown }>(key, msg.enc)
              .then(data => applyPresence(msg.from, msg.name, data?.buffering === true, msg.at))
              .catch(() => {
                // Forjado o corrupto: se ignora en silencio.
              });
          } else if ("buffering" in msg) {
            if (roomKeyRef.current) break;
            if (!acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
            if (typeof msg.buffering === "boolean") applyPresence(msg.from, msg.name, msg.buffering, msg.at);
          }
          break;
        }
        case "chat": {
          const key = roomKeyRef.current;
          if (key && typeof msg.enc !== "string") break;
          if (!key && typeof msg.enc === "string") break;
          if (!acceptFreshEvent(freshRef.current, msg.from, msg.at)) break;
          if (typeof msg.text === "string") {
            pushChatMessage(msg.id, msg.from, msg.name, msg.text, msg.at);
          } else if (typeof msg.enc === "string" && key) {
            void decryptRoomJson<{ text?: string }>(key, msg.enc)
              .then(data => {
                if (typeof data?.text === "string") pushChatMessage(msg.id, msg.from, msg.name, data.text, msg.at);
              })
              .catch(() => setError("No se pudo descifrar un mensaje."));
          }
          break;
        }
        case "room-closed":
          // El anfitrión mató la sala: salir sin reconectar.
          intentionalCloseRef.current = true;
          cleanupSocket();
          codeRef.current = "";
          roomKeyRef.current = null;
          pendingPasswordRef.current = null;
          setStatus("idle");
          setRoomCode("");
          setSelfId("");
          setIsOwner(false);
          setPeers([]);
          setMedia(null);
          setRoomProtected(false);
          resetRoomState();
          lastSentPresenceRef.current = null;
          notify("El anfitrión cerró la sala.");
          break;
        case "error":
          setError(msg.message);
          break;
        case "pong":
          pongsGotRef.current = pingsSentRef.current;
          break;
      }
    };

    const scheduleReconnect = () => {
      if (intentionalCloseRef.current) return;
      if (reconnectsRef.current >= MAX_RECONNECTS) {
        setStatus("error");
        setError("Se perdió la conexión con la sala. Sigues viendo en local; usa Migrar para reabrirla en otro servidor.");
        return;
      }
      reconnectsRef.current += 1;
      setStatus("reconnecting");
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => connect(codeRef.current, nameRef.current, baseRef.current), RECONNECT_DELAY_MS);
    };

    socket.onerror = () => {
      // El onclose que sigue decide si reconectar.
    };
    socket.onclose = () => {
      window.clearInterval(pingTimerRef.current);
      if (socketRef.current === socket) socketRef.current = null;
      scheduleReconnect();
    };
  }, [cleanupSocket, send]);

  // Entrada única: resetea relojes anti-replay y resuelve la identidad TOFU.
  const connect = useCallback((code: string, name: string, base: string) => {
    freshRef.current = {};
    void (async () => {
      let identity: string | undefined;
      try {
        identity = await getRoomIdentity(code);
      } catch {
        identity = undefined;
      }
      identityRef.current = identity;
      openSocket(code, name, identity, base);
    })();
  }, [openSocket]);

  // selfId accesible dentro de onmessage sin re-suscribir el socket.
  const selfIdRef = useRef("");
  const selfIdRefSafe = () => selfIdRef.current;
  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  const resetRoomState = () => {
    setChat([]);
    setLastControl(null);
    setLastMediaEvent(null);
    setLastStreamOffer(null);
    setBufferingPeers([]);
    setLobby(false);
    setLastLobbyEvent(null);
    setPeerPrints({});
    setNotice(null);
    setError(null);
  };

  // Reclama un código en un servidor concreto (con E2E si hay contraseña).
  const claimRoom = async (base: string, initialMedia: PartyMedia | null, name: string, password: string): Promise<{ code: string; key: CryptoKey | null }> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateRoomCode();
      let payload: PartyMediaPayload | null = initialMedia;
      let probe: string | undefined;
      let key: CryptoKey | null = null;
      try {
        if (password) {
          key = await deriveRoomKey(password, code);
          if (initialMedia) payload = { enc: await encryptRoomJson(key, initialMedia) };
          probe = await createRoomProbe(key);
        }
        const response = await fetch(`${base}/party/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, media: payload, protected: password.length > 0, probe, name }),
        });
        const data = (await response.json()) as { ok?: boolean; code?: string; taken?: boolean; error?: string };
        if (data.ok && data.code) {
          // Anti-confusión: el servidor debe confirmar EL código pedido.
          if (normalizeRoomCode(data.code) !== code) continue;
          return { code, key };
        }
        if (!data.taken) throw new Error(data.error || "El servidor Party no respondió.");
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error(`No se pudo contactar ${base}. Despliega el worker (party-server/README.md) y define VITE_PARTY_SERVER_URL.`);
        }
        if (error instanceof Error && error.message !== "taken") throw error;
      }
    }
    throw new Error("taken");
  };

  const createRoom = useCallback(async (initialMedia: PartyMedia | null, name: string, password = ""): Promise<string> => {
    const cleanName = name.trim() || "Anfitrión";
    const cleanPassword = password.trim();
    if (cleanPassword && cleanPassword.length < 4) {
      throw new Error("La contraseña debe tener al menos 4 caracteres (mejor 4+ palabras).");
    }
    setDisplayName(cleanName);
    reconnectsRef.current = 0;
    pendingPasswordRef.current = cleanPassword || null;
    usedPasswordRef.current = cleanPassword || null;
    roomKeyRef.current = null;
    setRoomProtected(cleanPassword.length > 0);
    const { base } = await pickHealthyServer();
    try {
      const { code, key } = await claimRoom(base, initialMedia, cleanName, cleanPassword);
      roomKeyRef.current = key;
      resetRoomState();
      setMedia(initialMedia);
      // Con contenido: el anfitrión entra a sala de espera (el player la
      // retiene en pausa y estampa `waiting` al conectar).
      if (initialMedia) setLobby(true);
      connect(code, cleanName, base);
      return code;
    } catch (error) {
      if (error instanceof Error && error.message === "taken") {
        throw new Error("No se pudo crear la sala, reintenta.");
      }
      throw error;
    }
  }, [connect]);

  const migrateRoom = useCallback(async (): Promise<string | null> => {
    // Mudanza anti-DoS: nueva sala en otro servidor sano, mismo contenido y
    // contraseña. El código nuevo hay que compartirlo fuera de la app; el
    // chat se conserva para no perder contexto.
    if (!roomCode) return null;
    const password = usedPasswordRef.current ?? "";
    const name = displayName || "Anfitrión";
    const currentBase = baseRef.current;
    // Buscar alternativa sana distinta al actual.
    let base = "";
    for (const candidate of getPartyServers().filter(item => item !== currentBase)) {
      if ((await probePartyServer(candidate).catch(() => null)) !== null) {
        base = candidate;
        break;
      }
    }
    if (!base) {
      notify("No hay otro servidor Party sano para migrar.");
      return null;
    }
    try {
      const { code, key } = await claimRoom(base, media, name, password);
      roomKeyRef.current = key;
      pendingPasswordRef.current = password || null;
      // Se conserva el chat; se resetea sync (posiciones las re-emite el player).
      setLastControl(null);
    setLastMediaEvent(null);
    setLastStreamOffer(null);
    setBufferingPeers([]);
      setLobby(false);
      setLastLobbyEvent(null);
      freshRef.current = {};
      connect(code, name, base);
      notify(`Sala migrada (${base.replace(/^https?:\/\//, "")}): nuevo código ${code}. Compártelo fuera de la app.`);
      return code;
    } catch {
      notify("No se pudo migrar la sala.");
      return null;
    }
  }, [roomCode, displayName, media, connect, notify]);

  const joinRoom = useCallback((code: string, name: string, password = "", server?: string) => {
    if (!isCompleteRoomCode(code)) {
      setError("El código debe tener 6 caracteres.");
      return;
    }
    const cleanName = name.trim() || "Invitado";
    setDisplayName(cleanName);
    reconnectsRef.current = 0;
    pendingPasswordRef.current = password.trim() || null;
    usedPasswordRef.current = password.trim() || null;
    roomKeyRef.current = null;
    setRoomProtected(false);
    resetRoomState();
    setMedia(null);
    connect(normalizeRoomCode(code), cleanName, getPartyHttpBase(server));
  }, [connect]);

  const retryConnection = useCallback(() => {
    if (!codeRef.current || statusRef.current === "idle") return;
    reconnectsRef.current = 0;
    connect(codeRef.current, nameRef.current || "Invitado", baseRef.current || getPartyHttpBase());
  }, [connect]);

  // El anfitrión estampa `waiting` al (re)conectar para los que lleguen tarde
  // (idempotente en el servidor).
  useEffect(() => {
    if (status === "connected" && lobby && isOwner) send({ t: "lobby", state: "waiting" });
  }, [status, lobby, isOwner, send]);

  const leaveRoom = useCallback(() => {    intentionalCloseRef.current = true;
    cleanupSocket();
    codeRef.current = "";
    roomKeyRef.current = null;
    pendingPasswordRef.current = null;
    setStatus("idle");
    setRoomCode("");
    setSelfId("");
    setIsOwner(false);
    setPeers([]);
    setMedia(null);
    setRoomProtected(false);
    resetRoomState();
    lastSentPresenceRef.current = null;
  }, [cleanupSocket]);

  const closeRoom = useCallback(() => {
    // El anfitrión mata la sala en el servidor (best-effort si el socket ya
    // cayó: el servidor la destruye por gracia) y sale localmente.
    try {
      send({ t: "close" });
    } catch {
      // Igual se sale en local.
    }
    leaveRoom();
  }, [leaveRoom, send]);

  useEffect(() => () => {
    intentionalCloseRef.current = true;
    cleanupSocket();
  }, [cleanupSocket]);

  const toggleVerifiedPrint = useCallback((full: string) => {
    setVerifiedPrints(current => {
      const next = current.includes(full) ? current.filter(print => print !== full) : [...current, full];
      try {
        localStorage.setItem(VERIFIED_PRINTS_KEY, JSON.stringify(next));
      } catch {
        // Solo memoria.
      }
      return next;
    });
  }, []);

  // Fingerprints de identidades vistas (cálculo perezoso + caché).
  const printCacheRef = useRef(new Map<string, IdentityFingerprint>());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, IdentityFingerprint> = {};
      for (const peer of peers) {
        if (!peer.identity) continue;
        let print = printCacheRef.current.get(peer.identity);
        if (!print) {
          try {
            print = await fingerprintIdentity(peer.identity);
          } catch {
            continue;
          }
          printCacheRef.current.set(peer.identity, print);
        }
        next[peer.id] = print;
      }
      if (!cancelled) setPeerPrints(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [peers]);

  const value = useMemo<PartyContextValue>(() => ({
    status,
    roomCode,
    roomServer,
    displayName,
    selfId,
    isOwner,
    peers,
    media,
    lastControl,
    lastMediaEvent,
    lastStreamOffer,
    bufferingPeers,
    lobby,
    lastLobbyEvent,
    sendLobby,
    roomProtected,
    peerPrints,
    verifiedPrints,
    toggleVerifiedPrint,
    notice,
    notify,
    chat,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    migrateRoom,
    retryConnection,
    setDisplayName,
    sendControl: (kind, position) => {
      const key = roomKeyRef.current;
      if (!key) {
        send({ t: "control", kind, position });
        return;
      }
      void encryptRoomJson(key, { kind, position })
        .then(enc => send({ t: "control", enc }))
        .catch(() => setError("No se pudo cifrar el control."));
    },
    sendMedia: (next) => {
      const key = roomKeyRef.current;
      if (!key) {
        send({ t: "media", media: next });
        return;
      }
      void encryptRoomJson(key, next)
        .then(enc => send({ t: "media", media: { enc } }))
        .catch(() => setError("No se pudo cifrar el contenido."));
    },
    sendStream: (offer) => {
      const key = roomKeyRef.current;
      if (!key) {
        send({ t: "stream", offer });
        return;
      }
      void encryptRoomJson(key, offer)
        .then(enc => send({ t: "stream", offer: { enc } }))
        .catch(() => setError("No se pudo cifrar el stream."));
    },
    sendPresence,
    sendChat: (text) => {
      const clean = text.trim();
      if (!clean) return;
      // Eco optimista: aparece al instante aunque el eco tarde o se pierda.
      try {
        pushChatMessage(`local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, selfIdRef.current, displayName || "Tú", clean, Date.now(), true);
      } catch {
        // Solo memoria.
      }
      const key = roomKeyRef.current;
      if (!key) {
        send({ t: "chat", text: clean });
        return;
      }
      void encryptRoomJson(key, { text: clean })
        .then(enc => send({ t: "chat", enc }))
        .catch(() => setError("No se pudo cifrar el mensaje."));
    },
    noteRemoteApplied: () => {
      lastRemoteAppliedRef.current = Date.now();
    },
    lastRemoteAppliedAt: () => lastRemoteAppliedRef.current,
  }), [status, roomCode, roomServer, displayName, selfId, isOwner, peers, media, lastControl, lastMediaEvent, lastStreamOffer, bufferingPeers, lobby, lastLobbyEvent, sendLobby, roomProtected, peerPrints, verifiedPrints, toggleVerifiedPrint, notice, notify, chat, error, createRoom, joinRoom, leaveRoom, closeRoom, migrateRoom, retryConnection, send, sendPresence]);

  return <PartyContext.Provider value={value}>{children}</PartyContext.Provider>;
}

export function useParty(): PartyContextValue {
  const context = useContext(PartyContext);
  if (!context) throw new Error("useParty debe usarse dentro de <PartyProvider>.");
  return context;
}
