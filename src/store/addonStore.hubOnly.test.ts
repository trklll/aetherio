import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledAddon } from "./addonStore.ts";

const globalKey = "aetherio-addons";
const profileKey = (id: string) => `aetherio-profile:${id}:aetherio-addons`;

function addon(id: string, extra: Partial<InstalledAddon> = {}): InstalledAddon {
  return { id, name: id, url: `https://user.example/${id}/manifest.json`, manifest: { id, resources: ["stream"], types: ["movie"] }, enabled: true, installedAt: 42, version: "1.0.0", ...extra };
}

function bundled(id: string, extra: Partial<InstalledAddon> = {}) {
  return addon(id, { bundled: true, installedAt: 0, scope: "global", ...extra });
}

function setup(global: InstalledAddon[] = [], profiles: Record<string, InstalledAddon[]> = {}) {
  const values = new Map<string, string>();
  const store = (key: string, addons: InstalledAddon[]) => values.set(key, JSON.stringify({ state: { addons }, version: 0 }));
  store(globalKey, global);
  for (const [id, addons] of Object.entries(profiles)) store(profileKey(id), addons);
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  vi.stubGlobal("localStorage", storage);
  const read = (key: string) => JSON.parse(values.get(key) ?? "null")?.state?.addons as InstalledAddon[] | undefined;
  return { values, storage, read };
}

