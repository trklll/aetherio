import formatterManifest from "../assets/stream-tags/manifest.json";
import type { MediaStream } from "../types/stream";

export type StreamFormatCategory = "source" | "video" | "audio" | "channels";

export interface StreamFormatBadge {
  id: string;
  label: string;
  imageUrl: string;
  category: StreamFormatCategory;
  order: number;
  overscan?: boolean;
}

type FormatterAssetMeta = Omit<StreamFormatBadge, "imageUrl">;

const formatterAssetUrls = import.meta.glob("../assets/stream-tags/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const FORMATTER_ASSET_META: Record<string, FormatterAssetMeta> = {
  "remux-tier-1.png": { id: "remux-tier-1", label: "REMUX T1", category: "source", order: 10 },
  "remux-tier-2.png": { id: "remux-tier-2", label: "REMUX T2", category: "source", order: 11 },
  "remux-tier-3.png": { id: "remux-tier-3", label: "REMUX T3", category: "source", order: 12 },
  "bluray-tier-1.png": { id: "bluray-tier-1", label: "Blu-ray T1", category: "source", order: 20 },
  "bluray-tier-2.png": { id: "bluray-tier-2", label: "Blu-ray T2", category: "source", order: 21 },
  "bluray-tier-3.png": { id: "bluray-tier-3", label: "Blu-ray T3", category: "source", order: 22 },
  "web-scene.png": { id: "web-scene", label: "WEB Scene", category: "source", order: 30 },
  "web-tier-1.png": { id: "web-tier-1", label: "WEB T1", category: "source", order: 31 },
  "web-tier-2.png": { id: "web-tier-2", label: "WEB T2", category: "source", order: 32 },
  "web-tier-3.png": { id: "web-tier-3", label: "WEB T3", category: "source", order: 33 },
  "anime-web-t1.png": { id: "anime-web-t1", label: "Anime WEB T1", category: "source", order: 40, overscan: true },
  "anime-web-t2.png": { id: "anime-web-t2", label: "Anime WEB T2", category: "source", order: 41, overscan: true },
  "anime-web-t3.png": { id: "anime-web-t3", label: "Anime WEB T3", category: "source", order: 42, overscan: true },
  "anime-web-t4.png": { id: "anime-web-t4", label: "Anime WEB T4", category: "source", order: 43, overscan: true },
  "anime-web-t5.png": { id: "anime-web-t5", label: "Anime WEB T5", category: "source", order: 44, overscan: true },
  "anime-web-t6.png": { id: "anime-web-t6", label: "Anime WEB T6", category: "source", order: 45, overscan: true },
  "2160p.png": { id: "resolution-2160p", label: "2160p", category: "video", order: 100 },
  "1080p.png": { id: "resolution-1080p", label: "1080p", category: "video", order: 101 },
  "720p.png": { id: "resolution-720p", label: "720p", category: "video", order: 102 },
  "imax.png": { id: "imax", label: "IMAX", category: "video", order: 110 },
  "dolby-vision.png": { id: "dolby-vision", label: "Dolby Vision", category: "video", order: 120 },
  "hdr10-plus.png": { id: "hdr10-plus", label: "HDR10+", category: "video", order: 121 },
  "hdr10.png": { id: "hdr10", label: "HDR10", category: "video", order: 122 },
  "hdr.png": { id: "hdr", label: "HDR", category: "video", order: 123 },
  "sdr.png": { id: "sdr", label: "SDR", category: "video", order: 124 },
  "atmos-ddp.png": { id: "atmos", label: "Dolby Atmos", category: "audio", order: 200 },
  "atmos.png": { id: "atmos", label: "Dolby Atmos", category: "audio", order: 201 },
  "truehd.png": { id: "truehd", label: "Dolby TrueHD", category: "audio", order: 210 },
  "dts-x.png": { id: "dts-x", label: "DTS:X", category: "audio", order: 220 },
  "dts-hd-ma.png": { id: "dts-hd-ma", label: "DTS-HD MA", category: "audio", order: 221 },
  "dts-hd.png": { id: "dts-hd", label: "DTS-HD", category: "audio", order: 222 },
  "dts.png": { id: "dts", label: "DTS", category: "audio", order: 223 },
  "dolby-digital-plus.png": { id: "dolby-digital-plus", label: "Dolby Digital Plus", category: "audio", order: 230 },
  "dolby-digital.png": { id: "dolby-digital", label: "Dolby Digital", category: "audio", order: 231 },
  "audio-7.1.png": { id: "channels-7.1", label: "7.1 canales", category: "channels", order: 300 },
  "audio-6.1.png": { id: "channels-6.1", label: "6.1 canales", category: "channels", order: 301 },
  "audio-5.1.png": { id: "channels-5.1", label: "5.1 canales", category: "channels", order: 302 },
  "codec-h264.png": { id: "codec-h264", label: "H.264", category: "video", order: 130 },
  "codec-h265.png": { id: "codec-h265", label: "H.265", category: "video", order: 131 },
  "codec-hevc.png": { id: "codec-hevc", label: "HEVC", category: "video", order: 132 },
  "codec-av1.png": { id: "codec-av1", label: "AV1", category: "video", order: 133 },
  "codec-avc.png": { id: "codec-avc", label: "AVC", category: "video", order: 134 },
  "codec-aac.png": { id: "codec-aac", label: "AAC", category: "audio", order: 240 },
  "codec-flac.png": { id: "codec-flac", label: "FLAC", category: "audio", order: 241 },
  "codec-opus.png": { id: "codec-opus", label: "Opus", category: "audio", order: 242 },
  "codec-vorbis.png": { id: "codec-vorbis", label: "Vorbis", category: "audio", order: 243 },
  "codec-mp3.png": { id: "codec-mp3", label: "MP3", category: "audio", order: 244 },
  "resolution-480p.png": { id: "resolution-480p", label: "480p", category: "video", order: 103 },
  "resolution-360p.png": { id: "resolution-360p", label: "360p", category: "video", order: 104 },
  "resolution-576p.png": { id: "resolution-576p", label: "576p", category: "video", order: 105 },
  "fhd.png": { id: "fhd", label: "FHD", category: "video", order: 106 },
  "uhd.png": { id: "uhd", label: "UHD", category: "video", order: 107 },
  "video-mpeg4.png": { id: "codec-mpeg4", label: "MPEG-4", category: "video", order: 135 },
  "video-vp9.png": { id: "codec-vp9", label: "VP9", category: "video", order: 136 },
  "audio-2.0.png": { id: "channels-2.0", label: "2.0 canales", category: "channels", order: 303 },
  "audio-mono.png": { id: "channels-mono", label: "Mono", category: "channels", order: 304 },
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const formatterTextMeta: Record<string, FormatterAssetMeta> = {
  "h.264": { id: "codec-h264", label: "H.264", category: "video", order: 130 },
  "h.265": { id: "codec-h265", label: "H.265", category: "video", order: 131 },
  "hevc": { id: "codec-hevc", label: "HEVC", category: "video", order: 132 },
  "av1": { id: "codec-av1", label: "AV1", category: "video", order: 133 },
  "avc": { id: "codec-avc", label: "AVC", category: "video", order: 134 },
  "aac": { id: "codec-aac", label: "AAC", category: "audio", order: 240 },
  "flac": { id: "codec-flac", label: "FLAC", category: "audio", order: 241 },
  "opus": { id: "codec-opus", label: "Opus", category: "audio", order: 242 },
  "vorbis": { id: "codec-vorbis", label: "Vorbis", category: "audio", order: 243 },
  "mp3": { id: "codec-mp3", label: "MP3", category: "audio", order: 244 },
  "mpeg-4": { id: "codec-mpeg4", label: "MPEG-4", category: "video", order: 135 },
  "vp9": { id: "codec-vp9", label: "VP9", category: "video", order: 136 },
  "dts": { id: "dts", label: "DTS", category: "audio", order: 223 },
  "dolby digital": { id: "dolby-digital", label: "Dolby Digital", category: "audio", order: 231 },
  "dolby digital +": { id: "dolby-digital-plus", label: "Dolby Digital Plus", category: "audio", order: 230 },
  "dolby vision": { id: "dolby-vision", label: "Dolby Vision", category: "video", order: 120 },
  "truehd": { id: "truehd", label: "Dolby TrueHD", category: "audio", order: 210 },
  "dts-x": { id: "dts-x", label: "DTS:X", category: "audio", order: 220 },
  "dts-hd ma": { id: "dts-hd-ma", label: "DTS-HD MA", category: "audio", order: 221 },
  "dts-hd": { id: "dts-hd", label: "DTS-HD", category: "audio", order: 222 },
  "atmos": { id: "atmos", label: "Dolby Atmos", category: "audio", order: 201 },
  "hdr": { id: "hdr", label: "HDR", category: "video", order: 123 },
  "hdr10": { id: "hdr10", label: "HDR10", category: "video", order: 122 },
  "hdr10+": { id: "hdr10-plus", label: "HDR10+", category: "video", order: 121 },
  "imax": { id: "imax", label: "IMAX", category: "video", order: 110 },
};

const compiledFormatters = formatterManifest.entries.flatMap(entry => {
  if (!entry.file) {
    if (!entry.name) return [];
    const textMeta = formatterTextMeta[entry.name.toLowerCase()] ?? { id: slugify(entry.name), label: entry.name, category: "source" as StreamFormatCategory, order: 500 };
    try {
      return [{ regex: compileFormatterPattern(entry.pattern), badge: { ...textMeta, imageUrl: "" } }];
    } catch {
      return [];
    }
  }
  const fileName = entry.file.replace(/^\.\//, "");
  const meta = FORMATTER_ASSET_META[fileName];
  const imageUrl = formatterAssetUrls[`../assets/stream-tags/${fileName}`];
  if (!meta) return [];
  try {
    return [{ regex: compileFormatterPattern(entry.pattern), badge: { ...meta, imageUrl: imageUrl ?? "" } }];
  } catch {
    return [];
  }
});

export function getStreamFormatBadges(stream: MediaStream): StreamFormatBadge[] {
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    ...(stream.sources ?? []),
  ].filter(Boolean).join(" ");
  if (!text.trim()) return [];

  const matches = new Map<string, StreamFormatBadge>();
  for (const formatter of compiledFormatters) {
    if (!formatter.regex.test(text) || matches.has(formatter.badge.id)) continue;
    matches.set(formatter.badge.id, formatter.badge);
  }
  return [...matches.values()].sort((left, right) => left.order - right.order);
}

function compileFormatterPattern(pattern: string) {
  let source = pattern.trim();
  let flags = "";
  const literal = source.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  if (literal) {
    source = literal[1];
    flags = literal[2];
  }
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    flags += "i";
  }
  if (source.includes("(?i:")) {
    source = source.split("(?i:").join("(?:");
    flags += "i";
  }
  if (source.endsWith("/i")) {
    source = source.slice(0, -2);
    flags += "i";
  }
  source = source.replace(/\\\\([bd])/g, "\\$1");
  if (/^\^\s/.test(source)) source = stripExtendedWhitespace(source);
  return new RegExp(source, [...new Set(flags)].join(""));
}

function stripExtendedWhitespace(source: string) {
  let result = "";
  let inCharacterClass = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }
    if (character === "[") inCharacterClass = true;
    if (character === "]") inCharacterClass = false;
    if (!inCharacterClass && /\s/.test(character)) continue;
    result += character;
  }
  return result;
}
