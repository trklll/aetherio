import { expect, test, type Page } from "@playwright/test";

async function openSportsOnboarding(page: Page, step = "deportes", viewport = { width: 1920, height: 1080 }) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((draftStep) => {
    let nextId = 1;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: () => nextId++,
        invoke: async (command: string) => command === "start_nuvio_sports_server"
          ? { ready: true, running: true, port: 7310, pid: 1 }
          : command.startsWith("plugin:event|") ? nextId++ : null,
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
      },
      __TAURI__: { event: { listen: async () => () => undefined } },
    });

    const pad = {
      id: "Xbox E2E", index: 0, connected: true, mapping: "standard", timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    Object.assign(window, { __sportsTestPad: pad });

    const profileId = "sports-onboarding-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Sports", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    const preferencesKey = `aetherio-profile:${profileId}:aetherio-sports-preferences`;
    if (!localStorage.getItem(preferencesKey)) {
      localStorage.setItem(preferencesKey, JSON.stringify({
        version: 1,
        onboarding: "pending",
        sports: [],
        followedCompetitions: [],
        followedClubs: [],
        followedNationalTeams: [],
        followedOrganizations: [],
        followedFighters: [],
        legacyTeamNames: [],
        view: "para-ti",
        scope: "todos",
      }));
    }
    if (draftStep !== "deportes") {
      const key = "aetherio-profile:sports-onboarding-e2e:aetherio-sports-onboarding-draft";
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
        step: draftStep, sports: ["futbol"], followedCompetitions: ["comp:eng-premier"],
        followedClubs: [], followedNationalTeams: [], followedOrganizations: [], followedFighters: [],
      }));
    }
  }, step);
  await page.goto("/big-picture/sports");
  await page.addStyleTag({
    content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }",
  });
  await expect(page.locator("[data-aetherio-sports-onboarding]")).toBeVisible();
}

// Exercises navigator.getGamepads -> useGamepad polling -> spatial input, not
// just keyboard events or programmatic focus/click masquerading as a controller.
async function pressPad(page: Page, button: number) {
  await page.evaluate(async (index) => {
    const pad = (window as unknown as { __sportsTestPad: { buttons: { pressed: boolean; value: number }[] } }).__sportsTestPad;
    pad.buttons[index].pressed = true;
    pad.buttons[index].value = 1;
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
    pad.buttons[index].pressed = false;
    pad.buttons[index].value = 0;
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  }, button);
}

async function expectFocusInViewport(page: Page) {
  expect(await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const root = document.querySelector("[data-aetherio-sports-onboarding]");
    const area = active?.closest("[data-onboarding-scroll]");
    if (!active || !root?.contains(active)) return false;
    const box = active.getBoundingClientRect();
    const bounds = area?.getBoundingClientRect();
    return box.top >= (bounds?.top ?? 0) - 1 && box.bottom <= (bounds?.bottom ?? innerHeight) + 1
      && box.left >= 0 && box.right <= innerWidth + 1;
  })).toBe(true);
  const indicator = await page.locator(":focus").evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(indicator.style).toBe("solid");
  expect(indicator.width).toBeGreaterThanOrEqual(3);
}

async function holdStickDown(page: Page) {
  return page.evaluate(async () => {
    const pad = (window as unknown as { __sportsTestPad: { axes: number[] } }).__sportsTestPad;
    const visited = new Set<string>();
    let visible = true;
    const start = performance.now();
    pad.axes[1] = 1;
    while (performance.now() - start < 1100) {
      await new Promise(requestAnimationFrame);
      const active = document.activeElement as HTMLElement | null;
      const area = active?.closest("[data-onboarding-scroll]");
      if (!active || !area) { visible = false; continue; }
      visited.add(active.dataset.onboardingFocusId ?? active.textContent ?? "");
      const box = active.getBoundingClientRect();
      const bounds = area.getBoundingClientRect();
      visible &&= box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
    }
    pad.axes[1] = 0;
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
    return { count: visited.size, visible };
  });
}

