import { useEffect, useRef, useState } from "react";
import { Copy, Check, Send, LogOut, ArrowRightLeft } from "lucide-react";
import { useParty } from "./PartyContext";
import { getPartyServers, isCompleteRoomCode, normalizeRoomCode, serverHost, type PartyMedia } from "./protocol";
import { getStoredAccount } from "../auth/authClient";

interface PartyPanelProps {
  /** Contenido actual del player (para crear la sala viéndolo). */
  currentMedia: PartyMedia | null;
  currentTitle: string;
  /** La fuente del anfitrión falló en este dispositivo. */
  streamFailed: boolean;
  /** Reintentar cargar la fuente del anfitrión. */
  onRetryStream: () => void;
}

function defaultName(): string {
  try {
    return getStoredAccount()?.displayName ?? "";
  } catch {
    return "";
  }
}

/** Contenido Party para incrustar en el menú contextual de la barra. */
export default function PartyPanel({ currentMedia, currentTitle, streamFailed, onRetryStream }: PartyPanelProps) {
  const party = useParty();
  const [name, setName] = useState(defaultName);
  const [codeInput, setCodeInput] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinServer, setJoinServer] = useState(() => getPartyServers()[0] ?? "");
  const [creating, setCreating] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [party.chat]);

  const connected = party.status === "connected";
  const busy = party.status === "connecting" || party.status === "reconnecting";

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      await party.createRoom(currentMedia, name.trim() || "Anfitrión", createPassword);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "No se pudo crear la sala.");
    } finally {
      setCreating(false);
    }
  }

  function handleJoin() {
    party.joinRoom(normalizeRoomCode(codeInput), name.trim() || "Invitado", joinPassword, joinServer);
  }

  async function handleMigrate() {
    setMigrating(true);
    try {
      await party.migrateRoom();
    } finally {
      setMigrating(false);
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(party.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Portapapeles no disponible.
    }
  }

  function handleSendChat() {
    const text = chatInput.trim();
    if (!text) return;
    party.sendChat(text);
    setChatInput("");
  }

  const peerName = (id: string, fallback: string) => {
    if (id === party.selfId) return `${fallback} (tú)`;
    return fallback;
  };
  const bufferingIds = new Set(party.bufferingPeers.map(peer => peer.id));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {party.status === "idle" || (!connected && !busy) ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
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

          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.055] shadow-[0_16px_54px_rgba(0,0,0,0.22)]">
            <div className="px-5 pt-4">
              <p className="text-base font-black tracking-tight text-white">Crear sala</p>
              <p className="mt-1 text-sm leading-5 text-white/50">
                {currentMedia && currentTitle
                  ? `Los invitados seguirán automáticamente: ${currentTitle}.`
                  : "Abre algo para que los invitados lo sigan automáticamente."}
              </p>
            </div>
            <div className="flex flex-col gap-2.5 px-5 pb-4 pt-3">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="gsap-transition w-full rounded-full bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-white/86 active:scale-[0.97] disabled:opacity-45"
              >
                {creating ? "Creando…" : "Crear y compartir código"}
              </button>
              <input
                value={createPassword}
                onChange={event => setCreatePassword(event.target.value)}
                placeholder="Contraseña (opcional)"
                type="password"
                maxLength={128}
                autoComplete="off"
                className="gsap-transition w-full rounded-full border border-white/12 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/34 focus:border-white/34"
              />
              {createError ? <p className="px-1 text-xs font-semibold text-red-300">{createError}</p> : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.055] shadow-[0_16px_54px_rgba(0,0,0,0.22)]">
            <p className="px-5 pt-4 text-base font-black tracking-tight text-white">Unirse con código</p>
            <div className="flex flex-col gap-2.5 px-5 pb-4 pt-3">
              <div className="flex gap-2">
                <input
                  value={codeInput}
                  onChange={event => setCodeInput(normalizeRoomCode(event.target.value))}
                  placeholder="ABC123"
                  maxLength={6}
                  className="gsap-transition min-w-0 flex-1 rounded-full border border-white/12 bg-white/10 px-4 py-2.5 text-center text-sm font-black uppercase tracking-[0.2em] text-white outline-none placeholder:text-white/34 focus:border-white/34"
                />
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={!isCompleteRoomCode(codeInput)}
                  className="gsap-transition shrink-0 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-white/86 active:scale-[0.97] disabled:opacity-40"
                >
                  Unirse
                </button>
              </div>
              <input
                value={joinPassword}
                onChange={event => setJoinPassword(event.target.value)}
                placeholder="Contraseña (si la sala la tiene)"
                type="password"
                maxLength={128}
                autoComplete="off"
                className="gsap-transition w-full rounded-full border border-white/12 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/34 focus:border-white/34"
              />
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
              {party.error ? (
                <div>
                  <p className="px-1 text-xs font-semibold text-red-300">{party.error}</p>
                  {party.status === "error" && party.roomCode ? (
                    <button
                      type="button"
                      onClick={party.retryConnection}
                      className="gsap-transition mt-1.5 w-full rounded-full bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-white/86 active:scale-[0.97]"
                    >
                      Reintentar
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : busy ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-white/55">{party.status === "reconnecting" ? "Reconectando…" : "Conectando…"}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div>
            <p className="text-xs font-black tracking-wider text-white/45">Código de sala</p>
            <div className="mt-1 flex items-center gap-2.5">
              <p className="text-3xl font-black tracking-[0.25em] text-white">{party.roomCode}</p>
              <button
                type="button"
                onClick={() => void handleCopyCode()}
                className="gsap-transition flex h-9 w-9 items-center justify-center rounded-full border border-white/12 text-white/70 hover:bg-white/12 hover:text-white active:scale-90"
                aria-label="Copiar código"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              {party.isOwner ? (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-white/70">Anfitrión</span>
              ) : null}
            </div>
            {party.media?.title ? (
              <p className="mt-1.5 truncate text-sm text-white/50">{party.media.title}</p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="text-sm font-black tracking-tight text-white">Fuente del anfitrión</p>
            <p className="mt-0.5 text-xs leading-4 text-white/50">
              Todos ven el mismo enlace exacto.
            </p>
            {streamFailed ? (
              <>
                <p className="mt-2 text-xs leading-5 text-amber-200/90">
                  No abrió en tu dispositivo.
                </p>
                <button
                  type="button"
                  onClick={onRetryStream}
                  className="gsap-transition mt-2.5 w-full rounded-full bg-white px-4 py-2 text-xs font-black text-black hover:bg-white/86 active:scale-[0.97]"
                >
                  Reintentar
                </button>
              </>
            ) : null}
          </div>

          {party.peers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {party.peers.map(peer => (
                <span key={peer.id} className="gsap-fade-in flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/85">
                  {peerName(peer.id, peer.name)}{peer.isOwner ? " · anfitrión" : ""}
                  {bufferingIds.has(peer.id) ? (
                    <span className="flex items-center gap-1 text-white/55">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/80" />
                      <span className="text-xs font-semibold">cargando</span>
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {party.chat.length === 0 ? (
              <p className="text-sm text-white/40">Sin mensajes todavía. Saluda al grupo.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {party.chat.map(message => (
                  <div key={message.id} className={`gsap-fade-in ${message.from === party.selfId ? "self-end" : "self-start"}`}>
                    <p className="mb-0.5 px-1 text-xs font-bold text-white/45">{peerName(message.from, message.name)}</p>
                    <p className={`max-w-[240px] break-words rounded-2xl px-3 py-1.5 text-sm leading-5 text-white ${message.temp ? "bg-white/[0.05] text-white/70" : "bg-white/10"}`}>
                      {message.text}
                    </p>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          <div className="shrink-0">
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={event => setChatInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") handleSendChat();
                }}
                placeholder="Escribe al grupo…"
                maxLength={500}
                className="gsap-transition min-w-0 flex-1 rounded-full border border-white/12 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/34 focus:border-white/34"
              />
              <button
                type="button"
                onClick={handleSendChat}
                className="gsap-transition flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black hover:bg-white/86 active:scale-90"
                aria-label="Enviar mensaje"
              >
                <Send size={17} />
              </button>
            </div>
            {getPartyServers().length > 1 ? (
              <button
                type="button"
                onClick={() => void handleMigrate()}
                disabled={migrating}
                className="gsap-transition mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/60 hover:bg-white/10 hover:text-white active:scale-[0.98] disabled:opacity-50"
              >
                <ArrowRightLeft size={14} /> {migrating ? "Migrando…" : "Migrar de servidor"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { if (party.isOwner) party.closeRoom(); else party.leaveRoom(); }}
              className="gsap-transition mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/60 hover:bg-white/10 hover:text-white active:scale-[0.98]"
            >
              <LogOut size={14} /> Salir de la sala
            </button>
          </div>
          {party.error ? <p className="text-xs font-semibold text-red-300">{party.error}</p> : null}
          {party.notice ? <p className="gsap-fade-in text-xs text-amber-100/90">{party.notice}</p> : null}
        </div>
      )}
    </div>
  );
}
