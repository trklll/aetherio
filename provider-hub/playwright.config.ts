import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const tempRoot = join(process.env.LOCALAPPDATA ?? process.cwd(), "Temp", "opencode");
const statePath = mkdtempSync(join(tempRoot, "provider-hub-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:8797", trace: "retain-on-failure" },
  reporter: "list",
  webServer: {
    command: `npx wrangler dev --config e2e/wrangler.toml --local --ip 127.0.0.1 --port 8797 --inspector-port 9237 --persist-to "${statePath}"`,
    url: "http://127.0.0.1:8797/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
