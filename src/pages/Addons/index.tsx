import { useState } from "react";
import { useAddonStore } from "../../store/addonStore";
import { Puzzle, Plus, Trash2, ToggleLeft, ToggleRight, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";

export default function AddonsPage() {
  const [url, setUrl]         = useState("");
  const [log, setLog]         = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  const {
    addons, isInstalling, installError,
    setInstalling, setInstallError, addAddon, removeAddon, enableAddon, disableAddon,
  } = useAddonStore();

  function addLog(msg: string) {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    setShowLog(true);
  }

  async function handleInstall() {
    const raw = url.trim();
    if (!raw) return;

    setInstalling(true);
    setInstallError(null);
    setLog([]);

    // Construir URL del manifest
    let manifestUrl = raw.replace(/\/manifest\.json$/, "").replace(/\/$/, "") + "/manifest.json";
    addLog(`Intentando conectar a: ${manifestUrl}`);

    try {
      addLog("Enviando petición fetch...");
      const res = await fetch(manifestUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      addLog(`Respuesta HTTP: ${res.status} ${res.statusText}`);

      if (!res.ok) {
        throw new Error(`El servidor respondió con error ${res.status}`);
      }

      const text = await res.text();
      addLog(`Respuesta recibida (${text.length} chars)`);

      let manifest: any;
      try {
        manifest = JSON.parse(text);
      } catch {
        throw new Error("La respuesta no es JSON válido");
      }

      addLog(`Manifest parseado: id="${manifest.id}" name="${manifest.name}"`);

      if (!manifest.id || !manifest.name) {
        throw new Error("Manifest inválido: faltan campos 'id' o 'name'");
      }

      addAddon({
        id:          manifest.id,
        name:        manifest.name,
        description: manifest.description,
        logo:        manifest.logo,
        url:         raw,
        manifest,
        enabled:     true,
        installedAt: Date.now(),
        version:     manifest.version ?? "1.0.0",
      });

      addLog(`✅ Addon "${manifest.name}" instalado correctamente.`);
      setUrl("");

    } catch (e: any) {
      const msg = e?.message ?? "Error desconocido";
      addLog(`❌ ERROR: ${msg}`);
      setInstallError(msg);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <PageContainer className="flex flex-col h-full py-8 animate-fadeIn overflow-y-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Puzzle size={28} className="text-accent" />
        <h1 className="text-3xl font-bold text-text-primary">Add-ons</h1>
      </div>

      {/* Install form */}
      <div className="glass rounded-glass p-6 mb-4 max-w-2xl">
        <h2 className="text-lg font-semibold text-text-primary mb-1">Instalar addon</h2>
        <p className="text-sm text-text-secondary mb-4">
          Pega la URL base del addon o directamente la URL de <code className="text-accent">/manifest.json</code>
        </p>
        <div className="flex gap-3">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleInstall()}
            placeholder="https://v3-cinemeta.strem.io/manifest.json"
            className="flex-1 bg-bg-surface border border-glass-border rounded-card px-4 py-3 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors text-sm"
          />
          <button
            onClick={handleInstall}
            disabled={isInstalling || !url.trim()}
            className="flex items-center gap-2 px-5 py-3 bg-accent hover:bg-accent-dark text-white font-semibold rounded-card transition-all duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isInstalling
              ? <Loader2 size={16} className="animate-spin" />
              : <Plus size={16} />}
            {isInstalling ? "Instalando..." : "Instalar"}
          </button>
        </div>

        {installError && (
          <p className="mt-3 text-sm text-red-400 font-medium">⚠ {installError}</p>
        )}
      </div>

      {/* Log panel */}
      {log.length > 0 && (
        <div className="max-w-2xl mb-6">
          <button
            onClick={() => setShowLog(v => !v)}
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary mb-2 transition-colors"
          >
            {showLog ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            Log de instalación ({log.length} líneas)
          </button>
          {showLog && (
            <div className="bg-bg-surface border border-glass-border rounded-card p-4 font-mono text-xs text-text-secondary space-y-1 max-h-48 overflow-y-auto">
              {log.map((line, i) => (
                <div
                  key={i}
                  className={line.includes("❌") ? "text-red-400" : line.includes("✅") ? "text-green-400" : ""}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Addons instalados */}
      <div className="max-w-2xl">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Instalados ({addons.length})
        </h2>

        {addons.length === 0 ? (
          <div className="glass rounded-glass p-8 text-center">
            <Puzzle size={36} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-sm">No hay addons instalados.</p>
            <p className="text-text-muted text-xs mt-1">
              Prueba con: <span className="text-accent">https://v3-cinemeta.strem.io/manifest.json</span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {addons.map(addon => (
              <div key={addon.id} className="glass rounded-glass p-4 flex items-center gap-4 animate-fadeIn">
                {addon.logo ? (
                  <img src={addon.logo} alt="" className="w-10 h-10 rounded-lg object-contain bg-bg-surface" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-bg-surface flex items-center justify-center shrink-0">
                    <Puzzle size={18} className="text-text-muted" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary truncate">{addon.name}</p>
                  <p className="text-xs text-text-muted truncate">
                    {addon.manifest?.types?.join(" · ")} · v{addon.version}
                  </p>
                  {addon.description && (
                    <p className="text-xs text-text-secondary truncate mt-0.5">{addon.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => addon.enabled ? disableAddon(addon.id) : enableAddon(addon.id)}
                    className={`transition-colors ${addon.enabled ? "text-accent" : "text-text-muted"}`}
                    title={addon.enabled ? "Desactivar" : "Activar"}
                  >
                    {addon.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                  </button>
                  <button
                    onClick={() => removeAddon(addon.id)}
                    className="text-text-muted hover:text-red-400 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
