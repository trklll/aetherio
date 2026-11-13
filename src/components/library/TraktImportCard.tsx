import { useEffect, useRef, useState, type DragEvent } from "react";
import { Archive, EyeOff, Upload } from "lucide-react";
import { getScopedStorageKey, EXPERIENCE_SCOPE_CHANGED_EVENT } from "../../utils/localProfiles";
import { importTraktArchive } from "../../integrations/traktImport";

const TRAKT_IMPORT_KEY = "aetherio-trakt-import-complete-v1";
const TRAKT_DISMISSED_KEY = "aetherio-trakt-import-dismissed-v1";

export default function TraktImportCard({ alwaysVisible = false }: { alwaysVisible?: boolean } = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState(readImportedState);
  const [dismissed, setDismissed] = useState(readDismissedState);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const refresh = () => {
      setImported(readImportedState());
      setDismissed(readDismissedState());
    };
    window.addEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  async function importFile(file?: File) {
    if (!file) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Selecciona un archivo .zip de exportación de Trakt.");
      return;
    }

    setBusy(true);
    try {
      const summary = importTraktArchive(new Uint8Array(await file.arrayBuffer()));
      localStorage.setItem(getScopedStorageKey(TRAKT_IMPORT_KEY), JSON.stringify({
        fileName: file.name,
        importedAt: Date.now(),
        summary,
      }));
      setImported(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo importar el ZIP de Trakt.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    void importFile(event.dataTransfer.files[0]);
  }

  function dismiss() {
    try {
      localStorage.setItem(getScopedStorageKey(TRAKT_DISMISSED_KEY), "1");
      setDismissed(true);
    } catch {
      setError("No se pudo ocultar el aviso. Revisa el almacenamiento disponible.");
    }
  }

  if (!alwaysVisible && (imported || dismissed)) return null;

  return (
    <section
      className="liquid-glass flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 transition-colors"
      style={{ borderColor: dragging ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.08)", background: dragging ? "rgba(255,255,255,0.10)" : undefined }}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-label="Zona para importar el archivo ZIP de Trakt"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Archive size={19} className="shrink-0 text-white/70" aria-hidden="true" />
        <div>
          <p className="text-sm font-black text-white">Trakt.tv</p>
          <p className="mt-1 text-xs font-semibold text-white/48">
            {error || (dragging
              ? "Suelta el ZIP de Trakt para importar sus datos."
              : alwaysVisible
                ? "Importa o reimporta tu ZIP de exportación para actualizar la Biblioteca."
                : "Importa o arrastra aquí cualquier ZIP de exportación de Trakt.")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
      {!alwaysVisible ? (
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-bold text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-55"
          aria-label="No mostrar la importación de Trakt"
        >
          <EyeOff size={15} aria-hidden="true" />
          No mostrar
        </button>
      ) : null}
      <div className="relative">
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          aria-label="Seleccionar archivo de exportación de Trakt"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          disabled={busy}
          onChange={event => void importFile(event.currentTarget.files?.[0])}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-black text-black disabled:opacity-55"
        >
          <Upload size={15} aria-hidden="true" />
          {busy ? "Importando…" : imported ? "Reimportar ZIP" : "Importar ZIP"}
        </button>
      </div>
      </div>
    </section>
  );
}

function readImportedState() {
  try {
    return localStorage.getItem(getScopedStorageKey(TRAKT_IMPORT_KEY)) !== null;
  } catch {
    return false;
  }
}

function readDismissedState() {
  try {
    return localStorage.getItem(getScopedStorageKey(TRAKT_DISMISSED_KEY)) === "1";
  } catch {
    return false;
  }
}
