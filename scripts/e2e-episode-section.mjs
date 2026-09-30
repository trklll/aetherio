import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = "C:\\Users\\Administrator\\Documents\\Projects\\aetherio";
const ARTIFACTS = path.join(ROOT, "artifacts", "episode-section");
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

function startPreview(log) {
  const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteBin, "preview", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", chunk => log.push(`[preview] ${chunk}`));
  child.stderr.on("data", chunk => log.push(`[preview:err] ${chunk}`));
  child.on("error", error => log.push(`[preview:spawn-error] ${error?.message ?? error}`));
  return child;
}

const serverLog = [];

async function waitForServer(retries = 60) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(BASE, { method: "GET" });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise(resolve => { setTimeout(resolve, 1000); });
  }
  console.error(`SERVER LOG TAIL:\n${serverLog.join("").slice(-2000)}`);
  throw new Error("preview server did not start");
}

const report = {};
const consoleErrors = [];
const pageErrors = [];

async function main() {
  const server = startPreview(serverLog);
  const killServer = () => { try { server.kill("SIGKILL"); } catch { /* noop */ } };
  process.on("exit", killServer);
  try {
    await waitForServer();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await context.addInitScript(() => {
        const now = Date.now();
        const profile = { id: "e2e-profile-1", name: "E2E", createdAt: now, updatedAt: now };
        localStorage.setItem("aetherio-local-mode-v1", "1");
        localStorage.setItem("aetherio-profile-space-v2:local:migrated", "1");
        localStorage.setItem("aetherio-profile-space-v2:local:profiles", JSON.stringify([profile]));
        localStorage.setItem("aetherio-profile-space-v2:local:active", profile.id);
      });
      const page = await context.newPage();
      page.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
      });
      page.on("pageerror", error => pageErrors.push(String(error).slice(0, 300)));

      await page.goto(`${BASE}/big-picture/detail/movie/tmdb:550`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(10000);
      const entryState = await page.evaluate(() => ({
        url: location.href,
        bodyText: (document.body.innerText ?? "").slice(0, 400),
        hasDetailContent: document.querySelectorAll("[data-aetherio-detail-content]").length,
        hasBigPicture: document.querySelectorAll("[data-aetherio-big-picture]").length,
        profiles: localStorage.getItem("aetherio-profile-space-v2:local:profiles")?.slice(0, 120) ?? null,
        active: localStorage.getItem("aetherio-profile-space-v2:local:active"),
        localMode: localStorage.getItem("aetherio-local-mode-v1"),
      }));
      report.entry = entryState;
      console.log(`ENTRY: ${JSON.stringify(entryState)}`);
      await page.screenshot({ path: path.join(ARTIFACTS, "00-entry.png") });
      if (entryState.url.includes("/profiles")) {
        await page.getByText("E2E", { exact: true }).click({ timeout: 15000 });
        await page.waitForURL(url => !url.pathname.startsWith("/profiles"), { timeout: 60000 });
        console.log(`AFTER PROFILE: ${page.url()}`);
        // Client-side navigation (no reload: App bounces deep links to /profiles on boot).
        await page.evaluate(() => {
          window.history.pushState({}, "", "/big-picture/detail/movie/tmdb:550");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.waitForTimeout(10000);
        const detailEntry = await page.evaluate(() => ({
          url: location.href,
          bodyText: (document.body.innerText ?? "").slice(0, 500),
          hasBigPicture: document.querySelectorAll("[data-aetherio-big-picture]").length,
          hasDetailContent: document.querySelectorAll("[data-aetherio-detail-content]").length,
          hasShellPreview: document.querySelectorAll("[data-shell-preview]").length,
          hasLoading: document.body.innerText.includes("Cargando"),
        }));
        console.log(`DETAIL ENTRY: ${JSON.stringify(detailEntry)}`);
        await page.screenshot({ path: path.join(ARTIFACTS, "00b-detail-entry.png") });
      }
      await page.waitForSelector("[data-aetherio-detail-content]", { timeout: 60000 });
      await page.waitForSelector("[data-hero-primary]", { timeout: 60000 });
      // Let entrance animations + artwork settle.
      await page.waitForTimeout(4000);

      const detailState = await page.evaluate(() => {
        const content = document.querySelector("[data-aetherio-detail-content]");
        const play = document.querySelector("[data-hero-primary]");
        const backdropImgs = Array.from(
          document.querySelectorAll("[data-bp-detail-background] img"),
        ).map(img => img.currentSrc || img.src);
        const style = content ? getComputedStyle(content) : null;
        return {
          contentVisible: style ? (style.visibility !== "hidden" && Number(style.opacity) > 0.5) : false,
          playLabel: play ? play.textContent.trim().slice(0, 40) : null,
          backdropCount: backdropImgs.length,
          backdropSrc: backdropImgs[0]?.slice(0, 90) ?? null,
          title: document.title,
        };
      });
      report.detail = detailState;
      await page.screenshot({ path: path.join(ARTIFACTS, "01-detail.png") });

      await page.locator("[data-hero-primary]").click({ timeout: 15000 });
      // Poll for the section marker instead of sleeping blindly.
      let sectionFound = false;
      for (let i = 0; i < 40; i += 1) {
        const count = await page.locator("[data-aetherio-episode-section]").count();
        if (count > 0) {
          sectionFound = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      report.sectionMarkerFound = sectionFound;
      // Let the reveal animation finish.
      await page.waitForTimeout(2500);

      const alignState = await page.evaluate(() => {
        const overlay = document.querySelector("[data-aetherio-episode-section]");
        const card = overlay?.querySelector(".episode-media-card") ?? null;
        const panel = overlay?.querySelector("section[aria-label]") ?? null;
        const cardBox = card ? card.getBoundingClientRect() : null;
        const panelBox = panel ? panel.getBoundingClientRect() : null;
        const overlayStyle = overlay ? getComputedStyle(overlay) : null;
        return {
          cardTop: cardBox ? Math.round(cardBox.top) : null,
          cardBottom: cardBox ? Math.round(cardBox.bottom) : null,
          panelTop: panelBox ? Math.round(panelBox.top) : null,
          panelBottom: panelBox ? Math.round(panelBox.bottom) : null,
          overlayPosition: overlayStyle?.position ?? null,
          viewportH: window.innerHeight,
        };
      });
      report.align = alignState;
        const sections = Array.from(document.querySelectorAll("[data-aetherio-episode-section]"));
        const overlay = sections[0] ?? null;
        const overlayStyle = overlay ? getComputedStyle(overlay) : null;
        const firstChild = overlay?.firstElementChild ?? null;
        const box = overlay ? overlay.getBoundingClientRect() : null;
        const backdrop = document.querySelector("[data-bp-detail-background] > div > div");
        const backdropFilter = backdrop ? getComputedStyle(backdrop).filter : null;
        const content = document.querySelector("[data-aetherio-detail-content]");
        const contentStyle = content ? getComputedStyle(content) : null;
        const bodyText = document.body.innerText ?? "";
        return {
          sectionCount: sections.length,
          overlayVisible: overlayStyle ? (overlayStyle.visibility !== "hidden" && Number(overlayStyle.opacity) > 0.5) : false,
          overlayBox: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
          overlayChildElements: overlay ? overlay.querySelectorAll("*").length : 0,
          overlayDebug: overlay?.getAttribute("data-debug"),
          episodieDebug: (() => {
            const el = overlay?.querySelector("[data-debug-q]");
            return el ? { qo: el.getAttribute("data-debug-qo"), q: el.getAttribute("data-debug-q"), meta: el.getAttribute("data-debug-meta") } : null;
          })(),
          firstChildTag: firstChild ? `${firstChild.tagName}.${(firstChild.className?.baseVal ?? firstChild.className ?? "").toString().slice(0, 80)}` : null,
          firstChildBusy: firstChild?.getAttribute("aria-busy"),
          firstChildText: (firstChild?.textContent ?? "").trim().slice(0, 200),
          allSectionTags: sections.map(s => `${s.tagName}:busy=${s.getAttribute("aria-busy")}:kids=${s.querySelectorAll("*").length}`).slice(0, 4),
          panelKids: (() => {
            const panel = overlay?.querySelector("section[aria-label]");
            if (!panel) return ["panel MISSING"];
            return Array.from(panel.children).map(child => {
              const box = child.getBoundingClientRect();
              const cls = (child.className?.baseVal ?? child.className ?? "").toString().replace(/\s+/g, " ").slice(0, 100);
              return `${child.tagName}.${cls} rect=${Math.round(box.width)}x${Math.round(box.height)} kids=${child.querySelectorAll("*").length} text=${(child.textContent ?? "").trim().slice(0, 60)}`;
            });
          })(),
          streamButtons: overlay ? overlay.querySelectorAll("[data-bp-episode-streams] button").length : -1,
          layers: (() => {
            const overlay = document.querySelector("[data-aetherio-episode-section]");
            const pick = selector => {
              const el = overlay ? overlay.querySelector(selector) : null;
              if (!el) return `${selector}: MISSING`;
              const style = getComputedStyle(el);
              const box = el.getBoundingClientRect();
              return `${selector}: op=${style.opacity} vis=${style.visibility} disp=${style.display} rect=${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}`;
            };
            const overlayStyle = overlay ? getComputedStyle(overlay) : null;
            const overlayBox = overlay ? overlay.getBoundingClientRect() : null;
            return [
              `overlay: op=${overlayStyle?.opacity} vis=${overlayStyle?.visibility} rect=${overlayBox ? `${Math.round(overlayBox.width)}x${Math.round(overlayBox.height)}` : "none"}`,
              pick(":scope > div"),
              pick(".episode-page-layout"),
              pick(".episode-hero-main"),
              pick(".episode-media-card"),
              pick(".episode-hero-copy"),
              pick("section[aria-label]"),
            ];
          })(),
          hitTest: (() => {
            const overlay = document.querySelector("[data-aetherio-episode-section]");
            const volver = overlay ? Array.from(overlay.querySelectorAll("button")).find(b => (b.textContent ?? "").includes("Volver")) : null;
            const box = volver ? volver.getBoundingClientRect() : null;
            const cx = box ? box.x + box.width / 2 : 960;
            const cy = box ? box.y + box.height / 2 : 200;
            const hit = document.elementFromPoint(cx, cy);
            const chain = [];
            let node = overlay;
            while (node && chain.length < 6) {
              const style = node instanceof Element ? getComputedStyle(node) : null;
              chain.push(`${node.nodeName}[pos=${style?.position} z=${style?.zIndex} op=${style?.opacity} ov=${style?.overflowY}]`);
              node = node.parentElement;
            }
            const describe = el => el ? `${el.tagName}.${(el.className?.baseVal ?? el.className ?? "").toString().replace(/\s+/g, " ").slice(0, 60)}#${el.id || "-"}` : "none";
            return {
              volverBox: box ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}` : "NO VOLVER BTN",
              point: `${Math.round(cx)},${Math.round(cy)}`,
              hit: describe(hit),
              hitText: (hit?.textContent ?? "").trim().slice(0, 80),
              chain,
            };
          })(),
          historyState: (() => { try { return JSON.stringify(window.history.state).slice(0, 500); } catch { return "unreadable"; } })(),
          detailContentCount: document.querySelectorAll("[data-aetherio-detail-content]").length,
          detailRoots: document.querySelectorAll("[data-aetherio-big-picture]").length,
          searchParams: location.search,
          hasVolver: bodyText.includes("Volver al detalle") || bodyText.includes("Volver"),
          hasPickStreams: bodyText.includes("Seleccionar fuente"),
          hasSinFuentes: bodyText.includes("Sin fuentes"),
          hasBuscando: bodyText.includes("Buscando fuentes"),
          hasHeroTitle: bodyText.includes("Fight Club"),
          backdropFilter,
          detailContentOpacity: contentStyle?.opacity ?? null,
          detailContentVisibility: contentStyle?.visibility ?? null,
          bodyTextLength: bodyText.length,
        };
      });
      report.section = sectionState;
      await page.screenshot({ path: path.join(ARTIFACTS, "02-section.png") });

      await page.keyboard.press("Escape");
      await page.waitForTimeout(2000);
      const backState = await page.evaluate(() => {
        const sections = document.querySelectorAll("[data-aetherio-episode-section]").length;
        const content = document.querySelector("[data-aetherio-detail-content]");
        const style = content ? getComputedStyle(content) : null;
        const backdrop = document.querySelector("[data-bp-detail-background] > div > div");
        return {
          sectionCount: sections,
          contentVisible: style ? (style.visibility !== "hidden" && Number(style.opacity) > 0.5) : false,
          backdropFilter: backdrop ? getComputedStyle(backdrop).filter : null,
        };
      });
      report.back = backState;
      await page.screenshot({ path: path.join(ARTIFACTS, "03-back.png") });

      await browser.close();
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    killServer();
  }
  report.consoleErrors = consoleErrors.slice(0, 12);
  report.pageErrors = pageErrors.slice(0, 12);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(`E2E FAILED: ${error?.message ?? error}`);
  process.exit(1);
});

// Expose server log on failure paths via env flag (kept simple: always print tail).
process.on("uncaughtException", error => {
  console.error(`UNCAUGHT: ${error?.message ?? error}`);
  process.exit(1);
});
