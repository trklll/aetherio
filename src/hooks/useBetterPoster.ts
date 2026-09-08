import { useEffect, useState } from "react";
import {
  applyBetterPosterToUrl,
  betterPosterSignature,
  extractImdbId,
  getBetterPosterSettings,
  isBetterPosterUrl,
  useBetterPosterSettings,
  type BetterPosterOverrides,
} from "../config/betterPosters.ts";
import {
  betterMetaTypeFor,
  parseTmdbId,
  readCachedImdb,
  resolveTmdbToImdb,
} from "../services/betterPosterResolve.ts";
import { verifyBetterPosterUrl } from "../services/betterPosterVerify.ts";

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
 *
 * El upgrade TMDB→BTTTR nunca se muestra en negro: mientras la URL BTTTR no
 * haya demostrado que carga (verificación offscreen), se sigue devolviendo
 * el póster base. Si la verificación falla o caduca, se conserva el base.
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
  const [verifiedUrl, setVerifiedUrl] = useState<string | null>(null);

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

  const targetUrl = enabled && effectiveImdb
    ? applyBetterPosterToUrl(basePosterUrl, effectiveImdb, settings, overrides)
    : basePosterUrl;
  // Solo el upgrade TMDB→BTTTR pasa por verificación. Si la base ya es BTTTR
  // (URLs horneadas por normalize* para ids tt) se conserva el flujo actual:
  // mostrarla y dejar el fallback al llamador vía `original`.
  const needsVerify = Boolean(
    targetUrl && basePosterUrl && targetUrl !== basePosterUrl
    && !isBetterPosterUrl(basePosterUrl) && isBetterPosterUrl(targetUrl),
  );

  useEffect(() => {
    if (!needsVerify || !targetUrl) {
      setVerifiedUrl(null);
      return;
    }
    let cancelled = false;
    setVerifiedUrl(current => (current === targetUrl ? current : null));
    void verifyBetterPosterUrl(targetUrl).then(ok => {
      if (!cancelled && ok) setVerifiedUrl(targetUrl);
    });
    return () => { cancelled = true; };
  }, [needsVerify, targetUrl]);

  if (!enabled || !effectiveImdb) {
    return { url: basePosterUrl, original: undefined, pending: resolving };
  }
  if (needsVerify && targetUrl) {
    if (verifiedUrl === targetUrl) {
      return { url: targetUrl, original: basePosterUrl, pending: false };
    }
    return { url: basePosterUrl, original: undefined, pending: true };
  }
  const url = targetUrl;
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