const hubEntry = (id: string) => ({
  id, name: `Hub ${id}`, description: "From control panel", logo: "https://hub.example/logo.svg",
  manifestUrl: `https://hub.example/${id}/manifest.json`, enabledByDefault: true, catalogPolicy: "empty",
  manifestFallback: { id, name: `Hub ${id}`, version: "2.0.0", types: ["movie"], resources: ["stream"], catalogs: [] },
});

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("Provider Hub is the only automatic addon source", () => {
  it("starts with zero local defaults and does not seed the empty CNCVerse bridge", async () => {
    setup();
    const { useAddonStore } = await import("./addonStore.ts");
    expect(useAddonStore.getState().addons).toEqual([]);
  });

  it("retains arbitrary administrator-defined logical partitions without local default identities", async () => {
    setup();
    const animes = hubEntry("example.upstream");
    const animeav1 = {
      ...hubEntry("example.variant"), name: "Example variant", upstreamAddonId: animes.id,
      logo: "https://hub.example/logo.svg", manifestUrl: animes.manifestUrl,
      streamNameFilter: { mode: "include", prefixes: ["Example"] },
    };
    const entries = [animeav1, { ...animes, streamNameFilter: { mode: "exclude", prefixes: ["Example"] } }];
    const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith("/addons.json") ? { version: 1, addons: entries } : animes.manifestFallback));
    vi.stubGlobal("fetch", fetcher);
    const { useAddonStore, refreshBundledAddonDirectory } = await import("./addonStore.ts");
    await refreshBundledAddonDirectory();
    const installed = useAddonStore.getState().addons;
    expect(installed.map(a => a.id)).toEqual([animeav1.id, animes.id]);
    expect(installed[0]).toMatchObject({ name: "Example variant", logo: animeav1.logo, streamNameFilter: animeav1.streamNameFilter });
    expect(fetcher.mock.calls.filter(([url]) => url === animes.manifestUrl)).toHaveLength(1);
    useAddonStore.getState().disableAddon(animeav1.id);
    expect(useAddonStore.getState().getEnabledAddons().map(a => a.id)).toEqual([animes.id]);
  });

  it("removes legacy bundled addons from EVERY profile, not user-installed addons or unrelated data", async () => {
    const own = addon("com.aiostreams.viren070.personal", { name: "AIOStreams | ElfHosted", scope: "profile" });
    const other = addon("other.user.source", { scope: "profile" });
    const { values, read } = setup([bundled("com.linvo.cinemeta"), addon("global.user")], {
      active: [bundled("com.animeflv.stremio.addon"), own],
      inactive: [bundled("com.stremio.torrentio.addon"), other],
    });
    values.set("aetherio-local-mode-v1", "1");
    values.set("aetherio-profile-space-v2:local:active", "active");
    values.set("aetherio-continue-watching-v1", "do not touch");
    values.set("aetherio-custom-provider-repositories", '["https://personal.example/manifest.json"]');
    const { useAddonStore, reloadAddonsForActiveProfile } = await import("./addonStore.ts");
    expect(read(profileKey("inactive"))).toEqual([other]);
    expect(read(profileKey("active"))).toEqual([own]);
    expect(read(globalKey)?.map(a => a.id)).toEqual(["global.user"]);
    expect(useAddonStore.getState().addons.find(a => a.id === own.id)).toEqual(own);
    expect(values.get("aetherio-continue-watching-v1")).toBe("do not touch");
    expect(values.get("aetherio-custom-provider-repositories")).toBe('["https://personal.example/manifest.json"]');
    values.set("aetherio-profile-space-v2:local:active", "inactive");
    expect(reloadAddonsForActiveProfile().find(a => a.id === other.id)).toEqual(other);
  });

  it("keeps a user's installation even if its ID was historically a default or retired", async () => {
    const own = addon("com.stremio.torrentio.addon");
    const retiredButPersonal = addon("com.stremverse.org");
    setup([own, retiredButPersonal]);
    const { useAddonStore } = await import("./addonStore.ts");
    expect(useAddonStore.getState().addons.map(a => a.id)).toEqual([own.id, retiredButPersonal.id]);
    expect(useAddonStore.getState().addons.find(a => a.id === own.id)?.url).toBe(own.url);
  });

  it("does not overwrite a personal addon with an identically named Hub ID on refresh", async () => {
    const own = addon("same.id", { scope: "profile" });
    const { values } = setup([], { active: [own] });
    values.set("aetherio-local-mode-v1", "1");
    values.set("aetherio-profile-space-v2:local:active", "active");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ version: 1, addons: [hubEntry(own.id)] })));
    const { useAddonStore, refreshBundledAddonDirectory } = await import("./addonStore.ts");
    await refreshBundledAddonDirectory();
    const matches = useAddonStore.getState().addons.filter(a => a.id === own.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(own);
  });

  it("applies additions and deletions from the Hub, including an empty Hub, without deleting personal addons", async () => {
    const own = addon("my.addon");
    setup([own, bundled("obsolete.default")]);
    let entries = [hubEntry("controlled.addon")];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/addons.json")
      ? { version: 1, addons: entries }
      : entries[0]?.manifestFallback ?? {})));
    const { useAddonStore, refreshBundledAddonDirectory } = await import("./addonStore.ts");
    await refreshBundledAddonDirectory();
    expect(useAddonStore.getState().addons.map(a => a.id)).toEqual(["controlled.addon", own.id]);
    entries = [];
    await refreshBundledAddonDirectory();
    expect(useAddonStore.getState().addons).toHaveLength(1);
    expect(useAddonStore.getState().addons[0]).toMatchObject({ id: own.id, url: own.url, installedAt: 42 });
  });

  it("preserves a personally configured Highfly URL while removing local defaults", async () => {
    const highfly = bundled("community.sports.fly", { url: "https://sports.highfly.to/personal-test/manifest.json" });
    setup([highfly, bundled("com.linvo.cinemeta")]);
    const { useAddonStore } = await import("./addonStore.ts");
    expect(useAddonStore.getState().addons).toHaveLength(1);
    expect(useAddonStore.getState().addons[0]).toMatchObject({ id: highfly.id, url: highfly.url, bundled: false });
  });

  it("preserves a configured CNCVerse bridge as a user source, but never seeds one without a URL", async () => {
    const bridge = bundled("com.cncverse.stremiobridge.aetherio", { url: "https://personal.example" });
    const { values } = setup([bridge]);
    values.set("aetherio-cncverse-bridge-url", "https://personal.example");
    const { useAddonStore } = await import("./addonStore.ts");
    expect(useAddonStore.getState().addons).toHaveLength(1);
    expect(useAddonStore.getState().addons[0]).toMatchObject({ id: bridge.id, url: bridge.url, bundled: false });
  });

  it("keeps a legacy personal source stored in a profile even if its scope is missing", async () => {
    const own = addon("user.original");
    const { values } = setup([], { active: [own] });
    values.set("aetherio-local-mode-v1", "1");
    values.set("aetherio-profile-space-v2:local:active", "active");
    const { useAddonStore } = await import("./addonStore.ts");
    expect(useAddonStore.getState().addons).toContainEqual({ ...own, scope: "profile" });
  });

  it("does not restore legacy defaults on a Hub failure, and safely keeps custom data", async () => {
    setup([bundled("old.default"), addon("my.addon")]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw Error("offline"); }));
    const { useAddonStore, refreshBundledAddonDirectory } = await import("./addonStore.ts");
    await refreshBundledAddonDirectory();
    expect(useAddonStore.getState().addons.map(a => a.id)).toEqual(["my.addon"]);
  });

  it("remembers a user's disabled Hub addon after the Hub removes and re-adds it", async () => {
    setup();
    let entries = [hubEntry("controlled.addon")];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/addons.json")
      ? { version: 1, addons: entries } : entries[0]?.manifestFallback ?? {})));
    const { useAddonStore, refreshBundledAddonDirectory } = await import("./addonStore.ts");
    await refreshBundledAddonDirectory();
    useAddonStore.getState().disableAddon("controlled.addon");
    entries = [];
    await refreshBundledAddonDirectory();
    expect(useAddonStore.getState().addons).toEqual([]);
    entries = [hubEntry("controlled.addon")];
    await refreshBundledAddonDirectory();
    expect(useAddonStore.getState().addons[0].enabled).toBe(false);
  });

  it("never modifies a malformed profile document during migration", async () => {
    const { values } = setup([bundled("old.default"), addon("my.addon")]);
    values.set(profileKey("corrupt"), "{broken");
    await import("./addonStore.ts");
    expect(values.get(profileKey("corrupt"))).toBe("{broken");
    const backup = JSON.parse(values.get("aetherio-hub-only-backup-v1")!);
    expect(JSON.parse(backup.entries[globalKey]).state.addons.map((a: InstalledAddon) => a.id)).toEqual(["old.default", "my.addon"]);
  });

  it("keeps the original backup across an interrupted migration and backs up new profile keys", async () => {
    const { values } = setup([bundled("old.default")], { inactive: [bundled("other.default")] });
    const originalInactive = values.get(profileKey("inactive"));
    values.set("aetherio-hub-only-backup-v1", JSON.stringify({ version: 1, entries: { [globalKey]: "first original value" } }));
    const { migrateLocalAddonDefaults } = await import("./addonDefaultsMigration.ts");
    migrateLocalAddonDefaults();
    const backup = JSON.parse(values.get("aetherio-hub-only-backup-v1")!).entries;
    expect(backup[globalKey]).toBe("first original value");
    expect(backup[profileKey("inactive")]).toBe(originalInactive);
  });

  it("keeps unknown array values untouched rather than deleting them as local defaults", async () => {
    const { values } = setup();
    values.set(profileKey("unknown"), JSON.stringify({ state: { addons: [null, { unknown: true }, bundled("old.default")] }, version: 7 }));
    const { migrateLocalAddonDefaults } = await import("./addonDefaultsMigration.ts");
    migrateLocalAddonDefaults();
    expect(JSON.parse(values.get(profileKey("unknown"))!)).toEqual({ state: { addons: [null, { unknown: true }] }, version: 7 });
  });

  it("fails closed without changing addons when the backup cannot be written", async () => {
    const { values, storage } = setup([bundled("old.default"), addon("mine")]);
    const original = values.get(globalKey);
    const save = storage.setItem;
    storage.setItem = (key: string, value: string) => {
      if (key === "aetherio-hub-only-backup-v1") throw Error("quota");
      save(key, value);
    };
    const { migrateLocalAddonDefaults } = await import("./addonDefaultsMigration.ts");
    expect(() => migrateLocalAddonDefaults()).toThrow("quota");
    expect(values.get(globalKey)).toBe(original);
    expect(values.has("aetherio-hub-only-migration-v1")).toBe(false);
  });
});
