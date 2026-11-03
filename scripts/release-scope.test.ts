import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public release excludes the unfinished Sports application", () => {
  it("does not expose Sports in the Big Picture navigation", () => {
    expect(source("src/pages/BigPicture/BigPictureRail.tsx")).not.toMatch(/key: "sports"/);
  });

  it("does not import Sports screens or providers from application entry points", () => {
    for (const file of [
      "src/pages/BigPicture/index.tsx",
      "src/pages/BigPicture/BigPictureSettings.tsx",
      "src/pages/Player/SourceResolver.tsx",
    ]) {
      expect(source(file), file).not.toMatch(/(?:from\s*|import\s*\()\s*["'][^"']*(?:BigPictureSports|liveSportsService|iptvSports|nuvioSportsRuntime|stremioSportsProviders)/);
    }
  });

  it("does not expose the Sports connection settings", () => {
    expect(source("src/pages/BigPicture/BigPictureSettings.tsx")).not.toContain('<SettingsGroup title="Sports">');
  });

  it("does not compile or register the native Nuvio Sports server", () => {
    const native = source("src-tauri/src/lib.rs");
    expect(native).not.toMatch(/^mod nuvio_server;/m);
    expect(native).not.toContain("nuvio_server::");
  });

  it("does not stage or package the Sports server", () => {
    const config = JSON.parse(source("src-tauri/tauri.conf.json"));
    expect(config.build.beforeBuildCommand).not.toContain("nuvio");
    expect(config.bundle.resources).not.toContain("resources/nuvio-live-sports");
  });
});
