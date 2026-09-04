/**
 * Filas con formato top (números grandes 1-10). El número ya indica el puesto,
 * así que sus pósters van sin badges de tendencia y nunca deben quedar dos
 * seguidas.
 */

const RANKED_CATALOG_IDS = new Set([
  "tmdb.trending_movie",
  "tmdb.trending_series",
  "mal.top_anime",
  "jikan.top_movies",
  "mal.last_year_best",
]);

export function isTopFormatRow(row: Pick<{ catalogId: string; name: string }, "catalogId" | "name">): boolean {
  if (RANKED_CATALOG_IDS.has(row.catalogId)) return true;
  const name = row.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return name.includes("trending") || name.includes("tendencia") || name.startsWith("top ");
}

/**
 * Reordena de forma estable para que nunca haya dos filas top adyacentes: la
 * segunda top consecutiva se desplaza tras la siguiente fila normal.
 */
export function separateTopRows<T extends { catalogId: string; name: string }>(rows: T[]): T[] {
  const out = [...rows];
  for (let index = 1; index < out.length; index += 1) {
    if (!isTopFormatRow(out[index]) || !isTopFormatRow(out[index - 1])) continue;
    const nextNormal = out.findIndex((row, position) => position > index && !isTopFormatRow(row));
    if (nextNormal === -1) break;
    const [moved] = out.splice(index, 1);
    // Tras quitar `index`, la fila normal queda en nextNormal - 1: insertar después.
    out.splice(nextNormal, 0, moved);
    // Reevaluar el mismo índice: la fila que se desplazó puede ser otro top.
    index -= 1;
  }
  return out;
}
