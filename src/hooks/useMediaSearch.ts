import { useEffect, useMemo, useRef, useState } from "react";
import type { InstalledAddon } from "../store/addonStore";
import {
  searchMediaResponse,
  type SearchCorrection,
  type SearchMode,
  type SearchResponse,
  type UnifiedSearchResult,
} from "../utils/searchProviders";

function emptyResponse(query: string): SearchResponse {
  return {
    query,
    effectiveQuery: query,
    results: [],
    partial: false,
    completedProviders: [],
    providerStatus: {
      tmdb: { state: "idle", resultCount: 0 },
      cinemeta: { state: "idle", resultCount: 0 },
      semantic: { state: "idle", resultCount: 0 },
      addons: { state: "idle", resultCount: 0 },
    },
  };
}

export interface UseMediaSearchOptions {
  query: string;
  mode: SearchMode;
  addons: InstalledAddon[];
  limit: number;
  enabled?: boolean;
  allowCorrection?: boolean;
}

export interface UseMediaSearchResult {
  response: SearchResponse;
  results: UnifiedSearchResult[];
  correction?: SearchCorrection;
  loading: boolean;
}

export function useMediaSearch({ query, mode, addons, limit, enabled = true, allowCorrection = true }: UseMediaSearchOptions): UseMediaSearchResult {
  const [response, setResponse] = useState<SearchResponse>(() => emptyResponse(query.trim()));
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const addonKey = useMemo(
    () => addons.filter(addon => addon.enabled).map(addon => `${addon.id}:${addon.url}`).sort().join(","),
    [addons],
  );

  useEffect(() => {
    const normalizedQuery = query.trim();
    const minimumLength = mode === "suggestions" ? 2 : 1;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    if (!enabled || normalizedQuery.length < minimumLength) {
      setResponse(emptyResponse(normalizedQuery));
      setLoading(false);
      return () => controller.abort();
    }

    setResponse(previous => {
      const next = emptyResponse(normalizedQuery);
      return mode === "full" ? { ...next, results: previous.results } : next;
    });
    setLoading(true);
    const debounceMs = mode === "suggestions" ? 180 : 350;
    const timer = setTimeout(() => {
      void searchMediaResponse({
        query: normalizedQuery,
        mode,
        addons,
        limit,
        allowCorrection,
        signal: controller.signal,
        onSnapshot: snapshot => {
          if (requestId === requestIdRef.current && !controller.signal.aborted) setResponse(snapshot);
        },
      }).then(next => {
        if (requestId === requestIdRef.current && !controller.signal.aborted) setResponse(next);
      }).catch(error => {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        if (requestId === requestIdRef.current) setResponse(emptyResponse(normalizedQuery));
      }).finally(() => {
        if (requestId === requestIdRef.current && !controller.signal.aborted) setLoading(false);
      });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [addonKey, addons, allowCorrection, enabled, limit, mode, query]);

  return {
    response,
    results: response.results,
    correction: response.correction,
    loading,
  };
}
