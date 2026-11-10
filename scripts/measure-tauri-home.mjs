// Measures the existing Tauri WebView2 window. No browser launch, fixtures,
// request interception, storage seeding, or application settings changes.
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const { values } = parseArgs({ options: {
  endpoint: { type: "string", default: "http://127.0.0.1:9231" },
  out: { type: "string", default: "artifacts/tauri-home-profile" },
  pid: { type: "string" },
  inspect: { type: "boolean", default: false },
  mode: { type: "string", default: "normal" },
  navigate: { type: "boolean", default: false },
  passes: { type: "string", default: "3" },
  ticks: { type: "string", default: "72" },
  interval: { type: "string", default: "100" },
  trace: { type: "boolean", default: false },
} });
const out = path.resolve(values.out);
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP(values.endpoint, { timeout: 120_000 });
const pages = browser.contexts().flatMap(context => context.pages());
let page;
for (const candidate of pages) {
  if (candidate.url().includes("window=splash")) continue;
  if (await candidate.evaluate(() => Boolean(window.__TAURI_INTERNALS__)).catch(() => false)) {
    page = candidate;
    break;
  }
}
if (!page) throw new Error(`No native Tauri main WebView found: ${pages.map(page => page.url()).join(", ")}`);

const inspect = () => page.evaluate(() => ({
  url: location.href, title: document.title,
  tauri: Boolean(window.__TAURI_INTERNALS__),
  windowLabel: window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label,
  userAgent: navigator.userAgent,
  viewport: [innerWidth, innerHeight, devicePixelRatio],
  visibility: document.visibilityState, focused: document.hasFocus(),
  rows: document.querySelectorAll(".home-page-scale [data-row-key]").length,
  images: document.images.length,
  loadedImages: Array.from(document.images).filter(image => image.complete && image.naturalWidth > 0).length,
  bodyText: document.body.innerText.slice(0, 1400),
}));
if (values.inspect) {
  console.log(JSON.stringify(await inspect(), null, 2));
  await page.screenshot({ path: path.join(out, "inspect.png") });
  // Disconnect the measuring client without closing the user's native app.
  process.exit(0);
}
if (!values.pid) throw new Error("--pid is required: measure an explicit native app process");
const route = values.mode === "tv" ? "/big-picture" : "/home";
if (values.navigate) await page.goto(new URL(route, page.url()).href, { waitUntil: "domcontentloaded" });
if (new URL(page.url()).pathname !== route) throw new Error(`Expected ${route}; found ${page.url()}. Select a profile normally first.`);
await page.locator(".home-page-scale").waitFor({ state: "visible", timeout: 180_000 });
await page.waitForFunction(() => document.querySelectorAll(".home-page-scale [data-row-key]").length >= 5, undefined, { timeout: 180_000 });
const runFile = promisify(execFile);
const wheelScript = path.resolve("scripts/tauri-wheel-input.py");
const input = async ticks => {
  const { stdout } = await runFile("python", [wheelScript, "--pid", values.pid, "--ticks", String(ticks), "--interval-ms", values.interval], { timeout: 60_000 });
  return JSON.parse(stdout);
};
const nativeWindow = await input(0);
const environment = await inspect();
delete environment.bodyText;
const cdp = await page.context().newCDPSession(page);
const version = await cdp.send("Browser.getVersion");
await cdp.send("Performance.enable");

