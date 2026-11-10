import { getScopedStorageKey } from "../utils/localProfiles.ts";
import { publicIptvUrl } from "./iptvSportsHttp.ts";

export const IPTV_SPORTS_CHANGED_EVENT = "aetherio-sports-iptv-changed";
export const IPTV_SPORTS_STORAGE_KEY = "aetherio-sports-iptv";
const IPTV_SPORTS_CONFIG_VERSION = 3;
export const DEFAULT_IPTV_SPORTS_URL = "https://iptv-org.github.io/iptv/categories/sports.m3u";
export const DEFAULT_SPORTS_EPG_URL = "https://www.tdtchannels.com/epg/TV.xml";
export const DEFAULT_IPTV_ALL_URL = "https://iptv-org.github.io/iptv/index.m3u";
export const DEFAULT_IPTV_ALL_EPG_URL = "https://epg.pw/xmltv/epg.xml";
export const MAX_IMPORTED_M3U = 2 * 1024 * 1024;

export interface SportsIptvList {
  id: string;
  name: string;
  enabled: boolean;
  url?: string;
  content?: string;
  epgUrls: string[];
}

export function defaultSportsIptvLists(): SportsIptvList[] {
  return [
    { id: "iptv-org-sports", name: "iptv-org · Deportes", url: DEFAULT_IPTV_SPORTS_URL, enabled: true, epgUrls: [DEFAULT_SPORTS_EPG_URL] },
    { id: "iptv-org-all", name: "IPTV-org · Lista completa", url: DEFAULT_IPTV_ALL_URL, enabled: true, epgUrls: [DEFAULT_IPTV_ALL_EPG_URL] },
    { id: "iptv-free-sports", name: "IPTV Free · Deportes", url: "https://live.iptv-free.com/iptv/categories/sports.m3u", enabled: true, epgUrls: [] },
    { id: "hacks-tools-sports", name: "Hacks.Tools · Deportes", url: "https://live.hacks.tools/iptv/categories/sports.m3u", enabled: true, epgUrls: [] },
    { id: "u-din-sports", name: "u-din IPTV · Deportes", url: "https://raw.githubusercontent.com/u-din/IPTV/refs/heads/main/sport.m3u", enabled: true, epgUrls: [] },
  ];
}

export function normalizeSportsIptvLists(value: unknown): SportsIptvList[] {
  if (!Array.isArray(value)) return [];
  const result: SportsIptvList[] = [];
  for (const entry of value.slice(0, 10)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<SportsIptvList>;
    if (typeof candidate.id !== "string" || !/^[\w-]{1,100}$/.test(candidate.id) || result.some(list => list.id === candidate.id)) continue;
    const url = publicIptvUrl(candidate.url)?.href;
    const content = typeof candidate.content === "string" && candidate.content.length <= MAX_IMPORTED_M3U && candidate.content.trimStart().replace(/^\uFEFF/, "").startsWith("#EXTM3U") ? candidate.content : undefined;
    if (!url && !content) continue;
    result.push({ id: candidate.id, name: typeof candidate.name === "string" ? candidate.name.trim().slice(0, 100) || "Lista IPTV" : "Lista IPTV", enabled: candidate.enabled !== false,
      ...(url ? { url } : { content }), epgUrls: Array.isArray(candidate.epgUrls) ? [...new Set(candidate.epgUrls.map(value => publicIptvUrl(value)?.href).filter((url): url is string => Boolean(url)))].slice(0, 4) : [] });
  }
  return result;
}

export function getSportsIptvLists(): SportsIptvList[] {
  try {
    const key = getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY);
    const raw = localStorage.getItem(key);
    if (!raw) return defaultSportsIptvLists();
    const stored = JSON.parse(raw) as { version?: unknown; lists?: unknown } | null;
    const lists = normalizeSportsIptvLists(stored?.lists);
    if (stored?.version === 1 || stored?.version === 2) {
      // Add new public defaults once, without overriding user choices or
      // reviving a deliberately empty configuration.
      const migrated = [...lists];
      if (migrated.length > 0) for (const defaultList of defaultSportsIptvLists()) {
        if (migrated.length >= 10) break;
        if (!migrated.some(list => list.id === defaultList.id)) migrated.push(defaultList);
      }
      try {
        localStorage.setItem(key, JSON.stringify({ version: IPTV_SPORTS_CONFIG_VERSION, lists: migrated }));
      } catch {
        // Keep the saved configuration usable even if migration cannot persist.
        return lists;
      }
      return migrated;
    }
    return lists;
  } catch { return defaultSportsIptvLists(); }
}

export function saveSportsIptvLists(lists: SportsIptvList[]): SportsIptvList[] {
  const normalized = normalizeSportsIptvLists(lists);
  if (normalized.length !== lists.length) throw new Error("Revisa las listas: admite hasta 10 listas con URLs públicas o contenido M3U válido.");
  try { localStorage.setItem(getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY), JSON.stringify({ version: IPTV_SPORTS_CONFIG_VERSION, lists: normalized })); }
  catch { throw new Error("No se pudieron guardar las listas. Prueba a importar por URL para ocupar menos espacio."); }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(IPTV_SPORTS_CHANGED_EVENT));
  return normalized;
}
