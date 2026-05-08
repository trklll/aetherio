import type { MediaStream, PlaybackEngine, StreamQuery } from "../types/stream";

export type EngineDecision = {
  engine: PlaybackEngine;
  reason: string;
  confidence: "high" | "medium" | "low";
};

function sourceText(stream: MediaStream): string {
  return [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function selectEngine(stream: MediaStream, query: StreamQuery): EngineDecision {
  const target = (stream.url ?? stream.externalUrl ?? "").toLowerCase();
  const text = sourceText(stream);

  if (stream.infoHash || target.startsWith("magnet:") || target.startsWith("stremio:")) {
    return { engine: "mpv", reason: "P2P/torrent requiere motor nativo", confidence: "high" };
  }
  if (target.endsWith(".m3u8") || target.includes(".m3u8?")) {
    return { engine: "mpv", reason: "HLS via libmpv", confidence: "high" };
  }
  if (target.endsWith(".mpd") || target.includes(".mpd?")) {
    return { engine: "mpv", reason: "DASH via libmpv", confidence: "high" };
  }
  if (/\b(hdr|hdr10|hdr10\+|hlg|dolby\s*vision|dv|atmos|truehd|dts(?:-|_|:)?x|dts(?:-|_|:)?ma|dts(?:-|_|:)?hd)\b/i.test(text)) {
    return { engine: "mpv", reason: "alta fidelidad via libmpv", confidence: "high" };
  }
  if (query.type === "anime") {
    return { engine: "mpv", reason: "anime via libmpv para ASS/SSA y Hi10P", confidence: "high" };
  }

  return { engine: "mpv", reason: "libmpv nativo por defecto", confidence: "high" };
}

export function chooseEngineSimple(stream: MediaStream, query: StreamQuery): PlaybackEngine {
  return selectEngine(stream, query).engine;
}
