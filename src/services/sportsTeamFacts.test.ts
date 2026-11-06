import { afterEach, expect, it, vi } from "vitest";
import { loadTeamClubFacts } from "./sportsTeamFacts";
vi.mock("../runtime/platform", () => ({ isTauriRuntime: () => false, invokeCommand: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

it("uses explicit Wikidata identity, ignores deprecated facts and resolves stadium labels", async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("Q50602.json") ? { entities: { Q50602: { claims: { P571: [{ rank: "deprecated", mainsnak: { datavalue: { value: { time: "+1800-01-01T00:00:00Z", precision: 9 } } } }, { rank: "preferred", mainsnak: { datavalue: { value: { time: "+1880-01-01T00:00:00Z", precision: 9 } } } }], P115: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q123" } } } }], P856: [{ mainsnak: { datavalue: { value: "javascript:alert(1)" } } }] } } } } : { entities: { Q123: { labels: { es: { value: "Estadio de prueba" }, en: { value: "Test Stadium" } } } } })));
  vi.stubGlobal("fetch", fetch);
  const result = await loadTeamClubFacts("club:man-city");
  expect(result).toMatchObject({ wikidataId: "Q50602", founded: "1880", stadium: "Estadio de prueba", website: undefined });
  expect(fetch.mock.calls[0][0]).not.toContain("search");
});
it("unknown teams never get an automatic potentially wrong Wikidata match", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await loadTeamClubFacts("club:unknown")).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});
