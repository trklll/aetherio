import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./assets/admin.html.txt", () => ({ default: "<main>Directorio de proveedores</main>" }));
vi.mock("./assets/admin.css.txt", () => ({ default: "body { color: white; }" }));
vi.mock("./assets/admin.js.txt", () => ({ default: "const adminUiLoaded = true;" }));
vi.mock("./builtinScripts.ts", () => ({
  builtinScriptSources: new Map(),
  GENERATED_PROVIDER_SCRIPTS: [],
  PROVIDER_DEPS_SOURCE: "",
}));

import worker from "./index.ts";
import type { Env } from "./types.ts";
import { DEFAULT_ADDONS } from "./addons.ts";
import * as sandbox from "./sandbox.ts";

const TOKEN = "test-admin-token";

function createEnv() {
  const data = new Map<string, string>();
  const PROVIDERS = {
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
  return { env: { ADMIN_TOKEN: TOKEN, PROVIDERS } as unknown as Env, data };
}

async function request(
  env: Env,
  pathname: string,
  init: RequestInit = {},
  token = TOKEN,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("x-admin-token", token);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return worker.fetch(
    new Request(`https://hub.example${pathname}`, { ...init, headers }),
    env,
    {} as ExecutionContext,
  );
}

describe("Provider Hub administration panel", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("serves the panel and same-origin assets with restrictive security headers", async () => {
    const { env } = createEnv();
    const page = await request(env, "/admin", { method: "GET" }, "");
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain("Directorio de proveedores");

    const script = await request(env, "/admin/assets/admin.js", { method: "GET" }, "");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    const scriptText = await script.text();
    expect(scriptText).toContain("adminUiLoaded");
    expect(scriptText).not.toContain("sessionStorage");
    expect(scriptText).not.toContain("localStorage");
  });

  it("separates sports add-ons from the general movie/series/anime directory", async () => {
    const { env } = createEnv();
    const general = await (await request(env, "/addons.json", {}, "")).json() as { domain: string; addons: Array<{ id: string }> };
    const sports = await (await request(env, "/sports-addons.json", {}, "")).json() as { domain: string; addons: Array<{ id: string }> };
    expect(general.domain).toBe("general");
    expect(general.addons.some(addon => addon.id === "community.sports.fly")).toBe(false);
    expect(sports.domain).toBe("sports");
    expect(sports.addons.map(addon => addon.id)).toEqual(["community.sports.fly", "community.nuvio.live-sports", "com.stremverse.org"]);
  });

  it("lets an administrator add a sports-domain Stremio add-on without leaking it into general catalogs", async () => {
    const { env } = createEnv();
    const saved = await request(env, "/admin/addons/org.example.sports", {
      method: "PUT",
      body: JSON.stringify({
        name: "Example Sports", domain: "sports", manifestUrl: "https://sports.example/manifest.json",
        manifestFallback: { id: "org.example.sports", name: "Example Sports", version: "1.0.0", types: ["sport"], resources: ["catalog", "stream"], catalogs: [] },
      }),
    });
    expect(saved.status).toBe(200);
    const general = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<{ id: string }> };
    const sports = await (await request(env, "/sports-addons.json", {}, "")).json() as { addons: Array<{ id: string; domain: string }> };
    expect(general.addons.some(addon => addon.id === "org.example.sports")).toBe(false);
    expect(sports.addons.find(addon => addon.id === "org.example.sports")?.domain).toBe("sports");
    expect((await request(env, "/admin/addons/org.example.invalid", { method: "PUT", body: JSON.stringify({ domain: "anime" }) })).status).toBe(400);
  });

  it("requires ADMIN_TOKEN for every management endpoint", async () => {
    const { env } = createEnv();
    const paths = ["/admin/providers", "/admin/test", "/admin/validate-script", "/admin/addons", "/admin/addons/example.addon/clone", "/admin/validate-addon"];
    for (const path of paths) {
      const response = await request(env, path, {
        method: path.endsWith("providers") ? "GET" : "POST",
        ...(path.endsWith("providers") ? {} : { body: "{}" }),
      }, "");
      expect(response.status).toBe(401);
    }
  });

  it("rejects unsafe script URLs without making an outbound request", async () => {
    const { env } = createEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(env, "/admin/validate-script", {
      method: "POST",
      body: JSON.stringify({ scriptUrl: "https://127.0.0.1/provider.js" }),
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms a public script response without compiling or storing its source", async () => {
    const { env, data } = createEnv();
    const source = "module.exports = { getStreams: async () => [] };";
    const fetchMock = vi.fn(async () => new Response(source, {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(env, "/admin/validate-script", {
      method: "POST",
      body: JSON.stringify({ scriptUrl: "https://cdn.example.org/provider.js" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, bytes: new TextEncoder().encode(source).byteLength });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.size).toBe(0);
  });

  it("validates a public script URL without following an unsafe redirect", async () => {
    const { env } = createEnv();
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private.js" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(env, "/admin/validate-script", {
      method: "POST",
      body: JSON.stringify({ scriptUrl: "https://cdn.example.org/provider.js" }),
    });
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.org/provider.js", expect.objectContaining({ redirect: "manual" }));
  });

  it("saves metadata and clears a previous script URL when switching to inline code", async () => {
    const { env } = createEnv();
    const initial = await request(env, "/admin/providers/test-source", {
      method: "PUT",
      body: JSON.stringify({
        name: "Test source",
        supportedTypes: ["movie"],
        enabled: true,
        scriptUrl: "https://cdn.example.org/source.js",
      }),
    });
    expect(initial.status).toBe(200);

    const changed = await request(env, "/admin/providers/test-source", {
      method: "PUT",
      body: JSON.stringify({
        name: "Test source edited",
        supportedTypes: ["movie"],
        enabled: true,
        clearScriptUrl: true,
        script: "module.exports = { getStreams: async () => [] };",
      }),
    });
    expect(changed.status).toBe(200);

    const directory = await request(env, "/admin/providers", { method: "GET" });
    const providers = await directory.json() as Array<Record<string, unknown>>;
    expect(providers).toContainEqual(expect.objectContaining({ id: "test-source", name: "Test source edited" }));
    expect(providers.find(provider => provider.id === "test-source")).not.toHaveProperty("scriptUrl");
    expect(await env.PROVIDERS.get("script:test-source")).toContain("getStreams");
  });

  it("will not dynamically compile or execute a script while testing a provider", async () => {
    const { env } = createEnv();
    const saved = await request(env, "/admin/providers/uncompiled", {
      method: "PUT",
      body: JSON.stringify({
        name: "Uncompiled source",
        supportedTypes: ["movie"],
        enabled: true,
        script: "throw new Error('must never execute in an admin request');",
      }),
    });
    expect(saved.status).toBe(200);

    const response = await request(env, "/admin/test", {
      method: "POST",
      body: JSON.stringify({ id: "uncompiled", type: "movie", tmdbId: 603, title: "The Matrix" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("no está compilado") });
  });

  it("reports compiled desktop torrents and header-requiring streams instead of hiding them as zero mobile results", async () => {
    const { env } = createEnv();
    await request(env, "/admin/providers/compiled-anime", { method: "PUT", body: JSON.stringify({ name: "Compiled Anime", enabled: true, supportedTypes: ["tv"] }) });
    vi.spyOn(sandbox, "compiledProviderInfo").mockReturnValue({ updatedAt: 0 });
    vi.spyOn(sandbox, "runProviderScript").mockResolvedValue([
      { name: "Original", url: "https://cdn.example/video.m3u8", headers: { Referer: "https://site.example/" } },
      { name: "Torrent", infoHash: "abcdef0123456789abcdef0123456789abcdef01", title: "Sample - 03" },
    ]);
    const response = await request(env, "/admin/test", { method: "POST", body: JSON.stringify({ id: "compiled-anime", type: "tv", tmdbId: 1, title: "Sample", season: 1, episode: 3 }) });
    expect(response.status).toBe(200);
    const result = await response.json() as { streamCount: number; streams: unknown[] };
    expect(result.streamCount).toBe(2);
    expect(result.streams).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "torrent", host: "BitTorrent" }), expect.objectContaining({ kind: "direct", host: "cdn.example" })]));
    expect(JSON.stringify(result)).not.toContain("abcdef0123456789");
    expect(JSON.stringify(result)).not.toContain("https://site.example");
  });

  it("lists the complete Stremio roster separately from script providers", async () => {
    const { env } = createEnv();
    const response = await request(env, "/admin/addons");
    expect(response.status).toBe(200);
    const addons = await response.json() as Array<Record<string, unknown>>;
    expect(addons.map(addon => addon.name)).toEqual([
      "AnimES", "Torrentio", "Cinemeta", "HdHub", "DeepFlix", "PenguPlay", "Sports Streams · Highfly", "Nuvio Sports", "StremVerse Sports",
    ]);
    expect(addons[0]).toMatchObject({
      id: "com.animeflv.stremio.addon", logo: "https://hub.example/addons/logos/animes.png",
    });
    expect(addons[1].description).not.toContain("AnimeAV1");
    expect(addons.find(addon => addon.id === "com.penguplay")).toMatchObject({
      manifestUrl: "/api/penguplay/manifest.json", hiddenInUi: true, streamAttempts: 2,
    });
  });

  it("does not publish a false filtered AnimeAV1 addon or informational alias", async () => {
    const { env } = createEnv();
    const admin = await (await request(env, "/admin/addons")).json() as Array<Record<string, unknown>>;
    expect(admin.filter(addon => addon.isAlias)).toHaveLength(0);
    const publicDirectory = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<Record<string, unknown>> };
    expect(publicDirectory.addons).toHaveLength(6);
    expect(publicDirectory.addons.find(addon => addon.id === "aetherio.source.animeav1")).toBeUndefined();
    expect(publicDirectory.addons.some(addon => addon.id === "aetherio.alias.animeav1")).toBe(false);
  });

  it("keeps broken marketplace sources visible in the desktop manifest without enabling them", async () => {
    const { env } = createEnv();
    await request(env, "/admin/providers/animeflv", { method: "PUT", body: JSON.stringify({
      name: "AnimeFLV", description: "Averiado en el marketplace; pendiente de reparación.",
      enabled: false, supportedTypes: ["movie", "tv"], contentLanguage: ["es"],
    }) });
    const response = await request(env, "/manifest.json", {}, "");
    expect(response.status).toBe(200);
    const manifest = await response.json() as { scrapers: Array<Record<string, unknown>> };
    expect(manifest.scrapers.find(source => source.id === "animeflv")).toMatchObject({
      name: "AnimeFLV", enabled: false, contentLanguage: ["es"],
      description: "Averiado en el marketplace; pendiente de reparación.",
    });
  });

  it("does not allow the informational AnimeAV1 row to be saved or deleted as an addon", async () => {
    const { env } = createEnv();
    const body = JSON.stringify({ name: "AnimeAV1", manifestUrl: "https://example.org/manifest.json" });
    expect((await request(env, "/admin/addons/aetherio.alias.animeav1", { method: "PUT", body })).status).toBe(400);
    expect((await request(env, "/admin/addons/aetherio.alias.animeav1", { method: "DELETE" })).status).toBe(400);
  });

  it("corrects the synthetic split once, preserving metadata and respecting later source removals", async () => {
    const { env, data } = createEnv();
    const legacy = DEFAULT_ADDONS.filter(addon => addon.id !== "aetherio.source.animeav1").map(addon => ({
      ...addon, ...(addon.id === "com.animeflv.stremio.addon" ? { name: "Mi AnimES", enabledByDefault: false } : {}), updatedAt: 42,
    }));
    const original = JSON.stringify({ version: 1, addons: legacy });
    data.set("addons:directory", original);
    const migrated = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<Record<string, unknown>> };
    expect(migrated.addons).toHaveLength(6);
    expect(migrated.addons.find(addon => addon.id === "com.animeflv.stremio.addon")).toMatchObject({ name: "Mi AnimES", enabledByDefault: false });
    expect(migrated.addons.find(addon => addon.id === "aetherio.source.animeav1")).toBeUndefined();
    expect(data.get("addons:directory")).toBe(original); // GET does not write to KV
    expect((await request(env, "/admin/addons/com.animeflv.stremio.addon", { method: "DELETE" })).status).toBe(200);
    const after = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<Record<string, unknown>> };
    expect(after.addons).toHaveLength(5);
    expect(after.addons.some(addon => addon.id === "aetherio.source.animeav1")).toBe(false);
    expect(JSON.parse(data.get("addons:directory")!).version).toBe(4);
    data.set("addons:directory", JSON.stringify({ version: 2, addons: [] }));
    expect(await (await request(env, "/addons.json", {}, "")).json()).toMatchObject({ addons: [] });
  });

  it("still supports user-defined logical partitions without applying one to AnimeAV1", async () => {
    const { env } = createEnv();
    const saved = await request(env, "/admin/addons/example.variant", {
      method: "PUT", body: JSON.stringify({ name: "Example variant", enabledByDefault: false,
        manifestUrl: "https://addon.example/manifest.json", upstreamAddonId: "example.upstream",
        streamNameFilter: { mode: "include", prefixes: ["Example"] },
        manifestFallback: { id: "example.variant", name: "Example variant", version: "1.0.0", types: ["series"], resources: ["stream"], catalogs: [] },
      }),
    });
    expect(saved.status).toBe(200);
    const directory = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<Record<string, unknown>> };
    expect(directory.addons.find(addon => addon.id === "example.variant")).toMatchObject({
      upstreamAddonId: "example.upstream", enabledByDefault: false,
      streamNameFilter: { mode: "include", prefixes: ["Example"] },
    });
    expect((await request(env, "/admin/addons/example.variant", {
      method: "PUT", body: JSON.stringify({ streamNameFilter: { mode: "regex", prefixes: [".*"] } }),
    })).status).toBe(400);
  });

  it("persists Stremio edits to the public directory without changing its script registry", async () => {
    const { env, data } = createEnv();
    data.set("providers:index", "{\"version\":2,\"records\":[]}");
    const before = data.get("providers:index");
    const saved = await request(env, "/admin/addons/com.stremio.torrentio.addon", {
      method: "PUT",
      body: JSON.stringify({ name: "Torrentio Latino", enabledByDefault: false, description: "NyaaSi y cine" }),
    });
    expect(saved.status).toBe(200);
    const publicResponse = await request(env, "/addons.json", {}, "");
    const directory = await publicResponse.json() as { addons: Array<Record<string, unknown>> };
    expect(directory.addons).toHaveLength(6);
    expect(directory.addons.find(addon => addon.id === "com.stremio.torrentio.addon")).toMatchObject({
      name: "Torrentio Latino", enabledByDefault: false, catalogPolicy: "empty",
      manifestFallback: { name: "Torrentio Latino", description: "NyaaSi y cine", logo: expect.stringContaining("https://hub.example/addons/logos/") },
    });
    expect(data.get("providers:index")).toBe(before);
    expect(publicResponse.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("adds and removes custom Stremio entries and serves their logos through the Hub", async () => {
    const { env } = createEnv();
    const saved = await request(env, "/admin/addons/com.example.Test", {
      method: "PUT",
      body: JSON.stringify({
        name: "Test add-on", manifestUrl: "https://addon.example.org/manifest.json",
        logoSource: "https://images.example.org/test.png", catalogPolicy: "empty",
        manifestFallback: { id: "com.example.Test", version: "1.0.0", name: "Test add-on", types: ["movie"], resources: ["stream"], catalogs: [] },
      }),
    });
    expect(saved.status).toBe(200);
    const response = await request(env, "/addons.json", {}, "");
    const directory = await response.json() as { addons: Array<{ id: string; logo: string }> };
    const logo = directory.addons.find(addon => addon.id === "com.example.Test")!.logo;
    expect(logo).toContain("https://hub.example/addons/logos/custom/");
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const image = await request(env, new URL(logo).pathname, {}, "");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledWith("https://images.example.org/test.png", expect.objectContaining({ redirect: "manual" }));

    expect((await request(env, "/admin/addons/com.example.Test", { method: "DELETE" })).status).toBe(200);
    const after = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<{ id: string }> };
    expect(after.addons.some(addon => addon.id === "com.example.Test")).toBe(false);
  });

  it("creates a separately identified draft for another profile of the same addon", async () => {
    const { env } = createEnv();
    const upstreamId = "com.cncverse.stremiobridge.profiletoken";
    const manifestUrl = "https://cncverse.dpdns.org/u/profile-one/manifest.json";
    await request(env, `/admin/addons/${upstreamId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "CNCVerse 1", manifestUrl,
        manifestFallback: { id: upstreamId, name: "CNCVerse", version: "1.0.0", types: ["movie"], resources: ["stream"], catalogs: [] },
      }),
    });

    const cloneResponse = await request(env, `/admin/addons/${upstreamId}/clone`, { method: "POST" });
    expect(cloneResponse.status).toBe(200);
    const clonePayload = await cloneResponse.json() as { addon: Record<string, any> };
    const clone = clonePayload.addon;
    expect(clone).toMatchObject({
      id: `${upstreamId}-copy-2`,
      name: "CNCVerse 2",
      manifestUrl,
      upstreamAddonId: upstreamId,
      manifestFallback: { id: `${upstreamId}-copy-2`, name: "CNCVerse 2" },
    });
    expect((await (await request(env, "/addons.json", {}, "")).json() as { addons: unknown[] }).addons).toHaveLength(7);

    const savedClone = await request(env, `/admin/addons/${clone.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...clone,
        name: "CNCVerse 2",
        manifestUrl: "https://cncverse.dpdns.org/u/profile-two/manifest.json",
      }),
    });
    expect(savedClone.status).toBe(200);
    const directory = await (await request(env, "/addons.json", {}, "")).json() as { addons: Array<Record<string, any>> };
    expect(directory.addons.filter(addon => addon.upstreamAddonId === upstreamId)).toHaveLength(1);
    expect(directory.addons.find(addon => addon.id === upstreamId)).toMatchObject({ name: "CNCVerse 1", manifestUrl });
    expect(directory.addons.find(addon => addon.id === clone.id)).toMatchObject({
      name: "CNCVerse 2",
      manifestUrl: "https://cncverse.dpdns.org/u/profile-two/manifest.json",
      upstreamAddonId: upstreamId,
      manifestFallback: { id: clone.id },
    });
  });

  it("keeps personal Highfly configuration and the authenticated PenguPlay proxy outside the Hub", async () => {
    const { env } = createEnv();
    for (const [id, manifestUrl] of [
      ["community.sports.fly", "https://sports.highfly.to/personal-secret/manifest.json"],
      ["com.penguplay", "https://pengu.uk/token/manifest.json"],
    ]) {
      const response = await request(env, `/admin/addons/${id}`, { method: "PUT", body: JSON.stringify({ manifestUrl }) });
      expect(response.status).toBe(400);
    }
  });

  it("validates Stremio manifests without forwarding the administrative token", async () => {
    const { env, data } = createEnv();
    const manifest = { id: "com.example.test", name: "Example", version: "1.0.0", types: ["movie"], resources: ["stream"], catalogs: [] };
    const fetchMock = vi.fn(async () => Response.json(manifest));
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(env, "/admin/validate-addon", {
      method: "POST", body: JSON.stringify({ manifestUrl: "https://addon.example.org/manifest.json" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, manifest });
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.has("x-admin-token")).toBe(false);
    expect(data.size).toBe(0);
  });

  it("rejects invalid JSON, bad URLs, and mismatched fallback ids before storing an addon", async () => {
    const { env, data } = createEnv();
    for (const body of [
      "null", "[]", "not json",
      JSON.stringify({ name: "Bad", manifestUrl: "http://localhost/manifest.json" }),
      JSON.stringify({ name: "Bad", manifestUrl: "https://addon.example.org/manifest.json", manifestFallback: { id: "other.id" } }),
    ]) {
      const response = await request(env, "/admin/addons/com.example.bad", { method: "PUT", body });
      expect(response.status).toBe(400);
    }
    expect(data.size).toBe(0);
  });

  it("deletes a bundled add-on without respawning it, while retaining the other defaults", async () => {
    const { env } = createEnv();
    const response = await request(env, "/admin/addons/org.portal.free", { method: "DELETE" });
    expect(await response.json()).toMatchObject({ ok: true, removed: true });
    const addons = await (await request(env, "/admin/addons")).json() as Array<{ id: string }>;
    expect(addons).toHaveLength(8);
    expect(addons.some(addon => addon.id === "org.portal.free")).toBe(false);
    expect(addons.some(addon => addon.id === "com.penguplay")).toBe(true);
  });

  it("clears explicit stream overrides back to automatic without changing the PenguPlay route", async () => {
    const { env } = createEnv();
    const saved = await request(env, "/admin/addons/com.penguplay", {
      method: "PUT", body: JSON.stringify({ streamTimeoutMs: null, streamAttempts: null }),
    });
    expect(saved.status).toBe(200);
    const addons = await (await request(env, "/admin/addons")).json() as Array<Record<string, unknown>>;
    const penguplay = addons.find(addon => addon.id === "com.penguplay");
    expect(penguplay).toMatchObject({ manifestUrl: "/api/penguplay/manifest.json" });
    expect(penguplay).not.toHaveProperty("streamTimeoutMs");
    expect(penguplay).not.toHaveProperty("streamAttempts");
  });

  it("rejects malformed, oversized and non-manifest upstream JSON", async () => {
    const { env } = createEnv();
    for (const [body, status] of [["<html>error</html>", 422], ["{}", 400], ["x".repeat(256 * 1024 + 1), 413]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
      const response = await request(env, "/admin/validate-addon", {
        method: "POST", body: JSON.stringify({ manifestUrl: "https://addon.example.org/manifest.json" }),
      });
      expect(response.status).toBe(status);
    }
  });
});
