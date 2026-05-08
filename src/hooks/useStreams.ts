import { useEffect, useMemo, useRef, useState } from "react";
import { useAddonStore } from "../store/addonStore";
import type { MediaStream, StreamQuery } from "../types/stream";

export interface UseStreamsResult {
  streams: MediaStream[];
  loading: boolean;
  error: string | null;
  streamId: string;
  reload: () => void;
}

// ── Fingerprint de contenido para deduplicacion inteligente ───────────────
// No solo compara URLs: un mismo recurso puede llegar de distintos addons
// con URL identica, hash identico, o titulo+calidad identicos.
function contentFingerprint(s: MediaStream): string {
  // Prioridad: url exacta > infoHash+fileIdx > titulo normalizado
  if (s.url)      return `url:${s.url.toLowerCase().trim()}`;
  if (s.infoHash) return `hash:${s.infoHash.toLowerCase()}:${s.fileIdx ?? 0}`;
  if (s.ytId)     return `yt:${s.ytId}`;
  // Fallback: normalizar titulo + addon para no perder fuentes distintas
  const title = (s.title ?? s.name ?? "").toLowerCase().replace(/\s+/g, "");
  return `title:${s.addonId}:${title}`;
}

function dedupeStreams(streams: MediaStream[]): MediaStream[] {
  const seen = new Map<string, MediaStream>();
  for (const s of streams) {
    const fp = contentFingerprint(s);
    if (!seen.has(fp)) {
      seen.set(fp, s);
    } else {
      // Preferir el que tenga mas metadata completa
      const existing = seen.get(fp)!;
      const score = (x: MediaStream) =>
        (x.title ? 1 : 0) + (x.description ? 1 : 0) +
        (x.behaviorHints?.videoSize ? 1 : 0) + (x.subtitles?.length ? 1 : 0);
      if (score(s) > score(existing)) seen.set(fp, s);
    }
  }
  return Array.from(seen.values());
}

function playbackScore(stream: MediaStream): number {
  const hints = stream.behaviorHints ?? {};
  const notWebReady = Boolean(hints.notWebReady);
  const lowerName = (stream.name ?? "").toLowerCase();
  const hasDirectUrl = typeof stream.url === "string" && /^https?:\/\//i.test(stream.url);
  const hasExternalUrl = typeof stream.externalUrl === "string" && stream.externalUrl.length > 0;
  const hasHttpSource = (stream.sources ?? []).some(item => /^https?:\/\//i.test(item));
  const hasTorrentSignals =
    Boolean(stream.infoHash) ||
    (stream.sources ?? []).some(item => /^magnet:/i.test(item));

  let score = 0;
  if (hasDirectUrl) score += 50;
  if (hasHttpSource) score += 20;
  if (stream.subtitles?.length) score += 8;
  if (typeof hints.videoSize === "number" && hints.videoSize > 0) score += 4;
  if (hasExternalUrl) score -= 6;
  if (notWebReady) score -= 100;
  if (hasTorrentSignals) score -= 120;
  if (lowerName.includes("cam")) score -= 12;
  return score;
}

function sortStreamsForPlayback(streams: MediaStream[]): MediaStream[] {
  return [...streams].sort((a, b) => playbackScore(b) - playbackScore(a));
}

function buildStreamId(q: StreamQuery): string {
  return q.type !== "movie" && q.season && q.episode
    ? `${q.id}:${q.season}:${q.episode}`
    : q.id;
}

function addonHasStreams(addon: any): boolean {
  const resources = addon.manifest?.resources ?? [];
  if (!resources.length) return true; // sin declaracion — intentar igual
  return resources.some((r: unknown) =>
    typeof r === "string" ? r === "stream" : (r as any)?.name === "stream"
  );
}

function normalizeStream(raw: any, addonId: string, addonName: string, idx: number): MediaStream | null {
  const url         = typeof raw.url         === "string" ? raw.url         : undefined;
  const externalUrl = typeof raw.externalUrl === "string" ? raw.externalUrl : undefined;
  const ytId        = typeof raw.ytId        === "string" ? raw.ytId        : undefined;
  const infoHash    = typeof raw.infoHash    === "string" ? raw.infoHash    : undefined;
  const sources     = Array.isArray(raw.sources) ? raw.sources.filter((item: unknown) => typeof item === "string") : undefined;
  // Descartar entradas sin ninguna forma de reproduccion
  if (!url && !externalUrl && !ytId && !infoHash) return null;
  return {
    id: [addonId, url ?? infoHash ?? ytId ?? externalUrl ?? "", idx].join("|"),
    addonId,
    addonName,
    name:         typeof raw.name        === "string" ? raw.name        : addonName,
    title:        typeof raw.title       === "string" ? raw.title       : undefined,
    description:  typeof raw.description === "string" ? raw.description : undefined,
    url,
    externalUrl,
    ytId,
    infoHash,
    fileIdx:      typeof raw.fileIdx === "number" ? raw.fileIdx : undefined,
    sources,
    behaviorHints: raw.behaviorHints ?? undefined,
    subtitles:    Array.isArray(raw.subtitles) ? raw.subtitles : undefined,
  };
}

export function useStreams(query: StreamQuery | null): UseStreamsResult {
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const [streams, setStreams] = useState<MediaStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);

  const streamId = useMemo(() => (query ? buildStreamId(query) : ""), [query]);

  // Ref para acumular resultados sin stale-closure
  const accRef = useRef<MediaStream[]>([]);

  useEffect(() => {
    if (!query || !streamId) {
      setStreams([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    accRef.current = [];
    setStreams([]);
    setLoading(true);
    setError(null);

    const addons = getEnabledAddons().filter(addonHasStreams);

    if (!addons.length) {
      setLoading(false);
      return;
    }

    // ── Non-blocking: lanzar todos en paralelo, actualizar UI al ir llegando ──
    let pending = addons.length;

    function onAddonDone() {
      if (cancelled) return;
      pending--;
      if (pending === 0) setLoading(false);
    }

    for (const addon of addons) {
      const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
      const url  = `${base}/stream/${query.type}/${encodeURIComponent(streamId)}.json`;

      fetch(url)
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((json: any) => {
          if (cancelled) return;
          const fresh = (json.streams ?? [])
            .map((s: any, i: number) => normalizeStream(s, addon.id, addon.name, i))
            .filter(Boolean) as MediaStream[];
          if (!fresh.length) return;
          // Merge + dedup incremental
          accRef.current = sortStreamsForPlayback(dedupeStreams([...accRef.current, ...fresh]));
          setStreams([...accRef.current]);
        })
        .catch(() => { /* addon roto — ignorar silenciosamente */ })
        .finally(onAddonDone);
    }

    return () => { cancelled = true; };
  }, [getEnabledAddons, query, streamId, tick]);

  return {
    streams,
    loading,
    error,
    streamId,
    reload: () => setTick(v => v + 1),
  };
}
