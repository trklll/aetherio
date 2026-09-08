import { describe, expect, it } from "vitest";
import { ANIME_ROW_MIN_ITEMS, dedupeAnimeHomeRows } from "./animeRows";
import type { MediaItem } from "../types/ui";

function item(id: string, name: string, malId?: number): MediaItem {
  return {
    id,
    type: "anime",
    name,
    ...(malId != null ? { _malId: malId } : {}),
  } as MediaItem;
}

function entry(id: string, title: string, order: number, items: MediaItem[]) {
  return { entry: { id, title, order }, items };
}

describe("dedupeAnimeHomeRows", () => {
  it("elimina duplicados exactos entre filas sin hambrear", () => {
    const rows = dedupeAnimeHomeRows([
      entry("a", "A", 1, [item("tmdb:1", "Naruto", 20), item("tmdb:2", "Bleach", 21)]),
      entry("b", "B", 2, [item("tmdb:2", "Bleach", 21), item("tmdb:3", "One Piece", 22)]),
    ]);
    expect(rows).toHaveLength(2);
    // B conserva One Piece + rellena con el duplicado hasta el mínimo.
    expect(rows[1].items.map(i => i.id)).toContain("tmdb:3");
    expect(rows[1].items.length).toBeGreaterThanOrEqual(ANIME_ROW_MIN_ITEMS - 8);
  });

  it("una fila totalmente solapada conserva el mínimo con relleno", () => {
    const shared = Array.from({ length: 20 }, (_, i) => item(`tmdb:${i}`, `Anime ${i}`, 100 + i));
    const rows = dedupeAnimeHomeRows([
      entry("a", "A", 1, shared),
      entry("b", "B", 2, [...shared]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].items).toHaveLength(20);
    // Antes: 0 items (fila fantasma de 2 en la app real). Ahora: mínimo.
    expect(rows[1].items.length).toBeGreaterThanOrEqual(ANIME_ROW_MIN_ITEMS);
  });

  it("respeta el orden de entrada y no inventa contenido si hay poco", () => {
    const rows = dedupeAnimeHomeRows([
      entry("b", "B", 1, [item("tmdb:9", "Solo", 99)]),
      entry("a", "A", 2, [item("tmdb:9", "Solo", 99)]),
    ]);
    // B va primero y se queda el item; A lo rellena como duplicado.
    expect(rows[0].catalogId).toBe("b");
    expect(rows[1].items).toHaveLength(1);
  });

  it("omite filas que quedan vacías de verdad", () => {
    const rows = dedupeAnimeHomeRows([
      entry("a", "A", 1, [item("tmdb:1", "X", 1)]),
      entry("b", "B", 2, []),
    ]);
    expect(rows.map(r => r.catalogId)).toEqual(["a"]);
  });
});
