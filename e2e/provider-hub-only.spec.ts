import { test, expect } from "@playwright/test";

const personal = {
  id: "com.aiostreams.viren070.e2e", name: "My AIOStreams", scope: "profile", enabled: true,
  url: "https://personal.example/manifest.json", installedAt: 42, version: "1.0.0",
  manifest: { id: "com.aiostreams.viren070.e2e", types: ["movie"], resources: ["stream"], catalogs: [] },
};
const legacy = { id: "old.default", name: "Old default", url: "https://old.example/manifest.json", installedAt: 0, version: "1.0.0", manifest: {}, bundled: true, enabled: true };
const hubEntry = {
  id: "controlled.addon", name: "Controlled from Provider Hub", description: "Hub control panel", logo: "https://hub.example/logo.svg",
  manifestUrl: "https://addon.example/manifest.json", enabledByDefault: true, catalogPolicy: "empty",
  manifestFallback: { id: "controlled.addon", name: "Controlled", version: "1.0.0", resources: ["stream"], types: ["movie"], catalogs: [] },
};

test("empty Hub starts clean, all profiles retain personal addons, and only Hub changes add automatic sources", async ({ page }) => {
  let addons: unknown[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:1420" && url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>Isolated Hub integration test
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;
        </script></body></html>` });
    }
    if (url.origin === "http://127.0.0.1:1420") return route.continue();
    if (url.pathname === "/addons.json") return route.fulfill({ json: { version: 1, addons } });
    if (url.pathname.endsWith("/manifest.json")) return route.fulfill({ json: hubEntry.manifestFallback });
    return route.abort();
  });
  await page.goto("/");
  // No reliance on UI, login, or catalog requests: test the real Vite modules
  // in an isolated browser origin and seed only synthetic storage.
  await page.evaluate(({ own, old }) => {
    localStorage.clear();
    const save = (key: string, values: unknown[]) => localStorage.setItem(key, JSON.stringify({ state: { addons: values }, version: 0 }));
    save("aetherio-addons", [old]);
    save("aetherio-profile:one:aetherio-addons", [old, own]);
    save("aetherio-profile:two:aetherio-addons", [old, { ...own, id: "second.personal", name: "Second personal" }]);
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-profile-space-v2:local:active", "one");
    localStorage.setItem("aetherio-custom-provider-repositories", '["https://user.example/repo.json"]');
    localStorage.setItem("untouched-library-sentinel", "kept");
  }, { own: personal, old: legacy });
  const initial = await page.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/store/addonStore.ts");
    await store.refreshBundledAddonDirectory();
    return { addons: store.useAddonStore.getState().addons,
      otherProfile: JSON.parse(localStorage.getItem("aetherio-profile:two:aetherio-addons")!).state.addons,
      backup: localStorage.getItem("aetherio-hub-only-backup-v1") !== null };
  });
  expect(initial.addons).toEqual([personal]);
  expect(initial.otherProfile.map((a: { id: string }) => a.id)).toEqual(["second.personal"]);
  expect(initial.backup).toBe(true);
  addons = [hubEntry];
  const populated = await page.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/store/addonStore.ts");
    await store.refreshBundledAddonDirectory();
    return store.useAddonStore.getState().addons;
  });
  expect(populated.map((a: { id: string }) => a.id)).toEqual([hubEntry.id, personal.id]);
  expect(populated[0].origin).toBe("provider-hub");
  addons = [];
  const final = await page.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/store/addonStore.ts");
    await store.refreshBundledAddonDirectory();
    localStorage.setItem("aetherio-profile-space-v2:local:active", "two");
    return { one: JSON.parse(localStorage.getItem("aetherio-profile:one:aetherio-addons")!).state.addons,
      two: store.reloadAddonsForActiveProfile(), customRepos: localStorage.getItem("aetherio-custom-provider-repositories"),
      library: localStorage.getItem("untouched-library-sentinel") };
  });
  expect(final.one).toEqual([personal]);
  expect(final.two.map((a: { id: string }) => a.id)).toEqual(["second.personal"]);
  expect(final.customRepos).toBe('["https://user.example/repo.json"]');
  expect(final.library).toBe("kept");
});
