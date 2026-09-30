/**
 * Calculo del destino de "atras" en la page detail.
 *
 * Vive aqui (y no en AppShell) porque es logica pura y hay que poder
 * coverla con tests: el fallo que corrigio esto no se reproduce a ojo.
 */

export function makeScrollKey(pathname: string, search: string) {
  if (pathname === "/settings") return pathname;
  return `${pathname}${search}`;
}

/** Rutas intermedias del flujo de reproduccion: no son un "origen" valido. */
function isPlaybackRoute(pathname: string) {
  return pathname === "/episode" || pathname === "/streams" || pathname === "/player";
}

/**
 * Cuantas entradas hay que retroceder desde el detail para llegar a la pagina de
 * la que se salio (buscador, home, catalogo, biblioteca...).
 *
 * La comparacion es SOLO por pathname, sin query string, y es deliberado:
 * volver a `/detail/movie/589?fromStreams=1` desde
 * `/detail/movie/589?fromSearch=1` es la misma pantalla con otro parametro, asi
 * que para el usuario no es un retroceso, es un no-op. Ese caso aparece al
 * volver del reproductor, que reescribe su entrada con `replace: true`.
 * Comparando ruta completa, esa entrada se tomaba por un destino valido y el
 * boton atras parecia no hacer nada.
 *
 * Detail -> Detail de otra obra sigue funcionando: cambia el id, luego cambia
 * el pathname, y eso si cuenta como origen.
 */
export function findDetailReturnDelta(
  history: Map<number, string>,
  currentIndex: number,
  currentPath: string,
) {
  const currentPathname = currentPath.split("?")[0] ?? "";
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = history.get(index);
    if (!candidate) continue;
    const pathname = candidate.split("?")[0];
    if (!pathname) continue;
    if (isPlaybackRoute(pathname)) continue;
    if (pathname === currentPathname) continue;
    return index - currentIndex;
  }
  return null;
}
