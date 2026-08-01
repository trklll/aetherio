import type { MediaStream } from "../types/stream";
import {
  SELECTED_MEDIA_META_KEY,
  SELECTED_PLAYBACK_OVERRIDES_KEY,
  SELECTED_STREAM_KEY,
} from "../pages/Player/utils";

export const LOCAL_FILES_DROPPED_EVENT = "aetherio-local-files-dropped";

const SUBTITLE_EXTENSIONS = new Set([
  "ass",
  "smi",
  "srt",
  "ssa",
  "stl",
  "sub",
  "sup",
  "ttml",
  "txt",
  "vtt",
]);

export interface LocalFileSelection {
  mediaPath: string | null;
  subtitlePaths: string[];
}

export function splitLocalFiles(paths: string[]): LocalFileSelection {
  const unique = [...new Set(paths.map(path => path.trim()).filter(Boolean))];
  const subtitlePaths = unique.filter(path => SUBTITLE_EXTENSIONS.has(fileExtension(path)));
  const mediaPath = unique.find(path => !SUBTITLE_EXTENSIONS.has(fileExtension(path))) ?? null;
  return { mediaPath, subtitlePaths };
}

export function prepareLocalMediaPlayback(mediaPath: string, subtitlePaths: string[] = []) {
  const filename = fileName(mediaPath) || "Archivo local";
  const stream: MediaStream = {
    id: `local:${mediaPath}`,
    addonId: "aetherio-local",
    addonName: "Archivo local",
    name: filename,
    title: filename,
    url: mediaPath,
    behaviorHints: {
      filename,
      localFile: true,
    },
    subtitles: subtitlePaths.map((path, index) => ({
      id: `local-subtitle-${index}:${path}`,
      url: path,
      lang: "und",
      title: fileName(path) || `Subtítulo ${index + 1}`,
    })),
  };

  sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(stream));
  sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({ name: filename }));
  sessionStorage.removeItem(SELECTED_PLAYBACK_OVERRIDES_KEY);
  return `/player?local=${Date.now()}`;
}

export function dispatchLocalSubtitleDrop(paths: string[]) {
  window.dispatchEvent(new CustomEvent<string[]>(LOCAL_FILES_DROPPED_EVENT, {
    detail: paths,
  }));
}

function fileExtension(path: string) {
  const filename = fileName(path);
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop()?.trim() ?? "";
}
