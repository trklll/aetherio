import { afterEach, describe, expect, it, vi } from "vitest";
import { sportsAddonResponse } from "./sportsAddonProxy.ts";

describe("sports add-on proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes a known sports add-on and marks its payload as sports-only", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://sports.highfly.to/manifest.json");
      return Response.json({ id: "community.sports.fly", types: ["sport"] });
    });
    vi.stubGlobal("fetch", upstream);

    const env = { PROVIDERS: { get: async () => null } } as unknown as import("./types.ts").Env;
    const response = await sportsAddonResponse(new Request("https://hub.example/api/sports/addons/sports-streams/manifest.json"), env, "/api/sports/addons/sports-streams/manifest.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ domain: "sports", provider: "sports-streams", payload: { id: "community.sports.fly", types: ["sport"] } });
  });

  it("does not accept arbitrary hosts or non-GET methods", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const env = { PROVIDERS: { get: async () => null } } as unknown as import("./types.ts").Env;
    const invalid = await sportsAddonResponse(new Request("https://hub.example/api/sports/addons/evil/manifest.json"), env, "/api/sports/addons/evil/manifest.json");
    const method = await sportsAddonResponse(new Request("https://hub.example/api/sports/addons/nuvio/manifest.json", { method: "POST" }), env, "/api/sports/addons/nuvio/manifest.json");
    expect(invalid.status).toBe(404);
    expect(method.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
});
