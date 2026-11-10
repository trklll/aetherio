import { create } from "zustand";
import { HUB_ADDON_STATES_KEY, migrateLocalAddonDefaults, readHubAddonStates } from "./addonDefaultsMigration.ts";
import type { AddonStreamNameFilter } from "../utils/addonStreamFilter.ts";
import { getActiveProfileId } from "../utils/localProfiles.ts";
import { configuredSportsStreamsManifestUrl, normalizeSportsStreamsManifestUrl, SPORTS_STREAMS_ADDON_ID } from "../services/sportsStreamsConfig.ts";
import {
  fetchHubAddonManifest,
  fetchProviderHubAddonDirectory,
  PENGUPLAY_MANIFEST_URL,
  readCachedProviderHubAddonDirectory,
  resolveHubAddonManifestUrl,
  type ProviderHubAddonDirectory,
  type ProviderHubAddonEntry,
} from "../services/providerHubAddonDirectory.ts";
import {
  CNCVERSE_BRIDGE_ID,
  CNCVERSE_BRIDGE_LOGO,
  CNCVERSE_TV_ADDON_ID,
  isCncVerseTvAddon,
  readCncVerseBridgeUrl,
  writeCncVerseBridgeUrl,
} from "../services/cncverseBridge.ts";

export type AddonScope = "global" | "profile";

export interface InstalledAddon {
  id: string;
  name: string;
  description?: string;
  logo?: string;
  url: string;
  manifest: any;
  enabled: boolean;
  installedAt: number;
  version: string;
  bundled?: boolean;
  /** Explicit provenance: manual installations must never be replaced by Hub sync. */
  origin?: "user" | "provider-hub";
  upstreamAddonId?: string;
  streamNameFilter?: AddonStreamNameFilter;
  scope?: AddonScope;
  /**
   * Timeout de `stream` en ms. Los add-ons que agregan muchos upstreams por
   * debajo (el CNCVerse Bridge consulta ~70 extensiones) tardan bastante mas
   * que el default de 6 s: medido, 28-49 s por capitulo.
   */
  streamTimeoutMs?: number;
  /** Intentos de `stream`. El default es 3, pensado para add-ons rapidos. */
  streamAttempts?: number;
  /**
   * Tipos por los que se pide `stream`, en vez de derivarlos de `query.type`.
   * Para add-ons que resuelven por id ignorando el tipo y tardan lo que tardan:
   * pedir movie/series/tv/anime seria la misma espera repetida cuatro veces.
   */
  streamRequestTypes?: string[];
  /**
   * El add-on codifica el proveedor en cada stream, asi que el filtro de
   * fuentes agrupa por proveedor real y no debe abrir un chip con su nombre.
   */
  streamSourceFromPayload?: boolean;
  /**
   * El add-on se pide igual pero no se lista en las paginas de complementos
   * ni en Fuentes: entra en el flujo de streams sin ocupar la interfaz.
   */
  hiddenInUi?: boolean;
}

interface AddonStore {
  addons: InstalledAddon[];
  isInstalling: boolean;
  installError: string | null;
  addAddon: (a: InstalledAddon) => void;
  removeAddon: (id: string) => void;
  enableAddon: (id: string) => void;
  disableAddon: (id: string) => void;
  setInstalling: (v: boolean) => void;
  setInstallError: (e: string | null) => void;
  getEnabledAddons: () => InstalledAddon[];
  /** Guarda (o borra, si no es https) la URL de la instancia del CNCVerse Bridge. */
  setCncVerseBridgeUrl: (url: string) => void;
}

const GLOBAL_ADDONS_STORAGE_KEY = "aetherio-addons";
const TORRENTIO_ADDON_ID = ["com.stre", "mio.torrentio.addon"].join("");
const HDHUB_ADDON_ID = "com.stremio.HdHub";
const PENGUPLAY_ADDON_ID = "com.penguplay";
const DEEPFLIX_ADDON_ID = "org.portal.free";
export { PENGUPLAY_MANIFEST_URL };
export const STREVERSE_MANIFEST_URL =
  "https://stremverse1.alwaysdata.net/1XY6xCsIwGIRfRW7O6NRNRRHERbtJKWn4SULTpOSPxSi-u7RVKG7H3cfdvZCeKLAvIcB9iIlR3HAIITXSOQjsolUtJQhsJbf0s7eS6StL8t4yBM4hhTiVjEB4WK8hcLnrJkNg01G0SvrVsjwrN1PHoFrKqASc9Ho6sT5B4NpLb9mMgZLzOU6RuoEiU-3sQDUN5NO4vwgi9U7mP9NYbZzVJjGq9wc/manifest.json";
