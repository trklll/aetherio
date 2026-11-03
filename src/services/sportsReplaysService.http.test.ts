import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchCatalogMetas } from "../types/stremioSports.ts";
import { fetchSportsReplaysPage } from "./sportsReplaysService.ts";

const { selectedBase } = vi.hoisted(() => ({ selectedBase: vi.fn() }));
vi.mock("./stremioSportsProviders.ts", () => ({ nuvioSportsBaseUrl: selectedBase }));
vi.mock("./nuvioSportsRuntime.ts", async importOriginal => ({
  ...await importOriginal<typeof import("./nuvioSportsRuntime.ts")>(),
  ensureLocalNuvioSportsServer: vi.fn(async () => {}),
  readNuvioSportsMode: () => "remote",
}));

describe("replay catalog HTTP routing", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url!, "http://localhost");
      const stream = /^\/([^/]+)\/stream\/tv\/([^/]+)\.json$/.exec(url.pathname);
      if (stream) {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          streams: [{ name: "Replay source", url: `https://sports.test/${stream[2]}.mp4` }],
        }));
        return;
      }
      // The plugin/SDK route accepts exactly ONE :extra segment. A slash
      // between genre and skip is a real 404, even if both strings are present.
      const route = /^\/([^/]+)\/catalog\/tv\/nuvio_sports_catalog\/([^/]+)\.json$/.exec(url.pathname);
      if (!route) { response.writeHead(404).end("Catalog route not found"); return; }
      const config = JSON.parse(decodeURIComponent(route[1]));
      const extras = new URLSearchParams(route[2]);
      if (config.sports !== "all" || extras.get("genre") !== "Replays") {
        response.writeHead(400).end("Invalid replay request"); return;
      }
      const skip = Number(extras.get("skip"));
      const metas = Array.from({ length: Math.max(0, Math.min(100, 205 - skip)) }, (_, index) => ({
        id: `archive-${skip + index}`, type: "tv", name: `Replay ${skip + index}`, genres: ["BASKETBALL"],
      }));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ metas }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    selectedBase.mockReturnValue(origin);
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });

  it.each([[0, 100, true], [100, 100, true], [200, 5, false]] as const)(
    "loads offset %i and resolves replay sources through HTTP",
    async (skip, count, hasMore) => {
      const page = await fetchSportsReplaysPage(skip);
      expect(page.items).toHaveLength(count);
      expect(page.items[0].requestId).toBe(`archive-${skip}`);
      expect(page.hasMore).toBe(hasMore);
    },
  );

  it("uses the same valid route for the shared sports catalog client", async () => {
    const config = encodeURIComponent(JSON.stringify({ sports: "all" }));
    const metas = await fetchCatalogMetas(`${origin}/${config}`, "tv", "nuvio_sports_catalog", { genre: "Replays", skip: "100" });
    expect(metas).toHaveLength(100);
    expect(metas[0].id).toBe("archive-100");
  });
});
