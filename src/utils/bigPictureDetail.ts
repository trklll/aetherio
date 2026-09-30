/**
 * Navegación al detalle consciente del modo picture.
 *
 * La page detail de Big Picture es EXACTAMENTE la misma UI de PC
 * (mismo componente DetailPage), solo cambia el chrome: sidebar
 * (BigPictureRail) en vez de topnav bar (AppShell/TopNav).
 *
 * Por eso todas las navegaciones a `/detail/...` deben preservar el
 * contexto: dentro de `/big-picture` van a `/big-picture/detail/...`,
 * fuera siguen a `/detail/...`.
 */

export function isBigPictureLocation(pathname?: string): boolean {
  try {
    const path =
      pathname ??
      (typeof window !== "undefined" ? window.location.pathname : "");
    return path.startsWith("/big-picture");
  } catch {
    return false;
  }
}

export function buildDetailPath(
  type: string,
  id: string | number,
  search?: string,
  pathname?: string,
): string {
  const base = isBigPictureLocation(pathname)
    ? `/big-picture/detail/${encodeURIComponent(type)}/${encodeURIComponent(String(id))}`
    : `/detail/${encodeURIComponent(type)}/${encodeURIComponent(String(id))}`;
  return search ? `${base}?${search}` : base;
}

export function buildEpisodePath(search?: string, pathname?: string): string {
  const base = isBigPictureLocation(pathname) ? "/big-picture/episode" : "/episode";
  return search ? `${base}?${search}` : base;
}

export function buildPlayerPath(search?: string, pathname?: string): string {
  const base = isBigPictureLocation(pathname) ? "/big-picture/player" : "/player";
  return search ? `${base}?${search}` : base;
}

/**
 * Destino de "atrás" desde el reproductor.
 *
 * Un único lugar decide a dónde lleva el gesto: la page de Episodie del mismo
 * medio (el picker de fuentes), nunca la ficha. Antes cada superficie lo
 * resolvía por su cuenta —el shell iba a `/episode`, el Player a la ficha y
 * Big Picture a `navigate(-1)`— y en la pantalla de carga eso acababa en la
 * page detail.
 *
 * `fromPlayer=1` viaja siempre: Episodie lo lee como `returnedFromPlayer` y
 * desactiva el auto-resolve, así que el picker aparece en vez de volver a
 * lanzar la reproducción automáticamente.
 */
export function buildPlayerBackPath(search: string, pathname?: string): string | null {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const id = params.get("id");
  if (!type || !id) return null;
  const next = new URLSearchParams({ type, id });
  for (const key of ["season", "ep", "epTitle", "fromSearch", "q"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  next.set("fromPlayer", "1");
  return buildEpisodePath(next.toString(), pathname);
}

export function buildPersonPath(id: string | number, pathname?: string): string {
  const base = isBigPictureLocation(pathname)
    ? `/big-picture/person/${encodeURIComponent(String(id))}`
    : `/person/${encodeURIComponent(String(id))}`;
  return base;
}

export function buildEntityPath(
  kind: string,
  id: string | number,
  pathname?: string,
): string {
  const base = isBigPictureLocation(pathname)
    ? `/big-picture/entity/${encodeURIComponent(kind)}/${encodeURIComponent(String(id))}`
    : `/entity/${encodeURIComponent(kind)}/${encodeURIComponent(String(id))}`;
  return base;
}

export function buildHomePath(pathname?: string): string {
  return isBigPictureLocation(pathname) ? "/big-picture" : "/home";
}

/**
 * El tipo puede enriquecerse después de cargar TMDB (por ejemplo, movie ->
 * anime). El ID sigue siendo la identidad estable del detalle.
 */
export function detailDataMatchesRoute(
  data: { id?: string; type?: string } | null | undefined,
  routeId?: string,
): boolean {
  return Boolean(data?.id && routeId && data.id === routeId);
}

export interface BigPictureDetailParams {
  type: string;
  id: string;
  section?: string;
}

/**
 * Parsea `/big-picture/detail/:type/:id(/:section)`.
 * El id puede contener `:` (tmdb:, mal:, etc.) e incluso `/` codificado,
 * así que se reconstruye a partir de los segmentos restantes.
 */
export function parseBigPictureDetail(
  pathname: string,
): BigPictureDetailParams | null {
  const prefix = "/big-picture/detail/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).split("/").filter(Boolean);
  if (rest.length < 2) return null;
  try {
    const type = decodeURIComponent(rest[0]);
    const section =
      rest.length > 2 ? decodeURIComponent(rest[rest.length - 1]) : undefined;
    const idSegments = section ? rest.slice(1, -1) : rest.slice(1);
    const id = idSegments.map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    }).join("/");
    if (!type || !id) return null;
    return section ? { type, id, section } : { type, id };
  } catch {
    return null;
  }
}
