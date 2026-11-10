/**
 * Logos de las ligas de football-logos.cc, no los escudos de sus clubes.
 *
 * node scripts/download-football-leagues.mjs
 * node scripts/download-football-leagues.mjs --refresh
 * node scripts/download-football-leagues.mjs --public-previews-only
 *
 * SVG + PNG de 512 y 3000 px, con variantes publicadas de color/sin texto.
 * No incluye recoloreados decorativos generados (oro, arcoiris, etc.).
 * Los recursos anteriores de FootyLogos no se modifican ni se remapean.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "cheerio";

const SITE = "https://football-logos.cc";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PNG_DIMENSIONS = [3000, 1500, 700, 512, 256, 128, 64, 32];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{8}$/i;

function sourcePage(href, segments) {
  const url = new URL(href, SITE);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.origin !== SITE || url.username || url.password || url.search || url.hash
    || parts.length !== segments || parts.some(part => !SLUG.test(part))) return null;
  return { parts, sourcePageUrl: `${SITE}/${parts.join("/")}/` };
}

export function parseCountryPages(html) {
  const $ = load(html);
  const countries = new Map();
  $("[data-country-group] a[href]").each((_, element) => {
    const page = sourcePage($(element).attr("href"), 1);
    if (page) countries.set(page.parts[0], { category: page.parts[0], sourcePageUrl: page.sourcePageUrl });
  });
  return [...countries.values()];
}

export function parseLeagueLinks(html) {
  const $ = load(html);
  const links = $("main h2").map((_, element) => $(element).closest("a[href]").get(0)).get();
  links.push(...$('[aria-labelledby="league-logos-heading"] a[href]').get());
  const leagues = new Map();
  for (const element of links) {
    const page = sourcePage($(element).attr("href"), 2);
    if (!page || leagues.has(page.sourcePageUrl)) continue;
    const [category, slug] = page.parts;
    const name = $(element).text().replace(/\s+/g, " ").replace(/\s+\d+\s+teams?\s*$/i, "").trim();
    leagues.set(page.sourcePageUrl, { category, slug, name, sourcePageUrl: page.sourcePageUrl });
  }
  return [...leagues.values()];
}

// Astro serializa props como [tipo, valor]. Se decodifican datos, nunca se
// ejecuta JavaScript descargado ni se deduce un logo a partir de su nombre.
function decodeProps(props) {
  const decode = ([type, value]) => {
    if (type === 1) return value.map(decode);
    if (type !== 0) throw new Error(`Tipo de dato Astro no soportado: ${type}`);
    return value && typeof value === "object" ? decodeProps(value) : value;
  };
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, decode(value)]));
}

export function parseLogoAssets(html, league, dimensions = [512, 3000]) {
  const { category, slug } = league;
  if (!SLUG.test(category) || !SLUG.test(slug)) throw new Error("Identidad de liga no válida");
  const $ = load(html);
  const primary = $('[data-logo-downloads][data-logo-download-source="lp"]').filter((_, element) =>
    $(element).attr("data-category-id") === category && $(element).attr("data-logo-id") === slug).first();
  if (!primary.length) throw new Error("La ficha no expone el logo principal de esta liga");
  const assets = new Map();
  const add = (logoId, variantName, format, hash, dimension) => {
    if (!SLUG.test(logoId) || !HASH.test(hash)) throw new Error("Identidad o hash de recurso no válido");
    const folder = format === "svg" ? "svg" : `${dimension}x${dimension}`;
    const filename = `${logoId}.${hash}.${format}`;
    // El CDN de previsualizaciones no publica PNG de 3000 px. Ese tamaño
    // utiliza la URL del botón de descarga, no una ruta inventada en el CDN.
    const sourceUrl = format === "svg" ? `https://images.football-logos.cc/${category}/${filename}`
      : dimension === 3000 ? `https://images.football-logos.cc/${category}/${dimension}/${filename}`
        : `https://assets.football-logos.cc/logos/${category}/${folder}/${filename}`;
    assets.set(sourceUrl, { logoId, variantName, format, ...(dimension ? { dimension } : {}), hash, sourceUrl, file: `${category}/${folder}/${filename}` });
  };
  const svgHash = primary.attr("data-svg-hash");
  if (svgHash) add(slug, "Original", "svg", svgHash);
  primary.find("[data-logo-png-download-select] option[value]").each((_, element) => {
    const [size, hash] = $(element).attr("value").split("::");
    if (dimensions.includes(Number(size))) add(slug, "Original", "png", hash, Number(size));
  });
  $('astro-island[component-export="LogoColorVariants"], astro-island[component-export="LogoStylisticVariants"]').each((_, element) => {
    const props = decodeProps(JSON.parse($(element).attr("props")));
    if (props.categoryId !== category) return;
    for (const variant of [...(props.colorVariants ?? []), ...(props.variants ?? [])]) {
      if (typeof variant.id !== "string" || !variant.id.startsWith(`${slug}--`)) continue;
      if (typeof variant.h !== "string" || !/^[a-f0-9]{72}$/i.test(variant.h)) throw new Error("Hash de variante no válido");
      if (variant.svg) add(variant.id, variant.name, "svg", variant.h.slice(64, 72));
      for (const png of variant.png ?? []) {
        if (!dimensions.includes(png.dimension)) continue;
        const index = PNG_DIMENSIONS.indexOf(png.dimension);
        add(variant.id, variant.name, "png", variant.h.slice(index * 8, index * 8 + 8), png.dimension);
      }
    }
  });
  if (!assets.size) throw new Error("La ficha no ofrece formatos descargables");
  return [...assets.values()];
}

export function validateAsset(bytes, asset) {
  if (!bytes.length || bytes.length > 10_000_000) throw new Error("Tamaño de recurso no válido");
  if (asset.format === "png") {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.toString("ascii", 12, 16) !== "IHDR"
      || bytes.readUInt32BE(16) !== asset.dimension || bytes.readUInt32BE(20) !== asset.dimension) {
      throw new Error("PNG o dimensiones no válidos");
    }
    return;
  }
  const text = bytes.toString("utf8");
  const $ = load(text, { xmlMode: true });
  if ($.root().children().first().get(0)?.name !== "svg" || /<!ENTITY\b/i.test(text)
    || $("script, foreignObject, iframe, object, embed").length) throw new Error("SVG no válido o ejecutable");
  $("*").each((_, element) => {
    for (const [key, value] of Object.entries(element.attribs ?? {})) {
      if (/^on/i.test(key) || (/^(?:xlink:)?href$/i.test(key) && !/^(?:#|data:image\/(?:png|jpeg|webp);base64,)/i.test(value))) {
        throw new Error("SVG con contenido ejecutable o externo");
      }
    }
  });
}

async function mapConcurrent(items, concurrency, mapper) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

export async function runDownload({
  outputRoot = join(ROOT, "public/assets/football-logos/leagues"),
  cacheRoot = join(ROOT, "output/football-leagues/pages"),
  fetchFn = fetch, log = console.log, concurrency = 4, refresh = false, blockedOrigins = [],
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("Concurrencia no válida");
  const blocked = new Set(blockedOrigins);
  await mkdir(outputRoot, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  async function request(url) {
    const origin = new URL(url).origin;
    if (blocked.has(origin)) throw new Error(`Descarga pendiente: origen bloqueado (HTTP 403), no se reintenta: ${origin}`);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchFn(url, {
          headers: { "user-agent": "Aetherio league logo downloader", accept: "text/html,image/svg+xml,image/png,*/*" },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt >= 2) throw error;
        await delay(1000 * 2 ** attempt);
        continue;
      }
      if (response.ok) return response;
      // No cambiar cabeceras, cliente ni URL para eludir una denegación.
      if (response.status === 403) blocked.add(origin);
      if (attempt >= 2 || (response.status !== 429 && response.status < 500)) throw new Error(`HTTP ${response.status}: ${url}`);
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(Math.min(30_000, Math.max(1000 * 2 ** attempt, retryAfter * 1000 || 0)));
    }
  }
  async function page(url) {
    const cacheFile = join(cacheRoot, `${new URL(url).pathname.split("/").filter(Boolean).join("--")}.html`);
    if (!refresh) {
      try { return await readFile(cacheFile, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const html = await (await request(url)).text();
    await writeFile(cacheFile, html, "utf8");
    return html;
  }
  const index = await page(`${SITE}/all/`);
  const countries = parseCountryPages(index);
  if (!countries.length) throw new Error("No se encontró el índice de países; se cancela sin reemplazar el manifiesto");
  const leagues = new Map(parseLeagueLinks(index).map(league => [league.sourcePageUrl, league]));
  const discoveryErrors = [];
  let scanned = 0;
  log(`Explorando las ligas de ${countries.length} países…`);
  await mapConcurrent(countries, concurrency, async country => {
    try {
      for (const league of parseLeagueLinks(await page(country.sourcePageUrl))) leagues.set(league.sourcePageUrl, league);
    } catch (error) {
      discoveryErrors.push({ sourcePageUrl: country.sourcePageUrl, reason: error.message });
    }
    scanned++;
    if (scanned % 25 === 0 || scanned === countries.length) log(`Países: ${scanned}/${countries.length}; ligas encontradas: ${leagues.size}`);
  });
  let done = 0;
  const entries = await mapConcurrent([...leagues.values()].sort((a, b) => a.sourcePageUrl.localeCompare(b.sourcePageUrl)), concurrency, async league => {
    try {
      const assets = [];
      for (const asset of parseLogoAssets(await page(league.sourcePageUrl), league)) {
        try {
          const localFile = join(outputRoot, asset.file);
          let bytes;
          let reused = false;
          try {
            bytes = await readFile(localFile);
            reused = true;
          } catch (error) { if (error.code !== "ENOENT") throw error; }
          if (!bytes) bytes = Buffer.from(await (await request(asset.sourceUrl)).arrayBuffer());
          validateAsset(bytes, asset);
          if (!reused) {
            await mkdir(dirname(localFile), { recursive: true });
            await writeFile(localFile, bytes, { flag: "wx" });
          }
          assets.push({ ...asset, status: "downloaded", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), reused });
        } catch (error) {
          assets.push({ ...asset, status: "failed", reason: error.message });
        }
      }
      const status = assets.every(asset => asset.status === "downloaded") ? "downloaded" : "partial";
      return { ...league, status, assets };
    } catch (error) {
      return { ...league, status: "unavailable", reason: error.message, assets: [] };
    } finally {
      done++;
      if (done % 10 === 0 || done === leagues.size) log(`Ligas procesadas: ${done}/${leagues.size}`);
    }
  });
  const assets = entries.flatMap(entry => entry.assets);
  const downloaded = assets.filter(asset => asset.status === "downloaded");
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { name: "Football Logos", website: SITE, index: `${SITE}/all/`, rights: `${SITE}/license/` },
    scope: {
      countries: countries.length, leagues: entries.length,
      leaguesWithAssets: entries.filter(entry => entry.assets.some(asset => asset.status === "downloaded")).length,
      unavailableLeagues: entries.filter(entry => entry.status === "unavailable").length,
      downloadedAssets: downloaded.length, failedAssets: assets.length - downloaded.length,
      downloadedBytes: downloaded.reduce((sum, asset) => sum + asset.bytes, 0),
      pngDimensions: [512, 3000],
    },
    discoveryErrors: discoveryErrors.sort((a, b) => a.sourcePageUrl.localeCompare(b.sourcePageUrl)),
    blockedOrigins: [...blocked].sort(),
    entries,
  };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(outputRoot, "README.md"), `# Logos de ligas — football-logos.cc\n\nFuente: ${SITE}/\n\nSe solicitan SVG y PNG de 512 y 3000 px, originales y variantes publicadas de color/sin texto. No se descargan escudos de clubes ni recoloreados decorativos generados. Organización: país/formato/archivo. El manifiesto registra las URLs, hashes SHA-256, descargas verificadas y formatos pendientes.\n\nReanudar: \`node scripts/download-football-leagues.mjs\`. Actualizar el índice: añadir \`--refresh\`. Si el servidor de descargas bloquea el acceso automático, usar \`--public-previews-only\`: conserva los SVG existentes y descarga solo las previsualizaciones PNG públicas; los SVG y PNG de 3000 px restantes figuran como pendientes. Un HTTP 403 detiene las peticiones nuevas a ese origen, sin intentar eludirlo.\n\nLos archivos existentes no se sobrescriben. No se han cambiado los recursos previos de FootyLogos ni el resolver de la aplicación.\n\n## Derechos y atribución\n\nFuente y curación: [football-logos.cc](${SITE}/), Leo4815162342. Los logos pertenecen a sus clubes, ligas y asociaciones y siguen protegidos por sus marcas. La descarga no concede una licencia comercial. El sitio los ofrece para fines informativos, editoriales y de aficionados, y restringe su uso en productos comerciales, mercancía, branding, promoción o de forma que sugiera respaldo. Véase [el aviso de uso](${SITE}/license/).\n`, "utf8");
  log(JSON.stringify(manifest.scope, null, 2));
  log(`Manifiesto: ${join(outputRoot, "manifest.json")}`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runDownload({
    refresh: process.argv.includes("--refresh"),
    blockedOrigins: process.argv.includes("--public-previews-only") ? ["https://images.football-logos.cc"] : [],
  }).then(manifest => {
    if (manifest.discoveryErrors.length || manifest.scope.failedAssets || manifest.scope.unavailableLeagues) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
