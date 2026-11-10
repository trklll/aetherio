/**
 * Descarga los escudos PNG 512x512 de los clubes de la Peruvian Primera División
 * publicados por football-logos.cc. No incorpora la selección ni clubes
 * históricos/fuera de la plantilla. No sobrescribe ficheros existentes.
 *
 * Uso: node scripts/download-peruvian-league-teams.mjs
 *       node scripts/download-peruvian-league-teams.mjs --refresh
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "cheerio";

const SITE = "https://football-logos.cc";
const COUNTRY_URL = `${SITE}/peru/`;
const LEAGUE_URL = `${SITE}/peru/peruvian-primera-division/`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(ROOT, "public/assets/football-logos/peru/primera-division");
const DEFAULT_CACHE = join(ROOT, "output/football-peru-teams/pages");
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{8}$/i;

function safePage(href) {
  let url;
  try { url = new URL(href, SITE); } catch { return null; }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.origin !== SITE || url.username || url.password || url.search || url.hash
    || parts.length !== 2 || parts[0] !== "peru" || !SLUG.test(parts[1])) return null;
  return { slug: parts[1], sourcePageUrl: `${SITE}/peru/${parts[1]}/` };
}

/** Read only the club cards nested within the league's declared roster region. */
export function parsePeruvianTeams(html) {
  const $ = load(html);
  const heading = $("h2").filter((_, element) =>
    $(element).text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() === "All Peruvian Primera Division Teams").first();
  const region = heading.closest("section");
  if (!region.length) throw new Error("No se encontró la plantilla oficial de la liga peruana");
  const teams = new Map();
  region.find("article a[href]").each((_, element) => {
    const page = safePage($(element).attr("href"));
    const name = $(element).text().replace(/\s+/g, " ").trim();
    if (!page || !name || page.slug === "peruvian-primera-division" || page.slug.endsWith("-national-team")) return;
    teams.set(page.slug, { ...page, name });
  });
  if (!teams.size) throw new Error("La plantilla peruana no contiene equipos");
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function clubLogo(html, club) {
  const $ = load(html);
  const record = $('[data-logo-downloads][data-logo-download-source="lp"]').filter((_, element) =>
    $(element).attr("data-category-id") === "peru" && $(element).attr("data-logo-id") === club.slug).first();
  if (!record.length) throw new Error(`La ficha no publica un logo de Perú para ${club.slug}`);
  const option = record.find("[data-logo-png-download-select] option[value]").toArray().find(element =>
    $(element).attr("value").startsWith("512::"));
  if (!option) throw new Error(`La ficha no publica un PNG de 512 px para ${club.slug}`);
  const [, hash] = $(option).attr("value").split("::");
  if (!HASH.test(hash)) throw new Error(`Hash de PNG no válido para ${club.slug}`);
  return {
    clubSlug: club.slug,
    clubName: club.name,
    format: "png",
    dimension: 512,
    hash,
    sourcePageUrl: club.sourcePageUrl,
    sourceUrl: `https://assets.football-logos.cc/logos/peru/512x512/${club.slug}.${hash}.png`,
    file: `512x512/${club.slug}.${hash}.png`,
  };
}

function validatePng(bytes) {
  if (bytes.length < 33 || bytes.length > 10_000_000 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== 512 || bytes.readUInt32BE(20) !== 512) {
    throw new Error("El recurso descargado no es un PNG válido de 512×512");
  }
}

async function concurrentMap(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) results[next] = await mapper(items[next], next++);
  }));
  return results;
}