export const STREVERSE_SPORTS = [
  "Football",
  "Cricket",
  "Basketball",
  "Baseball",
  "Tennis",
  "Motorsport",
  "Boxing",
  "Rugby",
  "American Football",
  "Cycling",
];
/**
 * CNCVerse Bridge: un add-on que expone ~70 extensiones CloudStream detras de
 * un endpoint. Se instala bundled pero APAGADO y sin URL hasta que el usuario
 * pega la de su instancia en Ajustes > Fuentes.
 *
 * Dos medidas para que no rompa el resto:
 *
 * - `streamTimeoutMs` sube el timeout de 6 s a 55 s y `streamAttempts` lo baja
 *   a 1. Su endpoint consulta ~70 extensiones en paralelo y tarda 28-49 s; con
 *   el default (6 s x 3) no devolveria nunca nada, y reintentar un request de
 *   45 s solo duplicaria la espera. Los demas add-ons tardan menos de 6 s y no
 *   se tocan.
 * - `streamRequestTypes: ["movie"]` hace una sola peticion por capitulo. El
 *   bridge resuelve por id IMDB ignorando el tipo, asi que movie/series/tv/
 *   anime devuelven exactamente lo mismo: pedirlos todos son cuatro esperas
 *   identicas en paralelo. El id sigue llevando `season:episode` para series.
 *
 * `catalogs: []` por lo mismo que el resto de bundled: sus catalogos son de
 * tipo `other` y no aportan filas a la Home. `meta` y `subtitles` no se
 * declaran porque el manifest los anuncia pero el endpoint responde 404 y
 * lista vacia respectivamente; los aporta Cinemeta.
 */
const CNCVERSE_BRIDGE_ADDON: InstalledAddon = {
  id: CNCVERSE_BRIDGE_ID,
  name: "CNCVerse Bridge",
  description: "Extensiones CloudStream de CNCVerse en una sola fuente.",
  logo: CNCVERSE_BRIDGE_LOGO,
  url: readCncVerseBridgeUrl(),
  manifest: {
    id: CNCVERSE_BRIDGE_ID,
    version: "1.0.0",
    name: "CNCVerse Bridge",
    description: "Cloudstream plugin bridge for Stremio",
    resources: ["catalog", "stream"],
    types: ["movie", "series", "anime", "other", "tv"],
    idPrefixes: ["tt", "kitsu", "cnc:"],
    catalogs: [],
    logo: CNCVERSE_BRIDGE_LOGO,
    behaviorHints: { configurable: true, configurationRequired: false },
  },
  enabled: true,
  installedAt: 0,
  version: "1.0.0",
  bundled: false,
  origin: "user",
  scope: "global",
  streamTimeoutMs: 55_000,
  streamAttempts: 1,
  streamRequestTypes: ["movie"],
  streamSourceFromPayload: true,
};

function withBundledCncVerse(globalAddons: InstalledAddon[]) {
  // Only a URL explicitly saved by the user can create this personal bridge.
  const url = readCncVerseBridgeUrl();
  if (!url) return globalAddons;
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  const existing = merged.get(CNCVERSE_BRIDGE_ADDON.id);
  // La URL vive en su propia clave, no en la lista persistida: asi borrarla
  // desde Ajustes desactiva el add-on aunque la lista fuera de fecha.
  merged.set(CNCVERSE_BRIDGE_ADDON.id, {
    ...existing,
    ...CNCVERSE_BRIDGE_ADDON,
    url,
    enabled: existing?.enabled ?? true,
  });
  return [...merged.values()];
}

/**
 * Add-ons integrados, en el orden en que deben aparecer sus chips en el panel
 * de seleccion de fuentes.
 *
 * La clave es que el chip casi nunca lleva el nombre del add-on: Torrentio se
 * desglosa en sus indexers (ThePiratebay, Yoru, Nyaa...), asi que un chip se
 * ordena por el add-on al que pertenece, no por como se llama. Los ids viven
 * aqui y no en las vistas para que esta lista no se desincronice.
 *
 * PenguPlay antes que DeepFlix: el orden lo fijo el usuario. Lo unico que queda
 * por encima de esta lista es AnimeAV1 (ver `chipTier` en sourceFilterOrder).
 */
const SOURCE_FILTER_ORDER: readonly string[] = [
  PENGUPLAY_ADDON_ID,
  DEEPFLIX_ADDON_ID,
  TORRENTIO_ADDON_ID,
  HDHUB_ADDON_ID,
];

