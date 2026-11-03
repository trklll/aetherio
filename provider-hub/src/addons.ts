import { SEANIME_LOGOS } from "./seanime/catalogLogos.ts";
import { fetchPublicAsset } from "./remoteAssets.ts";

export type AddonCatalogPolicy = "keep" | "empty";

export interface ProviderHubAddon {
  id: string;
  name: string;
  description: string;
  logo: string;
  manifestUrl: string;
  enabledByDefault: boolean;
  catalogPolicy: AddonCatalogPolicy;
  hiddenInUi?: boolean;
  streamTimeoutMs?: number;
  streamAttempts?: number;
  upstreamAddonId?: string;
  streamNameFilter?: { mode: "include" | "exclude"; prefixes: string[] };
  manifestFallback: Record<string, unknown>;
}

const cinemetaYears = () => Array.from(
  { length: 100 },
  (_, index) => String(new Date().getUTCFullYear() - index),
);

function cinemetaManifestFallback() {
  const years = cinemetaYears();
  const yearCatalog = (type: "movie" | "series") => ({
    type,
    id: "year",
    name: "New",
    extra: [{ name: "genre", options: years, isRequired: true }],
    extraRequired: ["genre"],
  });

  return {
    id: "com.linvo.cinemeta",
    version: "3.0.14",
    name: "Cinemeta",
    description: "The official addon for movie and series catalogs",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
      { type: "movie", id: "top", name: "Popular" },
      { type: "series", id: "top", name: "Popular" },
      yearCatalog("movie"),
      yearCatalog("series"),
      { type: "movie", id: "imdbRating", name: "Featured" },
      { type: "series", id: "imdbRating", name: "Featured" },
    ],
  };
}

/**
 * Directorio de complementos Stremio que Aetherio integra de serie. Sus
 * manifests y streams se consultan desde el cliente; este directorio solo
 * centraliza metadatos, logos, URLs y comportamiento de integración.
 */
const ANIMES_ADDON: ProviderHubAddon = {
    id: "com.animeflv.stremio.addon",
    name: "AnimES",
    description: "Catálogos y streams de Henaojara, TioAnime y Latanime.",
    logo: "/addons/logos/animes.png",
    manifestUrl: "https://pigamer37.alwaysdata.net/onAirCatalogs=animeav1%2Chenaojara%2Ctioanime%2Clatanime/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "empty",
    manifestFallback: {
      id: "com.animeflv.stremio.addon",
      version: "1.5.1",
      name: "AnimES",
      description: "Add Henaojara, TioAnime & Latanime functionality to Stremio.",
      logo: "/addons/logos/animes.png",
      resources: [
        "stream",
        { name: "meta", types: ["movie", "series", "anime", "other"], idPrefixes: ["animeav1:", "henaojara:", "tioanime:", "latanime:", "anilist:", "mal:", "anidb:"] },
        "catalog",
      ],
      types: ["movie", "series", "anime", "other"],
      idPrefixes: ["tt", "animeav1:", "henaojara:", "tioanime:", "latanime:", "tmdb:", "anilist:", "kitsu:", "mal:", "anidb:"],
      catalogs: [],
    },
};

