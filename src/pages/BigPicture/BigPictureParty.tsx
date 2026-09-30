import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useParty } from "../../party/PartyContext.tsx";
import { getStoredAccount } from "../../auth/authClient.ts";
import { buildPlayerPathForMedia } from "../../party/invite.ts";
import {
  getPartyServers,
  isCompleteRoomCode,
  normalizeRoomCode,
  serverHost,
} from "../../party/protocol.ts";
import { SELECTED_MEDIA_META_KEY } from "../Player/utils.ts";
import { useTextBackAction } from "../../input/inputActions";
import "./BigPictureParty.css";

/**
 * Party en Big Picture: page 10-foot, no modal.
 *
 * El modal de Home (HomePartyModal) es patrón PC: ventana pequeña centrada,
 * <input> con autoFocus, se cierra con ratón/Escape. Con mando eso no
 * funciona (sin cursor, sin teclado físico, targets de 32px).
 *
 * Esta page sigue el patrón de BigPictureSearch:
 * - Teclado en pantalla a la izquierda (D-pad: flechas = moverse, Enter = A).
 * - Sin <input>/<select>: todo son <button> (el motor espacial solo ve focos).
 * - Foco = cambio de material (fondo blanco) + scale, sin outlines.
 * - B/Escape lo gestiona BigPicturePage (vuelve a /big-picture).
 */

type PartyField = "name" | "code" | "password" | "chat";

const KB_ROWS: string[][] = [
  ["A", "B", "C", "D", "E", "F"],
  ["G", "H", "I", "J", "K", "L"],
  ["M", "N", "O", "P", "Q", "R"],
  ["S", "T", "U", "V", "W", "X"],
  ["Y", "Z", "0", "1", "2", "3"],
  ["4", "5", "6", "7", "8", "9"],
];

function defaultName(): string {
  try {
    return getStoredAccount()?.displayName ?? "";
  } catch {
    return "";
  }
}

function seedPlayerMeta(title: string) {
  try {
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: title || "Sala Party",
      logo: "",
      background: "",
      poster: "",
      resumeTime: 0,
    }));
  } catch {
    // best-effort
  }
}

function scrollShellToTop() {
  document
    .querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]")
    ?.scrollTo({ top: 0, behavior: "auto" });
}

