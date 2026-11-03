import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveSportsConfig, registerLiveSportsProvider, saveLiveSportsConfig, setLiveSportsProviderEnabled } from "./liveSportsService.ts";
import { DEFAULT_LIVE_SPORTS_CONFIG } from "../types/liveSports.ts";

for (const id of ["nuvio-sports", "stremverse", "fmhy-native"]) {
  registerLiveSportsProvider({ id, label: id, async fetchEvents() { return []; } });
}
const key = "aetherio-live-sports-config";
function storage(value: object) {
  const values = new Map([[key, JSON.stringify(value)]]);
  vi.stubGlobal("localStorage", { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, text: string) => values.set(name, text) });
  return values;
}
afterEach(() => vi.unstubAllGlobals());

describe("FMHY source activation", () => {
  it("enables the new native provider for new installations", () => {
    expect(DEFAULT_LIVE_SPORTS_CONFIG.enabledProviders).toContain("fmhy-native");
  });
  it("migrates existing profiles once, preserving other preferences", () => {
    const values = storage({ enabledProviders: ["nuvio-sports", "local"], refreshSeconds: 300, hideEnded: false });
    expect(getLiveSportsConfig()).toMatchObject({ enabledProviders: ["nuvio-sports", "local", "fmhy-native"], refreshSeconds: 300, hideEnded: false, nativeProvidersVersion: 1 });
    expect(JSON.parse(values.get(key)!)).toMatchObject({ nativeProvidersVersion: 1 });
  });
  it("respects explicit disabling after migration and saved custom selections", () => {
    storage({ enabledProviders: ["local"] });
    getLiveSportsConfig();
    setLiveSportsProviderEnabled("fmhy-native", false);
    expect(getLiveSportsConfig().enabledProviders).toEqual(["local"]);
    saveLiveSportsConfig({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true });
    expect(getLiveSportsConfig().enabledProviders).toEqual(["local"]);
  });
});
