import assert from "node:assert/strict";
import test from "node:test";
import { rankEntityRows, type EntityPopularityCandidate } from "./entityRanking.ts";

function item(id: string, popularity: number, voteCount = 0, sourceIndex = 0): EntityPopularityCandidate {
  return { id, popularity, voteCount, voteAverage: 7, sourceIndex };
}

test("places the row with stronger sustained popularity first", () => {
  const rows = rankEntityRows([
    { title: "Películas", items: [item("movie-1", 82, 1200, 0), item("movie-2", 70, 900, 1), item("movie-3", 58, 800, 2)] },
    { title: "Series", items: [item("series-1", 42, 500, 0), item("series-2", 35, 400, 1), item("series-3", 28, 300, 2)] },
  ]);
  assert.equal(rows[0].title, "Películas");
});

test("can place series first when its catalog is stronger", () => {
  const rows = rankEntityRows([
    { title: "Películas", items: [item("movie-1", 22, 300, 0), item("movie-2", 18, 200, 1)] },
    { title: "Series", items: [item("series-1", 72, 900, 0), item("series-2", 65, 700, 1)] },
  ]);
  assert.equal(rows[0].title, "Series");
});

test("protects a broad catalog from one isolated viral outlier", () => {
  const rows = rankEntityRows([
    { title: "Películas", items: [item("movie-viral", 1000, 10000, 0), ...Array.from({ length: 9 }, (_, index) => item(`movie-${index}`, 1, 10, index + 1))] },
    { title: "Series", items: Array.from({ length: 10 }, (_, index) => item(`series-${index}`, 140, 1200, index)) },
  ]);
  assert.equal(rows[0].title, "Series");
});

test("keeps missing metrics and ties deterministic", () => {
  const rows = rankEntityRows([
    { title: "First", items: [{ id: "a", sourceIndex: 0 }, { id: "b", sourceIndex: 1 }] },
    { title: "Second", items: [] },
  ]);
  assert.deepEqual(rows[0].items.map(candidate => candidate.id), ["a", "b"]);
  assert.equal(rows[1].title, "Second");
});
