export interface StreamSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  language?: string;
  title?: string;
}

export interface MediaStream {
  id: string;
  addonId: string;
  addonName: string;
  name: string;
  title?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  ytId?: string;
  infoHash?: string;
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
