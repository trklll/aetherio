export interface StreamSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  language?: string;
  title?: string;
}

export interface StreamTechnicalMetadata {
  resolutionHeight?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  dynamicRange?: string;
  /**
   * Perfil de audio declarado por el addon ("Dolby Atmos", "Atmos", ...).
   *
   * Va aparte de `dynamicRange` porque ese campo es de video en la practica
   * (HDR/DV) y mezclarlo dortaba las insignias de video.
   */
  audioProfile?: string;
  bitDepth?: string;
}

export interface MediaStream {
  id: string;
  addonId: string;
  addonName: string;
  /** Hub-defined logical source; not an embed host guessed from a title. */
  sourceName?: string;
  /** Artwork provided by the remote script manifest, served by its Hub. */
  sourceLogo?: string;
  name: string;
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
  behaviorHints?: {
    filename?: string;
    videoSize?: number;
    bingeGroup?: string;
    notWebReady?: boolean;
    [key: string]: unknown;
  };
  technicalMetadata?: StreamTechnicalMetadata;
  subtitles?: StreamSubtitle[];
}

export interface StreamQuery {
  type: string;
  id: string;
  season?: number;
  episode?: number;
}

export type StreamKind = "https" | "p2p" | "external" | "unknown";

export type PlaybackEngine = "mpv";
