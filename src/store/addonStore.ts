import { create } from "zustand";
import { getActiveProfileId } from "../utils/localProfiles.ts";
import { ANIMES_MANIFEST } from "./animesManifest.ts";

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
}

const GLOBAL_ADDONS_STORAGE_KEY = "aetherio-addons";
const TORRENTIO_ADDON_ID = ["com.stre", "mio.torrentio.addon"].join("");
export const TORRENTIO_LATINO_MANIFEST_URL = "https://torrentio.strem.fun/language=latino/manifest.json";

const CINEMETA_ADDON_ID = "com.linvo.cinemeta";
const ANIMES_ADDON_ID = "com.animeflv.stremio.addon";
const ANIMES_MANIFEST_URL =
  "https://pigamer37.alwaysdata.net/onAirCatalogs=animeflv%2Canimeav1%2Chenaojara%2Ctioanime%2Canimejara%2Cjkanime/manifest.json";const CINEMETA_MANIFEST_URL = "https://v3-cinemeta.strem.io/manifest.json";
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
    catalogs: [],
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
  manifest: ANIMES_MANIFEST,
  enabled: true,
  installedAt: 0,
  version: "1.4.2",
  bundled: true,
  scope: "global",
};

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

function loadAddonScopes() {
  if (typeof localStorage === "undefined") return [TORRENTIO_LATINO_ADDON, CINEMETA_ADDON, ANIMES_ADDON];
  const storedGlobal = readPersistedAddons(GLOBAL_ADDONS_STORAGE_KEY).map(withScope);
  const globalAddons = withBundledCinemeta(
    withBundledTorrentio(withBundledAnimes(storedGlobal.filter(addon => addon.scope === "global"))),
  );
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
  const globalAddons = withBundledCinemeta(
    withBundledTorrentio(withBundledAnimes(normalized.filter(addon => addon.scope === "global"))),
  );
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
