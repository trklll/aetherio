import { create } from "zustand";
import { getActiveProfileId } from "../utils/localProfiles.ts";
import { ANIMES_MANIFEST } from "./animesManifest.ts";
import {
  CNCVERSE_BRIDGE_ID,
  CNCVERSE_BRIDGE_LOGO,
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
export const TORRENTIO_LATINO_MANIFEST_URL = "https://torrentio.strem.fun/language=latino/manifest.json";

const CINEMETA_ADDON_ID = "com.linvo.cinemeta";
const ANIMES_ADDON_ID = "com.animeflv.stremio.addon";
const ANIMES_MANIFEST_URL =
  "https://pigamer37.alwaysdata.net/onAirCatalogs=animeflv%2Canimeav1%2Chenaojara%2Ctioanime%2Canimejara%2Cjkanime/manifest.json";const CINEMETA_MANIFEST_URL = "https://v3-cinemeta.strem.io/manifest.json";
const HDHUB_ADDON_ID = "com.stremio.HdHub";
export const HDHUB_MANIFEST_URL = "https://hdhub.thevolecitor.qzz.io/eyJ0b3Jib3giOiJ1bnNldCIsInF1YWxpdGllcyI6IjIxNjBwLDEwODBwLDcyMHAiLCJzb3J0IjoiZGVzYyIsImNvbnRlbnQiOiJsYXRpbiIsImNhdGFsb2dzIjoiIn0/manifest.json";
const STREVERSE_ADDON_ID = "com.stremverse.org";
export const STREVERSE_MANIFEST_URL =
  "https://stremverse1.alwaysdata.net/1XY6xCsIwGIRfRW7O6NRNRRHERbtJKWn4SULTpOSPxSi-u7RVKG7H3cfdvZCeKLAvIcB9iIlR3HAIITXSOQjsolUtJQhsJbf0s7eS6StL8t4yBM4hhTiVjEB4WK8hcLnrJkNg01G0SvrVsjwrN1PHoFrKqASc9Ho6sT5B4NpLb9mMgZLzOU6RuoEiU-3sQDUN5NO4vwgi9U7mP9NYbZzVJjGq9wc/manifest.json";
const STREVERSE_LOGO =
  "https://storage.ko-fi.com/cdn/useruploads/8be649b0-3d7f-42fc-a516-e092fdc9ca65_8bb57f59-c58d-4129-8b99-0a5ae03c0b06.png";
/** Deportes del addon, en el orden en que el los declara (Football primero). */
const STREVERSE_GENRES = [
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
const CINEMETA_YEAR_OPTIONS = Array.from(
  { length: 100 },
  (_, index) => String(new Date().getUTCFullYear() - index),
);

const TORRENTIO_LATINO_ADDON: InstalledAddon = {
  id: TORRENTIO_ADDON_ID,
  name: "Torrentio",
  description: "Torrentio configurado para priorizar resultados en español latino.",
  logo: "https://torrentio.strem.fun/images/logo_v1.png",
  url: TORRENTIO_LATINO_MANIFEST_URL,
  manifest: {
    id: TORRENTIO_ADDON_ID,
    version: "0.0.15",
    name: "Torrentio",
    description: "Provides torrent streams from scraped torrent providers.",
    catalogs: [], // Los add-ons bundled (excepto Cinemeta) no deben aportar catálogos.
    resources: [{
      name: "stream",
      types: ["movie", "series", "anime"],
      idPrefixes: ["tt", "kitsu"],
    }],
    types: ["movie", "series", "anime", "other"],
    background: "https://torrentio.strem.fun/images/background_v1.jpg",
    logo: "https://torrentio.strem.fun/images/logo_v1.png",
    behaviorHints: { configurable: true, configurationRequired: false },
  },
  enabled: true,
  installedAt: 0,
  version: "0.0.15",
  bundled: true,
  scope: "global",
};

const CINEMETA_ADDON: InstalledAddon = {
  id: CINEMETA_ADDON_ID,
  name: "Cinemeta",
  description: "Catálogos oficiales de películas y series.",
  url: CINEMETA_MANIFEST_URL,
  manifest: {
    id: CINEMETA_ADDON_ID,
    version: "3.0.14",
    name: "Cinemeta",
    description: "The official addon for movie and series catalogs",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
      { type: "movie", id: "top", name: "Popular" },
      { type: "series", id: "top", name: "Popular" },
      {
        type: "movie",
        id: "year",
        name: "New",
        extra: [{ name: "genre", options: CINEMETA_YEAR_OPTIONS, isRequired: true }],
        extraRequired: ["genre"],
      },
      {
        type: "series",
        id: "year",
        name: "New",
        extra: [{ name: "genre", options: CINEMETA_YEAR_OPTIONS, isRequired: true }],
        extraRequired: ["genre"],
      },
      { type: "movie", id: "imdbRating", name: "Featured" },
      { type: "series", id: "imdbRating", name: "Featured" },
    ],
  },
  enabled: true,
  installedAt: 0,
  version: "3.0.14",
  bundled: true,
  scope: "global",
};

const ANIMES_ADDON: InstalledAddon = {
  id: ANIMES_ADDON_ID,
  name: "AnimES",
  description: "Catálogos y streams de AnimeFLV, AnimeAV1, Henaojara, TioAnime, AnimeJara y JKAnime.",
  logo: "https://raw.githubusercontent.com/Pigamer37/animeflv-stremio-addon/refs/heads/main/views/AnimES.png",
  url: ANIMES_MANIFEST_URL,
  manifest: {
    ...ANIMES_MANIFEST,
    catalogs: [], // Los add-ons bundled (excepto Cinemeta) no deben aportar catálogos.
  },
  enabled: true,
  installedAt: 0,
  version: "1.4.2",
  bundled: true,
  scope: "global",
};

const HDHUB_ADDON: InstalledAddon = {
  id: HDHUB_ADDON_ID,
  name: "HdHub",
  description: "Watch movies and series from HdHub.",
  logo: "http://hdhub.thevolecitor.qzz.io/logo.png",
  url: HDHUB_MANIFEST_URL,
  manifest: {
    id: HDHUB_ADDON_ID,
    version: "1.0.7",
    name: "HdHub",
    description: "Watch movies and series from HdHub.",
    resources: ["stream", "catalog"],
    types: ["movie", "series", "HdHub"],
    idPrefixes: ["tt", "tmdb:", "kitsu:"],
    catalogs: [], // Los add-ons bundled (excepto Cinemeta) no deben aportar catálogos.
    logo: "http://hdhub.thevolecitor.qzz.io/logo.png",
    background: "http://hdhub.thevolecitor.qzz.io/logo.png",
    behaviorHints: { configurable: true },
  },
  enabled: true,
  installedAt: 0,
  version: "1.0.7",
  bundled: true,
  scope: "global",
};

/**
 * StremVerse: eventos en directo, repeticiones y highlights de deportes.
 *
 * Se instala como bundled para tener resolucion de `stream` de tipo `tv` (sus
 * idsown son `stremevent_*`, `replay_*`, `highlight_*` y `ttv:direct_*`, ninguno
 * con prefijo IMDB/TMDB), pero sin catalogos: sus tipos son `tv`, y las filas del
 * Home se filtran por `contentOrientation` (movie/series/anime), asi que no
 * aparecerian ahi ni contributing nada. El consumo real ocurre desde la pagina de
 * Deportes, via el provider de live (ver stremioSportsProviders.ts).
 */
const STREVERSE_ADDON: InstalledAddon = {
  id: STREVERSE_ADDON_ID,
  name: "StremVerse",
  description: "Deportes en directo, repeticiones y highlights.",
  logo: STREVERSE_LOGO,
  url: STREVERSE_MANIFEST_URL,
  manifest: {
    id: STREVERSE_ADDON_ID,
    version: "3.0.0",
    name: "StremVerse",
    description: "Live Events, Replays and Highlights from StremVerse.",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    idPrefixes: [
      "stremevent_",
      "stremevent_sktech_",
      "stremevent_playfy_",
      "stremevent_playztv_",
      "stremevent_merged_",
      "replay_",
      "highlight_",
      "stremevent_xtra2_",
      "ttv:direct_",
    ],
    catalogs: [], // Los add-ons bundled (excepto Cinemeta) no deben aportar catálogos.
    logo: STREVERSE_LOGO,
    behaviorHints: { configurable: true, configurationRequired: false },
  },
  enabled: true,
  installedAt: 0,
  version: "3.0.0",
  bundled: true,
  scope: "global",
};

/** Deportes que declara el addon, para el filtro de la pagina de Deportes. */
export const STREVERSE_SPORTS = STREVERSE_GENRES;

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
  bundled: true,
  scope: "global",
  streamTimeoutMs: 55_000,
  streamAttempts: 1,
  streamRequestTypes: ["movie"],
  streamSourceFromPayload: true,
};

