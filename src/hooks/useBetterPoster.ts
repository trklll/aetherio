import { useEffect, useState } from "react";
import {
  applyBetterPosterToUrl,
  betterPosterSignature,
  extractImdbId,
  getBetterPosterSettings,
  useBetterPosterSettings,
  type BetterPosterOverrides,
} from "../config/betterPosters.ts";
import {
  betterMetaTypeFor,
  parseTmdbId,
  readCachedImdb,
  resolveTmdbToImdb,
} from "../services/betterPosterResolve.ts";

export interface ResolvedPoster {
  /** URL a mostrar (BetterPosters cuando se pudo resolver, si no la base). */
  url?: string;
  /** Póster original para fallback si la URL BetterPosters falla. */
  original?: string;
  /** Hay una resolución async en curso (se muestra la base mientras tanto). */
  pending: boolean;
}

/**
 * Resuelve el póster BetterPosters para un item:
 * - ids `tt...` → síncrono, con los ajustes actuales (reacciona a cambios).
 * - ids `tmdb:...` → caché persistente + resolución async vía btttr meta.
 * - `disabled` (p. ej. override manual del usuario) → devuelve la base tal cual.
 */
export function useBetterPoster(
  mediaId: string,
  mediaType: string,
  basePosterUrl: string | undefined,
  disabled = false,
  overrides?: BetterPosterOverrides,
): ResolvedPoster {
  const settings = useBetterPosterSettings();
  const trendOverride = overrides?.trendTags;
  const signature = `${betterPosterSignature(settings)}|tag:${trendOverride ?? "auto"}`;
  const [asyncImdb, setAsyncImdb] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const enabled = settings.enabled && !disabled;
  const directImdb = enabled ? extractImdbId(mediaId) : null;
  const tmdbId = directImdb || !enabled ? null : parseTmdbId(mediaId);
  const metaType = betterMetaTypeFor(mediaType);
  const cachedImdb = tmdbId ? readCachedImdb(metaType, tmdbId) : null;
  const effectiveImdb = directImdb ?? cachedImdb ?? asyncImdb;

  useEffect(() => {
    if (!tmdbId || cachedImdb) return;
    let cancelled = false;
    setAsyncImdb(null);
    setResolving(true);
    void resolveTmdbToImdb(metaType, tmdbId).then(imdb => {
      if (cancelled) return;
      setAsyncImdb(imdb);
      setResolving(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, metaType, signature]);

  if (!enabled || !effectiveImdb) {
    return { url: basePosterUrl, original: undefined, pending: resolving };
  }
  const url = applyBetterPosterToUrl(basePosterUrl, effectiveImdb, settings, overrides);
  const original = url && url !== basePosterUrl ? basePosterUrl : undefined;
  return { url, original, pending: false };
}

/** Variante síncrona para lugares sin hooks (p. ej. búsquedas con imdb conocido). */
export function resolveBetterPosterSync(
  mediaId?: string | null,
  externalImdb?: string | null,
  basePosterUrl?: string,
): string | undefined {
  const imdb = extractImdbId(mediaId, externalImdb ?? undefined);
  if (!imdb) return basePosterUrl;
  return applyBetterPosterToUrl(basePosterUrl, imdb, getBetterPosterSettings());
}
