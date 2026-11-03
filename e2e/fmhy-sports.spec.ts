import { expect, test } from "@playwright/test";

test("FMHY: catálogo público → HLS nativo → volver a Sports, sin embeds", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let nextId = 1;
    let tick = 0;
    const profile = "fmhy-native-e2e";
    const httpCalls: string[] = [];
    Object.assign(window, {
      __fmhyHttpCalls: httpCalls,
      __TAURI_INTERNALS__: {
        transformCallback: () => nextId++,
        unregisterCallback: () => undefined,
        invoke: async (command: string, args?: { request?: { url?: string } }) => {
          if (command === "provider_http_request") {
            const url = args?.request?.url ?? "";
            httpCalls.push(url);
            let body = "";
            if (url === "https://sportsbite.org/api/forestgump/matches") {
              body = JSON.stringify({ days: [{ events: [{
                slug: "real-barca", title: "Real Madrid vs Barcelona", sport: "soccer", live: true,
                start: new Date(Date.now() - 600_000).toISOString(),
                teams: { home: { name: "Real Madrid" }, away: { name: "Barcelona" } },
                streams: [{ manifest_url: "https://sportsbite.org/tlive-embed/embed/real-barca", language: "Spanish", format: "iframe" }],
              }] }] });
            } else if (url === "https://streamfree.top/streams") {
              body = JSON.stringify({ streams: {} });
            } else if (url === "https://sportsbite.org/tlive-embed/embed/real-barca") {
              body = `var source = window.atob("${btoa("https://sportsbite.org/tlive/real-barca")}");`;
            } else if (url === "https://sportsbite.org/tlive/real-barca") {
              body = "#EXTM3U\n#EXTINF:4,\nhttps://sports-cdn.test/segment.ts\n";
            } else if (url === "https://sports-cdn.test/segment.ts") {
              const sample = new Uint8Array(1024);
              sample[0] = sample[188] = sample[376] = 0x47;
              body = String.fromCharCode(...sample);
            } else return { status: 404, url, bodyBase64: "" };
            return { status: 200, url, bodyBase64: btoa(body) };
          }
          if (command === "mpv_status") return { timePos: tick++, duration: 0, pause: false, fileLoaded: true, videoWidth: 1920, videoHeight: 1080, tracks: [{ id: 1, type: "audio", selected: true }] };
          if (command === "playback_capabilities") return { mpvBundled: true };
          if (command.startsWith("plugin:event|")) return nextId++;
          return null;
        },
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
      },
      __TAURI__: { event: { listen: async () => () => undefined } },
    });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: profile, name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", profile);
    // An existing installation: the FMHY migration must activate the new sources.
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 300, hideEnded: true }));
    localStorage.setItem(`aetherio-profile:${profile}:aetherio-sports-preferences`, JSON.stringify({
      version: 1, onboarding: "completed", sports: ["futbol"],
      followedCompetitions: [], followedClubs: [], followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "explorar", scope: "todos",
    }));
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
  await page.goto("/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.getByRole("heading", { name: "Real Madrid vs Barcelona" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Ver en directo", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("id")).toBe("fmhy:sportsbite:real-barca");
  const stream = await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream") ?? "null"));
  expect(stream.url).toBe("https://sportsbite.org/tlive/real-barca");
  expect(stream.behaviorHints.live).toBe(true);
  expect(stream.behaviorHints.headers.Referer).toBe("https://sportsbite.org/");
  expect(stream.behaviorHints.scraperPlayback).not.toBe("iframe");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture\/sports\/?$/);
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
});
