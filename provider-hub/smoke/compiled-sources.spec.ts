import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live smoke uses the already compiled Worker modules, never request-time codegen", async ({ request }) => {
  const headers = { "x-admin-token": "local-e2e-only-not-a-production-secret" };
  const health = await (await request.get("/health")).json();
  expect(health.warmup.failed).toEqual([]);
  expect(health.warmup.compiled).toContain("animeav1");
  const results = [];
  for (const [id, title] of [["animeav1", "Sousou no Frieren"], ["jkanime", "Sousou no Frieren"], ["latanime-online-provider", "Shingeki no Kyojin"], ["subsplease-provider", "Sousou no Frieren"]]) {
    const saved = await request.put(`/admin/providers/${id}`, { headers, data: { name: id, enabled: true, supportedTypes: ["tv"] } });
    expect(saved.ok()).toBe(true);
    const response = await request.post("/admin/test", { headers, data: { id, tmdbId: 1, type: "tv", season: 1, episode: 1, title } });
    const body = await response.json();
    results.push({ id, status: response.status(), ...body });
  }
  const directory = resolve("output/seanime");
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/live-worker-smoke.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(results.map(result => `${result.id}: HTTP ${result.status}, streams=${result.streamCount ?? "error"}`).join("\n"));
  expect(results[0].status).toBe(200);
  expect(results[0].streamCount).toBeGreaterThan(0);
});