export async function runDownload({
  outputRoot = DEFAULT_OUTPUT,
  cacheRoot = DEFAULT_CACHE,
  manifestPath = join(outputRoot, "manifest.json"),
  readmePath = join(outputRoot, "README.md"),
  fetchFn = fetch,
  log = console.log,
  refresh = false,
  rosterHtml,
  clubPageHtml,
} = {}) {
  await mkdir(outputRoot, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  async function getPage(url) {
    if (url === LEAGUE_URL && rosterHtml !== undefined) return rosterHtml;
    if (url !== LEAGUE_URL && clubPageHtml !== undefined) return clubPageHtml;
    const path = join(cacheRoot, `${new URL(url).pathname.split("/").filter(Boolean).join("--")}.html`);
    if (!refresh) {
      try { return await readFile(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const response = await fetchFn(url, {
      headers: { accept: "text/html,*/*", "user-agent": "Aetherio Peruvian league logo downloader" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const html = await response.text();
    await writeFile(path, html, "utf8");
    return html;
  }

  const rosterHtmlOnDisk = rosterHtml ?? await getPage(LEAGUE_URL);
  const teams = parsePeruvianTeams(rosterHtmlOnDisk);
  log(`Peruvian Primera División: ${teams.length} equipos en la plantilla publicada.`);
  let done = 0;
  const entries = await concurrentMap(teams, 3, async team => {
    const assets = [];
    try {
      const asset = clubLogo(await getPage(team.sourcePageUrl), team);
      const local = join(outputRoot, asset.file);
      let bytes;
      let reused = false;
      try { bytes = await readFile(local); reused = true; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!bytes) {
        const response = await fetchFn(asset.sourceUrl, {
          headers: { accept: "image/png,*/*", "user-agent": "Aetherio Peruvian league logo downloader" },
          signal: AbortSignal.timeout(25_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${asset.sourceUrl}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      validatePng(bytes);
      if (!reused) {
        await mkdir(dirname(local), { recursive: true });
        await writeFile(local, bytes, { flag: "wx" });
      }
      assets.push({ ...asset, status: "downloaded", reused, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } catch (error) {
      assets.push({ clubSlug: team.slug, clubName: team.name, status: "failed", sourcePageUrl: team.sourcePageUrl, reason: error.message });
    }
    done++;
    log(`Equipos procesados: ${done}/${teams.length}`);
    return { ...team, status: assets[0].status, assets };
  });
  const downloaded = entries.flatMap(entry => entry.assets).filter(asset => asset.status === "downloaded");
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { name: "Football Logos", website: SITE, league: LEAGUE_URL, country: COUNTRY_URL, rights: `${SITE}/license/` },
    scope: {
      country: "Perú",
      leaguesPublishedBySource: 1,
      league: "Peruvian Primera División",
      clubs: teams.length,
      downloadedAssets: downloaded.length,
      failedAssets: entries.length - downloaded.length,
      downloadedBytes: downloaded.reduce((sum, asset) => sum + asset.bytes, 0),
      format: "PNG 512×512",
    },
    entries,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(readmePath, `# Escudos de clubes — Peruvian Primera División\n\nFuente: [Football Logos](${SITE}) · [Plantilla publicada de la liga](${LEAGUE_URL})\n\nSe descargan solo los ${teams.length} equipos incluidos en la plantilla de la liga que publica football-logos.cc. El sitio enumera una única liga peruana: la Peruvian Primera División. No se incluyen la selección peruana ni los otros clubes que aparecen en la página del país.\n\nFormato: PNG transparente, 512×512. Los archivos, hashes, URLs y fallos están en \`manifest.json\`. Reanudar la descarga: \`node scripts/download-peruvian-league-teams.mjs\`. Actualizar páginas cacheadas: añadir \`--refresh\`. Los archivos existentes no se sobrescriben.\n\n## Derechos y atribución\n\nLos escudos son marcas de sus clubes. La descarga no concede derechos de uso comercial; consulta el [aviso de uso](${SITE}/license/).\n`, "utf8");
  log(JSON.stringify(manifest.scope, null, 2));
  log(`Manifiesto: ${manifestPath}`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runDownload({ refresh: process.argv.includes("--refresh") }).then(manifest => {
    if (manifest.scope.failedAssets) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
