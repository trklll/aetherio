export interface MpvLaunchResult {
  pid?: number | null;
  hostPid?: number;
  backend?: string;
  logPath?: string;
  bridgeLogPath?: string;
  libmpvPath?: string;
  runtimePath?: string;
  resolvedTarget?: string;
  p2pLogPath?: string;
}

export interface MpvTrack {
  id?: number;
  type?: string;
  title?: string;
  lang?: string;
  selected?: boolean;
}

export interface MpvStatusSnapshot {
  timePos?: number | null;
  duration?: number | null;
  pause?: boolean | null;
  sid?: number | null;
  aid?: number | null;
  speed?: number | null;
  fileLoaded?: boolean | null;
  pausedForCache?: boolean | null;
  cacheBufferingState?: number | null;
  chapter?: number | null;
  chapterList?: { title?: string; time?: number }[] | null;
  tracks?: MpvTrack[] | null;
}

export interface MpvEventPayload {
  event?: string;
  property?: unknown;
  target?: string;
  snapshot?: MpvStatusSnapshot;
}

export interface EpisodeOption {
  id: string;
  episode: number;
  season: number;
  name: string;
  overview?: string;
  airDate?: string;
  still?: string;
}

export interface ChapterOption {
  index: number;
  title: string;
  time: number;
}

export interface PlayerPanelItem {
  key: string;
  title: string;
  subtitle: string;
  image?: string;
  active: boolean;
  onClick: () => void;
}

export interface SelectOption {
  value: string;
  label: string;
  languageKey?: string;
  languageLabel?: string;
  sourceLabel?: string;
}

export type VideoScaleMode = "original" | "crop";
