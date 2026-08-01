#!/usr/bin/env node
// Job de captura de páginas de archivo de premiaciones bloqueadas por
// Cloudflare u otras protecciones: usa Playwright (navegador real), guarda el
// HTML original en disco y lo envía al importador. Nunca raspa en caliente:
// el Detail no consulta estas páginas; solo el job, con el HTML ya capturado.
//
// Uso:
//   node scripts/capture-awards.mjs --ceremony oscar --editions 63,64
//   node scripts/capture-awards.mjs --ceremony bafta --editions 44-46
//   node scripts/capture-awards.mjs --urls urls.json --out .awards-capture
//
// Opciones:
//   --base-url   URL del worker (por defecto http://127.0.0.1:8787)
//   --token      Token de importación interna (o env AWARDS_IMPORT_TOKEN)
//   --out        Directorio de captura (por defecto .awards-capture)
//   --force      Recaptura aunque el archivo ya exista
//   --resend     Reenvía las capturas ya guardadas en disco sin navegar
//                (para reintentar tras un POST fallido sin recapturar)
//   --tier       source_tier del importador: official | secondary (por
//                defecto secondary para Wikipedia, official para --urls)
//   --no-post    Solo guardar en disco, sin enviar al importador
//   --urls       JSON: { "oscar:63": "https://...", ... } (reemplaza Wikipedia)
//
// El URL oficial de cada edición se obtiene del manifest del worker
// (GET /api/awards/coverage no lo expone; se usa Wikipedia por ceremonia).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args["base-url"] ?? process.env.AWARDS_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const token = args.token ?? process.env.AWARDS_IMPORT_TOKEN ?? "";
const outDir = args.out ?? ".awards-capture";
const force = Boolean(args.force);
const resend = Boolean(args.resend);
const noPost = Boolean(args["no-post"]);
const tierOverride = args.tier === "official" || args.tier === "secondary" ? args.tier : null;

const CEREMONY_IDS = ["oscar", "bafta", "golden_globes", "emmy", "goya", "japan_academy", "crunchyroll", "cannes", "venice", "mar_del_plata"];

const WIKIPEDIA_TITLES = {
  oscar: edition => `${ordinal(edition)} Academy Awards`,
  bafta: edition => `${ordinal(edition)} British Academy Film Awards`,
  golden_globes: edition => `${ordinal(edition)} Golden Globe Awards`,
  emmy: edition => `${ordinal(edition)} Primetime Emmy Awards`,
  goya: edition => `${ordinal(edition)} Goya Awards`,
  japan_academy: edition => `${ordinal(edition)} Japan Academy Film Prize`,
  crunchyroll: edition => `${ordinal(edition)} Crunchyroll Anime Awards`,
  cannes: (_edition, awardYear) => `${awardYear} Cannes Film Festival`,
  venice: edition => `${ordinal(edition)} Venice International Film Festival`,
  mar_del_plata: () => null,
};

const targets = buildTargets();
if (targets.length === 0) fail("No hay ediciones para capturar.");

mkdirSync(outDir, { recursive: true });

let browser = null;
let page = null;
if (!resend) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    fail("Falta playwright: npm i -D playwright en website/ (o usa --urls con HTML ya capturado).");
  }
  browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Aetherio-Awards-Capture/1.0 (Playwright; verificación de archivos de premiaciones)",
    locale: "en-US",
  });
  page = await context.newPage();
}

if (!token && !noPost) fail("Falta el token: --token o env AWARDS_IMPORT_TOKEN (o usa --no-post).");

let captured = 0;
let posted = 0;
const failed = [];

