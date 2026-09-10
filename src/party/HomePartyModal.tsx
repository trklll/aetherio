import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Copy, Link2, LogOut, Users, X } from "lucide-react";
import { gsap, springTo, prefersReducedMotion } from "../utils/motion.ts";
import { getContextGlassStyle } from "../components/ui/glassSurface.ts";
import { useParty } from "./PartyContext";
import { getStoredAccount } from "../auth/authClient";
import {
  buildPlayerPathForMedia,
  buildPartyInviteLink,
  takePendingPartyJoin,
} from "./invite";
import {
  getPartyServers,
  isCompleteRoomCode,
  normalizeRoomCode,
  serverHost,
  type PartyMedia,
} from "./protocol";
import { SELECTED_MEDIA_META_KEY } from "../pages/Player/utils";

/**
 * Entrada a Party desde cualquier página con chrome (Home, etc.).
 *
 * - Botón flotante arriba a la izquierda (el Player ya tiene su propio panel).
 * - Modal para unirse con código (en Home no hay contenido para crear sala:
 *   el anfitrión crea desde una ficha o el reproductor).
 * - Auto-join de invitaciones `aetherio://party/join` (o botón Unirse) con
 *   entrada directa al reproductor cuando la sala ya trae contenido.
 */

function defaultName(): string {
  try {
    return getStoredAccount()?.displayName ?? "";
  } catch {
    return "";
  }
}

function seedPlayerMeta(media: PartyMedia | null) {
  try {
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: media?.title || "Sala Party",
      logo: "",
      background: "",
      poster: "",
      resumeTime: 0,
    }));
  } catch {
    // best-effort
  }
}