async function resetToTop() {
  await page.evaluate(async () => {
    const { stopInertialScroll } = await import("/src/utils/motion.ts");
    const shell = document.querySelector("[data-aetherio-scroll-shell]");
    stopInertialScroll(shell);
    shell.scrollTo({ top: 0, behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function startSample() {
  return page.evaluate(() => {
    if (window.__tauriHomeProbe) throw new Error("A sample is already active");
    const probe = {
      frames: [], wheels: [], longTasks: [], visibilityChanges: [],
      start: performance.now(), previous: 0, raf: 0,
      initialScrollTop: document.querySelector("[data-aetherio-scroll-shell]").scrollTop,
    };
    probe.previous = probe.start;
    const tick = now => {
      probe.frames.push({ at: now, ms: now - probe.previous });
      probe.previous = now;
      probe.raf = requestAnimationFrame(tick);
    };
    const wheel = event => probe.wheels.push({ at: performance.now(), deltaY: event.deltaY, trusted: event.isTrusted, cancelled: event.defaultPrevented });
    const visibility = () => probe.visibilityChanges.push({ at: performance.now(), state: document.visibilityState });
    const observer = new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => ({ at: entry.startTime, ms: entry.duration }))));
    observer.observe({ type: "longtask" });
    document.addEventListener("wheel", wheel, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    probe.stop = () => {
      cancelAnimationFrame(probe.raf);
      observer.disconnect();
      document.removeEventListener("wheel", wheel);
      document.removeEventListener("visibilitychange", visibility);
    };
    window.__tauriHomeProbe = probe;
    probe.raf = requestAnimationFrame(tick);
    performance.mark("aetherio-home-measure-start");
  });
}
async function finishSample() {
  return page.evaluate(() => {
    const probe = window.__tauriHomeProbe;
    probe.stop();
    delete window.__tauriHomeProbe;
    performance.mark("aetherio-home-measure-end");
    const shell = document.querySelector("[data-aetherio-scroll-shell]");
    const { stop, raf, ...data } = probe;
    return { ...data, end: performance.now(), finalScrollTop: shell.scrollTop, scrollHeight: shell.scrollHeight,
      focused: document.hasFocus(), visibility: document.visibilityState,
      loadedImages: Array.from(document.images).filter(image => image.complete && image.naturalWidth > 0).length };
  });
}
// The idle calibration and post-input settling intervals are explicit parts of
// the protocol; they do not stand in for application readiness checks.
async function animationTime(ms) {
  await page.evaluate(ms => new Promise(resolve => {
    const start = performance.now();
    const tick = now => now - start >= ms ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }), ms);
}
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
const round = number => Math.round(number * 100) / 100;
function summarize(raw, budget, activeOnly) {
  const from = activeOnly && raw.wheels.length ? raw.wheels[0].at : raw.start;
  const until = activeOnly && raw.wheels.length ? Math.min(raw.end, raw.wheels.at(-1).at + 1200) : raw.end;
  const frames = raw.frames.filter(frame => frame.at - frame.ms >= from && frame.at <= until);
  const times = frames.map(frame => frame.ms).sort((a, b) => a - b);
  let episodes = 0, previousBad = false;
  let episodesOver33Ms = 0, episodesOver50Ms = 0, previousOver33 = false, previousOver50 = false;
  for (const frame of frames) {
    const bad = frame.ms > budget * 1.5;
    if (bad && !previousBad) episodes += 1;
    previousBad = bad;
    if (frame.ms > 33.4 && !previousOver33) episodesOver33Ms += 1;
    if (frame.ms > 50 && !previousOver50) episodesOver50Ms += 1;
    previousOver33 = frame.ms > 33.4;
    previousOver50 = frame.ms > 50;
  }
  return {
    durationMs: round(until - from), frames: frames.length,
    averageRafFps: round(frames.length * 1000 / frames.reduce((sum, frame) => sum + frame.ms, 0)),
    frameBudgetMs: round(budget), frameP95Ms: round(percentile(times, 0.95)), frameP99Ms: round(percentile(times, 0.99)),
    maxFrameMs: round(times.at(-1) ?? 0),
    missedDeadlineIntervals: frames.filter(frame => frame.ms > budget * 1.5).length,
    stutterEpisodes: episodes,
    episodesOver33Ms, episodesOver50Ms,
    estimatedMissedVsyncs: frames.reduce((sum, frame) => sum + Math.max(0, Math.round(frame.ms / budget) - 1), 0),
    intervalsOver33Ms: frames.filter(frame => frame.ms > 33.4).length,
    intervalsOver50Ms: frames.filter(frame => frame.ms > 50).length,
    intervalsOver100Ms: frames.filter(frame => frame.ms > 100).length,
    longTasks: raw.longTasks.filter(task => task.at >= from && task.at <= until).length,
    longTaskTotalMs: round(raw.longTasks.filter(task => task.at >= from && task.at <= until).reduce((sum, task) => sum + task.ms, 0)),
    wheelEvents: raw.wheels.length, trustedWheelEvents: raw.wheels.filter(wheel => wheel.trusted).length,
    initialScrollTop: raw.initialScrollTop, finalScrollTop: raw.finalScrollTop,
    scrollDistancePx: round(raw.finalScrollTop - raw.initialScrollTop),
    loadedImages: raw.loadedImages, focused: raw.focused, visibility: raw.visibility,
    visibilityChanges: raw.visibilityChanges,
  };
}

await resetToTop();
await startSample();
await animationTime(2500);
const idle = await finishSample();
const idleTimes = idle.frames.slice(5).map(frame => frame.ms).sort((a, b) => a - b);
const frameBudget = percentile(idleTimes, 0.5);
const report = {
  capturedAt: new Date().toISOString(), mode: values.mode,
  protocol: { input: "Windows mouse_event wheel (-120 per tick), foreground native Tauri WebView2", ticks: Number(values.ticks), intervalMs: Number(values.interval),
    note: "rAF measures animation/main-thread deadlines. Missed vsyncs are estimates, NOT physical display/PresentMon frame drops. Trace runs include extra profiling overhead.", trace: values.trace },
  environment, nativeWindow, browserVersion: version, observedIdleRefreshHz: round(1000 / frameBudget),
  idle: summarize(idle, frameBudget, false), runs: [],
};
await writeFile(path.join(out, `${values.mode}-idle-raw.json`), JSON.stringify(idle));
for (let pass = 1; pass <= Number(values.passes); pass++) {
  await resetToTop();
  await input(0);
  await animationTime(700);
  await page.screenshot({ path: path.join(out, `${values.mode}-${pass}-before.png`) });
  let traceComplete;
  if (values.trace) {
    traceComplete = new Promise(resolve => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,cc,viz,blink.user_timing,toplevel", transferMode: "ReturnAsStream" });
  }
  const beforeMetrics = await cdp.send("Performance.getMetrics");
  await startSample();
  const injection = await input(Number(values.ticks));
  await animationTime(1400);
  const raw = await finishSample();
  const afterMetrics = await cdp.send("Performance.getMetrics");
  if (values.trace) {
    await cdp.send("Tracing.end");
    const { stream } = await traceComplete;
    const chunks = [];
    for (;;) {
      const chunk = await cdp.send("IO.read", { handle: stream });
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
      if (chunk.eof) break;
    }
    await cdp.send("IO.close", { handle: stream });
    await writeFile(path.join(out, `${values.mode}-${pass}-trace.json.gz`), gzipSync(Buffer.concat(chunks)));
  }
  const delta = name => (afterMetrics.metrics.find(metric => metric.name === name)?.value ?? 0) - (beforeMetrics.metrics.find(metric => metric.name === name)?.value ?? 0);
  const summary = { pass, ...summarize(raw, frameBudget, true),
    scriptMs: round(delta("ScriptDuration") * 1000), layoutMs: round(delta("LayoutDuration") * 1000), layouts: delta("LayoutCount"), injection };
  report.runs.push(summary);
  await writeFile(path.join(out, `${values.mode}-${pass}-raw.json`), JSON.stringify(raw));
  await writeFile(path.join(out, `${values.mode}-report.json`), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(out, `${values.mode}-${pass}-after.png`) });
  console.log(JSON.stringify({ mode: values.mode, ...summary }));
}
await cdp.detach();
console.log(`Report: ${path.join(out, `${values.mode}-report.json`)}`);
process.exit(0);
