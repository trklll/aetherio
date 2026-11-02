#!/usr/bin/env node
/**
 * Registrar en el hub (KV, vía API admin) el set completo de proveedores
 * predeterminados de Aetherio, sin tener que publicar una versión de la app.
 *
 * Qué hace:
 *  1. Descarga los manifest de los repos externos de proveedores.
 *  2. Escanea cada script (compatibilidad con el sandbox del hub: CommonJS con
 *     getStreams, require limitado a axios/crypto-js/cheerio, sin eval/new
 *     Function, sin .cs3/pluginLists, sin retirados).
 *  3. Deduplica por id (gana la primera copia compatible del repo con mayor
 *     prioridad) y ordena: PRIORITY_TOP primero (fan-out móvil), resto en orden
 *     de repos.
 *  4. Sincroniza con el hub: borra del KV lo que sobra y hace PUT secuencial en
 *     el orden deseado (el orden del índice KV define warmup y fan-out).
 *
 * Uso:  node scripts/register-defaults.mjs [--apply]
 * Sin --apply muestro el plan (dry-run). El token admin se lee de
 * `.admin-token.local` (o env ADMIN_TOKEN / HUB_ADMIN_TOKEN) y NUNCA se imprime.
 */

import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HUB_URL = "https://aetherio-provider-hub.xoolinnbeats.workers.dev";
const APPLY = process.argv.includes("--apply");
const BUNDLE_ONLY = process.argv.includes("--bundle-only");

/** Orden de preferencia para copias duplicadas entre repos (gana la primera). */
const REPO_PRIORITY = [
  { key: "yoruix", manifest: "https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json", defaultLang: ["en"] },
  { key: "adrianjael", manifest: "https://raw.githubusercontent.com/adrianjael/pluggin-latino/refs/heads/main/manifest.json", defaultLang: ["es"] },
  { key: "kennethjys", manifest: "https://raw.githubusercontent.com/KennethJYS/Nuvio-Providers-Latino/refs/heads/main/manifest.json", defaultLang: ["es"] },
  { key: "eclipsia", manifest: "https://eclipsia.dpdns.org/rc244rsv/manifest.json", defaultLang: ["en"] },
  {
    key: "range7",
    manifest: "https://raw.githubusercontent.com/Range7/Nuvio-Plugin/refs/heads/main/manifest.json",
    defaultLang: ["en"],
    // Aetherio PC ya limitaba este manifest mediante scraperIds.
    allowedIds: new Set(["2peckle"]),
  },
];

/** Retirados por auditoría: no reintroducir bajo ningún id. */
const RETIRED_IDS = new Set([
  "allmovieland", "animepahe", "anizone", "cinemacity", "cinevibe",
  "dahmermovies", "dooflix", "hianime", "mallumv", "moviesdrive",
  "mavonyx", "phraxis", "pynvix", "qyrvaen", "solunix", "vitrix",
]);

/** Retiradas específicas por repo en providerRuntimeService.ts (incluye WIP actual). */
const RETIRED_BY_REPO = new Map([
  ["yoruix", new Set([
    "mycima", "netmirror", "showbox", "streamflix", "uhdmovies",
    "vidlink", "vidnest", "vidnest-anime", "videasy",
  ])],
  ["adrianjael", new Set([
    "cuevanaubd", "hackstore", "lamovie", "pelispanda", "pelisplus",
    "playhubmax", "sololatino", "tioplus", "cinemacity", "videasy",
  ])],
  ["kennethjys", new Set([
    "cinecalidad", "detodopeliculas", "embed69", "hackstore", "lamovie",
    "peliserieshoy", "seriesflix", "seriesmetro", "xupalace",
  ])],
  ["eclipsia", new Set([
    "fendrix", "hexion", "kryxalia", "mavonyx", "phraxis", "pynvix",
    "qyrvaen", "solunix", "vitrix",
  ])],
]);

/** Fan-out móvil (/stream) ejecuta los primeros 6: orden de prioridad manual. */
const PRIORITY_TOP = ["embed69", "moviebox", "4khdhub", "vixsrc", "yflix", "moviesmod"];

/** Scripts incompatibles confirmados por compilación real en el Worker. */
const UNSUPPORTED_IDS = new Map([
  ["dvdplay", "no compila en el sandbox del Worker (axios.defaults.URL_VALIDATION_ENABLED)"],
]);

const ALLOWED_REQUIRES = new Set(["axios", "crypto-js", "cheerio", "cheerio-without-node-native"]);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function fetchJson(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return res.json();
}