function withBundledCncVerse(globalAddons: InstalledAddon[]) {
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  const existing = merged.get(CNCVERSE_BRIDGE_ADDON.id);
  // La URL vive en su propia clave, no en la lista persistida: asi borrarla
  // desde Ajustes desactiva el add-on aunque la lista fuera de fecha.
  merged.set(CNCVERSE_BRIDGE_ADDON.id, {
    ...existing,
    ...CNCVERSE_BRIDGE_ADDON,
    url: readCncVerseBridgeUrl(),
    enabled: existing?.enabled ?? true,
  });
  return [...merged.values()];
}

function isInstalledAddon(value: unknown): value is InstalledAddon {
  if (!value || typeof value !== "object") return false;
  const addon = value as Partial<InstalledAddon>;
  return typeof addon.id === "string" && typeof addon.name === "string" && typeof addon.url === "string";
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

function withBundledTorrentio(globalAddons: InstalledAddon[]) {
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  const existing = merged.get(TORRENTIO_LATINO_ADDON.id);
  merged.set(TORRENTIO_LATINO_ADDON.id, {
    ...existing,
    ...TORRENTIO_LATINO_ADDON,
    enabled: existing?.enabled ?? true,
  });
  return [...merged.values()];
}

function withBundledAnimes(globalAddons: InstalledAddon[]) {
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  const existing = merged.get(ANIMES_ADDON.id);
  merged.set(ANIMES_ADDON.id, {
    ...existing,
    ...ANIMES_ADDON,
    enabled: existing?.enabled ?? true,
  });
  return [...merged.values()];
}

function withBundledCinemeta(globalAddons: InstalledAddon[]) {
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  if (!merged.has(CINEMETA_ADDON_ID)) merged.set(CINEMETA_ADDON_ID, CINEMETA_ADDON);
  return [...merged.values()];
}

function withBundledHdhub(globalAddons: InstalledAddon[]) {
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  const existing = merged.get(HDHUB_ADDON.id);
  merged.set(HDHUB_ADDON.id, {
    ...existing,
    ...HDHUB_ADDON,
    enabled: existing?.enabled ?? true,
  });
  return [...merged.values()];
}

function withBundledStremVerse(globalAddons: InstalledAddon[]) {
  const merged = new Map(globalAddons.map(addon => [addon.id, withScope(addon)]));
  const existing = merged.get(STREVERSE_ADDON.id);
  merged.set(STREVERSE_ADDON.id, {
    ...existing,
    ...STREVERSE_ADDON,
    enabled: existing?.enabled ?? true,
  });
  return [...merged.values()];
}

/**
 * Aplica, en orden, los add-ons que Aetherio trae de serie. La URL del
 * CNCVerse Bridge se relee aqui en cada pasada para que quitarla en Ajustes
 * surta efecto aunque la lista persistida fuera de fecha.
 */
function withBundledAddons(globalAddons: InstalledAddon[]) {
  return withBundledCncVerse(withBundledStremVerse(withBundledHdhub(withBundledCinemeta(
    withBundledTorrentio(withBundledAnimes(globalAddons)),
  ))));
}

function loadAddonScopes() {
  if (typeof localStorage === "undefined") {
    return [TORRENTIO_LATINO_ADDON, CINEMETA_ADDON, ANIMES_ADDON, HDHUB_ADDON, STREVERSE_ADDON, CNCVERSE_BRIDGE_ADDON];
  }
  const storedGlobal = readPersistedAddons(GLOBAL_ADDONS_STORAGE_KEY).map(withScope);
  const globalAddons = withBundledAddons(storedGlobal.filter(addon => addon.scope === "global"));
  const profileKey = activeProfileAddonsStorageKey();
  if (!profileKey) return globalAddons;

  const storedProfile = readPersistedAddons(profileKey)
    .map(withScope)
    .filter(addon => addon.scope === "profile");
  const incorrectlyGlobalPersonal = storedGlobal.filter(addon => addon.scope === "profile");
  const profileAddons = mergeById([...incorrectlyGlobalPersonal, ...storedProfile]);

  // Migración de la versión que volvió globales todos los add-ons: los dos
  // add-ons personales vuelven al perfil activo y se eliminan del ámbito global.
  writePersistedAddons(GLOBAL_ADDONS_STORAGE_KEY, globalAddons);
  writePersistedAddons(profileKey, profileAddons);
  return [...globalAddons, ...profileAddons];
}

function persistAddonScopes(addons: InstalledAddon[]) {
  const normalized = mergeById(addons);
  const globalAddons = withBundledAddons(normalized.filter(addon => addon.scope === "global"));
  writePersistedAddons(GLOBAL_ADDONS_STORAGE_KEY, globalAddons);
  const profileKey = activeProfileAddonsStorageKey();
  if (profileKey) {
    writePersistedAddons(profileKey, normalized.filter(addon => addon.scope === "profile"));
  }
  return [...globalAddons, ...normalized.filter(addon => addon.scope === "profile")];
}

export const useAddonStore = create<AddonStore>((set, get) => ({
  addons: loadAddonScopes(),
  isInstalling: false,
  installError: null,
  addAddon: addon => set(state => ({
    addons: persistAddonScopes([...state.addons.filter(item => item.id !== addon.id), withScope(addon)]),
  })),
  removeAddon: id => set(state => ({
    addons: persistAddonScopes(state.addons.filter(addon => addon.id !== id || addon.bundled)),
  })),
  enableAddon: id => set(state => ({
    addons: persistAddonScopes(state.addons.map(addon => addon.id === id ? { ...addon, enabled: true } : addon)),
  })),
  disableAddon: id => set(state => ({
    addons: persistAddonScopes(state.addons.map(addon => addon.id === id ? { ...addon, enabled: false } : addon)),
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
    const addons = persistAddonScopes(state.addons);
    return {
      addons,
      // Sin URL el add-on no se puede pedir, asi que quitar la URL lo apaga.
      ...(normalized ? {} : { addons: addons.map(addon => addon.id === CNCVERSE_BRIDGE_ID ? { ...addon, enabled: false } : addon) }),
    };
  }),
}));

export function reloadAddonsForActiveProfile() {
  const addons = loadAddonScopes();
  useAddonStore.setState({
    addons,
    isInstalling: false,
    installError: null,
  });
  return addons;
}