/**
 * Posicion de un chip de fuente: menor goes antes.
 *
 * Lo que instalo el usuario va primero (cualquier add-on no integrado,
 * incluidos los scrapers), porque si eligio esa fuente manda sobre las que
 * trae la app. Luego los integrados en el orden de arriba, y el resto al
 * final para que el desempate por cantidad de streams los ordene entre si.
 */
export function sourceFilterPriority(addonId: string | undefined, bundled: boolean | undefined): number {
  // `undefined` es "no sabemos de donde viene" (streams de scraper, extensiones
  // de media, add-ons que ya no estan instalados). No es lo mismo que un
  // add-on no integrado: tratarlo como instalado por el usuario lo mandaba
  // delante de todo, y como lo ignoran los未知 lo que llega sin registro.
  if (bundled === false) return 0;
  const normalized = addonId === "torrentio" ? TORRENTIO_ADDON_ID : addonId;
  const index = normalized ? SOURCE_FILTER_ORDER.indexOf(normalized) : -1;
  return index === -1 ? SOURCE_FILTER_ORDER.length + 1 : index + 1;
}

function isInstalledAddon(value: unknown): value is InstalledAddon {
  if (!value || typeof value !== "object") return false;
  const addon = value as Partial<InstalledAddon>;
  return typeof addon.id === "string" && typeof addon.name === "string" && typeof addon.url === "string";
}

/**
 * Add-ons que la interfaz debe listar. Los marcados `hiddenInUi` se siguen
 * pidiendo en `stream` —para eso estan instalados— pero no aparecen en
 * Complementos ni en Fuentes. Todo lo demas (los contadores de "instalados",
 * los toggles globales y el log de la pagina) cuenta sobre esta lista.
 */
export function listableAddons(addons: InstalledAddon[]) {
  return addons.filter(addon => !addon.hiddenInUi && !isCncVerseTvAddon(addon));
}

function readPersistedAddons(key: string): InstalledAddon[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    const addons = parsed?.state?.addons ?? parsed?.addons;
    return Array.isArray(addons) ? addons.filter(isInstalledAddon) : [];
  } catch {
    return [];
  }
}

function writePersistedAddons(key: string, addons: InstalledAddon[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify({ state: { addons }, version: 0 }));
}

function activeProfileAddonsStorageKey() {
  const activeProfileId = typeof localStorage === "undefined" ? null : getActiveProfileId();
  return activeProfileId ? `aetherio-profile:${activeProfileId}:${GLOBAL_ADDONS_STORAGE_KEY}` : null;
}

function isPersonalElfHostedAddon(addon: Pick<InstalledAddon, "id" | "name">) {
  return addon.id === "aio-metadata"
    || addon.id.startsWith("com.aiostreams.viren070.")
    || /\bAIOMetadata\b/i.test(addon.name)
    || /\bAIOStreams\b/i.test(addon.name);
}

function withScope(addon: InstalledAddon): InstalledAddon {
  const scope: AddonScope = addon.bundled
    ? "global"
    : isPersonalElfHostedAddon(addon)
      ? "profile"
      : addon.scope ?? "global";
  return { ...addon, scope };
}

function mergeById(addons: InstalledAddon[]) {
  const merged = new Map<string, InstalledAddon>();
  for (const addon of addons) merged.set(addon.id, withScope(addon));
  return [...merged.values()];
}

export function manifestForHubAddon(
  entry: ProviderHubAddonEntry,
  remoteManifest?: Record<string, unknown>,
): Record<string, unknown> {
  const source = { ...entry.manifestFallback, ...(remoteManifest ?? {}) };
  const catalogs = entry.catalogPolicy === "empty"
    ? []
    : Array.isArray(source.catalogs)
      ? source.catalogs
      : [];
  const cncVerseTvOnly = entry.id === CNCVERSE_TV_ADDON_ID;
  return {
    ...source,
    id: entry.id,
    name: entry.name,
    description: entry.description || source.description,
    logo: entry.logo || source.logo,
    resources: cncVerseTvOnly ? [{ name: "stream", types: ["tv"] }] : source.resources,
    types: cncVerseTvOnly ? ["tv"] : source.types,
    catalogs: cncVerseTvOnly ? [] : catalogs,
  };
}

