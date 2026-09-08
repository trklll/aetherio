import type { CatalogRowData, MediaItem } from "../types/ui.ts";

/**
 * Dedupe central de filas anime por mal_id/clave. Sin red de seguridad, las
 * filas tardías se quedaban casi vacías: cuando AniList/Jikan caen, todas
 * usan fallbacks TMDB casi idénticos (p. ej. recomendaciones y favoritas
 * pedían lo mismo) y el dedupe dejaba 2 items en "Las más queridas".
 * Ahora cada fila conserva un mínimo rellenando con duplicados antes que
 * quedarse vacía.
 */
export const ANIME_ROW_MIN_ITEMS = 10;

export interface AnimeRowInput {
  entry: { id: string; title: string; order: number };
  items: MediaItem[];
}

export function dedupeAnimeHomeRows(
  allResults: AnimeRowInput[],
  minPerRow = ANIME_ROW_MIN_ITEMS,
): CatalogRowData[] {
  const seenMalIds = new Set<number>();
  const seenKeys = new Set<string>();
  const rows: CatalogRowData[] = [];
  for (const { entry, items } of allResults) {
    const deduped: MediaItem[] = [];
    const deferred: MediaItem[] = [];
    for (const item of items) {
      const malId = (item as MediaItem & { _malId?: number })._malId;
      const itemKey = `${item.type}:${item.id}`;
      if (seenKeys.has(itemKey) || (malId != null && seenMalIds.has(malId))) {
        deferred.push(item);
        continue;
      }
      seenKeys.add(itemKey);
      if (malId != null) seenMalIds.add(malId);
      deduped.push(item);
    }
    // Rellenar hasta el mínimo con duplicados: una fila con 10 (aunque
    // algunos se repitan en otras) sirve; una fila con 2, no.
    for (const item of deferred) {
      if (deduped.length >= minPerRow) break;
      const malId = (item as MediaItem & { _malId?: number })._malId;
      seenKeys.add(`${item.type}:${item.id}`);
      if (malId != null) seenMalIds.add(malId);
      deduped.push(item);
    }
    if (!deduped.length) continue;
    rows.push({
      addonId: "aetherio-starter",
      addonName: "Aetherio",
      catalogId: entry.id,
      type: "anime",
      name: entry.title,
      subtitle: "Actualizado con TMDB",
      items: deduped,
      order: entry.order,
    } satisfies CatalogRowData);
  }
  return rows;
}
