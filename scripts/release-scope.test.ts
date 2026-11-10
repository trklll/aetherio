import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public release excludes the unfinished Sports application", () => {
  it("only exposes Sports in the Big Picture navigation during development", () => {
    expect(source("src/pages/BigPicture/BigPictureRail.tsx")).toMatch(/\.\.\.\(import\.meta\.env\.DEV\s*\?\s*\[\{\s*key: "sports"/);
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

  it("gates the native Nuvio Sports server to development builds", () => {
    const native = source("src-tauri/src/lib.rs");
    expect(native).toMatch(/#\[cfg\(debug_assertions\)\]\s*mod nuvio_server;/);
    for (const command of [
      "start_nuvio_sports_server",
      "stop_nuvio_sports_server",
      "nuvio_sports_server_status",
    ]) {
      expect(native).toMatch(new RegExp(`#\\[cfg\\(debug_assertions\\)\\]\\s*nuvio_server::${command},`));
    }
    expect(native).toMatch(/#\[cfg\(debug_assertions\)\]\s*\{\s*nuvio_server::stop\(\);/);
  });

  it("does not stage or package the Sports server", () => {
    const config = JSON.parse(source("src-tauri/tauri.conf.json"));
    expect(config.build.beforeBuildCommand).not.toContain("nuvio");
    expect(config.bundle.resources).not.toContain("resources/nuvio-live-sports");
  });
});

describe("public release hides IPTV Channels", () => {
  it("does not expose Channels in either navigation", () => {
    expect(source("src/components/layout/TopNav.tsx")).not.toMatch(/label:\s*"Canales",\s*to:\s*"\/channels"/);
    expect(source("src/pages/BigPicture/BigPictureRail.tsx")).not.toMatch(/key:\s*"channels",\s*route:\s*"\/big-picture\/channels"/);
  });

  it("redirects direct Channels routes and does not import the IPTV page", () => {
    const app = source("src/App.tsx");
    const bigPicture = source("src/pages/BigPicture/index.tsx");

    expect(app).not.toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/Channels["']\)\)/);
    expect(app).toContain('<Route path="/channels"          element={<Navigate to="/home" replace />} />');
    expect(bigPicture).not.toMatch(/import\(["']\.\.\/Channels\/index\.tsx["']\)/);
    expect(bigPicture).toContain('<Navigate to="/big-picture" replace />');
  });
});