export const DEFAULT_ADDONS: readonly ProviderHubAddon[] = [
  ANIMES_ADDON,
  {
    id: "com.stremio.torrentio.addon",
    name: "Torrentio",
    description: "Torrentio configurado para priorizar resultados en español latino. Incluye NyaaSi entre sus indexers de anime.",
    logo: "/addons/logos/torrentio.png",
    manifestUrl: "https://torrentio.strem.fun/language=latino/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "empty",
    manifestFallback: {
      id: "com.stremio.torrentio.addon",
      version: "0.0.15",
      name: "Torrentio",
      description: "Provides torrent streams from scraped torrent providers.",
      resources: [{ name: "stream", types: ["movie", "series", "anime"], idPrefixes: ["tt", "kitsu"] }],
      types: ["movie", "series", "anime", "other"],
      idPrefixes: ["tt", "kitsu"],
      catalogs: [],
      logo: "/addons/logos/torrentio.png",
    },
  },
  {
    id: "com.linvo.cinemeta",
    name: "Cinemeta",
    description: "Catálogos oficiales de películas y series.",
    logo: "/addons/logos/cinemeta.svg",
    manifestUrl: "https://v3-cinemeta.strem.io/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "keep",
    manifestFallback: cinemetaManifestFallback(),
  },
  {
    id: "com.stremio.HdHub",
    name: "HdHub",
    description: "Watch movies and series from HdHub.",
    logo: "/addons/logos/hdhub.png",
    manifestUrl: "https://hdhub.thevolecitor.qzz.io/eyJ0b3Jib3giOiJ1bnNldCIsInF1YWxpdGllcyI6IjIxNjBwLDEwODBwLDcyMHAiLCJzb3J0IjoiZGVzYyIsImNvbnRlbnQiOiJsYXRpbiIsImNhdGFsb2dzIjoiIn0/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "empty",
    manifestFallback: {
      id: "com.stremio.HdHub",
      version: "1.0.7",
      name: "HdHub",
      description: "Watch movies and series from HdHub.",
      resources: ["stream", "catalog"],
      types: ["movie", "series", "HdHub"],
      idPrefixes: ["tt", "tmdb:", "kitsu:"],
      catalogs: [],
      logo: "/addons/logos/hdhub.png",
    },
  },
  {
    id: "org.portal.free",
    name: "DeepFlix",
    description: "Portal de películas y series en idioma latino.",
    logo: "/addons/logos/deepflix.png",
    manifestUrl: "https://mg.homelabx.qzz.io/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "empty",
    manifestFallback: {
      id: "org.portal.free",
      version: "1.0.0",
      name: "DeepFlix",
      description: "Portal de películas y series en idioma latino.",
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
      types: ["movie", "series"],
      idPrefixes: ["tt"],
      catalogs: [],
    },
  },
  {
    id: "com.penguplay",
    name: "PenguPlay",
    description: "Agregador de proveedores con filtros de calidad, audio y tamaño.",
    logo: "/addons/logos/penguplay.png",
    // Ruta relativa a la API de Aetherio: conserva el proxy y su autenticación.
    manifestUrl: "/api/penguplay/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "empty",
    hiddenInUi: true,
    streamTimeoutMs: 20_000,
    streamAttempts: 2,
    manifestFallback: {
      id: "com.penguplay",
      version: "1.4.0",
      name: "PenguPlay",
      description: "Stream movies and series in Stremio with configurable provider and quality filters.",
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "tmdb:", "tvdb:", "mal:", "kitsu:", "tvmaze:", "anilist:", "anidb:"] }],
      types: ["movie", "series"],
      idPrefixes: ["tt", "tmdb:", "tvdb:", "mal:", "kitsu:", "tvmaze:", "anilist:", "anidb:"],
      catalogs: [],
      logo: "/addons/logos/penguplay.png",
    },
  },
  {
    id: "community.sports.fly",
    name: "Sports Streams · Highfly",
    description: "Partidos y canales de Highfly integrados en Sports. Narraciones en español primero; horarios de Perú.",
    logo: "/addons/logos/highfly.ico",
    // Public default only. Personal Highfly URLs stay in each Aetherio install.
    manifestUrl: "https://sports.highfly.to/manifest.json",
    enabledByDefault: true,
    catalogPolicy: "empty",
    manifestFallback: {
      id: "community.sports.fly",
      version: "1.3.0",
      name: "Sports Streams",
      description: "Live and upcoming sports matches — football, basketball, cricket, UFC, tennis, and more.",
      resources: ["catalog", "meta", "stream"],
      types: ["sport"],
      idPrefixes: ["streamed", "sf", "recap", "leaf"],
      catalogs: [],
      logo: "/addons/logos/highfly.ico",
    },
  },
];

const CINEMETA_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#202638"/><circle cx="128" cy="128" r="82" fill="#8f72ff"/><circle cx="128" cy="128" r="54" fill="#202638"/><circle cx="128" cy="128" r="27" fill="#8f72ff"/><path d="M63 77l29 29m72 72 29 29M193 77l-29 29m-72 72-29 29" stroke="#202638" stroke-width="17" stroke-linecap="round"/><text x="128" y="239" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="23" font-weight="700">CINEMETA</text></svg>`;

