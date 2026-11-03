import { DEFAULT_ADDONS, buildAddonDirectory, type ProviderHubAddon } from "./addons.ts";
import { AssetError, fetchPublicAsset, publicHttpsUrl } from "./remoteAssets.ts";
import type { Env } from "./types.ts";

const ADDONS_KEY = "addons:directory";
const ADDON_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_ADDONS = 100;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DIRECTORY_BYTES = 2 * 1024 * 1024;
const PENGUPLAY_PATH = "/api/penguplay/manifest.json";
const HIGHFLY_URL = "https://sports.highfly.to/manifest.json";
const ANIMEAV1_ALIAS_ID = "aetherio.alias.animeav1";
const GENERIC_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#18352f"/><text x="64" y="80" text-anchor="middle" fill="#8de0c3" font-family="sans-serif" font-size="42">AH</text></svg>';

export interface ManagedAddon extends ProviderHubAddon { updatedAt: number }

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isValidAddonId(value: string): boolean { return ADDON_ID.test(value); }

export async function loadAddons(env: Env): Promise<ManagedAddon[]> {
  const raw = await env.PROVIDERS.get(ADDONS_KEY);
  if (raw === null) return DEFAULT_ADDONS.map(addon => ({ ...addon, updatedAt: 0 }));
  const stored: unknown = JSON.parse(raw);
  // No resembrar ni sobrescribir un índice existente dañado o incompatible.
  if (!isObject(stored) || ![1, 2, 3].includes(Number(stored.version)) || !Array.isArray(stored.addons)) {
    throw new Error("Índice de add-ons inválido");
  }
  const addons = stored.addons as ManagedAddon[];
  // Correct only the synthetic split introduced in v1/v2. The independent
  // AnimeAV1 scraper is now a script provider; never recreate an AnimES alias.
  // Explicit removals, empty directories and independent custom sources survive.
  if (stored.version === 1 || stored.version === 2) {
    const exactFilter = (addon: ManagedAddon, mode: string) => addon.streamNameFilter?.mode === mode
      && addon.streamNameFilter.prefixes.length === 1 && addon.streamNameFilter.prefixes[0] === "AnimeAV1";
    return addons.filter(addon => !(addon.id === "aetherio.source.animeav1"
      && addon.upstreamAddonId === "com.animeflv.stremio.addon" && exactFilter(addon, "include")))
      .map(addon => {
        if (addon.id !== "com.animeflv.stremio.addon" || !exactFilter(addon, "exclude")) return addon;
        const { streamNameFilter: _obsolete, ...original } = addon;
        return original;
      });
  }
  return addons;
}

export function adminAddonDirectory(addons: ManagedAddon[], hubUrl: string) {
  const published = buildAddonDirectory(hubUrl, addons).addons;
  return addons.map((addon, index) => ({
    ...published[index], logoSource: addon.logo, updatedAt: addon.updatedAt,
  }));
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new AssetError(`${label} es obligatorio (máximo ${limit} caracteres).`);
  }
  return value.trim();
}

function manifestUrl(value: unknown, id: string): string {
  const url = requiredText(value, "Manifest URL", 2048);
  if (id === "com.penguplay") {
    if (url !== PENGUPLAY_PATH) throw new AssetError("PenguPlay debe conservar el proxy autenticado de Aetherio.");
    return url;
  }
  if (id === "community.sports.fly" && url !== HIGHFLY_URL) {
    throw new AssetError("Highfly usa su URL pública en el Hub. La URL personal se configura solo en Aetherio.");
  }
  const parsed = publicHttpsUrl(url);
  if (!parsed) throw new AssetError("El manifest debe usar HTTPS sin credenciales, IP literal ni host local.");
  return parsed.href;
}

function checkedManifest(value: unknown, expectedId?: string): Record<string, unknown> {
  if (!isObject(value)) throw new AssetError("El manifest de respaldo debe ser un objeto JSON.");
  const id = requiredText(value.id, "ID del manifest", 128);
  if (!isValidAddonId(id) || (expectedId && id !== expectedId)) throw new AssetError("El ID del manifest debe coincidir con el ID del add-on.");
  requiredText(value.name, "Nombre del manifest", 120);
  requiredText(value.version, "Versión del manifest", 64);
  if (!Array.isArray(value.types) || !value.types.length || value.types.some(type => typeof type !== "string" || type.length > 80)) {
    throw new AssetError("El manifest debe declarar al menos un tipo de contenido.");
  }
  if (!Array.isArray(value.resources) || !value.resources.length || !Array.isArray(value.catalogs)) {
    throw new AssetError("El manifest debe declarar resources y catalogs.");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_MANIFEST_BYTES) {
    throw new AssetError("El manifest supera 256 KB.", 413);
  }
  return value;
}

