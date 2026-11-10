import { expect, test } from "@playwright/test";

for (const scale of [0.8, 1, 1.2, 1.5]) {
  test(`virtualized row memory survives remount, reordering and removal at scale ${scale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/__spatial-row-probe", route => route.fulfill({ contentType: "text/html", body: `
      <!doctype html><html><body><div id="root"></div><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { mountSpatialRowsProbe } = await import("/e2e/fixtures/SpatialRowsProbe.ts");
      mountSpatialRowsProbe(${scale});
      </script></body></html>
    ` }));
    await page.goto("/__spatial-row-probe");
    const collection = page.locator('[data-row-key="collection"]');
    await expect(collection).toBeVisible();
    await collection.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 60 * (137 + 31); });
    const remembered = page.getByRole("button", { name: "collection 60", exact: true });
    await remembered.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Back to rows", exact: true }).click();
    await expect(remembered).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("button", { name: "middle 0", exact: true })).toBeFocused();
    await collection.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 0; });
    await expect(remembered).toHaveCount(0);

    const previous = page.getByRole("button", { name: "middle 0", exact: true });
    await previous.focus();
    await page.keyboard.press("ArrowDown");
    await expect(remembered).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(previous).toBeFocused();

    await page.getByRole("button", { name: "Reorder and remove rows", exact: true }).click();
    await expect(page.locator("[data-row-key]")).toHaveCount(3);
    await page.getByRole("button", { name: "last 0", exact: true }).focus();
    await collection.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 0; });
    await page.keyboard.press("ArrowDown");
    await expect(remembered).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "first 0", exact: true })).toBeFocused();
  });
}

test("return restores all row offsets, the focused card and its screen position", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/__row-position-probe", route => route.fulfill({ contentType: "text/html", body: `
    <!doctype html><html><body><div id="root"></div><script type="module">
    import RefreshRuntime from "/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { mountSpatialRowsProbe } = await import("/e2e/fixtures/SpatialRowsProbe.ts");
    mountSpatialRowsProbe(1.2);
    </script></body></html>
  ` }));
  await page.goto("/__row-position-probe");
  const other = page.locator('[data-row-key="other"] [data-row-scroller]');
  await other.evaluate(element => { element.scrollLeft = 900; });
  const row = page.locator('[data-row-key="collection"]');
  await row.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 60 * 168 - 83; });
  const card = page.getByRole("button", { name: "collection 60", exact: true });
  await card.focus();
  await page.locator("[data-aetherio-scroll-shell]").evaluate(element => { element.scrollTop = 180; });
  const before = await card.boundingBox();
  const horizontal = await row.locator("[data-row-scroller]").evaluate(element => element.scrollLeft);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Back to rows", exact: true }).click();
  await expect(card).toBeFocused();
  await expect.poll(() => row.locator("[data-row-scroller]").evaluate(element => element.scrollLeft)).toBe(horizontal);
  await expect.poll(() => page.locator("[data-aetherio-scroll-shell]").evaluate(element => element.scrollTop)).toBe(180);
  await expect.poll(() => other.evaluate(element => element.scrollLeft)).toBe(900);
  const after = await card.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
});
