import { defineConfig, devices } from "@playwright/test";

const PORT = 1420;
const baseURL = `http://127.0.0.1:${PORT}`;

// E2E de la capa web: el shell de React, el enrutado y los ajustes. Lo que
// depende de Tauri (MPV, Credential Manager, descargas) se cubre con tests de
// Rust, no desde el navegador.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // `vite` directo y no `npm run dev`: los hooks de predev (shaders, runtime de
    // proveedores) no hacen falta para probar la interfaz. `--host 127.0.0.1`
    // porque en Windows vite enlaza solo con `localhost` (::1) y `baseURL` apunta
    // a IPv4.
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
