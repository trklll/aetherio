import { test } from "@playwright/test";
import path from "node:path";

/**
 * Congela la base de pixel APROBADA: el clon en espanol, capturado con las
 * MISMAS flags que usa e2e/pause-screen.spec.ts. Si las flags difieren cambia
 * el antialiasing y la tinta se mueve ~20 % sin que cambie ni un pixel de
 * geometria — la puerta mide el delantal, no la pantalla.
 */
test("congela la base aprobada", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 701, height: 438 });
  const url = "http://127.0.0.1:8899/index.html?frozen=1&lang=es";
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => Array.from(document.fonts).some(f => f.status === "loaded" && f.family.includes("Inter")),
    undefined, { timeout: 30000 },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.resolve("artifacts/pause-screen/measure/baseline_es_approved.png") });
});