/** Escanea un script candidato y devuelve compatibilidad con el sandbox del hub. */
function scanScript(text) {
  const needs = [...new Set([...text.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]))];
  const badRequires = needs.filter(name => !ALLOWED_REQUIRES.has(name));
  const codegen =
    (text.match(/\beval\s*\(/g) || []).length +
    (text.match(/new\s+Function\s*\(/g) || []).length +
    (text.match(/(^|[^\w.])Function\s*\(/g) || []).length;
  return {
    bytes: text.length,
    ok: text.includes("getStreams") && badRequires.length === 0 && codegen === 0,
    reason: !text.includes("getStreams") ? "no getStreams"
      : badRequires.length ? `require: ${badRequires.join(",")}`
      : codegen ? `codegen: ${codegen}` : "",
  };
}

function normalizeTypes(raw) {
  const out = new Set();
  for (const value of Array.isArray(raw) ? raw : []) {
    const v = String(value).toLowerCase();
    if (v === "movie" || v === "movies") out.add("movie");
    if (v === "tv" || v === "series" || v === "tvseries" || v === "shows") out.add("tv");
  }
  return [...out];
}

function resolveLogo(scraper, manifest, scriptText, manifestUrl) {
  const declared = [scraper?.logo, manifest?.logo]
    .find(value => typeof value === "string" && value.trim());
  if (declared) {
    try {
      const url = new URL(declared.trim(), manifestUrl);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch { /* intenta recuperar el favicon del sitio */ }
  }

  // Varios repositorios no declaran logo, aunque el script sí fija el sitio
  // del proveedor. Reutiliza el servicio de favicon usado por manifests reales.
  const siteUrl = scriptText.match(/\b(?:BASE_URL|BASEURL|SITE_URL|SITEURL|BASE|DOMAIN|HOST)\s*[:=]\s*["'`](https?:\/\/[^"'`/?#]+)/i)?.[1];
  let hostname = "";
  try { hostname = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./i, "") : ""; } catch { /* busca otra URL */ }
  if (!hostname) {
    const ignoredHosts = /(?:^|\.)(?:github\.com|githubusercontent\.com|google\.[a-z.]+|googleapis\.com|gstatic\.com|youtube\.com|youtu\.be|imdb\.com|themoviedb\.org|tmdb\.org|wikipedia\.org|cloudflare\.com|jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/i;
    for (const candidate of scriptText.matchAll(/["'`](https?:\/\/[^"'`\s<>]+)/g)) {
      try {
        const host = new URL(candidate[1]).hostname.replace(/^www\./i, "");
        if (host.includes(".") && !ignoredHosts.test(host)) { hostname = host; break; }
      } catch { /* URL literal no válida */ }
    }
  }
  return hostname
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`
    : undefined;
}

async function writeProviderBundle(scriptRoot, providers) {
  const file = path.join(scriptRoot, "src", "generatedProviderScripts.ts");
  const content = [
    "/** Generado por scripts/register-defaults.mjs; no editar a mano. */",
    "export interface GeneratedProviderScript {",
    "  id: string; name: string; description: string; logo?: string;",
    '  supportedTypes: Array<"movie" | "tv">; contentLanguage: string[];',
    "  enabled: boolean; updatedAt: number; source: string;",
    "}",
    `export const GENERATED_PROVIDER_SCRIPTS: readonly GeneratedProviderScript[] = ${JSON.stringify(providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      logo: provider.logo,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage,
      enabled: true,
      updatedAt: Date.now(),
      source: provider.text,
    })))};`,
    "",
  ].join("\n");
  const temp = `${file}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

async function main() {
  const scriptRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

  // 1) captura de candidatos por repo (en orden de prioridad)
  const byId = new Map();
  const rejected = new Map();
  const note = (id, repo, reason) => {
    const list = rejected.get(id) || [];
    list.push(`${repo}:${reason}`);
    rejected.set(id, list);
  };

  for (const repo of REPO_PRIORITY) {
    const manifest = await fetchJson(repo.manifest);
    for (const scraper of await manifest.scrapers || []) {
      if (!scraper || typeof scraper.id !== "string" || !ID_RE.test(scraper.id)) { note(String(scraper?.id), repo.key, "id no válido"); continue; }
      if (repo.allowedIds && !repo.allowedIds.has(scraper.id)) { note(scraper.id, repo.key, "fuera del filtro original de Aetherio"); continue; }
      if (RETIRED_IDS.has(scraper.id) || RETIRED_BY_REPO.get(repo.key)?.has(scraper.id)) { note(scraper.id, repo.key, "retirado por Aetherio/auditoría"); continue; }
      if (byId.has(scraper.id)) { note(scraper.id, repo.key, "duplicado (ya registrado con mayor prioridad)"); continue; }
      if (Array.isArray(scraper.pluginLists) && scraper.pluginLists.length > 0) { note(scraper.id, repo.key, "cloudstream .cs3"); continue; }
      if (UNSUPPORTED_IDS.has(scraper.id)) { note(scraper.id, repo.key, UNSUPPORTED_IDS.get(scraper.id)); continue; }

      const scriptUrl = new URL(scraper.filename, repo.manifest).toString();
      let text;
      try {
        const res = await fetch(scriptUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } catch (error) {
        note(scraper.id, repo.key, `script no descargable (${error.message})`);
        continue;
      }
      const scan = scanScript(text);
      if (!scan.ok) { note(scraper.id, repo.key, scan.reason); continue; }

      const supportedTypes = normalizeTypes(scraper.supportedTypes);
      if (supportedTypes.length === 0) { note(scraper.id, repo.key, "sin movie/tv en supportedTypes"); continue; }
      const contentLanguage = Array.isArray(scraper.contentLanguage) && scraper.contentLanguage.length
        ? scraper.contentLanguage.filter(v => typeof v === "string").slice(0, 6)
        : repo.defaultLang;

      byId.set(scraper.id, {
        id: scraper.id,
        name: String(scraper.name || scraper.id).slice(0, 120),
        description: String(scraper.description || "").slice(0, 300),
        logo: resolveLogo(scraper, manifest, text, repo.manifest),
        supportedTypes,
        contentLanguage,
        repo: repo.key,
        scriptUrl,
        bytes: scan.bytes,
        text,
      });
    }
  }

  // 2) orden deseado: PRIORITY_TOP válido primero; resto en orden de captura
  const candidates = [...byId.values()];
  const wanted = new Set(PRIORITY_TOP.filter(id => byId.has(id)));
  const ordered = [
    ...candidates.filter(c => wanted.has(c.id)).sort((a, b) => PRIORITY_TOP.indexOf(a.id) - PRIORITY_TOP.indexOf(b.id)),
    ...candidates.filter(c => !wanted.has(c.id)),
  ];

  // 3) plan
  console.log(`compatibles: ${ordered.length}`);
  const withLogo = ordered.filter(provider => provider.logo).length;
  console.log(`logos: ${withLogo}/${ordered.length}${withLogo === ordered.length ? "" : ` (sin recuperar: ${ordered.filter(provider => !provider.logo).map(provider => provider.id).join(", ")})`}`);
  for (const [i, c] of ordered.entries()) {
    console.log(`  ${String(i + 1).padStart(2, "0")}. ${c.id.padEnd(20)} ${String(c.bytes).padStart(6)} B  ${c.repo.padEnd(10)} ${c.supportedTypes.join("/")}  ${c.contentLanguage.join(",")}`);
  }
  if (rejected.size) {
    console.log(`descartados: ${rejected.size}`);
    for (const [id, reasons] of rejected) console.log(`  - ${id}: ${reasons.join("; ")}`);
  }

  if (BUNDLE_ONLY) {
    await writeProviderBundle(scriptRoot, ordered);
    console.log(`bundle local generado: ${ordered.length} proveedores, ${ordered.filter(provider => provider.logo).length} logos`);
    return;
  }
  if (!APPLY) { console.log("\n(dry-run; usa --apply para sincronizar el hub)"); return; }

  // 4) token (nunca se imprime)
  let token = process.env.HUB_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!token) {
    try { token = (await readFile(path.join(scriptRoot, ".admin-token.local"), "utf8")).trim(); } catch { /* ausente */ }
  }
  if (!token) { console.error("Sin token admin: define HUB_ADMIN_TOKEN o crea .admin-token.local"); process.exitCode = 1; return; }
  await writeProviderBundle(scriptRoot, ordered);
  const headers = { "x-admin-token": token, "content-type": "application/json" };
  const api = async call => {
    const res = await fetch(call.url, { method: call.method || "GET", headers, body: call.body, signal: AbortSignal.timeout(30_000) });
    let body = null;
    try { body = await res.json(); } catch { /* respuesta no JSON */ }
    return { status: res.status, body };
  };

  // 5) estado previo (solo diagnóstico: la verdad final la fija /admin/index)
  const current = (await api({ url: `${HUB_URL}/admin/providers` })).body || [];
  console.log(`\nestado previo: ${current.length} proveedor(es) en el índice [${current.map(p => p.id).join(", ") || "vacío"}]`);

  // 6) PUTs secuenciales (orden = posición del índice; el alta admin es redundante-sensible)
  let ok = 0, fail = 0;
  for (const [i, c] of ordered.entries()) {
    const body = JSON.stringify({
      name: c.name,
      description: c.description,
      logo: c.logo,
      enabled: true,
      supportedTypes: c.supportedTypes,
      contentLanguage: c.contentLanguage,
      mobileHeaders: "drop",
      scriptUrl: c.scriptUrl,
      // script inline: queda persistido en KV (warmup no depende del repo remoto)
      script: c.text,
    });
    try {
      const res = await api({ url: `${HUB_URL}/admin/providers/${c.id}`, method: "PUT", body });
      if (res.status === 200 && res.body?.ok) { ok++; console.log(`  put ${String(i + 1).padStart(2, "0")}/${ordered.length} ${c.id}`); }
      else { fail++; console.log(`  put ${c.id}: HTTP ${res.status} ${JSON.stringify(res.body)}`); }
    } catch (error) {
      fail++; console.log(`  put ${c.id}: ${error.message}`);
    }
  }

  // 7) sincronización final del índice: orden deseado + limpieza de sobrantes
  const syncBody = JSON.stringify({
    providers: ordered.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      logo: c.logo,
      enabled: true,
      supportedTypes: c.supportedTypes,
      contentLanguage: c.contentLanguage,
      mobileHeaders: "drop",
      scriptUrl: c.scriptUrl,
    })),
  });
  const sync = await api({ url: `${HUB_URL}/admin/index`, method: "PUT", body: syncBody });
  if (sync.status !== 200 || !sync.body?.ok) {
    console.error(`sincronización del índice: HTTP ${sync.status} ${JSON.stringify(sync.body)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`índice sincronizado: ${sync.body.count} proveedor(es); eliminados: ${(sync.body.removed || []).join(", ") || "ninguno"}`);

  // 8) compila los scripts KV como parte del Worker y despliega solo el hub
  console.log("\ncompilando scripts KV y desplegando solo Aetherio Provider Hub…");
  const deploy = spawnSync(process.execPath, [path.join(scriptRoot, "scripts", "deploy-current-providers.mjs")], {
    cwd: scriptRoot,
    env: {
      ...process.env,
      HUB_ADMIN_TOKEN: token,
      HUB_PROVIDER_LOGOS_JSON: JSON.stringify(Object.fromEntries(ordered.map(provider => [provider.id, provider.logo]).filter(([, logo]) => logo))),
    },
    stdio: "inherit",
  });
  if (deploy.error) throw deploy.error;
  if (deploy.status !== 0) {
    console.error(`deploy del hub falló (código ${deploy.status})`);
    process.exitCode = 1;
    return;
  }

  // Con el Worker actualizado, repite la sincronización para que la metadata de
  // logos quede también persistida en KV y no dependa del fallback empaquetado.
  const logoSync = await api({ url: `${HUB_URL}/admin/index`, method: "PUT", body: syncBody });
  if (logoSync.status !== 200 || !logoSync.body?.ok) {
    console.error(`persistencia final de logos: HTTP ${logoSync.status} ${JSON.stringify(logoSync.body)}`);
    process.exitCode = 1;
    return;
  }
  console.log("logos persistidos en KV después del deploy");

  // 9) verificación final (los KV pueden tardar ~60 s en propagar entre pops)
  const desiredIds = ordered.map(c => c.id);
  let after = [];
  let mismatched = true;
  for (let attempt = 0; attempt < 5 && mismatched; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 4000));
    after = (await api({ url: `${HUB_URL}/admin/providers` })).body || [];
    mismatched = after.length !== ordered.length || after.some((p, i) => p.id !== desiredIds[i]);
    console.log(mismatched
      ? `  intento ${attempt + 1}: índice ${after.length}/${ordered.length}${after.length < 3 ? ` [${after.map(p => p.id).join(", ")}]` : ""} — esperando propagación KV…`
      : `  intento ${attempt + 1}: índice verificado (${after.length} proveedores, orden correcto)`);
  }
  console.log(`\nresultado: ${ok} ok, ${fail} fallo; índice final ${after.length} proveedor(es)`);
  console.log(`orden: ${after.map(p => p.id).join(", ")}`);
  if (fail > 0 || mismatched) process.exitCode = 1;
}

await main();
