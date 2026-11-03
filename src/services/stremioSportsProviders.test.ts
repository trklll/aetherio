import { afterEach, expect, it, vi } from "vitest";
import { fetchCatalogMetas, fetchManifest } from "../types/stremioSports.ts";
import { getLiveSportsProvider } from "./liveSportsService.ts";
import { probeStremioSportsProvider } from "./stremioSportsProviders.ts";

vi.mock("../types/stremioSports.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../types/stremioSports.ts")>(),
  fetchCatalogMetas: vi.fn(),
  fetchManifest: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

it("loads football and MMA agenda lanes together and sorts before applying the cap", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  let finishFootball!: (value: never[]) => void;
  const mma = { id: "ufc", name: "UFC Main Card", genres: ["MMA"], released: "2099-01-01T18:00:00Z" };
  vi.mocked(fetchCatalogMetas).mockImplementation((_base, _type, _catalog, extras) => extras?.genre === "football"
    ? new Promise(resolve => { finishFootball = resolve; })
    : Promise.resolve([mma]));
  const pending = getLiveSportsProvider("nuvio-sports")!.fetchUpcoming!();
  try {
    await vi.waitFor(() => expect(fetchCatalogMetas).toHaveBeenCalledTimes(2));
  } finally {
    finishFootball([]);
  }
  expect((await pending).map(event => event.id)).toContain("nuvio:ufc");
});

it("displays Sports while keeping upstream protocol and provider identifiers", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.mocked(fetchManifest).mockResolvedValueOnce({ id: "community.nuvio.live-sports", name: "🏆 Nuvio Live Sports", version: "3.1.3" });
  expect(getLiveSportsProvider("nuvio-sports")?.label).toBe("Sports");
  expect(await probeStremioSportsProvider("nuvio")).toMatchObject({ name: "Sports", version: "3.1.3", ok: true });
});
