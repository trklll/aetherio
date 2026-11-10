import { useCallback, useEffect, useState } from "react";
import {
  cancelDownload,
  deleteDownload,
  listDownloads,
  retryDownload,
  subscribeToDownloads,
  type DownloadEvent,
  type DownloadRecord,
} from "../services/downloads";

function mergeEvent(items: DownloadRecord[], event: DownloadEvent): DownloadRecord[] {
  if ("deleted" in event) return items.filter(item => item.id !== event.id);
  const next = items.filter(item => item.id !== event.id);
  next.push(event);
  return next.sort((left, right) => right.createdAt - left.createdAt);
}

export function useDownloads() {
  const [items, setItems] = useState<DownloadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listDownloads());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las descargas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void subscribeToDownloads(event => {
      if (!disposed) setItems(current => mergeEvent(current, event));
    }).then(cleanup => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    void listDownloads().then(records => {
      if (!disposed) {
        setItems(records);
        setError("");
      }
    }).catch(cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las descargas.");
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    items,
    loading,
    error,
    refresh,
    cancel: cancelDownload,
    retry: retryDownload,
    remove: deleteDownload,
  };
}
