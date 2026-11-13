import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: "settings-test", name: "Pruebas", createdAt: 1, updatedAt: 1, avatarDataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Cdefs%3E%3ClinearGradient id='g'%3E%3Cstop stop-color='%23bf542e'/%3E%3Cstop offset='1' stop-color='%2327678b'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' fill='url(%23g)'/%3E%3C/svg%3E" },
    ]));
    localStorage.setItem("aetherio-active-profile-id", "settings-test");
  });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
}

test.beforeEach(async ({ page }) => prepare(page));

test("profile details save per field without a global save button", async ({ page }) => {
  await page.goto("/settings?tab=account");
  const surface = page.locator("[data-settings-surface]");
  await surface.getByRole("button", { name: "Perfiles", exact: true }).click();
  await surface.getByRole("button", { name: "Administrar Perfiles", exact: true }).click();

  const manage = page.locator("[data-settings-surface]");
  await expect(manage.getByRole("button", { name: "Cambiar foto", exact: true })).toBeVisible();
  await expect(manage.getByRole("button", { name: "Guardar perfil", exact: true })).toHaveCount(0);
  await expect(manage.getByRole("button", { name: "Nombre", exact: true })).toBeVisible();
  await expect(manage.getByRole("button", { name: "PIN opcional", exact: true })).toBeVisible();

  await manage.getByRole("button", { name: "Nombre", exact: true }).click();
  const nameEditor = page.locator('[data-profile-field-editor="name"]');
  await expect(nameEditor.getByRole("heading", { name: "Elige un nombre" })).toBeVisible();
  await nameEditor.getByRole("button", { name: "BORRAR", exact: true }).click();
  await page.keyboard.type("Perfil actualizado");
  await nameEditor.getByRole("button", { name: "Listo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.endsWith(":profiles"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "[]")[0]?.name : null;
  })).toBe("Perfil actualizado");

  await manage.getByRole("button", { name: "PIN opcional", exact: true }).click();
  const pinEditor = page.locator('[data-profile-field-editor="pin"]');
  await expect(pinEditor.getByRole("heading", { name: "Elige un PIN" })).toBeVisible();
  for (const digit of ["1", "2", "3", "4"]) await pinEditor.getByRole("button", { name: `Escribir ${digit}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.endsWith(":profiles"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "[]")[0]?.pin?.length : null;
  })).toBe(64);

  await manage.locator('input[type="file"][aria-label="Archivo de foto de perfil"]').setInputFiles({
    name: "avatar.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="4" fill="red"/></svg>'),
  });
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.endsWith(":profiles"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "[]")[0]?.avatarDataUrl?.startsWith("data:image/svg+xml") : false;
  })).toBe(true);
  await expect(manage.locator(".settings-surface__identity img.settings-surface__profile-image")).toBeVisible();
  await expect(manage.locator(".settings-surface__identity [data-settings-category-icon]")).toHaveCount(0);
});

test("profile field screens fade in and out when moving between options", async ({ page }) => {
  await page.goto("/settings?tab=account");
  const surface = page.locator("[data-settings-surface]");
  await surface.getByRole("button", { name: "Perfiles", exact: true }).click();
  await surface.getByRole("button", { name: "Administrar Perfiles", exact: true }).click();
  await surface.getByRole("button", { name: "Nombre", exact: true }).click();

  const editor = page.locator('[data-profile-field-editor="name"]');
  await expect(editor).toHaveAttribute("data-transitioning", "in");
  await expect(editor).toHaveCSS("animation-name", "profile-field-fade-in");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveAttribute("data-transitioning", "out");
  await expect(editor).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Nombre", exact: true })).toBeFocused();
});

test("the large profile preview follows the focused profile row", async ({ page }) => {
  await page.addInitScript(() => {
    const key = "aetherio-local-profiles-v1";
    const profiles = JSON.parse(localStorage.getItem(key) ?? "[]");
    profiles.push({
      id: "settings-second-profile",
      name: "XD2",
      createdAt: 2,
      updatedAt: 2,
      avatarDataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%2300aaff'/%3E%3C/svg%3E",
    });
    localStorage.setItem(key, JSON.stringify(profiles));
  });
  await page.goto("/settings?tab=account");
  const surface = page.locator("[data-settings-surface]");
  await surface.getByRole("button", { name: "Perfiles", exact: true }).click();
  await surface.getByRole("button", { name: "Administrar Perfiles", exact: true }).click();

  const preview = surface.locator(".settings-surface__identity img.settings-surface__profile-image");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /bf542e/);
  await surface.getByRole("button", { name: "XD2", exact: true }).focus();
  await expect(preview).toHaveAttribute("src", /00aaff/);
});

test("binary settings toggle immediately without opening a dialog", async ({ page }) => {
  await page.goto("/settings?tab=design");
  const surface = page.locator("[data-settings-surface]");
  const toggle = surface.getByRole("button", { name: "Usar SpatialPosters", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toContainText("Desactivado");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const mode of ["desktop", "tv"] as const) {
  const path = mode === "tv" ? "/big-picture/settings" : "/settings";

  test(`${mode}: settings typography is larger and semibold in both modes`, async ({ page }) => {
    test.setTimeout(90_000);
    const capture = async (name: string) => {
      if (process.env.AETHERIO_SETTINGS_TYPE_CAPTURE === "1") {
        await page.screenshot({ path: `.impeccable/review/settings-typography-readable/${mode}-${name}.png`, animations: "disabled" });
      }
    };
    const resize = async (width: number, height: number) => {
      // Big Picture enters fullscreen on mount; release it before resizing Chromium.
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
      await page.setViewportSize({ width, height });
    };
    await page.goto(path);
    for (const width of [1440, 1920, 3840]) {
      await resize(width, width === 3840 ? 2160 : 1080);
      const surface = page.locator("[data-settings-surface]");
      const row = surface.getByRole("button", { name: "Cuenta", exact: true });
      await expect(row).toBeFocused();
      await expect(row).toHaveCSS("font-weight", "600");
      await expect(surface.locator(".settings-surface__description")).toHaveCSS("font-weight", "500");
      expect(await row.evaluate(element => getComputedStyle(element).fontFamily)).toBe(
        await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily),
      );
      const sizes = await surface.evaluate(element => {
        const size = (selector: string) => parseFloat(getComputedStyle(element.querySelector(selector)!).fontSize);
        return { title: size(".settings-row__title"), description: size(".settings-surface__description") };
      });
      expect(sizes.title).toBeGreaterThanOrEqual(22);
      expect(sizes.title).toBeLessThanOrEqual(28);
      expect(sizes.description).toBeGreaterThanOrEqual(18);
      expect(sizes.description).toBeLessThanOrEqual(22);
      if (width === 1920) expect(sizes.title).toBeCloseTo(25.92, 1);
      if (width === 1920) await capture("categories");
    }

    await resize(1920, 1080);
    await page.goto(`${path}?tab=playback`);
    const surface = page.locator("[data-settings-surface]");
    const audio = surface.getByRole("button", { name: "Idioma de audio preferido", exact: true });
    await expect(audio).toBeVisible();
    const secondarySizes = await surface.evaluate(element => {
      const size = (selector: string) => parseFloat(getComputedStyle(element.querySelector(selector)!).fontSize);
      return { value: size(".settings-row__value"), section: size(".settings-section-label") };
    });
    expect(secondarySizes.value).toBeGreaterThanOrEqual(20);
    expect(secondarySizes.value).toBeLessThanOrEqual(22);
    expect(secondarySizes.section).toBeGreaterThanOrEqual(18);
    expect(secondarySizes.section).toBeLessThanOrEqual(20);
    await expect(audio.locator(".settings-row__value")).toHaveCSS("font-weight", "500");
    await capture("playback");

    await audio.click();
    const popup = page.getByRole("dialog", { name: "Idioma de audio preferido", exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.locator("h2")).toHaveCSS("font-size", "24px");
    await expect(popup.locator(".settings-dialog__option").first()).toHaveCSS("font-size", "20px");
    await expect(popup.locator(".settings-dialog__option").first()).toHaveCSS("font-weight", "600");
    await expect(popup.locator(".settings-dialog__description")).toHaveCSS("font-size", "18px");
    await capture("popup");
    await page.keyboard.press("Escape");
    await expect(audio).toBeFocused();

    await page.goto(path);
    const compactRow = surface.getByRole("button", { name: "Cuenta", exact: true });
    await expect(compactRow).toBeFocused();
    await resize(390, 844);
    await expect(compactRow).toHaveCSS("font-size", "22px");
    await expect(surface.locator(".settings-surface__description")).toHaveCSS("font-size", "16px");
    const compact = await compactRow.evaluate(row => ({
      height: row.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(compact.height).toBeGreaterThanOrEqual(44);
    expect(compact.overflow).toBe(false);
    await capture("compact");

    // Rem bounds must still respond to the user's preferred text size.
    await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
    await expect(compactRow).toHaveCSS("font-size", "27.5px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });

  test(`${mode}: shared categories, contextual help and choice popup`, async ({ page }) => {
    await page.goto(path);
    const surface = page.locator("[data-settings-surface]");
    await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
    await expect(surface.locator("[data-settings-category-icon='account']")).toBeVisible();
    await surface.getByRole("button", { name: "Reproducción", exact: true }).focus();
    await expect(surface.locator("[data-settings-description]")).toContainText("audio");
    await page.keyboard.press("Enter");
    const row = surface.getByRole("button", { name: /Idioma de audio preferido/ });
    await row.click();
    const popup = page.getByRole("dialog", { name: "Idioma de audio preferido", exact: true });
    await expect(popup).toBeVisible();
    const japanese = popup.getByRole("button", { name: "Japonés", exact: true });
    await japanese.hover();
    await expect(japanese).toBeFocused();
    await expect.poll(() => popup.locator("button").evaluateAll(buttons =>
      buttons.filter(button => getComputedStyle(button).backgroundColor === "rgb(255, 255, 255)").length,
    )).toBe(1);
    const cancel = popup.getByRole("button", { name: "Cancelar", exact: true });
    await cancel.hover();
    await expect(cancel).toBeFocused();
    await expect.poll(() => popup.locator("button").evaluateAll(buttons =>
      buttons.filter(button => getComputedStyle(button).backgroundColor === "rgb(255, 255, 255)").length,
    )).toBe(1);
    await popup.getByRole("button", { name: "Japonés", exact: true }).click();
    await expect(popup).not.toBeVisible();
    await expect(row).toContainText("Japonés");
    await expect(row).toBeFocused();
    await page.reload();
    await expect(surface.getByRole("button", { name: /Idioma de audio preferido/ })).toContainText("Japonés");
  });

  test(`${mode}: popup cancel, focus containment and hierarchical back`, async ({ page }) => {
    await page.goto(`${path}?tab=playback`);
    const surface = page.locator("[data-settings-surface]");
    const row = surface.getByRole("button", { name: /Mostrar superposición de carga/ });
    await row.click();
    const popup = page.getByRole("dialog", { name: "Mostrar superposición de carga", exact: true });
    await expect(popup).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => popup.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();
    await expect(row).toBeFocused();
    await row.click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-input:back", { cancelable: true })));
    await expect(popup).not.toBeVisible();
    await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-input:back", { cancelable: true })));
    await expect(surface.getByRole("button", { name: "Cuenta", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });

  test(`${mode}: hierarchical back restores the originating row`, async ({ page }) => {
    await page.goto(path);
    const surface = page.locator("[data-settings-surface]");
    const playback = surface.getByRole("button", { name: "Reproducción", exact: true });
    await playback.click();
    await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(playback).toBeFocused();

    await surface.getByRole("button", { name: "Cuenta", exact: true }).click();
    const integrations = surface.getByRole("button", { name: "Integraciones", exact: true });
    await integrations.click();
    const intro = surface.getByRole("button", { name: "TheIntroDB", exact: true });
    await intro.click();
    await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(intro).toBeFocused();
    if (mode === "desktop") await surface.getByRole("button", { name: "Volver", exact: true }).click();
    else await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-input:back", { cancelable: true })));
    await expect(integrations).toBeFocused();
  });

  test(`${mode}: six general category SVGs follow focus and persist in subpages`, async ({ page }) => {
    await page.goto(path);
    const surface = page.locator("[data-settings-surface]");
    const icon = surface.locator("[data-settings-category-icon]");
    const categories = [
      ["account", "Cuenta"], ["design", "Diseño"], ["addons", "Complementos"],
      ["sources", "Fuentes"], ["playback", "Reproducción"], ["about", "Acerca de"],
    ];
    const sources = new Set<string>();
    await expect(icon).toHaveCount(1);
    for (const [id, label] of categories) {
      const row = surface.getByRole("button", { name: label, exact: true });
      if (id === "sources" && process.env.AETHERIO_RELEASE_SMOKE === "1") continue;
      await row.hover();
      await expect(row).toBeFocused();
      await expect(icon).toHaveAttribute("data-settings-category-icon", id);
      await expect(icon).toHaveAttribute("alt", `Icono de ${label}`);
      await expect.poll(() => icon.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
      const src = await icon.getAttribute("src");
      expect(src).toMatch(/\.svg(?:\?|$)|^data:image\/svg\+xml/);
      sources.add(src!);
    }
    expect(sources.size).toBe(process.env.AETHERIO_RELEASE_SMOKE === "1" ? 5 : 6);

    await surface.getByRole("button", { name: "Diseño", exact: true }).click();
    await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
    await expect(icon).toHaveAttribute("data-settings-category-icon", "design");
    await surface.getByRole("button", { name: "Pantalla de inicio", exact: true }).click();
    await surface.getByRole("button", { name: "Contenido principal", exact: true }).focus();
    await expect(icon).toHaveAttribute("data-settings-category-icon", "design");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(surface.getByRole("button", { name: "Diseño", exact: true })).toBeFocused();
    await expect(icon).toHaveAttribute("data-settings-category-icon", "design");
    await expect(surface.locator("img[src*='aetheriosettings']")).toHaveCount(0);
  });
}

test("TV includes the complete PC design and integration options", async ({ page }) => {
  await page.goto("/big-picture/settings?tab=account");
  const surface = page.locator("[data-settings-surface]");
  await surface.getByRole("button", { name: "Integraciones", exact: true }).click();
  for (const name of ["MDBList", "Anime skip", "TheIntroDB", "Biblioteca y sincronización", "Discord Rich Presence"]) {
    await expect(surface.getByRole("button", { name, exact: true })).toBeVisible();
  }
});

for (const mode of ["desktop", "tv"] as const) {
test(`${mode}: reference proportions and a single white focus row`, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(mode === "tv" ? "/big-picture/settings" : "/settings");
  const surface = page.locator("[data-settings-surface]");
  const account = surface.getByRole("button", { name: "Cuenta", exact: true });
  await expect(account).toBeFocused();
  await expect(surface.getByRole("heading", { name: "Ajustes", exact: true })).toHaveCount(0);
  const design = surface.getByRole("button", { name: "Diseño", exact: true });
  const geometry = await design.evaluate(row => {
    const rect = row.getBoundingClientRect();
    const image = document.querySelector(".settings-surface__image")!.getBoundingClientRect();
    const icon = row.querySelector("svg")!;
    const ink = icon.querySelector("path")!.getBoundingClientRect();
    return { x: rect.x, width: rect.width, height: rect.height,
      artworkLeft: image.left,
      artworkWidth: image.width,
      artworkTop: image.top + image.height * 24 / 256,
      firstRowTop: document.querySelector("[data-settings-row]")!.getBoundingClientRect().top,
      chevronRatio: ink.height / ink.width };
  });
  expect(geometry.x).toBeCloseTo(1059.84, 0);
  expect(geometry.width).toBeCloseTo(783.36, 0);
  expect(geometry.height).toBeCloseTo(67.2, 0);
  expect(geometry.artworkLeft).toBeCloseTo(207.36, 0);
  expect(geometry.artworkWidth).toBeCloseTo(637.44, 0);
  expect(geometry.artworkTop - geometry.firstRowTop).toBeGreaterThan(0);
  expect(geometry.chevronRatio).toBeGreaterThan(2);
  await design.hover();
  await expect(design).toBeFocused();
  await expect.poll(() => surface.evaluate(element => {
    const rows = Array.from(document.querySelectorAll("[data-settings-row]"));
    return rows.filter(item => element.contains(item) && getComputedStyle(item).backgroundColor === "rgb(255, 255, 255)").length;
  })).toBe(1);
  await expect(surface.locator(".settings-surface__identity")).toBeVisible();
  await expect(surface.getByRole("button", { name: "Volver", exact: true })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(surface.getByRole("button", { name: "Volver", exact: true })).toHaveCount(mode === "tv" ? 0 : 1);
});
}

test("TV remote arrows and confirm stay inside the option popup", async ({ page }) => {
  await page.goto("/big-picture/settings");
  const surface = page.locator("[data-settings-surface]");
  await expect(surface.getByRole("button", { name: "Cuenta", exact: true })).toBeFocused();
  await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", "account");
  const remoteKey = (key: string) => page.evaluate(key => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })), key);
  await remoteKey("ArrowDown");
  await expect(surface.getByRole("button", { name: "Diseño", exact: true })).toBeFocused();
  await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", "design");
  await remoteKey("ArrowDown");
  await expect(surface.getByRole("button", { name: "Complementos", exact: true })).toBeFocused();
  await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", "addons");
  await remoteKey("ArrowDown");
  await expect(surface.getByRole("button", { name: "Fuentes", exact: true })).toBeFocused();
  await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", "sources");
  await remoteKey("ArrowUp");
  await expect(surface.getByRole("button", { name: "Complementos", exact: true })).toBeFocused();
  await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", "addons");
  await remoteKey("ArrowUp");
  await expect(surface.getByRole("button", { name: "Diseño", exact: true })).toBeFocused();
  await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", "design");
  await remoteKey("Enter");
  await expect(surface.getByRole("button", { name: "Pantalla de inicio", exact: true })).toBeFocused();
  await remoteKey("Enter");
  await expect(surface.getByRole("button", { name: "Contenido principal", exact: true })).toBeFocused();
  await remoteKey("Enter");
  const popup = page.getByRole("dialog", { name: "Contenido principal", exact: true });
  await expect(popup).toBeVisible();
  await remoteKey("ArrowDown");
  await expect.poll(() => popup.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
  await remoteKey("Enter");
  await expect(popup).not.toBeVisible();
  await expect(surface.getByRole("button", { name: "Contenido principal", exact: true })).toBeFocused();
});

test("TV settings return the scroll shell to the top when navigating back to the first setting", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/big-picture/settings?tab=playback");
  await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
  await page.setViewportSize({ width: 1920, height: 1080 });

  const surface = page.locator("[data-settings-surface]");
  const rows = surface.locator("[data-settings-row]");
  const first = rows.first();
  const last = rows.last();
  const shell = page.locator(".big-picture__scroll");
  await expect(first).toBeFocused();

  const navigateTo = async (key: "ArrowDown" | "ArrowUp", target: ReturnType<typeof rows.first>, maxSteps: number) => {
    for (let index = 0; index < maxSteps; index += 1) {
      if (await target.evaluate(element => element === document.activeElement)) return;
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }
  };

  const maxSteps = (await rows.count()) + 5;
  await navigateTo("ArrowDown", last, maxSteps);
  await expect(last).toBeFocused();
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBeGreaterThan(100);

  await navigateTo("ArrowUp", first, maxSteps);
  await expect(first).toBeFocused();
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBeLessThan(2);
});

test("range options can be adjusted without a pointer", async ({ page }) => {
  await page.goto("/big-picture/settings?tab=playback");
  const surface = page.locator("[data-settings-surface]");
  await surface.getByRole("button", { name: "Umbral de película", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Umbral de película", exact: true });
  const slider = popup.getByRole("slider");
  const before = Number(await slider.inputValue());
  const increase = before < 100;
  await popup.getByRole("button", { name: `${increase ? "Aumentar" : "Reducir"} Umbral de película`, exact: true }).click();
  await expect(slider).toHaveValue(String(before + (increase ? 1 : -1)));
  await popup.getByRole("button", { name: "Listo", exact: true }).click();
  await expect(surface.getByRole("button", { name: "Umbral de película", exact: true })).toContainText(`${before + (increase ? 1 : -1)}%`);
});

test("release hides Fuentes and rejects its direct tab", async ({ page }) => {
  test.skip(process.env.AETHERIO_RELEASE_SMOKE !== "1", "Production bundle assertion");
  await page.goto("/settings?tab=sources");
  const surface = page.locator("[data-settings-surface]");
  await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Fuentes", exact: true })).toHaveCount(0);
  await expect(surface.getByText("CNCVerse", { exact: true })).toHaveCount(0);
  await page.goto("/big-picture/settings?tab=sources");
  await expect(surface.locator(".settings-surface__header h1")).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Fuentes", exact: true })).toHaveCount(0);
});

test("settings visual evidence", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(process.env.AETHERIO_SETTINGS_CAPTURE !== "1", "Explicit bounded capture pass only");
  const output = ".impeccable/review/settings-icons";
  const ready = async () => {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator("[data-settings-surface]").evaluate(element => {
      const image = element.querySelector("img");
      if (!image?.complete || !image.naturalWidth) return false;
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) < .99) return false;
      }
      return true;
    })).toBe(true);
  };
  const metrics: Record<string, unknown> = {};
  const capture = async (name: string) => {
    await ready();
    metrics[name] = await surface.evaluate(element => {
      const rect = (selector: string) => element.querySelector(selector)?.getBoundingClientRect().toJSON();
      return { viewport: { width: innerWidth, height: innerHeight }, image: rect(".settings-surface__image"),
        list: rect(".settings-surface__content"), row: rect(".settings-row:not(:focus)"),
        heading: rect("h1"), selected: element.querySelector(".settings-row:focus")?.textContent };
    });
    await page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings");
  const surface = page.locator("[data-settings-surface]");
  await expect(surface.getByRole("button", { name: "Cuenta", exact: true })).toBeFocused();
  await ready();
  await capture("desktop");
  await page.setViewportSize({ width: 1056, height: 886 });
  await capture("user-1056");
  await page.setViewportSize({ width: 1440, height: 900 });
  await surface.getByRole("button", { name: "Reproducción", exact: true }).click();
  await expect(surface.getByRole("button", { name: /Mostrar superposición de carga/ })).toBeFocused();
  await page.screenshot({ path: `${output}/desktop-playback.png`, animations: "disabled" });
  await surface.getByRole("button", { name: /Idioma de audio preferido/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${output}/desktop-popup.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.goto("/big-picture/settings");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(surface.getByRole("button", { name: "Cuenta", exact: true })).toBeFocused();
  await expect(page.locator(".bp-settings-profile-backdrop")).toHaveCSS("z-index", "0");
  await expect(page.locator(".bp-settings-profile-backdrop img")).toBeVisible();
  await ready();
  await capture("tv");
  for (const [id, label] of [["design", "Diseño"], ["addons", "Complementos"], ["sources", "Fuentes"], ["playback", "Reproducción"], ["about", "Acerca de"]]) {
    const row = surface.getByRole("button", { name: label, exact: true });
    if (!await row.count()) continue;
    await row.focus();
    await expect(surface.locator("[data-settings-category-icon]")).toHaveAttribute("data-settings-category-icon", id);
    await capture(`tv-${id}`);
  }
  await surface.getByRole("button", { name: "Cuenta", exact: true }).click();
  await capture("tv-account");
  await page.keyboard.press("Escape");
  await surface.getByRole("button", { name: "Reproducción", exact: true }).click();
  await surface.getByRole("button", { name: /Idioma de audio preferido/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${output}/tv-popup.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(surface.getByRole("button", { name: "Cuenta", exact: true })).toBeFocused();
  await ready();
  await capture("mobile");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await writeFile(`${output}/metrics.json`, JSON.stringify(metrics, null, 2));
});
