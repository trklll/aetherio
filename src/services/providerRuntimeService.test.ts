import { describe, expect, it } from "vitest";
import { getBuiltinProviderScriptPath, isProviderManifestScraperAllowed, isProviderRetired, providerRuntimeDepsUrl } from "./providerRuntimeService";

describe("providerRuntimeDepsUrl", () => {
  it("resolves the dependency from the application root on nested routes", () => {
    expect(providerRuntimeDepsUrl("http://localhost:1420/player/241585?source=providers"))
      .toBe("http://localhost:1420/provider-runtime-deps.js");
  });

  it("preserves the custom application protocol", () => {
    expect(providerRuntimeDepsUrl("tauri://localhost/player/241585"))
      .toBe("tauri://localhost/provider-runtime-deps.js");
  });

  it("uses the bundled 4KHDHub adapter", () => {
    expect(getBuiltinProviderScriptPath("yoruix:4khdhub")).toBe("/aetherio-4khdhub.js");
    expect(getBuiltinProviderScriptPath("yoruix:vidlink")).toBeNull();
  });
});

describe("provider retirement", () => {
  it("limits the curated Range7 repository to 2Peckle", () => {
    expect(isProviderManifestScraperAllowed("range7", "2peckle")).toBe(true);
    expect(isProviderManifestScraperAllowed("range7", "4khdhub")).toBe(false);
  });

  it("retires providers requiring setup or known-broken endpoints", () => {
    for (const key of [
      "yoruix:showbox",
      "yoruix:vidnest",
      "adrianjael:tioplus",
      "adrianjael:pelisplus",
      "eclipsia:hexion",
    ]) {
      expect(isProviderRetired(key)).toBe(true);
    }
  });

  it("keeps the selected duplicate versions", () => {
    for (const key of [
      "adrianjael:embed69",
      "kennethjys:zoowomaniacos",
      "eclipsia:novus",
      "yoruix:4khdhub",
      "range7:2peckle",
    ]) {
      expect(isProviderRetired(key)).toBe(false);
    }
  });
});
