import { useEffect, useState } from "react";
import { Code2, Puzzle } from "lucide-react";
import AppleSpinner from "../../components/ui/AppleSpinner.tsx";
import ToggleSwitch, { TogglePill } from "../../components/ui/ToggleSwitch.tsx";
import { getSourcePreferences, isProviderEnabled, isRepositoryEnabled, saveSourcePreferences, useSourcePreferences } from "../../config/sourcePreferences.ts";
import { clearProviderRuntimeResultCache, getProviderRuntimeRepositories, type ProviderRuntimeScraperInfo } from "../../services/providerRuntimeService.ts";

const HUB_KEY = "aetherio-hub";

/** Real executable scripts, not synthetic InstalledAddon/Stremio identities. */
export default function HubScriptSources({ bigPicture = false }: { bigPicture?: boolean }) {
  const preferences = useSourcePreferences();
  const [sources, setSources] = useState<ProviderRuntimeScraperInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getProviderRuntimeRepositories().then(repositories => {
      if (!active) return;
      const hub = repositories.find(repository => repository.key === HUB_KEY);
      setSources((hub?.scrapers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)));
      setError(hub?.error ? "No se pudo cargar el Provider Hub. Vuelve a abrir esta pantalla para reintentar." : "");
    }).catch(() => {
      if (active) setError("No se pudo cargar el Provider Hub. Vuelve a abrir esta pantalla para reintentar.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function toggle(source: ProviderRuntimeScraperInfo) {
    const current = getSourcePreferences();
    const enabled = isProviderEnabled(current, HUB_KEY, source.key, source.enabledByManifest);
    saveSourcePreferences({ ...current, providerOverrides: { ...current.providerOverrides, [source.key]: !enabled } });
    clearProviderRuntimeResultCache();
  }

  return <section aria-label="Scripts del Provider Hub" className={bigPicture ? "bp-addons-page__installed" : "mt-10 max-w-2xl"}>
    <div className={bigPicture ? "bp-addons-page__installed-header" : "mb-4"}>
      <h2 className={bigPicture ? undefined : "text-sm font-semibold text-text-primary"}>Scripts del Provider Hub</h2>
      <p className={bigPicture ? "bp-settings-page__hint" : "mt-1 text-sm text-text-secondary"}>Fuentes independientes. Su disponibilidad se administra en el Hub.</p>
    </div>
    {loading ? <p role="status" className="flex items-center gap-2 py-4"><AppleSpinner size={18} />Cargando fuentes…</p> : null}
    {error ? <p role="alert" className="py-4 text-sm text-text-secondary">{error}</p> : null}
    {!loading && !error && !sources.length ? <p className="py-4 text-sm text-text-secondary">El Hub no publica scripts activos.</p> : null}
    <div className={bigPicture ? "bp-addons-page__list" : "space-y-3"}>
      {sources.map(source => {
        const enabled = source.enabledByManifest && isProviderEnabled(preferences, HUB_KEY, source.key, source.enabledByManifest);
        const disabled = !source.enabledByManifest || !source.supportsExternalPlayer || !isRepositoryEnabled(preferences, HUB_KEY);
        const label = `${enabled ? "Desactivar" : "Activar"} ${source.name}`;
        return <article key={source.key} className={bigPicture ? `bp-addons-page__card${enabled ? " is-enabled" : " is-disabled"}` : "flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"}>
          <div className={bigPicture ? "bp-addons-page__logo" : "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/5"}>
            {source.logo ? <img src={source.logo} alt="" className="h-full w-full object-contain" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /> : <Puzzle size={bigPicture ? 27 : 20} />}
          </div>
          <div className={bigPicture ? "bp-addons-page__card-copy" : "min-w-0 flex-1"}>
            <h3 className={bigPicture ? undefined : "font-semibold text-text-primary"}>{source.name}</h3>
            <p className={bigPicture ? undefined : "mt-1 flex items-center gap-1 text-xs text-text-secondary"}><Code2 size={13} aria-hidden="true" /> Script · {source.contentLanguage.map(language => language.toUpperCase()).join(" · ")}</p>
            {source.description ? <p className={bigPicture ? undefined : "mt-1 text-xs text-text-secondary"}>{source.description}</p> : null}
          </div>
          {bigPicture ? <button type="button" className="bp-addons-page__toggle" role="switch" aria-label={label} aria-checked={enabled} disabled={disabled} onClick={() => toggle(source)}>
            <TogglePill checked={enabled} /><span>{enabled ? "Activo" : "Inactivo"}</span>
          </button> : <ToggleSwitch checked={enabled} disabled={disabled} label={label} onChange={() => toggle(source)} />}
        </article>;
      })}
    </div>
  </section>;
}
