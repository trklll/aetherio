import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Delete,
  Loader2,
  Plus,
  Puzzle,
  Trash2,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import { useAddonStore, type InstalledAddon } from "../../store/addonStore.ts";

const KEYBOARD_ROWS = [
  ["a", "b", "c", "d", "e", "f", "g", "h"],
  ["i", "j", "k", "l", "m", "n", "o", "p"],
  ["q", "r", "s", "t", "u", "v", "w", "x"],
  ["y", "z", "0", "1", "2", "3", "4", "5"],
  ["6", "7", "8", "9", ":", "/", ".", "-"] ,
];

export default function BigPictureAddons() {
  const [url, setUrl] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<InstalledAddon | null>(null);
  const keyboardFirstRef = useRef<HTMLButtonElement | null>(null);
  const {
    addons,
    isInstalling,
    installError,
    setInstalling,
    setInstallError,
    addAddon,
    removeAddon,
    enableAddon,
    disableAddon,
  } = useAddonStore();

  useEffect(() => {
    if (!keyboardOpen) return;
    const timer = window.setTimeout(() => keyboardFirstRef.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(timer);
  }, [keyboardOpen]);

  useEffect(() => {
    if (!keyboardOpen && !removeTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (keyboardOpen) setKeyboardOpen(false);
      else setRemoveTarget(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [keyboardOpen, removeTarget]);

  function addLog(message: string) {
    setLog(previous => [...previous, `[${new Date().toLocaleTimeString()}] ${message}`]);
    setShowLog(true);
  }

  async function handleInstall() {
    const raw = url.trim();
    if (!raw || isInstalling) return;
    setInstalling(true);
    setInstallError(null);
    setLog([]);
    const manifestUrl = raw.replace(/\/manifest\.json$/, "").replace(/\/$/, "") + "/manifest.json";
    addLog(`Conectando con ${manifestUrl}`);
    try {
      const response = await fetch(manifestUrl, { headers: { Accept: "application/json" } });
      addLog(`Respuesta HTTP ${response.status}`);
      if (!response.ok) throw new Error(`El servidor respondió con error ${response.status}`);
      const text = await response.text();
      let manifest: any;
      try {
        manifest = JSON.parse(text);
      } catch {
        throw new Error("La respuesta no es JSON válido");
      }
      if (!manifest.id || !manifest.name) throw new Error("Manifest inválido: faltan id o name");
      addAddon({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        logo: manifest.logo,
        url: raw,
        manifest,
        enabled: true,
        installedAt: Date.now(),
        version: manifest.version ?? "1.0.0",
      });
      addLog(`Addon ${manifest.name} instalado correctamente.`);
      setUrl("");
      setKeyboardOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      addLog(`Error: ${message}`);
      setInstallError(message);
    } finally {
      setInstalling(false);
    }
  }

  function confirmRemove() {
    if (!removeTarget) return;
    removeAddon(removeTarget.id);
    setRemoveTarget(null);
  }

  return (
    <main className="bp-settings-page bp-addons-page" data-bp-addons>
      <header className="bp-settings-page__header">
        <p className="bp-settings-page__eyebrow">Aetherio / Fuentes</p>
        <h1>Complementos</h1>
      </header>

      <section className="bp-addons-page__install" aria-label="Instalar complemento">
        <div>
          <p className="bp-addons-page__section-label">Instalar complemento</p>
          <h2>Añadir una fuente</h2>
        </div>
        <div className="bp-addons-page__install-controls">
          <button type="button" className={`bp-addons-page__url${url ? " has-value" : ""}`} onClick={() => setKeyboardOpen(true)}>
            <span>{url || "Escribir URL del manifest"}</span>
          </button>
          <button type="button" className="bp-settings-page__action bp-addons-page__install-button" disabled={isInstalling || !url.trim()} onClick={() => void handleInstall()}>
            {isInstalling ? <Loader2 size={21} className="bp-addons-page__spin" /> : <Plus size={21} />}
            {isInstalling ? "Instalando" : "Instalar"}
          </button>
        </div>
        {installError ? <p className="bp-addons-page__error">{installError}</p> : null}
      </section>

      {log.length > 0 ? (
        <section className="bp-addons-page__log">
          <button type="button" onClick={() => setShowLog(value => !value)}>
            {showLog ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
            Registro de instalación · {log.length} eventos
          </button>
          {showLog ? <div className="bp-addons-page__log-body">{log.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div> : null}
        </section>
      ) : null}

      <section className="bp-addons-page__installed">
        <div className="bp-addons-page__installed-header">
          <div>
            <p className="bp-addons-page__section-label">Fuentes disponibles</p>
            <h2>Instalados <span>{addons.length}</span></h2>
          </div>
          <p className="bp-settings-page__hint">{addons.filter(addon => addon.enabled).length} activos</p>
        </div>
        {addons.length === 0 ? (
          <div className="bp-addons-page__empty"><Puzzle size={42} /><p>Aún no hay complementos instalados.</p></div>
        ) : (
          <div className="bp-addons-page__list">
            {addons.map(addon => (
              <AddonCard key={addon.id} addon={addon} onToggle={() => addon.enabled ? disableAddon(addon.id) : enableAddon(addon.id)} onRemove={() => setRemoveTarget(addon)} />
            ))}
          </div>
        )}
      </section>

      {keyboardOpen ? <AddonKeyboard value={url} onChange={setUrl} onDone={() => setKeyboardOpen(false)} firstRef={keyboardFirstRef} /> : null}
      {removeTarget ? <RemoveDialog addon={removeTarget} onCancel={() => setRemoveTarget(null)} onConfirm={confirmRemove} /> : null}
    </main>
  );
}

function AddonCard({ addon, onToggle, onRemove }: { addon: InstalledAddon; onToggle: () => void; onRemove: () => void }) {
  return (
    <article className={`bp-addons-page__card${addon.enabled ? " is-enabled" : " is-disabled"}`}>
      <div className="bp-addons-page__logo">
        {addon.logo ? <img src={addon.logo} alt="" /> : <Puzzle size={27} />}
      </div>
      <div className="bp-addons-page__card-copy">
        <h3>{addon.name}</h3>
        <p>{addon.scope === "profile" ? "Personal" : addon.bundled ? "Integrado" : "Global"} · v{addon.version}</p>
        {addon.description ? <small>{addon.description}</small> : null}
      </div>
      <div className="bp-addons-page__card-actions">
        <button type="button" className="bp-addons-page__toggle" onClick={onToggle} aria-pressed={addon.enabled}>
          {addon.enabled ? <ToggleRight size={31} /> : <ToggleLeft size={31} />}
          <span>{addon.enabled ? "Activo" : "Inactivo"}</span>
        </button>
        {!addon.bundled ? <button type="button" className="bp-addons-page__remove" onClick={onRemove} aria-label={`Eliminar ${addon.name}`}><Trash2 size={21} /></button> : null}
      </div>
    </article>
  );
}

function AddonKeyboard({ value, onChange, onDone, firstRef }: { value: string; onChange: (value: string) => void; onDone: () => void; firstRef: MutableRefObject<HTMLButtonElement | null> }) {
  const append = (key: string) => onChange(`${value}${key}`);
  return (
    <div className="bp-addons-page__modal" data-spatial-modal role="dialog" aria-label="Teclado para URL">
      <div className="bp-addons-page__keyboard">
        <div className="bp-addons-page__keyboard-head"><span>URL del manifest</span><strong>{value || "Escribe una dirección"}</strong></div>
        <div className="bp-addons-page__keys">
          {KEYBOARD_ROWS.flatMap((row, rowIndex) => row.map((key, keyIndex) => (
            <button key={key} type="button" ref={rowIndex === 0 && keyIndex === 0 ? firstRef : undefined} onClick={() => append(key)}>{key}</button>
          )))}
          <button type="button" onClick={() => append("_")}>_</button>
          <button type="button" onClick={() => onChange(value.slice(0, -1))}><Delete size={22} /></button>
          <button type="button" onClick={() => onChange("")}>Limpiar</button>
          <button type="button" className="is-done" onClick={onDone}><Check size={22} />Listo</button>
        </div>
      </div>
    </div>
  );
}

function RemoveDialog({ addon, onCancel, onConfirm }: { addon: InstalledAddon; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="bp-addons-page__modal" data-spatial-modal role="dialog" aria-label="Confirmar eliminación">
      <div className="bp-addons-page__confirm">
        <button type="button" className="bp-addons-page__close" aria-label="Cerrar" onClick={onCancel}><X size={21} /></button>
        <Trash2 size={30} />
        <h2>¿Eliminar {addon.name}?</h2>
        <p>Dejará de aparecer como fuente en tus catálogos y streams.</p>
        <div><button ref={cancelRef} type="button" className="bp-addons-page__secondary" onClick={onCancel}>Cancelar</button><button type="button" className="bp-addons-page__danger" onClick={onConfirm}>Eliminar</button></div>
      </div>
    </div>
  );
}
