import { test } from "@playwright/test";
import fs from "node:fs";

function rows(file: string) {
  const png = fs.readFileSync(file);
  // crude: reuse PIL outside; here only report DOM side
  return null;
}

test("DIAG desc", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 701, height: 438 });
  await page.goto("/artifacts/pause-screen/harness.html?delay=0", { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__harnessReady === true", undefined, { timeout: 20000 });
  await page.waitForFunction(() => {
    const o = document.querySelector("[data-player-pause-screen]");
    return o && getComputedStyle(o).opacity === "1";
  }, undefined, { timeout: 20000 });
  const comp = await page.evaluate(() => {
    const d = document.querySelector("[data-player-pause-desc]")!;
    const r = document.createRange();
    const lines: { y: number; w: number }[] = [];
    const text = d.firstChild as Text;
    for (let i = 0; i < text.length; i++) {
      r.setStart(text, i); r.setEnd(text, i + 1);
      const b = r.getBoundingClientRect();
      const last = lines[lines.length - 1];
      if (last && Math.abs(b.top - last.y) > 1) { lines.push({ y: b.top, w: b.width }); }
      else if (last) { last.w = Math.max(last.w, b.right - (r.getBoundingClientRect().left - b.width)); }
    }
    return { text: d.textContent, w: d.getBoundingClientRect().width, h: d.getBoundingClientRect().height, lines: lines.length };
  });
  console.log("DIAG-COMP-DESC " + JSON.stringify(comp));
});