function boundedNumber(value: unknown, fallback: number | undefined, min: number, max: number, label: string): number | undefined {
  if (value === null) return undefined;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new AssetError(`${label} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

async function persistAddons(env: Env, addons: ManagedAddon[]) {
  const serialized = JSON.stringify({ version: 3, addons });
  if (new TextEncoder().encode(serialized).byteLength > MAX_DIRECTORY_BYTES) {
    throw new AssetError("El directorio de add-ons supera 2 MB.", 413);
  }
  await env.PROVIDERS.put(ADDONS_KEY, serialized);
}

export async function upsertAddon(env: Env, id: string, body: Record<string, unknown>): Promise<ManagedAddon> {
  if (id === ANIMEAV1_ALIAS_ID) throw new AssetError("ID obsoleto. AnimeAV1 es un scraper independiente en Scripts.");
  if (!isValidAddonId(id)) throw new AssetError("ID de add-on inválido: letras, números, puntos, guiones o guiones bajos (1–128).");
  const addons = await loadAddons(env);
  const index = addons.findIndex(addon => addon.id === id);
  const existing = addons[index];
  if (!existing && addons.length >= MAX_ADDONS) throw new AssetError("Máximo 100 add-ons.");
  const name = requiredText(body.name ?? existing?.name, "Nombre", 120);
  const description = body.description ?? existing?.description ?? "";
  if (typeof description !== "string" || description.length > 300) throw new AssetError("Descripción inválida (máximo 300 caracteres).");
  const url = manifestUrl(body.manifestUrl ?? existing?.manifestUrl, id);
  const logo = body.logoSource ?? existing?.logo ?? "";
  if (typeof logo !== "string" || (logo && !publicHttpsUrl(logo) && !DEFAULT_ADDONS.some(addon => addon.logo === logo))) {
    throw new AssetError("El logo debe usar HTTPS o un recurso de logos integrado del Hub.");
  }
  const catalogPolicy = body.catalogPolicy ?? existing?.catalogPolicy ?? "empty";
  if (catalogPolicy !== "keep" && catalogPolicy !== "empty") throw new AssetError("catalogPolicy debe ser keep o empty.");
  for (const key of ["enabledByDefault", "hiddenInUi"]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") throw new AssetError(`${key} debe ser booleano.`);
  }
  const fallback = checkedManifest(body.manifestFallback ?? existing?.manifestFallback, id);
  const upstreamAddonId = body.upstreamAddonId ?? existing?.upstreamAddonId;
  if (upstreamAddonId !== undefined && (typeof upstreamAddonId !== "string" || !isValidAddonId(upstreamAddonId))) {
    throw new AssetError("ID del add-on upstream inválido.");
  }
  const streamNameFilter = body.streamNameFilter ?? existing?.streamNameFilter;
  if (streamNameFilter !== undefined && (!isObject(streamNameFilter)
    || (streamNameFilter.mode !== "include" && streamNameFilter.mode !== "exclude")
    || !Array.isArray(streamNameFilter.prefixes) || !streamNameFilter.prefixes.length || streamNameFilter.prefixes.length > 20
    || streamNameFilter.prefixes.some(prefix => typeof prefix !== "string" || !prefix.trim() || prefix.length > 80))) {
    throw new AssetError("Filtro de streams inválido: usa include/exclude y de 1 a 20 prefijos de nombre.");
  }
  const addon: ManagedAddon = {
    id, name, description, manifestUrl: url, logo, catalogPolicy,
    enabledByDefault: (body.enabledByDefault ?? existing?.enabledByDefault ?? true) as boolean,
    hiddenInUi: (body.hiddenInUi ?? existing?.hiddenInUi ?? false) as boolean,
    streamTimeoutMs: boundedNumber(body.streamTimeoutMs, existing?.streamTimeoutMs, 1000, 120_000, "Timeout"),
    streamAttempts: boundedNumber(body.streamAttempts, existing?.streamAttempts, 1, 3, "Intentos"),
    upstreamAddonId: upstreamAddonId as string | undefined,
    streamNameFilter: streamNameFilter as ProviderHubAddon["streamNameFilter"],
    manifestFallback: { ...fallback, id, name, description },
    updatedAt: Date.now(),
  };
  if (existing) addons[index] = addon;
  else addons.push(addon);
  await persistAddons(env, addons);
  return addon;
}

export async function deleteAddon(env: Env, id: string): Promise<boolean> {
  if (id === ANIMEAV1_ALIAS_ID) throw new AssetError("ID obsoleto. AnimeAV1 se administra en Scripts.");
  if (!isValidAddonId(id)) throw new AssetError("ID de add-on inválido.");
  const addons = await loadAddons(env);
  const remaining = addons.filter(addon => addon.id !== id);
  if (remaining.length === addons.length) return false;
  await persistAddons(env, remaining);
  return true;
}

export async function validateAddonManifest(value: unknown) {
  const input = requiredText(value, "Manifest URL", 2048);
  // La única ruta relativa admitida es el proxy público existente; nunca una URL personal.
  const url = input === PENGUPLAY_PATH ? `https://trkll.aetherio.workers.dev${PENGUPLAY_PATH}` : input;
  const response = await fetchPublicAsset(url, MAX_MANIFEST_BYTES);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(response.bytes)); }
  catch { throw new AssetError("La URL no devolvió un manifest JSON válido.", 422); }
  return checkedManifest(parsed);
}

export async function customAddonLogoResponse(env: Env, pathname: string): Promise<Response | null> {
  const match = pathname.match(/^\/addons\/logos\/custom\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/);
  if (!match) return null;
  const addon = (await loadAddons(env)).find(entry => entry.id === match[1]);
  if (!addon) return null;
  const headers = {
    "cache-control": "public, max-age=300", "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  };
  if (!addon.logo) return new Response(GENERIC_LOGO, { headers: { ...headers, "content-type": "image/svg+xml" } });
  const response = await fetchPublicAsset(addon.logo, 512 * 1024);
  const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"];
  if (!allowed.includes(response.contentType)) throw new AssetError("La URL del logo no devolvió una imagen permitida.", 422);
  return new Response(response.bytes, { headers: { ...headers, "content-type": response.contentType } });
}
