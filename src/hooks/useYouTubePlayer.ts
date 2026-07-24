import { useEffect, useState } from "react";
import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";

export interface YouTubeStreamInfo {
  videoId: string;
  url: string;
  audioUrl?: string | null;
  title: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  formatId?: string | null;
  hasAudio: boolean;
  mimeType: string;
  audioMimeType?: string | null;
}

export function useYouTubePlayer(videoId: string | null) {
  const [stream, setStream] = useState<YouTubeStreamInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStream(null);
    setError(null);
    if (!videoId || !isTauriRuntime()) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    void invokeCommand<YouTubeStreamInfo>("youtube_resolve_stream", { videoId })
      .then(result => {
        if (!cancelled) setStream(result);
      })
      .catch(reason => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        console.warn("[Aetherio:YouTube] No se pudo resolver el stream:", message);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [videoId]);

  return { stream, loading, error };
}
