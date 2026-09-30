/**
 * Coincidencia de nombres de persona para la búsqueda.
 *
 * Existe porque `/search/person` de TMDB hace coincidencia difusa y devuelve
 * homónimos que nadie pidió: buscando "nnn" salen "Nnn" y "st4nn", y buscando
 * un nombre escrito a medias ("inde navar") no sale la persona que sí es.
 * Aquí se decide qué devoluciones son de fiar, en vez de fiarse del orden de
 * TMDB.
 */

import { damerauLevenshtein } from "./searchProviders";

/**
 * Listón de popularidad para que una persona llegue a "Top resultados". El
 * nombre puede coincidir palabra por palabra con la query y aun así ser un
 * homónimo que nadie ha oído de ("Nnn" para "nnn"): la popularity de TMDB
 * separa a un actor real de eso sin pedirle nada extra al usuario.
 *
 * Valor conservador a propósito: subirlo deja fuera a-Quien (actores poco
 * conocidos), bajarlo deja entrar ruido. La tab de reparto NO usa este listón
 * (allí la lista completa sí tiene sentido), solo la tarjeta de Top resultados.
 */
export const TOP_MATCH_POPULARITY = 5;

/** Normaliza igual que la búsqueda: sin acentos, minúsculas, sin espacios extra. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * ¿Un token de la query "cubre" un token del nombre? Tres vías, de la más
 * estricta a la más tolerante:
 *
 *  1. Igualdad exacta.
 *  2. Prefijo: "navar" cubre "navarrete". Es la vía que más importa, porque
 *     escribir un nombre a medias es lo natural con un teclado de TV, y la
 *     búsqueda de títulos resuelve el caso con `tier`, no con distancia de
 *     edición (a "navar" le sobran 4 letras y la distancia lo castiga).
 *     Exige 3 letras para que "an" no valide media lista.
 *  3. Un typo: "navarrette" → "navarrete". Solo con tokens de 6+ letras, que es
 *     donde un error de tecleo se distingue de un nombre realmente distinto: a
 *     5 letras, 1 edit ya convierte "hanks" en "banks".
 */
function nameTokenCovers(queryToken: string, nameToken: string): boolean {
  if (queryToken === nameToken) return true;
  const shortest = Math.min(queryToken.length, nameToken.length);
  const longest = Math.max(queryToken.length, nameToken.length);
  if (shortest >= 3 && (nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken))) return true;
  if (longest >= 6) return damerauLevenshtein(queryToken, nameToken) <= 1;
  return false;
}

/**
 * ¿El nombre de esta persona es realmente el que se buscó? Cada token de la
 * query tiene que estar cubierto por algún token del nombre; da igual que la
 * query sea un prefijo del nombre ("inde navar" → "Inde Navarrete"), al revés
 * ("navarrete" a secas) o que lleve un typo.
 *
 * Rechaza los homónimos difusos de TMDB: "st4nn" no cubre "nnn" porque no
 * comparte prefijo y está a 3 edits.
 */
export function isNameMatch(name: string, query: string): boolean {
  const nameTokens = normalizeName(name).split(" ").filter(Boolean);
  const queryTokens = normalizeName(query).split(" ").filter(Boolean);
  if (!nameTokens.length || !queryTokens.length) return false;
  return queryTokens.every(queryToken =>
    nameTokens.some(nameToken => nameTokenCovers(queryToken, nameToken)),
  );
}

export interface NameMatchCandidate {
  name: string;
  popularity?: number;
}

/**
 * La persona que la query nombraba, o null. Devuelve la de mayor coincidencia
 * que además supere el listón de popularidad, para que un homónimo desconocido
 * no ocupe la primera posición de la búsqueda.
 */
export function pickTopNameMatch<T extends NameMatchCandidate>(
  candidates: readonly T[],
  query: string,
  minPopularity = TOP_MATCH_POPULARITY,
): T | null {
  return (
    candidates.find(candidate => isNameMatch(candidate.name, query) && (candidate.popularity ?? 0) >= minPopularity) ??
    null
  );
}
