import { expect, test, type Page } from "@playwright/test";

const DISCORD_URL = "aetherio://open/detail/movie/589";
const DETAIL_PATH = "/detail/movie/589";

interface DeepLinkFixture {
  reads: number;
  listeners: number;
  open: (url: string) => void;
}

async function setup(page: Page, initialUrl: string | null) {
  await page.route("https://**/*", route => route.fulfill({
    contentType: "application/json",
    body: "{}",
  }));
  await page.addInitScript(initialUrl => {
    let nextId = 1;
    let currentUrls = initialUrl ? [initialUrl] : [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const fixture: DeepLinkFixture = {
      reads: 0,
      get listeners() {
        return [...listeners.values()].filter(listener => listener.event === "deep-link://new-url").length;
      },
      open(url) {
        currentUrls = [url];
        for (const [id, listener] of [...listeners]) {
          if (listener.event === "deep-link://new-url") {
            callbacks.get(listener.handler)?.({ event: listener.event, id, payload: currentUrls });
          }
        }
      },
    };
    Object.assign(window, {
      __deepLinkTest: fixture,
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void) {
          const id = nextId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        convertFileSrc: (path: string) => path,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
        async invoke(command: string, args?: { event?: string; handler?: number; eventId?: number }) {
          if (command === "plugin:deep-link|get_current") {
            fixture.reads += 1;
            return currentUrls;
          }
          if (command === "plugin:event|listen") {
            const id = nextId++;
            listeners.set(id, { event: args!.event!, handler: args!.handler! });
            return id;
          }
          if (command === "plugin:event|unlisten") listeners.delete(args!.eventId!);
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
    const space = "aetherio-profile-space-v2:local";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem(`${space}:profiles`, JSON.stringify([
      { id: "discord-test", name: "Discord", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem(`${space}:active`, "discord-test");
    localStorage.setItem(`${space}:migrated`, "1");
  }, initialUrl);
  await page.goto("/home");
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __deepLinkTest: DeepLinkFixture }).__deepLinkTest.listeners)).toBe(1);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await page.clock.install();
  await page.clock.runFor(750);
}

async function expectRoute(page: Page, path: string) {
  // Dejar que React procese los efectos de navegación: una URL transitoria no
  // demuestra que el enlace inicial haya dejado de redirigir.
  await page.clock.runFor(750);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function openLink(page: Page, url: string) {
  await page.evaluate(url =>
    (window as unknown as { __deepLinkTest: DeepLinkFixture }).__deepLinkTest.open(url), url);
}

async function goHome(page: Page) {
  await page.getByRole("button", { name: "Inicio", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
}

test("permite ir a Inicio después de abrir un detalle desde Discord", async ({ page }) => {
  await setup(page, DISCORD_URL);
  await expectRoute(page, DETAIL_PATH);
  const reads = await page.evaluate(() =>
    (window as unknown as { __deepLinkTest: DeepLinkFixture }).__deepLinkTest.reads);

  await goHome(page);
  await expectRoute(page, "/home");
  expect(await page.evaluate(() =>
    (window as unknown as { __deepLinkTest: DeepLinkFixture }).__deepLinkTest.reads)).toBe(reads);
});

test("permite navegar a otro detalle sin restaurar el de Discord", async ({ page }) => {
  await setup(page, DISCORD_URL);
  await expectRoute(page, DETAIL_PATH);
  await page.evaluate(() => {
    const state = { usr: null, key: "otro-detalle", idx: 2 };
    history.pushState(state, "", "/detail/movie/603");
    dispatchEvent(new PopStateEvent("popstate", { state }));
  });
  await expectRoute(page, "/detail/movie/603");
});

test("los enlaces nuevos siguen funcionando, incluso al reabrir el mismo título", async ({ page }) => {
  await setup(page, null);
  await expectRoute(page, "/home");
  await openLink(page, DISCORD_URL);
  await expectRoute(page, DETAIL_PATH);
  await goHome(page);
  await expectRoute(page, "/home");

  await openLink(page, DISCORD_URL);
  await expectRoute(page, DETAIL_PATH);
  await openLink(page, "aetherio://open/detail/movie/603");
  await expectRoute(page, "/detail/movie/603");
  expect(await page.evaluate(() =>
    (window as unknown as { __deepLinkTest: DeepLinkFixture }).__deepLinkTest.listeners)).toBe(1);
});