export default function BigPictureParty() {
  const party = useParty();
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [activeField, setActiveField] = useState<PartyField>("code");
  const [joinServer, setJoinServer] = useState(() => getPartyServers()[0] ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const joinedNavRef = useRef("");

  const connected = party.status === "connected";
  const busy = party.status === "connecting" || party.status === "reconnecting";
  const servers = useMemo(() => getPartyServers(), []);
  const codeComplete = isCompleteRoomCode(code);

  // Al entrar a la page, arriba del todo (el teclado es sticky como en Search).
  useEffect(() => {
    scrollShellToTop();
  }, []);

  // Foco inicial para el mando: primera tecla cuando no hay sala, acción
  // primaria cuando sí (el motor espacial parte de ahí).
  useEffect(() => {
    const t = window.setTimeout(() => {
      document.querySelector<HTMLElement>("[data-bp-party-primary]")?.focus({ preventScroll: true });
    }, 70);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, busy]);

  // Chat siempre abajo (como PartyPanel).
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [party.chat, connected]);

  useEffect(() => {
    if (!party.roomCode) joinedNavRef.current = "";
  }, [party.roomCode]);

  // Invitado con contenido de sala: directo al reproductor (igual que el
  // modal de Home). El reproductor ya tiene su propio PartyPanel con mando.
  useEffect(() => {
    if (party.status !== "connected" || party.isOwner || !party.media) return;
    if (joinedNavRef.current === party.roomCode) return;
    joinedNavRef.current = party.roomCode;
    seedPlayerMeta(party.media.title ?? "");
    const path = buildPlayerPathForMedia(party.media);
    if (path) navigate(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party.status, party.isOwner, party.media, party.roomCode]);

  const insertChar = useCallback((ch: string) => {
    if (activeField === "code") {
      const clean = ch.toUpperCase();
      if (!/[A-Z0-9]/.test(clean)) return;
      setCode(current => (current.length >= 6 ? current : current + clean));
      return;
    }
    if (activeField === "name") {
      setName(current => (current.length >= 32 ? current : current + ch));
      return;
    }
    if (activeField === "password") {
      setPassword(current => (current.length >= 128 ? current : current + ch));
      return;
    }
    setChatInput(current => (current.length >= 500 ? current : current + ch));
  }, [activeField]);

  const addSpace = useCallback(() => {
    // El código nunca lleva espacios.
    if (activeField === "code" || activeField === "password") return;
    insertChar(" ");
  }, [activeField, insertChar]);

  const deleteLast = useCallback(() => {
    if (activeField === "code") setCode(current => current.slice(0, -1));
    else if (activeField === "name") setName(current => current.slice(0, -1));
    else if (activeField === "password") setPassword(current => current.slice(0, -1));
    else setChatInput(current => current.slice(0, -1));
  }, [activeField]);

  const clearField = useCallback(() => {
    if (activeField === "code") setCode("");
    else if (activeField === "name") setName("");
    else if (activeField === "password") setPassword("");
    else setChatInput("");
  }, [activeField]);

  // Borrar físico + B del mando borran el campo activo cuando tiene texto;
  // sin texto B/Esc retroceden (back de BigPicturePage). Acción central.
  const activeText =
    activeField === "code" ? code
    : activeField === "name" ? name
    : activeField === "password" ? password
    : chatInput;
  useTextBackAction({ hasText: activeText.length > 0, onDeleteChar: deleteLast });

  // Teclado físico también escribe (para probar con teclado en desktop).
  // Con mando, useGamepad ya sintetiza flechas + Enter: no interfiere.
  // Borrar/B del mando lo gestiona useTextBackAction (acción central).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return;
      if (event.key === "Backspace") return;
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        addSpace();
        return;
      }
      if (event.key.length === 1 && /[a-zA-Z0-9]/.test(event.key)) {
        insertChar(event.key.toUpperCase());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [insertChar, addSpace, deleteLast]);

  const handleJoin = useCallback(() => {
    const clean = normalizeRoomCode(code);
    if (!isCompleteRoomCode(clean)) return;
    party.joinRoom(clean, name.trim() || "Invitado", password.trim(), joinServer);
  }, [code, name, password, joinServer, party]);

  const handleCreate = useCallback(() => {
    setCreating(true);
    setCreateError(null);
    void party
      .createRoom(null, name.trim() || "Anfitrión", password.trim())
      .catch((error: unknown) => {
        setCreateError(error instanceof Error ? error.message : "No se pudo crear la sala.");
      })
      .finally(() => setCreating(false));
  }, [name, password, party]);

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    party.sendChat(text);
    setChatInput("");
  }, [chatInput, party]);

  return (
    <div className="bp-party" data-bp-party>
      <h1 className="bp-party__title">Party</h1>
      <p className="bp-party__subtitle">
        {connected ? `Sala ${party.roomCode}` : "Ver juntos en la misma sala"}
      </p>

      <div className="bp-party__body">
        {/* Teclado en pantalla: la única entrada de texto con mando. */}
        <div className="bp-party__keyboard" aria-label="Teclado en pantalla">
          {KB_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="bp-party__kb-row">
              {row.map((ch, colIndex) => (
                <button
                  key={ch}
                  type="button"
                  data-bp-party-primary={rowIndex === 0 && colIndex === 0 && !connected && !busy ? true : undefined}
                  className="bp-party__kb-key"
                  onClick={() => insertChar(ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
          ))}
          <div className="bp-party__kb-actionrow">
            <button type="button" className="bp-party__kb-text" onClick={addSpace}>
              ESPACIO
            </button>
            <button type="button" className="bp-party__kb-del" aria-label="Borrar último carácter" onClick={deleteLast}>
              ⌫
            </button>
            <button type="button" className="bp-party__kb-text" onClick={clearField}>
              BORRAR
            </button>
          </div>
          {servers.length > 1 && !connected && !busy ? (
            <div className="bp-party__servers" role="group" aria-label="Servidor de la sala">
              {servers.map(server => (
                <button
                  key={server}
                  type="button"
                  className={joinServer === server ? "bp-party__server is-active" : "bp-party__server"}
                  aria-pressed={joinServer === server}
                  onClick={() => setJoinServer(server)}
                >
                  {serverHost(server)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="bp-party__content">
          {!connected && !busy ? (
            <>
              <div className="bp-party__fields">
                <button
                  type="button"
                  className={activeField === "name" ? "bp-party__field is-active" : "bp-party__field"}
                  onClick={() => setActiveField("name")}
                  onFocus={() => setActiveField("name")}
                >
                  <span className="bp-party__field-label">Tu nombre</span>
                  <span className="bp-party__field-value">{name || "¿Cómo te verán?"}</span>
                </button>
                <button
                  type="button"
                  className={activeField === "code" ? "bp-party__field is-active" : "bp-party__field"}
                  onClick={() => setActiveField("code")}
                  onFocus={() => setActiveField("code")}
                >
                  <span className="bp-party__field-label">Código de sala</span>
                  <span className="bp-party__field-value is-code">
                    {(code || "······").padEnd(6, "·")}
                  </span>
                </button>
                <button
                  type="button"
                  className={activeField === "password" ? "bp-party__field is-active" : "bp-party__field"}
                  onClick={() => setActiveField("password")}
                  onFocus={() => setActiveField("password")}
                >
                  <span className="bp-party__field-label">Contraseña (opcional)</span>
                  <span className="bp-party__field-value">
                    {password ? "•".repeat(Math.min(password.length, 16)) : "Solo si la sala la tiene"}
                  </span>
                </button>
              </div>

              <div className="bp-party__actions">
                <button
                  type="button"
                  className="bp-party__btn bp-party__btn--primary"
                  disabled={!codeComplete}
                  onClick={handleJoin}
                >
                  Unirse a la sala
                </button>
                <button
                  type="button"
                  className="bp-party__btn bp-party__btn--ghost"
                  disabled={creating}
                  onClick={handleCreate}
                >
                  {creating ? "Creando…" : "Crear sala vacía"}
                </button>
              </div>
              {createError ? <p className="bp-party__error">{createError}</p> : null}
              {party.error ? <p className="bp-party__error">{party.error}</p> : null}
              <p className="bp-party__hint">
                Escribe el código con el teclado de la izquierda. ¿Eres el anfitrión?
                Crea la sala aquí y comparte el código.
              </p>
            </>
          ) : busy ? (
            <div className="bp-party__busy">
              <p className="bp-party__busy-text">
                {party.status === "reconnecting" ? "Reconectando…" : "Conectando…"}
              </p>
              <button type="button" className="bp-party__btn bp-party__btn--ghost" onClick={() => party.leaveRoom()}>
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <p className="bp-party__code">{party.roomCode}</p>
              {party.isOwner ? <p className="bp-party__owner">Eres el anfitrión</p> : null}
              {party.media?.title ? (
                <p className="bp-party__media">{party.media.title}</p>
              ) : null}
              {party.peers.length > 0 ? (
                <div className="bp-party__peers">
                  {party.peers.map(peer => (
                    <span key={peer.id} className="bp-party__peer">
                      {peer.id === party.selfId ? `${peer.name} (tú)` : peer.name}
                      {peer.isOwner ? " · anfitrión" : ""}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="bp-party__chat" aria-label="Chat de la sala">
                {party.chat.length === 0 ? (
                  <p className="bp-party__hint">Sin mensajes todavía. Saluda al grupo.</p>
                ) : (
                  party.chat.map(message => (
                    <div
                      key={message.id}
                      className={message.from === party.selfId ? "bp-party__msg is-own" : "bp-party__msg"}
                    >
                      <p className="bp-party__msg-name">
                        {message.from === party.selfId ? `${message.name} (tú)` : message.name}
                      </p>
                      <p className="bp-party__msg-text">{message.text}</p>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <button
                type="button"
                className="bp-party__field is-active"
                onClick={() => setActiveField("chat")}
                onFocus={() => setActiveField("chat")}
              >
                <span className="bp-party__field-label">Mensaje</span>
                <span className="bp-party__field-value">{chatInput || "Escribe con el teclado…"}</span>
              </button>

              <div className="bp-party__actions">
                <button
                  type="button"
                  data-bp-party-primary={connected ? true : undefined}
                  className="bp-party__btn bp-party__btn--primary"
                  disabled={!chatInput.trim()}
                  onClick={handleSendChat}
                >
                  Enviar mensaje
                </button>
                {party.media ? (
                  <button
                    type="button"
                    className="bp-party__btn bp-party__btn--ghost"
                    onClick={() => {
                      const path = buildPlayerPathForMedia(party.media);
                      if (!path) return;
                      seedPlayerMeta(party.media?.title ?? "");
                      navigate(path);
                    }}
                  >
                    Abrir reproductor
                  </button>
                ) : null}
                <button
                  type="button"
                  className="bp-party__btn bp-party__btn--ghost is-danger"
                  onClick={() => {
                    if (party.isOwner) party.closeRoom();
                    else party.leaveRoom();
                  }}
                >
                  Salir de la sala
                </button>
              </div>
              {party.error ? <p className="bp-party__error">{party.error}</p> : null}
              {party.notice ? <p className="bp-party__notice">{party.notice}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
