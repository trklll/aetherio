import formatterManifest from "../assets/stream-tags/manifest.json";
import type { MediaStream, StreamTechnicalMetadata } from "../types/stream.ts";

export type StreamFormatCategory = "source" | "video" | "audio" | "channels" | "special" | "service" | "language";

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
  // ── Badges adicionales (aditivas: no reemplazan las de arriba) ──
  // Special tags
  "seadex-release.png": { id: "seadex-release", label: "SEADEX", category: "special", order: 5 },
  "edition-directors-cut.png": { id: "edition-directors-cut", label: "DIR CUT", category: "special", order: 6 },
  "edition-extended.png": { id: "edition-extended", label: "EXTENDED", category: "special", order: 7 },
  "edition-true-hue.png": { id: "edition-true-hue", label: "TRUE-HUE", category: "special", order: 8 },
  "edition-bw.png": { id: "edition-bw", label: "B&W", category: "special", order: 9 },
  // Servicios de streaming
  "gs-crave.png": { id: "gs-crave", label: "CRAVE", category: "service", order: 46 },
  "s-nflx.png": { id: "s-nflx", label: "NETFLIX", category: "service", order: 47 },
  "s-amzn.png": { id: "s-amzn", label: "PRIME", category: "service", order: 48 },
  "s-atvp.png": { id: "s-atvp", label: "APPLE TV+", category: "service", order: 49 },
  "s-dsnp.png": { id: "s-dsnp", label: "DISNEY+", category: "service", order: 50 },
  "s-hmax.png": { id: "s-hmax", label: "MAX", category: "service", order: 51 },
  "s-hulu.png": { id: "s-hulu", label: "HULU", category: "service", order: 52 },
  "s-pcok.png": { id: "s-pcok", label: "PEACOCK", category: "service", order: 53 },
  "s-pamp.png": { id: "s-pamp", label: "PARAMOUNT+", category: "service", order: 54 },
  "s-croll.png": { id: "s-croll", label: "CRUNCHYROLL", category: "service", order: 55 },
  // Tiers adicionales (conviven con los tiers T1-T3 propios)
  "web-unranked.png": { id: "web-unranked", label: "WEB Unranked", category: "source", order: 56 },
  "web-6.png": { id: "web-6", label: "WEB 6", category: "source", order: 57 },
  "web-5.png": { id: "web-5", label: "WEB 5", category: "source", order: 58 },
  "web-4.png": { id: "web-4", label: "WEB 4", category: "source", order: 59 },
  "web-3.png": { id: "web-3", label: "WEB 3", category: "source", order: 60 },
  "web-2.png": { id: "web-2", label: "WEB 2", category: "source", order: 61 },
  "web-1.png": { id: "web-1", label: "WEB 1", category: "source", order: 62 },
  "blu-ray-unranked.png": { id: "blu-ray-unranked", label: "BLU-RAY Unranked", category: "source", order: 63 },
  "blu-ray-8.png": { id: "blu-ray-8", label: "BLU-RAY 8", category: "source", order: 64 },
  "blu-ray-7.png": { id: "blu-ray-7", label: "BLU-RAY 7", category: "source", order: 65 },
  "blu-ray-6.png": { id: "blu-ray-6", label: "BLU-RAY 6", category: "source", order: 66 },
  "blu-ray-5.png": { id: "blu-ray-5", label: "BLU-RAY 5", category: "source", order: 67 },
  "blu-ray-4.png": { id: "blu-ray-4", label: "BLU-RAY 4", category: "source", order: 68 },
  "blu-ray-3.png": { id: "blu-ray-3", label: "BLU-RAY 3", category: "source", order: 69 },
  "blu-ray-2.png": { id: "blu-ray-2", label: "BLU-RAY 2", category: "source", order: 70 },
  "blu-ray-1.png": { id: "blu-ray-1", label: "BLU-RAY 1", category: "source", order: 71 },
  "remux-unranked.png": { id: "remux-unranked", label: "REMUX Unranked", category: "source", order: 72 },
  "remux-3.png": { id: "remux-3", label: "REMUX 3", category: "source", order: 73 },
  "remux-2.png": { id: "remux-2", label: "REMUX 2", category: "source", order: 74 },
  "remux-1.png": { id: "remux-1", label: "REMUX 1", category: "source", order: 75 },
  "q-br.png": { id: "q-br", label: "Best Remux", category: "source", order: 76 },
  "q-bb.png": { id: "q-bb", label: "Best BluRay", category: "source", order: 77 },
  "q-bw.png": { id: "q-bw", label: "Best WebDL", category: "source", order: 78 },
  "q-gr.png": { id: "q-gr", label: "Good Remux", category: "source", order: 79 },
  "q-gb.png": { id: "q-gb", label: "Good BluRay", category: "source", order: 80 },
  "q-gw.png": { id: "q-gw", label: "Good WebDL", category: "source", order: 81 },
  "q-or.png": { id: "q-or", label: "OK Remux", category: "source", order: 82 },
  "q-ob.png": { id: "q-ob", label: "OK BluRay", category: "source", order: 83 },
  "q-ow.png": { id: "q-ow", label: "OK WebDL", category: "source", order: 84 },
  "grl-hdtv.png": { id: "grl-hdtv", label: "HDTV", category: "source", order: 85 },
  "q-b.png": { id: "q-b", label: "BluRay", category: "source", order: 86 },
  "q-w.png": { id: "q-w", label: "WebDL", category: "source", order: 87 },
  "q-wr.png": { id: "q-wr", label: "WebRip", category: "source", order: 88 },
  "q-r.png": { id: "q-r", label: "Remux", category: "source", order: 89 },
  // Video extra (resolución baja, 3D, IMAX Enhanced, combos, codecs, bit depth)
  "gr-480p-sd.png": { id: "gr-480p-sd", label: "480p", category: "video", order: 103 },
  "gv-dvd-rip.png": { id: "gv-dvd-rip", label: "DVD RIP", category: "video", order: 125 },
  "v-imax-e.png": { id: "v-imax-e", label: "IMAX Enhanced", category: "video", order: 126 },
  "v-3d.png": { id: "v-3d", label: "3D", category: "video", order: 127 },
  "a-at-dv.png": { id: "a-at-dv", label: "Atmos+DV", category: "video", order: 128 },
  "a-th-dv.png": { id: "a-th-dv", label: "TrueHD+DV", category: "video", order: 129 },
  "a-dp-dv.png": { id: "a-dp-dv", label: "DD++DV", category: "video", order: 130 },
  "a-dd-dv.png": { id: "a-dd-dv", label: "DD+DV", category: "video", order: 131 },
  "video-codec-avc.png": { id: "video-codec-avc", label: "AVC", category: "video", order: 140 },
  "video-codec-hevc.png": { id: "video-codec-hevc", label: "HEVC", category: "video", order: 141 },
  "bit-depth-8bit.png": { id: "bit-depth-8bit", label: "8-Bit", category: "video", order: 142 },
  "bit-depth-10bit.png": { id: "bit-depth-10bit", label: "10-Bit", category: "video", order: 143 },
  // Audio extra
  "a-aac.png": { id: "a-aac", label: "AAC", category: "audio", order: 232 },
  "a-flac.png": { id: "a-flac", label: "FLAC", category: "audio", order: 233 },
  "a-opus.png": { id: "a-opus", label: "OPUS", category: "audio", order: 234 },
  "a-mp3.png": { id: "a-mp3", label: "MP3", category: "audio", order: 235 },
  "a-pcm.png": { id: "a-pcm", label: "PCM", category: "audio", order: 236 },
  // Canales extra
  "ch-20.png": { id: "ch-20", label: "2.0 canales", category: "channels", order: 303 },
  // Idiomas
  "l-en.png": { id: "l-en", label: "Inglés", category: "language", order: 400 },
  "l-es.png": { id: "l-es", label: "Español", category: "language", order: 401 },
  "l-fr.png": { id: "l-fr", label: "Francés", category: "language", order: 402 },
  "l-de.png": { id: "l-de", label: "Alemán", category: "language", order: 403 },
  "l-it.png": { id: "l-it", label: "Italiano", category: "language", order: 404 },
  "l-pt-br.png": { id: "l-pt-br", label: "Portugués BR", category: "language", order: 405 },
  "l-pt-pt.png": { id: "l-pt-pt", label: "Portugués", category: "language", order: 406 },
  "l-tr.png": { id: "l-tr", label: "Turco", category: "language", order: 407 },
  "l-pl.png": { id: "l-pl", label: "Polaco", category: "language", order: 408 },
  "l-uk.png": { id: "l-uk", label: "Ucraniano", category: "language", order: 409 },
  "l-id.png": { id: "l-id", label: "Indonesio", category: "language", order: 410 },
  "l-th.png": { id: "l-th", label: "Tailandés", category: "language", order: 411 },
  "l-vi.png": { id: "l-vi", label: "Vietnamita", category: "language", order: 412 },
  "l-ja.png": { id: "l-ja", label: "Japonés", category: "language", order: 413 },
  "l-ko.png": { id: "l-ko", label: "Coreano", category: "language", order: 414 },
  "l-zh.png": { id: "l-zh", label: "Chino", category: "language", order: 415 },
  "l-hi.png": { id: "l-hi", label: "Hindi", category: "language", order: 416 },
  "l-ar.png": { id: "l-ar", label: "Árabe", category: "language", order: 417 },
  "l-ru.png": { id: "l-ru", label: "Ruso", category: "language", order: 418 },
  "l-el.png": { id: "l-el", label: "Griego", category: "language", order: 419 },
  "l-mu.png": { id: "l-mu", label: "Multi-Audio", category: "language", order: 420 },
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const formatterTextMeta: Record<string, FormatterAssetMeta> = {
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
  if ((entry as { status?: string }).status === "generated") return [];
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

function metadataBadges(metadata?: StreamTechnicalMetadata): StreamFormatBadge[] {
  if (!metadata) return [];
  const result: StreamFormatBadge[] = [];
  const add = (id: string) => {
    const badge = [...FORMATTER_ASSET_META_ENTRIES].find(entry => entry.id === id);
    if (!badge) return;
    const imageUrl = badge.fileName ? formatterAssetUrls[`../assets/stream-tags/${badge.fileName}`] ?? "" : "";
    result.push({ ...badge, imageUrl });
  };
  const height = metadata.resolutionHeight;
  if (height && height >= 2160) add("resolution-2160p");
  else if (height && height >= 1080) add("resolution-1080p");
  else if (height && height >= 720) add("resolution-720p");
  else if (height && height >= 480) add("gr-480p-sd");

  const videoCodec = metadata.videoCodec?.toLowerCase() ?? "";
  if (/\b(?:hevc|h[ ._-]?265|x265)\b/.test(videoCodec)) add("video-codec-hevc");
  else if (/\b(?:avc|h[ ._-]?264|x264)\b/.test(videoCodec)) add("video-codec-avc");

  const bitDepth = String(metadata.bitDepth ?? "").toLowerCase();
  if (/hi10p|\b10([\s._-]?bit|b)?\b/.test(bitDepth)) add("bit-depth-10bit");
  else if (/\b8([\s._-]?bit|b)\b/.test(bitDepth)) add("bit-depth-8bit");

  const audioCodec = metadata.audioCodec?.toLowerCase() ?? "";
  if (/\batmos\b|joc/.test(audioCodec)) add("atmos");
  if (/\b(?:e-?ac-?3|ec-3|ddp|dolby digital plus)\b/.test(audioCodec)) add("dolby-digital-plus");
  else if (/\b(?:ac-?3|ac3|dd|dolby digital)\b/.test(audioCodec)) add("dolby-digital");
  else if (/\btrue[ ._-]?hd\b/.test(audioCodec)) add("truehd");
  else if (/\bdts[ ._-]?x\b/.test(audioCodec)) add("dts-x");
  else if (/\bdts[ ._-]?hd[ ._-]?ma\b/.test(audioCodec)) add("dts-hd-ma");
  else if (/\bdts[ ._-]?hd\b/.test(audioCodec)) add("dts-hd");
  else if (/\bdts\b/.test(audioCodec)) add("dts");
  else if (/\baac\b/.test(audioCodec)) add("a-aac");
  else if (/\bflac\b/.test(audioCodec)) add("a-flac");
  else if (/\bopus\b/.test(audioCodec)) add("a-opus");
  else if (/\bmp3\b/.test(audioCodec)) add("a-mp3");
  else if (/\b(?:pcm|lpcm)\b/.test(audioCodec)) add("a-pcm");

  const dynamicRange = metadata.dynamicRange?.toLowerCase() ?? "";
  if (/dolby[ ._-]?vision|dovi|dv/.test(dynamicRange)) add("dolby-vision");
  else if (/hdr10[ ._-]?(?:plus|\+)|hdr10p/.test(dynamicRange)) add("hdr10-plus");
  else if (/hdr10/.test(dynamicRange)) add("hdr10");
  else if (/\bhdr\b|hlg/.test(dynamicRange)) add("hdr");
  else if (/\bsdr\b/.test(dynamicRange)) add("sdr");

  if (metadata.audioChannels === 8) add("channels-7.1");
  else if (metadata.audioChannels === 7) add("channels-6.1");
  else if (metadata.audioChannels === 6) add("channels-5.1");
  else if (metadata.audioChannels === 2) add("ch-20");
  return result;
}

type FormatterAssetEntry = FormatterAssetMeta & { fileName?: string };
const FORMATTER_ASSET_META_ENTRIES: FormatterAssetEntry[] = Object.entries(FORMATTER_ASSET_META)
  .map(([fileName, meta]) => ({ ...meta, fileName }));

function dedupeEquivalentBadges(badges: StreamFormatBadge[]) {
  return [...badges].sort((left, right) => left.order - right.order);
}

export function getStreamFormatBadges(stream: MediaStream, additionalMetadata?: StreamTechnicalMetadata): StreamFormatBadge[] {
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    ...(stream.sources ?? []),
  ].filter(Boolean).join(" ");
  const matches = new Map<string, StreamFormatBadge>();
  for (const formatter of compiledFormatters) {
    if (!formatter.regex.test(text) || matches.has(formatter.badge.id)) continue;
    matches.set(formatter.badge.id, formatter.badge);
  }
  for (const badge of metadataBadges({ ...stream.technicalMetadata, ...additionalMetadata })) {
    if (!matches.has(badge.id)) matches.set(badge.id, badge);
  }
  return dedupeEquivalentBadges([...matches.values()]);
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
