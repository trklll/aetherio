import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ExternalLink, RefreshCw, Settings2, X } from "lucide-react";
import {
  getSourcePreferences,
  isProviderEnabled,
  isRepositoryEnabled,
  isSeanimeExtensionEnabled,
  isScraperSiteEnabled,
  saveSourcePreferences,
  type SourcePreferences,
} from "../../config/sourcePreferences";
import {
  getNuvioProviderRepositories,
  refreshNuvioProviderRepositories,
  type NuvioProviderRepositoryInfo,
} from "../../services/nuvioProviderService";
import { getScraperSites, type ScraperSiteInfo } from "../../services/scraperService";
import {
  getSeanimeExtensionInventory,
  getSeanimeExtensionUserConfig,
  saveSeanimeExtensionUserConfig,
  type SeanimeExtensionInventory,
  type SeanimeExtensionManifest,
} from "../../services/seanimeExtensionService";
import { useAddonStore } from "../../store/addonStore";

const CATEGORY_LABELS: Record<string, string> = {
  aggregator: "AGREGADORES",
  dedicated_server: "SERVIDORES DEDICADOS",
  multi_server: "MULTISERVIDOR",
  anime: "ANIME",
  free_with_ads: "GRATUITAS CON ANUNCIOS",
};

export default function SourcesPanel() {
  const addons = useAddonStore(state => state.addons);
  const enableAddon = useAddonStore(state => state.enableAddon);
  const disableAddon = useAddonStore(state => state.disableAddon);
  const [preferences, setPreferences] = useState<SourcePreferences>(() => getSourcePreferences());
  const [repositories, setRepositories] = useState<NuvioProviderRepositoryInfo[]>([]);
  const [sites, setSites] = useState<ScraperSiteInfo[]>([]);
  const [seanime, setSeanime] = useState<SeanimeExtensionInventory>({
    installed: [],
    errors: [],
  });
  const [configExtension, setConfigExtension] = useState<SeanimeExtensionManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadInventory = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const [nextRepositories, nextSites, nextSeanime] = await Promise.all([
        refresh ? refreshNuvioProviderRepositories() : getNuvioProviderRepositories(),
        getScraperSites(),
        getSeanimeExtensionInventory(refresh),
      ]);
      setRepositories(nextRepositories);
      setSites(nextSites);
      setSeanime(nextSeanime);
      if (nextSeanime.errors.length) setError(nextSeanime.errors.join("\n"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const groupedSites = useMemo(() => {
    const groups = new Map<string, ScraperSiteInfo[]>();
    for (const site of sites) {
      const current = groups.get(site.category) ?? [];
      current.push(site);
      groups.set(site.category, current);
    }
    return Array.from(groups.entries());
  }, [sites]);

  function updatePreferences(update: (current: SourcePreferences) => SourcePreferences) {
    setPreferences(current => {
      const next = update(current);
      saveSourcePreferences(next);
      return next;
    });
  }

  function setRepositoryEnabled(repositoryKey: string, enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      repositoryOverrides: { ...current.repositoryOverrides, [repositoryKey]: enabled },
    }));
  }

  function setProviderEnabled(providerKey: string, enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      providerOverrides: { ...current.providerOverrides, [providerKey]: enabled },
    }));
  }

  function setSiteEnabled(siteId: string, enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      siteOverrides: { ...current.siteOverrides, [siteId]: enabled },
    }));
  }

  function setSeanimeEnabled(extensionId: string, enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      seanimeExtensionOverrides: { ...current.seanimeExtensionOverrides, [extensionId]: enabled },
    }));
  }

  function setAllRepositories(enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      repositoryOverrides: {
        ...current.repositoryOverrides,
        ...Object.fromEntries(repositories.map(repository => [repository.key, enabled])),
      },
    }));
  }

  function setAllSites(enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      siteOverrides: {
        ...current.siteOverrides,
        ...Object.fromEntries(sites.map(site => [site.id, enabled])),
      },
    }));
  }

  function setAllSeanime(enabled: boolean) {
    updatePreferences(current => ({
      ...current,
      seanimeExtensionOverrides: {
        ...current.seanimeExtensionOverrides,
        ...Object.fromEntries(seanime.installed.map(extension => [extension.id, enabled])),
      },
    }));
  }

  const activeRepositoryCount = repositories.filter(repository => isRepositoryEnabled(preferences, repository.key)).length;
  const activeSiteCount = sites.filter(site => isScraperSiteEnabled(preferences, site.id, site.enabledByDefault)).length;
  const activeSeanimeCount = seanime.installed.filter(extension => isSeanimeExtensionEnabled(preferences, extension.id)).length;
  const activeAddonCount = addons.filter(addon => addon.enabled).length;

  function setAllAddons(enabled: boolean) {
    for (const addon of addons) {
      if (enabled) enableAddon(addon.id);
      else disableAddon(addon.id);
    }
  }

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-white">Fuentes</h2>
          <p className="mt-1 text-sm font-semibold text-white/45">
            {activeAddonCount} add-ons Stremio · {activeRepositoryCount} repositorios · {activeSiteCount} sitios FMHY · {activeSeanimeCount} providers Seanime
          </p>
          <p className="mt-1 text-xs font-semibold text-white/32">Fuentes integradas globales; AIOMetadata y AIOStreams pertenecen únicamente al perfil activo.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadInventory(true)}
          disabled={loading}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white/70 gsap-transition hover:bg-white/[0.12] hover:text-white disabled:cursor-wait disabled:opacity-45"
          aria-label="Actualizar manifests"
          title="Actualizar manifests"
        >
          <RefreshCw size={17} className={loading ? "gsap-spin" : undefined} />
        </button>
      </header>

      {error ? (
        <p className="mb-5 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-8">
        <SourceSection
          title="ADD-ONS STREMIO"
          count={`${activeAddonCount}/${addons.length}`}
          onEnableAll={() => setAllAddons(true)}
          onDisableAll={() => setAllAddons(false)}
        >
          {addons.map(addon => (
            <SourceRow
              key={addon.id}
              title={addon.name}
              description={`${addon.scope === "profile" ? "Personal · " : addon.bundled ? "Global · Integrado · " : "Global · "}${(addon.manifest?.types ?? []).map((type: string) => type === "series" ? "Series" : type === "movie" ? "Películas" : type).join(" · ")} · v${addon.version}`}
              checked={addon.enabled}
              onChange={checked => checked ? enableAddon(addon.id) : disableAddon(addon.id)}
              action={(
                <a
                  href={addon.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 gsap-transition hover:bg-white/[0.08] hover:text-white"
                  aria-label={`Abrir manifest de ${addon.name}`}
                  title="Abrir manifest"
                >
                  <ExternalLink size={15} />
                </a>
              )}
            />
          ))}
          {addons.length === 0 ? <EmptyRow label="No hay add-ons Stremio instalados." /> : null}
        </SourceSection>

        <SourceSection
          title="MANIFESTS"
          count={`${activeRepositoryCount}/${repositories.length}`}
          onEnableAll={() => setAllRepositories(true)}
          onDisableAll={() => setAllRepositories(false)}
        >
          {repositories.map(repository => {
            const repositoryEnabled = isRepositoryEnabled(preferences, repository.key);
            const compatibleScrapers = repository.scrapers.filter(scraper => scraper.supportsExternalPlayer);
            const enabledScrapers = compatibleScrapers.filter(scraper => isProviderEnabled(
              preferences,
              repository.key,
              scraper.key,
              scraper.enabledByManifest,
            )).length;
            return (
              <div key={repository.key} className="border-b border-white/[0.07] last:border-b-0">
                <SourceRow
                  title={`${repository.ownerName} · ${repository.name}`}
                  description={repository.error
                    ? "Manifest no disponible"
                    : `${enabledScrapers}/${compatibleScrapers.length} scrapers activos${repository.version ? ` · v${repository.version}` : ""}`}
                  checked={repositoryEnabled}
                  onChange={checked => setRepositoryEnabled(repository.key, checked)}
                  action={(
                    <a
                      href={repository.manifestUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 gsap-transition hover:bg-white/[0.08] hover:text-white"
                      aria-label={`Abrir manifest de ${repository.ownerName}`}
                      title="Abrir manifest"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                />
                {repository.scrapers.length ? (
                  <div className="border-t border-white/[0.05] bg-black/10 pl-7">
                    {repository.scrapers.map(scraper => {
                      const available = scraper.supportsExternalPlayer && scraper.enabledByManifest;
                      const checked = available && isProviderEnabled(
                        preferences,
                        repository.key,
                        scraper.key,
                        scraper.enabledByManifest,
                      );
                      const metadata = [
                        scraper.supportedTypes.map(type => type === "tv" ? "Series" : type === "movie" ? "Peliculas" : type).join(" · "),
                        scraper.contentLanguage.map(language => language.toUpperCase()).join(" · "),
                        !scraper.supportsExternalPlayer ? "No compatible con MPV" : "",
                        !scraper.enabledByManifest ? "Desactivado por el manifest" : "",
                      ].filter(Boolean).join(" · ");
                      return (
                        <SourceRow
                          key={scraper.key}
                          title={scraper.name}
                          description={metadata || scraper.description}
                          checked={checked}
                          disabled={!repositoryEnabled || !available}
                          onChange={enabled => setProviderEnabled(scraper.key, enabled)}
                          compact
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!loading && repositories.length === 0 ? <EmptyRow label="No se pudieron cargar los manifests." /> : null}
        </SourceSection>

        <SourceSection
          title="PROVIDERS SEANIME"
          count={`${activeSeanimeCount}/${seanime.installed.length}`}
          onEnableAll={() => setAllSeanime(true)}
          onDisableAll={() => setAllSeanime(false)}
        >
          {seanime.installed.map(extension => (
            <SourceRow
              key={extension.id}
              title={extension.name}
              description={`${extension.type === "anime-torrent-provider" ? "Torrent" : "Servidor"} · ${extension.lang?.toUpperCase() ?? "MULTI"} · v${extension.version}`}
              checked={isSeanimeExtensionEnabled(preferences, extension.id)}
              onChange={checked => setSeanimeEnabled(extension.id, checked)}
              action={(
                <div className="flex items-center gap-1">
                  <a
                    href={extension.manifestURI}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 gsap-transition hover:bg-white/[0.08] hover:text-white"
                    aria-label={`Abrir manifest de ${extension.name}`}
                    title="Abrir manifest"
                  >
                    <ExternalLink size={15} />
                  </a>
                  {extension.userConfig?.fields.length ? (
                    <button
                      type="button"
                      onClick={() => setConfigExtension(extension)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 gsap-transition hover:bg-white/[0.08] hover:text-white"
                      aria-label={`Configurar ${extension.name}`}
                      title="Preferencias"
                    >
                      <Settings2 size={15} />
                    </button>
                  ) : null}
                </div>
              )}
              compact
            />
          ))}
          {!loading && seanime.installed.length === 0 ? <EmptyRow label="No hay providers Seanime instalados." /> : null}
        </SourceSection>

        <SourceSection
          title="SITIOS FMHY"
          count={`${activeSiteCount}/${sites.length}`}
          onEnableAll={() => setAllSites(true)}
          onDisableAll={() => setAllSites(false)}
        >
          {groupedSites.map(([category, categorySites]) => (
            <div key={category}>
              <p className="border-b border-white/[0.06] bg-white/[0.025] px-5 py-2 text-[11px] font-black text-white/38">
                {CATEGORY_LABELS[category] ?? category.toUpperCase()}
              </p>
              {categorySites.map(site => (
                <SourceRow
                  key={site.id}
                  title={site.name}
                  description={`${site.types.map(type => type === "series" ? "Series" : type === "movie" ? "Peliculas" : "Anime").join(" · ")} · ${site.baseUrl}`}
                  checked={isScraperSiteEnabled(preferences, site.id, site.enabledByDefault)}
                  onChange={checked => setSiteEnabled(site.id, checked)}
                  compact
                />
              ))}
            </div>
          ))}
          {!loading && sites.length === 0 ? <EmptyRow label="Los sitios FMHY solo están disponibles en la app de escritorio." /> : null}
        </SourceSection>
      </div>
      {configExtension ? (
        <SeanimeConfigDialog extension={configExtension} onClose={() => setConfigExtension(null)} />
      ) : null}
    </section>
  );
}

function SourceSection({
  title,
  count,
  onEnableAll,
  onDisableAll,
  children,
}: {
  title: string;
  count: string;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-black text-white/48">{title}</h3>
          <span className="text-xs font-bold text-white/28">{count}</span>
        </div>
        {onEnableAll && onDisableAll ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={onEnableAll} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white/55 gsap-transition hover:bg-white/[0.08] hover:text-white">
              Activar todo
            </button>
            <button type="button" onClick={onDisableAll} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white/55 gsap-transition hover:bg-white/[0.08] hover:text-white">
              Desactivar todo
            </button>
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.045]">
        {children}
      </div>
    </section>
  );
}

function SourceRow({
  title,
  description,
  checked,
  disabled = false,
  compact = false,
  action,
  onChange,
}: {
  title: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  compact?: boolean;
  action?: ReactNode;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <div className={clsx(
      "flex min-w-0 items-center justify-between gap-4 border-b border-white/[0.055] px-5 last:border-b-0",
      compact ? "py-3" : "py-4",
      disabled && "opacity-45",
    )}>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-white">{title}</p>
        {description ? <p className="mt-1 truncate text-xs font-semibold text-white/42">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        {typeof checked === "boolean" && onChange ? (
          <SourceSwitch checked={checked} disabled={disabled} onChange={() => onChange(!checked)} />
        ) : null}
      </div>
    </div>
  );
}

function SourceSwitch({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={clsx(
        "relative h-7 w-12 rounded-full gsap-transition",
        checked ? "bg-white" : "bg-white/18",
        disabled && "cursor-not-allowed",
      )}
      aria-pressed={checked}
    >
      <span className={clsx(
        "absolute top-1 h-5 w-5 rounded-full gsap-transition",
        checked ? "left-6 bg-black" : "left-1 bg-white/54",
      )} />
    </button>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-5 py-4 text-sm font-semibold text-white/42">{label}</p>;
}

function SeanimeConfigDialog({ extension, onClose }: { extension: SeanimeExtensionManifest; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => getSeanimeExtensionUserConfig(extension));

  function updateValue(name: string, value: string) {
    setValues(current => ({ ...current, [name]: value }));
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 p-5" role="dialog" aria-modal="true" aria-label={`Preferencias de ${extension.name}`}>
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Cerrar" />
      <form
        className="relative z-10 w-full max-w-lg rounded-lg border border-white/12 bg-[#181818] p-5 shadow-2xl"
        onSubmit={event => {
          event.preventDefault();
          saveSeanimeExtensionUserConfig(extension, values);
          onClose();
        }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black text-white">{extension.name}</h3>
            <p className="mt-1 text-xs font-semibold text-white/42">v{extension.version}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/55 gsap-transition hover:bg-white/[0.08] hover:text-white" aria-label="Cerrar" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4">
          {(extension.userConfig?.fields ?? []).map(field => (
            <label key={field.name} className="grid gap-2 text-sm font-bold text-white/72">
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select
                  value={values[field.name] ?? ""}
                  onChange={event => updateValue(field.name, event.target.value)}
                  className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                >
                  {(field.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : field.type === "switch" ? (
                <SourceSwitch
                  checked={values[field.name] === "true"}
                  disabled={false}
                  onChange={() => updateValue(field.name, values[field.name] === "true" ? "false" : "true")}
                />
              ) : (
                <input
                  type="text"
                  value={values[field.name] ?? ""}
                  onChange={event => updateValue(field.name, event.target.value)}
                  className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                />
              )}
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold text-white/60 gsap-transition hover:bg-white/[0.08] hover:text-white">Cancelar</button>
          <button type="submit" className="h-10 rounded-lg bg-white px-5 text-sm font-black text-black gsap-transition hover:bg-white/90">Guardar</button>
        </div>
      </form>
    </div>
  );
}