for (const target of targets) {
  const { ceremony, edition } = target;
  const file = join(outDir, ceremony, `${edition}.html`);

  if (resend) {
    if (!existsSync(file)) {
      failed.push(`${ceremony} ${edition}: no hay captura en disco para reenviar`);
      continue;
    }
    try {
      const html = readFileSync(file, "utf8");
      const ok = await postCapture(ceremony, edition, html, target.tier, target.url, true);
      if (ok) {
        posted += 1;
        console.log(`  [send] ${ceremony} ${edition} reenviada desde disco`);
      } else {
        failed.push(`${ceremony} ${edition}: el importador rechazó la captura`);
      }
    } catch (error) {
      failed.push(`${ceremony} ${edition}: ${error instanceof Error ? error.message : "error al reenviar"}`);
    }
    continue;
  }

  if (!force && existsSync(file)) {
    console.log(`  [skip] ${ceremony} ${edition} ya capturada`);
    continue;
  }
  const url = target.url;
  if (!url) {
    failed.push(`${ceremony} ${edition}: sin URL disponible`);
    continue;
  }
  try {
    console.log(`  [get ] ${ceremony} ${edition} -> ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const html = await page.content();
    if (html.length < 2000) throw new Error("HTML capturado sospechosamente corto");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html, "utf8");
    captured += 1;
    if (!noPost) {
      const ok = await postCapture(ceremony, edition, html, target.tier, target.url, force);
      if (ok) posted += 1;
      else failed.push(`${ceremony} ${edition}: el importador rechazó la captura`);
    }
  } catch (error) {
    failed.push(`${ceremony} ${edition}: ${error instanceof Error ? error.message : "error de navegador"}`);
  }
}

await browser?.close?.();
console.log(`[awards-capture] listo: ${captured} capturadas, ${posted} enviadas, ${failed.length} fallidas.`);
if (failed.length > 0) {
  for (const item of failed) console.error(`  - ${item}`);
}
process.exit(failed.length > 0 ? 1 : 0);

async function postCapture(ceremony, edition, html, tier, url, force = false) {
  const payload = { scope: "manual", targets: [{ ceremony, edition, html, tier: tier ?? "secondary", url: url ?? undefined, force }] };
  const response = await fetch(`${baseUrl}/api/internal/awards/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    console.error(`    HTTP ${response.status}: ${text}`);
    return false;
  }
  const body = await response.json().catch(() => null);
  const result = body?.results?.[0];
  const status = result?.ok ? "importada" : `rechazada: ${result?.error ?? "error desconocido"}`;
  console.log(`  [post] ${ceremony} ${edition} ${status}`);
  return result?.ok === true;
}

function buildTargets() {
  const list = [];
  const urlsFile = args.urls;
  const urlsMap = urlsFile
    ? safeJson(readFileSync(urlsFile, "utf8"))
    : null;

  if (urlsMap) {
    for (const [key, url] of Object.entries(urlsMap)) {
      const [ceremony, editionRaw] = key.split(":");
      const edition = Number(editionRaw);
      if (!CEREMONY_IDS.includes(ceremony) || !Number.isInteger(edition) || edition < 1) continue;
      list.push({ ceremony, edition, url, tier: tierOverride ?? "official" });
    }
    return list;
  }

  const ceremonyFilter = args.ceremony ? String(args.ceremony).split(",").map(s => s.trim()).filter(Boolean) : [];
  const editionsSpec = args.editions ? String(args.editions) : null;
  if (ceremonyFilter.length === 0 || !editionsSpec) {
    fail("Se requiere --ceremony y --editions, o --urls urls.json.");
  }
  const unknown = ceremonyFilter.filter(id => !CEREMONY_IDS.includes(id));
  if (unknown.length > 0) fail(`Ceremonias desconocidas: ${unknown.join(", ")}. Válidas: ${CEREMONY_IDS.join(", ")}.`);
  const editions = parseEditions(editionsSpec);
  for (const ceremony of ceremonyFilter) {
    for (const edition of editions) {
      const year = awardYearOf(ceremony, edition);
      const title = WIKIPEDIA_TITLES[ceremony]?.(edition, year);
      list.push({
        ceremony,
        edition,
        url: title ? `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` : null,
        tier: tierOverride ?? "secondary",
      });
    }
  }
  return list;
}

function awardYearOf(ceremony, edition) {
  if (ceremony === "cannes") {
    const skipped = edition >= 3 ? 2 : edition >= 2 ? 1 : 0;
    return 1946 + edition - 1 + skipped;
  }
  if (ceremony === "venice") {
    const explicit = { 1: 1932, 2: 1934, 3: 1935, 4: 1936, 5: 1937, 6: 1938, 7: 1939, 8: 1940, 9: 1941, 10: 1942, 11: 1946, 12: 1947, 13: 1948, 14: 1949 };
    return explicit[edition] ?? edition + 1943;
  }
  if (ceremony === "mar_del_plata") {
    const explicit = { 1: 1954, 2: 1959, 3: 1960, 4: 1961, 5: 1962, 6: 1963, 7: 1964, 8: 1965, 9: 1966, 10: 1967, 11: 1968, 12: 1970, 13: 1996 };
    if (edition >= 13) return [1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2023, 2024, 2025, 2026][edition - 13];
    return explicit[edition] ?? 1954;
  }
  // Las demás ceremonias: la edición N suele premiar obras del año N-1.
  return edition + 1928;
}

function ordinal(edition) {
  const mod100 = edition % 100;
  const mod10 = edition % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${edition}th`;
  if (mod10 === 1) return `${edition}st`;
  if (mod10 === 2) return `${edition}nd`;
  if (mod10 === 3) return `${edition}rd`;
  return `${edition}th`;
}

function parseEditions(spec) {
  const out = [];
  for (const part of String(spec).split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = /^(\d+)-(\d+)$/.exec(trimmed);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < to) {
        for (let edition = from; edition <= to; edition += 1) out.push(edition);
      } else if (from > to) {
        for (let edition = from; edition >= to; edition -= 1) out.push(edition);
      } else {
        out.push(from);
      }
      continue;
    }
    const single = /^\d+$/.exec(trimmed);
    if (single) out.push(Number(single));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        index += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function fail(message) {
  console.error(`[awards-capture] ${message}`);
  process.exit(2);
}