test("solo mando: elige, vuelve al contenido y finaliza sin campos de texto", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openSportsOnboarding(page);

  const football = page.getByRole("button", { name: /fútbol/i });
  const mma = page.getByRole("button", { name: /MMA/i });
  await expect(football).toBeFocused();
  await expect(football).toHaveAttribute("aria-pressed", "false");
  await pressPad(page, 15);
  await expect(mma).toBeFocused();
  await expect(mma).toHaveAttribute("aria-pressed", "false");
  await pressPad(page, 15); // Right edge never wraps or jumps diagonally.
  await expect(mma).toBeFocused();
  await pressPad(page, 14);
  await pressPad(page, 0);
  await expect(football).toHaveAttribute("aria-pressed", "true");
  await pressPad(page, 3); // Y = actions, without committing anything.
  await expect(page.getByRole("button", { name: "Continuar" })).toBeFocused();
  await pressPad(page, 13);
  await expect(football).toBeFocused();
  await pressPad(page, 3);
  await pressPad(page, 0);
  await expect(page.getByRole("heading", { name: "¿Qué competiciones sigues?" })).toBeVisible();
  await expect(page.locator("input, textarea, select")).toHaveCount(0);
  await pressPad(page, 3);
  await pressPad(page, 0);
  await expect(page.getByRole("heading", { name: "¿Qué equipos sigues?" })).toBeVisible();
  await pressPad(page, 1); // B reverses exactly one step, not the whole route.
  await expect(page.getByRole("heading", { name: "¿Qué competiciones sigues?" })).toBeVisible();
  await pressPad(page, 3);
  await pressPad(page, 0);
  await pressPad(page, 3);
  await pressPad(page, 0);
  await expect(page.getByRole("heading", { name: "Todo listo" })).toBeVisible();
  const sportsSummary = page.getByRole("button", { name: "Deportes 1" });
  await expect(sportsSummary).toBeFocused();
  await pressPad(page, 0);
  await expect(sportsSummary).toHaveAttribute("aria-expanded", "true");
  await pressPad(page, 13);
  await expectFocusInViewport(page);
  await page.screenshot({ path: testInfo.outputPath("summary-gamepad.png") });
  await pressPad(page, 3);
  await expect(page.getByRole("button", { name: "Listo" })).toBeFocused();
  await pressPad(page, 0);
  await expect(page.locator("[data-aetherio-sports-onboarding]")).toHaveCount(0);
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`cruceta y desplazamiento automático sin barras a ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await openSportsOnboarding(page, "equipos", viewport);
    if (viewport.width === 1920) await page.emulateMedia({ reducedMotion: "no-preference" });
    const area = page.locator("[data-onboarding-scroll]");
    await expect(page.getByRole("button", { name: "Clubes", exact: true })).toBeFocused();
    await expect(page.locator("input, textarea, select")).toHaveCount(0);
    expect(await area.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe("none");
    const continueButton = page.getByRole("button", { name: "Continuar" });
    const toolbarY = (await continueButton.boundingBox())!.y;
    await page.screenshot({ path: testInfo.outputPath("initial-gamepad.png") });

    // Walk the real rendered rows, including wrapped filters and offscreen clubs.
    for (let index = 0; index < 28; index++) {
      await pressPad(page, 13);
      await expectFocusInViewport(page);
    }
    expect(await area.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(Math.abs((await continueButton.boundingBox())!.y - toolbarY)).toBeLessThan(1);
    expect(await page.locator("[data-aetherio-scroll-shell]").evaluate(element => element.scrollTop)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("scrolled-gamepad.png") });
    const focusedId = await page.locator(":focus").getAttribute("data-onboarding-focus-id");
    await pressPad(page, 3);
    await expect(continueButton).toBeFocused();
    await pressPad(page, 13);
    await expect(page.locator(":focus")).toHaveAttribute("data-onboarding-focus-id", focusedId!);
    await expectFocusInViewport(page);
    await pressPad(page, 12);
    await expectFocusInViewport(page);
    await page.keyboard.press("ArrowDown"); // Same map for physical keyboard.
    await expectFocusInViewport(page);
    if (viewport.width > 760) {
      const held = await holdStickDown(page);
      expect(held.count).toBeGreaterThan(3);
      expect(held.visible).toBe(true);
      const beforePage = await page.locator(":focus").getAttribute("data-onboarding-focus-id");
      await pressPad(page, 5); // RB jumps a page of visual rows, without native scrolling.
      await expectFocusInViewport(page);
      expect(await page.locator(":focus").getAttribute("data-onboarding-focus-id")).not.toBe(beforePage);
      await pressPad(page, 4);
      await expectFocusInViewport(page);
    }
  });
}

test("los filtros de país y continente no cambian selecciones ni pierden el foco", async ({ page }) => {
  test.setTimeout(90_000);
  await openSportsOnboarding(page, "equipos");
  await page.getByRole("button", { name: "Europa", exact: true }).click();
  await page.getByRole("button", { name: "España", exact: true }).click();
  const clubs = page.getByRole("group", { name: "Clubes", exact: true });
  await expect(clubs.getByRole("button", { name: /Real Madrid/ })).toBeVisible();
  await expect(clubs.getByRole("button", { name: /Manchester/ })).toHaveCount(0);
  const madrid = clubs.getByRole("button", { name: /Real Madrid/ });
  await madrid.click();
  await expect(madrid).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Seguidos/ }).click();
  await madrid.click(); // Last item in this filter disappears; recover onto a control.
  await expect(madrid).toHaveCount(0);
  await expectFocusInViewport(page);
  await pressPad(page, 3);
  await expect(page.getByRole("button", { name: "Continuar" })).toBeFocused();
  await page.getByRole("button", { name: "Selecciones", exact: true }).click();
  await page.getByRole("button", { name: "Ver todos", exact: true }).click();
  const teams = page.getByRole("group", { name: "Selecciones", exact: true });
  await expect(teams.getByRole("button", { name: /España/ })).toBeVisible();
  await expect(teams.getByRole("button", { name: /Brasil/ })).toHaveCount(0);
});

test("MMA y pasos vacíos se pueden completar y deshacer solo con mando", async ({ page }) => {
  test.setTimeout(90_000);
  await openSportsOnboarding(page);
  await expect(page.getByRole("button", { name: /fútbol/i })).toBeFocused();
  await pressPad(page, 15);
  await pressPad(page, 0);
  await pressPad(page, 3);
  await pressPad(page, 0);
  await expect(page.getByRole("heading", { name: "¿Qué organizaciones sigues?" })).toBeVisible();
  await pressPad(page, 3);
  await pressPad(page, 0);
  await expect(page.getByRole("heading", { name: "¿Sigues a algún peleador?" })).toBeVisible();
  await expectFocusInViewport(page);
  await pressPad(page, 3);
  await pressPad(page, 0);
  await expect(page.getByRole("heading", { name: "Todo listo" })).toBeVisible();
  await pressPad(page, 1);
  await expect(page.getByRole("heading", { name: "¿Sigues a algún peleador?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "¿Qué organizaciones sigues?" })).toBeVisible();
  await expectFocusInViewport(page);
});