/** Auto-entrada del invitado al reproductor cuando hay contenido de sala. */
export function PartyPendingJoinHandler({ onJoinFailed }: { onJoinFailed: () => void }) {
  const party = useParty();
  const navigate = useNavigate();
  const location = useLocation();
  const enteredRef = useRef("");
  const pendingFailedRef = useRef(false);

  // Consumir invitación pendiente (deep link) cuando no hay sala activa.
  useEffect(() => {
    if (party.status !== "idle" || party.roomCode) return;
    const pending = takePendingPartyJoin();
    if (!pending) return;
    pendingFailedRef.current = true;
    party.joinRoom(pending.code, defaultName() || "Invitado", "", pending.server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party.status, party.roomCode]);

  // Si la unión por invitación falla, abrir el modal para reintentar a mano.
  useEffect(() => {
    if (!pendingFailedRef.current) return;
    if (party.status === "connected") {
      pendingFailedRef.current = false;
      return;
    }
    if (party.status === "error") {
      pendingFailedRef.current = false;
      onJoinFailed();
    }
  }, [party.status, onJoinFailed]);

  // Invitado en Home con contenido de sala: directo al reproductor.
  useEffect(() => {
    if (!party.roomCode) {
      enteredRef.current = "";
      return;
    }
    if (location.pathname !== "/home") return;
    if (party.status !== "connected" || party.isOwner || !party.media) return;
    if (enteredRef.current === party.roomCode) return;
    enteredRef.current = party.roomCode;
    seedPlayerMeta(party.media);
    const path = buildPlayerPathForMedia(party.media);
    if (path) navigate(path);
  }, [location.pathname, party.status, party.isOwner, party.media, party.roomCode, navigate]);

  return null;
}

/** Botón de entrada a Party: gemelo visual de la píldora TopNav (mismo material). */
export function PartyHomeButton({ onOpen }: { onOpen: () => void }) {
  const party = useParty();
  const connected = party.status === "connected";
  return (
    <div
      className="relative liquid-glass-pill flex items-center min-w-0"
      style={{
        boxShadow: "0 3px 14px rgba(0,0,0,0.38)",
        padding: "6px",
        transform: "scale(1.1)",
        transformOrigin: "left top",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`rounded-full flex items-center justify-center shrink-0 hover:scale-105 gsap-transition ${
          connected ? "bg-atv-selected text-white" : "text-atv-secondary hover:text-white hover:bg-atv-hover"
        }`}
        style={{ width: 32, height: 32 }}
        title={connected ? `Party: en sala ${party.roomCode}` : "Party: ver juntos"}
        aria-label={connected ? "Party: en sala" : "Party: ver juntos"}
      >
        <Users size={17} />
      </button>
      {connected && party.peers.length > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-0.5 text-[10px] font-black text-black">
          {party.peers.length}
        </span>
      ) : null}
    </div>
  );
}

export default function HomePartyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const party = useParty();
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName);
  const [codeInput, setCodeInput] = useState("");
  const [joinServer, setJoinServer] = useState(() => getPartyServers()[0] ?? "");
  const [joining, setJoining] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const joinedNavRef = useRef("");

  const connected = party.status === "connected";
  const busy = party.status === "connecting" || party.status === "reconnecting";

  // Unirse desde el modal: al conectar, directo al reproductor si hay contenido.
  useEffect(() => {
    if (!open || party.status !== "connected" || party.isOwner || !party.media) return;
    if (joinedNavRef.current === party.roomCode) return;
    joinedNavRef.current = party.roomCode;
    seedPlayerMeta(party.media);
    const path = buildPlayerPathForMedia(party.media);
    if (path) {
      onClose();
      navigate(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, party.status, party.isOwner, party.media, party.roomCode]);
  useEffect(() => {
    if (!party.roomCode) joinedNavRef.current = "";
  }, [party.roomCode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Montaje con salida animada (patrón ContextMenu): enter spring + exit blur.
  const [mounted, setMounted] = useState(open);
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    if (!card || !backdrop) {
      setMounted(false);
      return;
    }
    gsap.killTweensOf([card, backdrop]);
    if (prefersReducedMotion()) {
      gsap.to([card, backdrop], {
        opacity: 0,
        duration: 0.18,
        ease: "power1.out",
        overwrite: "auto",
        onComplete: () => setMounted(false),
      });
      return;
    }
    springTo(backdrop, { opacity: 0 } as unknown as gsap.TweenVars, { duration: 0.22, damping: 1.0 });
    springTo(card, {
      opacity: 0,
      y: 8,
      scale: 0.97,
      filter: "blur(6px)",
    } as unknown as gsap.TweenVars, { duration: 0.24, damping: 1.0 });
    gsap.delayedCall(0.26, () => {
      if (!open) setMounted(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    if (!card || !backdrop) return;
    gsap.killTweensOf([card, backdrop]);
    if (prefersReducedMotion()) {
      gsap.set([card, backdrop], { opacity: 0 });
      gsap.to([card, backdrop], { opacity: 1, duration: 0.2, ease: "power1.out", overwrite: "auto" });
      return;
    }
    gsap.set(backdrop, { opacity: 0 });
    gsap.set(card, { opacity: 0, y: 8, scale: 0.97, filter: "blur(6px)" });
    gsap.to(backdrop, { opacity: 1, duration: 0.25, ease: "power1.out", overwrite: "auto" });
    springTo(card, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { duration: 0.36, damping: 1.0 });
  }, [open, mounted]);

  const handleJoin = useCallback(() => {
    const code = normalizeRoomCode(codeInput);
    if (!isCompleteRoomCode(code)) return;
    setJoining(true);
    party.joinRoom(code, name.trim() || "Invitado", "", joinServer);
    window.setTimeout(() => setJoining(false), 800);
  }, [codeInput, joinServer, name, party]);

  const copyText = useCallback(async (text: string, done: (value: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      done(true);
      window.setTimeout(() => done(false), 1500);
    } catch {
      // Portapapeles no disponible.
    }
  }, []);

  if (!mounted) return null;
  const inviteLink = party.roomCode ? buildPartyInviteLink(party.roomCode, party.roomServer) : null;
  const glassStyle = getContextGlassStyle();

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/60"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ver juntos (Party)"
        onClick={event => event.stopPropagation()}
        className="relative w-full max-w-[380px] overflow-hidden"
        style={{
          ...glassStyle,
          borderRadius: 24,
          willChange: "transform, opacity, filter",
          transform: "translateZ(0)",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <div>
            <p className="text-base font-black tracking-tight text-white">Ver juntos</p>
            <p className="mt-0.5 text-xs text-white/50">
              {connected ? `Sala ${party.roomCode}` : "Únete a una sala con su código"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="gsap-transition flex h-9 w-9 items-center justify-center rounded-full border border-white/12 text-white/70 hover:bg-white/12 hover:text-white active:scale-90"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-2.5 px-5 pb-5 pt-3">
          {connected ? (
            <>
              <p className="text-center text-3xl font-black tracking-[0.25em] text-white">{party.roomCode}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyText(party.roomCode, setCopiedCode)}
                  className="gsap-transition flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/12 px-4 py-2.5 text-xs font-black text-white/75 hover:bg-white/10 hover:text-white active:scale-[0.98]"
                >
                  {copiedCode ? <Check size={14} /> : <Copy size={14} />} Código
                </button>
                {inviteLink ? (
                  <button
                    type="button"
                    onClick={() => void copyText(inviteLink, setCopiedLink)}
                    className="gsap-transition flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-xs font-black text-black hover:bg-white/86 active:scale-[0.98]"
                  >
                    {copiedLink ? <Check size={14} /> : <Link2 size={14} />} Link
                  </button>
                ) : null}
              </div>
              {party.media?.title ? (
                <p className="truncate text-center text-sm text-white/50">{party.media.title}</p>
              ) : null}
              {party.peers.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {party.peers.map(peer => (
                    <span key={peer.id} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/85">
                      {peer.id === party.selfId ? `${peer.name} (tú)` : peer.name}{peer.isOwner ? " · anfitrión" : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              {party.media ? (
                <button
                  type="button"
                  onClick={() => {
                    const path = buildPlayerPathForMedia(party.media);
                    if (!path) return;
                    seedPlayerMeta(party.media);
                    onClose();
                    navigate(path);
                  }}
                  className="gsap-transition w-full rounded-full bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-white/86 active:scale-[0.97]"
                >
                  Abrir reproductor
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { if (party.isOwner) party.closeRoom(); else party.leaveRoom(); onClose(); }}
                className="gsap-transition flex w-full items-center justify-center gap-1.5 rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/60 hover:bg-white/10 hover:text-white active:scale-[0.98]"
              >
                <LogOut size={14} /> Salir de la sala
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-white/72">Tu nombre</label>
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="¿Cómo te verán?"
                  maxLength={32}
                  className="gsap-transition w-full rounded-full border border-white/12 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/34 focus:border-white/34"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-white/72">Código de sala</label>
                <div className="flex gap-2">
                  <input
                    value={codeInput}
                    onChange={event => setCodeInput(normalizeRoomCode(event.target.value))}
                    placeholder="ABC123"
                    maxLength={6}
                    autoFocus
                    className="gsap-transition min-w-0 flex-1 rounded-full border border-white/12 bg-white/10 px-4 py-2.5 text-center text-sm font-black uppercase tracking-[0.2em] text-white outline-none placeholder:text-white/34 focus:border-white/34"
                  />
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={!isCompleteRoomCode(codeInput) || busy || joining}
                    className="gsap-transition shrink-0 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-white/86 active:scale-[0.97] disabled:opacity-40"
                  >
                    {busy || joining ? "Entrando…" : "Unirse"}
                  </button>
                </div>
              </div>
              {getPartyServers().length > 1 ? (
                <select
                  value={joinServer}
                  onChange={event => setJoinServer(event.target.value)}
                  className="gsap-transition w-full rounded-full border border-white/12 bg-[#171719] px-4 py-2.5 text-sm font-semibold text-white outline-none focus:border-white/34"
                  aria-label="Servidor de la sala"
                >
                  {getPartyServers().map(server => (
                    <option key={server} value={server}>{serverHost(server)}</option>
                  ))}
                </select>
              ) : null}
              {party.error ? <p className="px-1 text-xs font-semibold text-red-300">{party.error}</p> : null}
              <p className="px-1 text-center text-xs text-white/40">
                ¿Eres el anfitrión? Crea la sala desde una ficha o el reproductor.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
