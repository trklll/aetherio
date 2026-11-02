export interface StreamSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  language?: string;
  title?: string;
}

export interface MediaStream {
  id?: string;
  addonId?: string;
  addonName?: string;
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  ytId?: string;
  infoHash?: string;
  seeders?: number;
  fileIdx?: number;
  size?: number;
  folderSize?: number;
  indexer?: string;
  duration?: number;
  languages?: string[];
  sources?: string[];
  headers?: Record<string, string>;
  behaviorHints?: {
    filename?: string;
    videoSize?: number;
    bingeGroup?: string;
    notWebReady?: boolean;
    proxyHeaders?: { request?: Record<string, string> };
    [key: string]: unknown;
  };
  subtitles?: StreamSubtitle[];
  [key: string]: unknown;
}

export type DesktopMediaType = "movie" | "tv";

export interface ProviderRecord {
  id: string;
  name: string;
  description?: string;
  /** URL del logo del scraper, preservada desde el manifest del repo original. */
  logo?: string;
  enabled: boolean;
  supportedTypes: DesktopMediaType[];
  contentLanguage?: string[];
  /** Enlace remoto de proveniencia del script (se usa si no hay copia en KV). */
  scriptUrl?: string;
  /** "drop": para móvil se descartan streams que exigen cabeceras; "keep": se dejan sin cabeceras. */
  mobileHeaders: "drop" | "keep";
  origin: "default" | "kv";
  updatedAt: number;
}

export interface Env {
  /** KV con la lista de proveedores y sus scripts. */
  PROVIDERS: KVNamespace;
  /** Secret: token para /admin (el admin queda deshabilitado si falta). */
  ADMIN_TOKEN?: string;
  /** Secret opcional: token v4 de TMDB (Bearer) para resolver títulos. */
  TMDB_BEARER?: string;
  /** Secret opcional: clave v3 de TMDB (alternativa a TMDB_BEARER). */
  TMDB_KEY?: string;
}