function installedHubAddon(
  entry: ProviderHubAddonEntry,
  existing?: InstalledAddon,
  remoteManifest?: Record<string, unknown>,
): InstalledAddon {
  const manifest = manifestForHubAddon(entry, remoteManifest);
  const canonicalUrl = resolveHubAddonManifestUrl(entry.manifestUrl);
  const existingSportsUrl = entry.id === SPORTS_STREAMS_ADDON_ID
    ? normalizeSportsStreamsManifestUrl(existing?.url)
    : null;
  const defaultSportsUrl = entry.id === SPORTS_STREAMS_ADDON_ID
    ? normalizeSportsStreamsManifestUrl(canonicalUrl)
    : null;
  const url = entry.id === SPORTS_STREAMS_ADDON_ID
    ? existingSportsUrl && existingSportsUrl !== defaultSportsUrl
      ? existingSportsUrl
      : configuredSportsStreamsManifestUrl()
    : canonicalUrl;
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    logo: entry.logo || (typeof manifest.logo === "string" ? manifest.logo : undefined),
    url,
    manifest,
    enabled: existing?.enabled ?? readHubAddonStates()[entry.id] ?? entry.enabledByDefault,
    installedAt: existing?.installedAt ?? 0,
    version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
    bundled: true,
    origin: "provider-hub",
    scope: "global",
    hiddenInUi: entry.hiddenInUi,
    streamTimeoutMs: entry.streamTimeoutMs,
    streamAttempts: entry.streamAttempts,
    upstreamAddonId: entry.upstreamAddonId,
    streamNameFilter: entry.streamNameFilter,
  };
}

/**
 * The Hub is the only automatic source. No legacy bundled fallback or local
 * seed may be reinstated when the Hub is empty/unreachable. Personal wins.
 */
function withBundledAddons(
  globalAddons: InstalledAddon[],
  directory: ProviderHubAddonDirectory | null = readCachedProviderHubAddonDirectory(),
) {
  const userInstalled = globalAddons.filter(addon => !addon.bundled);
  const hubBundled = directory
    ? directory.addons.map(entry => installedHubAddon(
      entry,
      globalAddons.find(addon => addon.id === entry.id),
    ))
    : [];
  return mergeById([...hubBundled, ...userInstalled]);
}

function loadAddonScopes(directory: ProviderHubAddonDirectory | null = readCachedProviderHubAddonDirectory()) {
  if (typeof localStorage === "undefined") {
    return withBundledAddons([], directory);
  }
  const profileKey = activeProfileAddonsStorageKey();
  migrateLocalAddonDefaults(profileKey ? [profileKey] : []);
  const storedGlobal = readPersistedAddons(GLOBAL_ADDONS_STORAGE_KEY).map(withScope);
  const globalAddons = withBundledAddons(
    storedGlobal.filter(addon => addon.scope === "global"),
    directory,
  );
  if (!profileKey) {
    writePersistedAddons(GLOBAL_ADDONS_STORAGE_KEY, globalAddons);
    return globalAddons;
  }

  const storedProfile = readPersistedAddons(profileKey)
    .filter(addon => !addon.bundled)
    .map(addon => ({ ...addon, scope: "profile" as const }));
  const incorrectlyGlobalPersonal = storedGlobal.filter(
    addon => addon.scope === "profile",
  );
  const profileAddons = mergeById([...incorrectlyGlobalPersonal, ...storedProfile]);

  // Migración de la versión que volvió globales todos los add-ons: los dos
  // add-ons personales vuelven al perfil activo y se eliminan del ámbito global.
  writePersistedAddons(GLOBAL_ADDONS_STORAGE_KEY, globalAddons);
  writePersistedAddons(profileKey, profileAddons);
  return mergeById([...globalAddons, ...profileAddons]);
}

function persistAddonScopes(addons: InstalledAddon[]) {
  const normalized = mergeById(addons);
  const globalAddons = withBundledAddons(normalized.filter(addon => addon.scope === "global"));
  writePersistedAddons(GLOBAL_ADDONS_STORAGE_KEY, globalAddons);
  const profileKey = activeProfileAddonsStorageKey();
  if (profileKey) {
    writePersistedAddons(profileKey, normalized.filter(addon => addon.scope === "profile"));
  }
  return mergeById([...globalAddons, ...normalized.filter(addon => addon.scope === "profile")]);
}

function updateAddonEnabled(addons: InstalledAddon[], id: string, enabled: boolean) {
  const addon = addons.find(candidate => candidate.id === id);
  if (addon?.origin === "provider-hub" && typeof localStorage !== "undefined") {
    localStorage.setItem(HUB_ADDON_STATES_KEY, JSON.stringify({ ...readHubAddonStates(), [id]: enabled }));
  }
  return addons.map(addon => addon.id === id ? { ...addon, enabled } : addon);
}

