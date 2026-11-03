#!/usr/bin/env node
/** Import is explicit and build-time only. Remote code is pinned by SHA-256;
 * deployment never downloads/evaluates a marketplace payload in a handler. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const MARKETPLACE_URL = "https://raw.githubusercontent.com/Bas1874/Seanime-Marketplace/refs/heads/main/Marketplace/Main.json";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HUB = "https://aetherio-provider-hub.xoolinnbeats.workers.dev";
const OUTPUT = path.join(ROOT, "src/seanime");

export function selectSpanishAnimeProviders(entries) {
  const seen = new Set();
  return entries.filter(entry => entry && entry.type === "onlinestream-provider" && /^es(?:-|$)/i.test(entry.lang)
    && entry.id !== "animeav1"
    && !seen.has(entry.id) && seen.add(entry.id));
}

// Additional sources require positive raw/softsub evidence at result level.
// Language labels describe a site's UI/subtitles, not the audio of each release.
const ONLINE_SOFT = new Map([
  ["animeya", { servers: ["Softsub"] }],
  ["anipm", { servers: ["AniPM (Soft)"] }],
  ["aq-anizone", { trustedSoft: true }],
  ["aq-kickassanime", { trustedSoft: true }],
  ["xanime", { trustedSoft: true }],
  ["reanime", { trustedSoft: true }],
  ["uniquestream", { trustedSoft: true, servers: ["Japanese"] }],
]);
const OMIT_TORRENTS = new Set(["acgnx", "animetosho", "lst", "nyaa-non-eng", "nyaa-sukebei", "AniLiberty"]);

export function selectAdditionalAnimeProviders(entries) {
  return entries.filter(entry => /^(?:multi|en|ja)$/i.test(entry.lang ?? "") && !entry.deprecatedTag && !entry.brokenTag && (
    entry.type === "onlinestream-provider" && ONLINE_SOFT.has(entry.id)
    || entry.type === "anime-torrent-provider" && !OMIT_TORRENTS.has(entry.id)
  ));
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error(`Payload demasiado grande: ${url}`);
  return text;
}

export async function bundleSeanimeProvider(source, metadata, adapterOptions = {}) {
  const input = `
    import {createSeanimeAdapter} from "./src/seanime/adapter.ts";
    import {createCompatibility} from "./src/seanime/compat.ts";
    const Crypto = require("crypto-js");
    const dom = require("cheerio");
    module.exports = createSeanimeAdapter(context => {
      const {fetch, CryptoJS, $store, $scannerUtils, $habari, $torrentUtils,
        $getUserPreference, $toString, $toBytes, $isOffline, $sleep, LoadDoc, Doc, load} = context;
      ${source}
      const provider = new Provider();
      ${adapterOptions.servers ? `const settings = provider.getSettings.bind(provider); provider.getSettings = () => ({...settings(), episodeServers: ${JSON.stringify(adapterOptions.servers)}});` : ""}
      return provider;
    }, ${JSON.stringify(metadata)}, {CryptoJS: Crypto, compat: createCompatibility(dom, Crypto)});
  `;
  const result = await build({ stdin: { contents: input, loader: "ts", resolveDir: ROOT, sourcefile: "seanime-provider.ts" },
    bundle: true, write: false, platform: "browser", format: "cjs", target: "es2022", external: ["crypto-js", "cheerio"], legalComments: "inline", logLevel: "silent" });
  const code = `/** ${metadata.name} — Seanime adaptation; upstream preserved in upstream/${metadata.id}.ts.txt. */\n` + result.outputFiles[0].text;
  if (Buffer.byteLength(code) > 512 * 1024) throw new Error(`${metadata.id}: bundle excede 512 KB`);
  return code;
}

function expandConfig(source, config) {
  return source.replace(/\{\{([\w-]+)\}\}/g, (full, key) => key in config ? String(config[key]).replace(/\\/g, "\\\\").replace(/"/g, '\\"') : full);
}

async function writeCatalog(records) {
  const included = records.filter(record => !record.excluded);
  const generated = ["/** Generado por scripts/import-seanime-providers.mjs. No editar a mano. */",
    ...included.map(record => `import source_${record.id.replace(/-/g, "_")} from "../assets/seanime/${record.id}.js.txt";`),
    "export const SEANIME_PROVIDER_SCRIPTS = [",
    ...included.map(record => `  { ...${JSON.stringify(record)}, compileAlways: true, supportedTypes: ["movie", "tv"] as Array<"movie" | "tv">, contentLanguage: [${JSON.stringify(record.lang)}], updatedAt: 0, source: source_${record.id.replace(/-/g, "_")} },`),
    "] as const;", ""].join("\n");
  await writeFile(path.join(OUTPUT, "generatedCatalog.ts"), generated);
  await writeFile(path.join(OUTPUT, "catalogLogos.ts"), "/** Generado por import-seanime-providers.mjs. */\nexport const SEANIME_LOGOS: Record<string, string> = " + JSON.stringify(Object.fromEntries(included.filter(record => record.icon).map(record => [record.id, record.icon]))) + ";\n");
}

export async function rebuildLockedProviders() {
  const { records } = JSON.parse(await readFile(path.join(OUTPUT, "catalog.lock.json"), "utf8"));
  for (const record of records.filter(record => !record.excluded)) {
    const source = await readFile(path.join(OUTPUT, "upstream", record.id + ".ts.txt"), "utf8");
    if (createHash("sha256").update(source).digest("hex") !== record.sourceSha256) throw new Error(`${record.id}: SHA-256 upstream no coincide`);
    const code = await bundleSeanimeProvider(expandConfig(source, record.config), record, ONLINE_SOFT.get(record.id) ?? {});
    await writeFile(path.join(ROOT, "src/assets/seanime", record.id + ".js.txt"), code);
  }
  await writeCatalog(records);
  console.log(`Recompilados ${records.filter(record => !record.excluded).length} payloads fijados; sin descargas ni cambios en KV.`);
}

export async function importProviders({ offlineDirectory } = {}) {
  const marketplace = offlineDirectory
    ? JSON.parse(await readFile(path.join(offlineDirectory, "marketplace.json"), "utf8"))
    : JSON.parse(await download(MARKETPLACE_URL));
  const spanish = selectSpanishAnimeProviders(marketplace);
  const additional = selectAdditionalAnimeProviders(marketplace);
  const selected = [...spanish, ...additional];
  await mkdir(path.join(OUTPUT, "upstream"), { recursive: true });
  await mkdir(path.join(ROOT, "src/assets/seanime"), { recursive: true });
  const records = [];
  for (const entry of selected) {
    const id = entry.id.toLowerCase();
    const previous = offlineDirectory ? JSON.parse(await readFile(path.join(offlineDirectory, id + ".json"), "utf8")) : null;
    const manifest = previous?.manifest ?? JSON.parse(await download(entry.manifestURI));
    if (manifest.type !== entry.type || manifest.id.toLowerCase() !== id) throw new Error(`${id}: manifest incompatible`);
    if (manifest.userConfig?.requiresConfig) { records.push({ id, excluded: "Requiere credenciales personales" }); continue; }
    let source = offlineDirectory ? await readFile(path.join(offlineDirectory, id + ".ts"), "utf8") : manifest.payload || await download(manifest.payloadURI || entry.payloadURI);
    const sha256 = createHash("sha256").update(source).digest("hex");
    await writeFile(path.join(OUTPUT, "upstream", id + ".ts.txt"), source);
    const isSpanish = /^es(?:-|$)/i.test(entry.lang);
    const config = Object.fromEntries((manifest.userConfig?.fields ?? []).map(field => [field.name, field.default ?? ""]));
    if (id === "torrentclaw") { config.audioLang = "ja"; config.verifiedOnly = "true"; }
    // Seanime expands preference templates before execution. Keep that process
    // local to this explicit build; no credentials are read or embedded here.
    source = expandConfig(source, config);
    const options = ONLINE_SOFT.get(entry.id) ?? {};
    const metadata = { id, name: entry.name, lang: isSpanish ? "es" : "ja", type: entry.type, policy: isSpanish ? "spanish" : "original-soft",
      trustedSoft: options.trustedSoft ?? false, rawCategory: id === "tokyo-toshokan-raws-provider", config,
      needsAnimeId: ["seadex", "torrentio", "torrentiov2", "tsukihime", "aq-anizone", "aq-kickassanime", "xanime"].includes(id), manifestURI: entry.manifestURI };
    const compiled = await bundleSeanimeProvider(source, metadata, options);
    await writeFile(path.join(ROOT, "src/assets/seanime", id + ".js.txt"), compiled);
    const logo = id === "animeav1" ? `${HUB}/addons/logos/animeav1.svg` : `${HUB}/addons/logos/seanime/${id}`;
    records.push({ ...metadata, marketplaceLang: entry.lang, sourceVersion: manifest.version, sourceSha256: sha256, payloadURI: manifest.payloadURI || entry.payloadURI,
      icon: manifest.icon || entry.icon, logo, enabled: !entry.brokenTag,
      description: `${isSpanish ? "Anime en español" : entry.type === "anime-torrent-provider" ? "Torrents con audio original y RAW/softsubs; descarta DUB y formato desconocido" : "Audio original japonés; solo RAW/softsubs"}.${entry.brokenTag ? " Averiado en el marketplace; pendiente de reparación." : ""}` });
  }
  const included = records.filter(record => !record.excluded);
  await writeFile(path.join(OUTPUT, "catalog.lock.json"), JSON.stringify({ marketplace: MARKETPLACE_URL, records }, null, 2) + "\n");
  await writeCatalog(records);
  console.log(`Seanime: ${included.length} proveedores compilados (${spanish.length} españoles; ${included.length - spanish.length} adicionales filtrados).`);
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (process.argv.includes("--locked") ? rebuildLockedProviders() : importProviders({ offlineDirectory: process.env.SEANIME_REVIEW_DIRECTORY })).catch(error => { console.error(error.message); process.exitCode = 1; });
}
