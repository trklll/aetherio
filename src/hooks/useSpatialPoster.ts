import { useEffect, useState } from "react";
import {
  applySpatialPosterToUrl,
  extractTmdbId,
  isSpatialPosterUrl,
  isSpatialPostersConfigured,
  spatialPosterSignature,
  useSpatialPosterSettings,
  type SpatialPosterOverrides,
  type SpatialPosterSettings,
} from "../config/spatialPosters.ts";
import {
  getReadyPosterArtwork,
  isPosterArtworkFailed,
  preloadPosterArtwork,
} from "../services/posterArtworkCache.ts";

export interface ResolvedPoster {
  /** URL a mostrar (SpatialPosters cuando está configurado, si no la base). */
  url?: string;
  /** Póster original para fallback si la URL de SpatialPosters falla. */
  original?: string;
  /** La verificación offscreen está en curso (se muestra la base mientras tanto). */
  pending: boolean;
}

/**
 * Resuelve el póster de SpatialPosters para un item.
 *
 * A diferencia de BetterPosters, aquí **no hay resolución async**: SpatialPosters
 * direcciona por ID TMDB, que es el identificador nativo de Aetherio. Eso
 * elimina por completo la capa TMDB→IMDb y hace que la URL objetivo esté
 * disponible de inmediato.
 *
 * El upgrade nunca se muestra en negro: mientras la URL de SpatialPosters no
 * haya demostrado que carga (verificación offscreen) se sigue devolviendo el
 * póster base. Si la verificación falla, se conserva el base.
 */
export function useSpatialPoster(
  mediaId: string,
  mediaType: string,
  basePosterUrl: string | undefined,
  disabled = false,
  overrides?: SpatialPosterOverrides,
  fallbackPoster?: string,
): ResolvedPoster {
  const settings = useSpatialPosterSettings();
  const rankingOverride = overrides?.rankingBadges;
  const signature = `${spatialPosterSignature(settings)}|rank:${rankingOverride ?? "auto"}`;
  const [verification, setVerification] = useState<{ url: string; ok: boolean } | null>(null);

  const enabled = isSpatialPostersConfigured(settings) && !disabled;
  const tmdbId = enabled ? extractTmdbId(mediaId) : null;

  const targetUrl = enabled && tmdbId
    ? applySpatialPosterToUrl(basePosterUrl, tmdbId, mediaType, settings, overrides)
    : basePosterUrl;
  const isSpatial = isSpatialPosterUrl(targetUrl);
  const readyTarget = targetUrl ? getReadyPosterArtwork(targetUrl, settings, signature) : undefined;
  const failedTarget = Boolean(targetUrl && isSpatial && isPosterArtworkFailed(targetUrl, settings, signature));
  const fallback = fallbackPoster ?? (isSpatialPosterUrl(basePosterUrl) ? undefined : basePosterUrl);

  useEffect(() => {
    if (!targetUrl || !isSpatial || readyTarget || failedTarget || verification?.url === targetUrl) return;
    let cancelled = false;
    void preloadPosterArtwork(targetUrl, settings, signature).then(result => {
      if (!cancelled) setVerification({ url: targetUrl, ok: Boolean(result) });
    });
    return () => { cancelled = true; };
  }, [failedTarget, isSpatial, readyTarget, settings, signature, targetUrl, verification?.url]);

  if (!enabled || !tmdbId || !isSpatial) {
    return { url: basePosterUrl, original: undefined, pending: false };
  }
  if (targetUrl) {
    if (readyTarget || (verification?.url === targetUrl && verification.ok)) {
      return { url: targetUrl, original: basePosterUrl, pending: false };
    }
    if (failedTarget || (verification?.url === targetUrl && !verification.ok)) {
      return { url: fallback, original: undefined, pending: false };
    }
    return {
      url: isSpatialPosterUrl(basePosterUrl) ? fallback : basePosterUrl,
      original: undefined,
      pending: true,
    };
  }
  return { url: basePosterUrl, original: undefined, pending: false };
}

/** Variante síncrona para lugares sin hooks (p. ej. resolve de tarjetas). */
export function resolveSpatialPosterSync(
  mediaId?: string | null,
  mediaType?: string,
  basePosterUrl?: string,
  settings?: SpatialPosterSettings,
): string | undefined {
  const tmdbId = extractTmdbId(mediaId);
  if (!tmdbId) return basePosterUrl;
  return applySpatialPosterToUrl(basePosterUrl, tmdbId, mediaType, settings);
}