export const useAddonStore = create<AddonStore>((set, get) => ({
  addons: loadAddonScopes(),
  isInstalling: false,
  installError: null,
  addAddon: addon => set(state => ({
    addons: persistAddonScopes([...state.addons.filter(item => item.id !== addon.id), withScope({ ...addon, bundled: false, origin: "user" })]),
  })),
  removeAddon: id => set(state => ({
    addons: persistAddonScopes(state.addons.filter(addon => addon.id !== id || addon.bundled)),
  })),
  enableAddon: id => set(state => ({
    addons: persistAddonScopes(updateAddonEnabled(state.addons, id, true)),
  })),
  disableAddon: id => set(state => ({
    addons: persistAddonScopes(updateAddonEnabled(state.addons, id, false)),
  })),
  setInstalling: value => set({ isInstalling: value }),
  setInstallError: error => set({ installError: error }),
  getEnabledAddons: () => get().addons.filter(addon => addon.enabled),
  setCncVerseBridgeUrl: url => set(state => {
    const normalized = writeCncVerseBridgeUrl(url);
    // Se reconstruye el add-on con la URL nueva en vez de editarla en sitio:
    // `withBundledCncVerse` es la unica que sabe como se combina con lo que
    // hubiera persistido, y asi Ajustes y la pagina de episodio no pueden
    // discrepar sobre si el bridge esta configurado.
    const current = state.addons.filter(addon => addon.id !== CNCVERSE_BRIDGE_ID || Boolean(normalized));
    const addons = persistAddonScopes(withBundledCncVerse(current));
    return {
      addons,
      // Sin URL el add-on no se puede pedir, asi que quitar la URL lo apaga.
      ...(normalized ? {} : { addons: addons.map(addon => addon.id === CNCVERSE_BRIDGE_ID ? { ...addon, enabled: false } : addon) }),
    };
  }),
}));

let addonDirectoryRefresh: Promise<void> | null = null;

function publishAddonChanges(addons: InstalledAddon[]) {
  useAddonStore.setState({
    addons,
    // Hooks subscribe to this selector; changing its identity notifies them
    // when the remote directory or a fetched manifest hydrates the store.
    getEnabledAddons: () => useAddonStore.getState().addons.filter(addon => addon.enabled),
  });
}

export function refreshBundledAddonDirectory(): Promise<void> {
  if (addonDirectoryRefresh) return addonDirectoryRefresh;
  addonDirectoryRefresh = (async () => {
    let directory: ProviderHubAddonDirectory;
    try {
      directory = await fetchProviderHubAddonDirectory();
    } catch (error) {
      // Old installs can still use their locally persisted defaults offline.
      console.warn("[AETHERIO:ADDONS] No se pudo actualizar el directorio del Provider Hub", error);
      return;
    }

    publishAddonChanges(loadAddonScopes(directory));

    const pendingManifests = new Map<string, ReturnType<typeof fetchHubAddonManifest>>();
    const manifests = await Promise.all(directory.addons.map(async entry => {
      try {
        const url = resolveHubAddonManifestUrl(entry.manifestUrl);
        let pending = pendingManifests.get(url);
        if (!pending) {
          pending = fetchHubAddonManifest(entry);
          pendingManifests.set(url, pending);
        }
        return [entry.id, await pending] as const;
      } catch {
        return [entry.id, null] as const;
      }
    }));
    const manifestsById = new Map<string, Record<string, unknown>>();
    for (const [id, manifest] of manifests) {
      if (manifest) manifestsById.set(id, manifest);
    }
    if (!manifestsById.size) return;

    const current = useAddonStore.getState().addons;
    const updated = current.map(addon => {
      const entry = directory.addons.find(candidate => candidate.id === addon.id);
      const remoteManifest = manifestsById.get(addon.id);
      return entry && remoteManifest && addon.bundled && addon.origin === "provider-hub"
        ? installedHubAddon(entry, addon, remoteManifest)
        : addon;
    });
    publishAddonChanges(updated);
  })().finally(() => {
    addonDirectoryRefresh = null;
  });
  return addonDirectoryRefresh;
}

if (typeof window !== "undefined") {
  void refreshBundledAddonDirectory();
  window.addEventListener("focus", () => { void refreshBundledAddonDirectory(); });
}

export function reloadAddonsForActiveProfile() {
  const addons = loadAddonScopes();
  useAddonStore.setState({
    addons,
    isInstalling: false,
    installError: null,
  });
  return addons;
}
