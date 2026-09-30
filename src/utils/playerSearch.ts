import type { StreamQuery } from "../types/stream.ts";

function readNonNegativeInt(raw: string | null): number | undefined {
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readPositiveInt(raw: string | null): number | undefined {
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Arma el search del reproductor.
 *
 * El query resuelto manda sobre los search params porque el componente Episodie
 * se renderiza embebido dentro de Detail, donde la URL es `/detail/:type/:id` y
 * no lleva search params. Leyendo solo los params, el reproductor quedaba sin
 * `type`/`id` y todo lo que se apoya en la identidad del titulo (streams,
 * continuacion, Seekr) se caia.
 */
export function buildPlayerSearch(params: URLSearchParams, query: StreamQuery | null) {
  const next = new URLSearchParams();
  const resolvedType = query?.type ?? params.get("type");
  const resolvedId = query?.id ?? params.get("id");
  if (resolvedType) next.set("type", resolvedType);
  if (resolvedId) next.set("id", resolvedId);
  const resolvedSeason = query?.season ?? readNonNegativeInt(params.get("season"));
  const resolvedEpisode = query?.episode ?? readPositiveInt(params.get("ep"));
  if (resolvedSeason != null) next.set("season", String(resolvedSeason));
  if (resolvedEpisode != null) next.set("ep", String(resolvedEpisode));
  for (const key of ["fromSearch", "q"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
}