const REMOTE_ADDON_LOGOS: Record<string, { url: string; contentType: string }> = {
  "/addons/logos/animeav1.svg": {
    url: "https://animeav1.com/img/logo-dark.svg",
    contentType: "image/svg+xml; charset=utf-8",
  },
  "/addons/logos/animes.png": {
    url: "https://raw.githubusercontent.com/Pigamer37/animeflv-stremio-addon/refs/heads/main/views/AnimES.png",
    contentType: "image/png",
  },
  "/addons/logos/torrentio.png": {
    url: "https://torrentio.strem.fun/images/logo_v1.png",
    contentType: "image/png",
  },
  "/addons/logos/hdhub.png": {
    url: "https://hdhub.thevolecitor.qzz.io/logo.png",
    contentType: "image/png",
  },
  "/addons/logos/deepflix.png": {
    url: "https://mg.homelabx.qzz.io/logo.png",
    contentType: "image/png",
  },
  "/addons/logos/penguplay.png": {
    url: "https://pengu.uk/penguplay-icon.png",
    contentType: "image/png",
  },
  "/addons/logos/highfly.ico": {
    url: "https://cdn.highfly.to/logo.ico",
    contentType: "image/x-icon",
  },
};

export function buildAddonDirectory(
  hubBaseUrl: string,
  addons: readonly (ProviderHubAddon & { updatedAt?: number })[] = DEFAULT_ADDONS,
) {
  return {
    version: 1,
    addons: addons.map(addon => {
      const logoPath = addon.logo.startsWith("/addons/logos/")
        ? addon.logo
        : `/addons/logos/custom/${encodeURIComponent(addon.id)}?v=${addon.updatedAt ?? 0}`;
      const logo = new URL(logoPath, hubBaseUrl).toString();
      // Metadatos administrados también deben prevalecer al usar el fallback offline.
      return {
        id: addon.id, name: addon.name, description: addon.description, logo,
        manifestUrl: addon.manifestUrl, enabledByDefault: addon.enabledByDefault,
        catalogPolicy: addon.catalogPolicy, hiddenInUi: addon.hiddenInUi,
        streamTimeoutMs: addon.streamTimeoutMs, streamAttempts: addon.streamAttempts,
        upstreamAddonId: addon.upstreamAddonId, streamNameFilter: addon.streamNameFilter,
        manifestFallback: { ...addon.manifestFallback, name: addon.name, description: addon.description, logo },
      };
    }),
  };
}

export async function addonLogoResponse(pathname: string): Promise<Response | null> {
  const headers = (contentType: string) => ({
    "content-type": contentType,
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  });
  if (pathname === "/addons/logos/cinemeta.svg") {
    return new Response(CINEMETA_LOGO_SVG, { status: 200, headers: headers("image/svg+xml; charset=utf-8") });
  }

  const seanimeId = pathname.match(/^\/addons\/logos\/seanime\/([a-z0-9-]+)$/)?.[1];
  if (seanimeId) {
    const source = SEANIME_LOGOS[seanimeId];
    if (!source) return null;
    try {
      const asset = await fetchPublicAsset(source, 1024 * 1024);
      const contentType = asset.contentType.startsWith("image/") ? asset.contentType
        : /\.ico(?:$|\?)/i.test(source) ? "image/x-icon" : /\.png(?:$|\?)/i.test(source) ? "image/png" : "application/octet-stream";
      return new Response(asset.bytes, { headers: headers(contentType) });
    } catch { return new Response("Logo upstream no disponible", { status: 502 }); }
  }

  const asset = REMOTE_ADDON_LOGOS[pathname];
  if (!asset) return null;
  try {
    const response = await fetch(asset.url);
    if (!response.ok || !response.body) return new Response("Logo upstream no disponible", { status: 502 });
    return new Response(response.body, { status: 200, headers: headers(asset.contentType) });
  } catch {
    return new Response("Logo upstream no disponible", { status: 502 });
  }
}
