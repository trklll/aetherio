import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public/assets/football-logos/clubs");
const MANIFEST = join(OUTPUT, "football-logos-cc-manifest.json");
const SITE = "https://football-logos.cc";
const ASSETS = "https://assets.football-logos.cc";
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

// Each page was matched to the catalog identity (and checked against the club
// name/competition on Football-Logos). Never derive a club association by slug.
const CLUBS = [
  ["club:fl-always-ready", "bolivia", "always-ready", "Always Ready"],
  ["club:fl-chadormalu-ardakan", "iran", "chadormalu-ardakan", "Chadormalu Ardakan"],
  ["club:fl-deportivo-la-guaira", "venezuela", "deportivo-la-guaira", "Deportivo La Guaira"],
  ["club:fl-deportivo-tachira", "venezuela", "deportivo-tachira", "Deportivo Táchira"],
  ["club:fl-dewa-united", "indonesia", "dewa-united", "Dewa United"],
  ["club:fl-fk-vojvodina", "serbia", "vojvodina", "FK Vojvodina"],
  ["club:fl-fram-reykjavik", "iceland", "fram", "Fram"],
  ["club:fl-hafnarfjordur-fh", "iceland", "fh", "FH"],
  ["club:fl-ibv", "iceland", "ibv", "ÍBV"],
  ["club:fl-juazeirense", "brazil", "juazeirense", "Juazeirense"],
  ["club:fl-ka-akureyri", "iceland", "ka", "KA"],
  ["club:fl-leones-fc", "ecuador", "leones-del-norte", "Leones del Norte"],
  ["club:fl-libertad-fc", "ecuador", "libertad", "Libertad Fútbol Club"],
  ["club:fl-mushuc-runa-sc", "ecuador", "mushuc-runa", "Mushuc Runa Sporting Club"],
  ["club:fl-once-caldas", "colombia", "once-caldas", "Once Caldas"],
  ["club:fl-sportivo-ameliano", "paraguay", "sportivo-ameliano", "Club Sportivo Ameliano"],
  ["club:fl-stjarnan", "iceland", "stjarnan", "Stjarnan"],
  ["club:fl-the-strongest", "bolivia", "the-strongest", "The Strongest"],
  ["club:fl-universidad-central", "venezuela", "universidad-central", "Universidad Central"],
  ["club:fl-valur", "iceland", "valur", "Valur"],
  ["club:fl-vikingur-r", "iceland", "vikingur-r", "Víkingur R."],
  ["club:fl-waterford", "republic-of-ireland", "waterford", "Waterford"],
  ["club:fl-oxford-city", "england", "oxford-city", "Oxford City"],
];

async function fetchOk(url, asText = false) {
  const response = await fetch(url, {
    headers: { "user-agent": "Aetherio football-logo asset inventory", accept: asText ? "text/html" : "image/png" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return asText ? response.text() : Buffer.from(await response.arrayBuffer());
}

function logoUrlFromPage(html, expectedName) {
  const $ = load(html);
  const heading = $("h1").first().text().replace(/\s+/g, " ").trim();
  if (!heading.startsWith(`${expectedName} Logo`)) {
    throw new Error(`La ficha no confirma ${expectedName}: ${heading || "sin título"}`);
  }
  // 512 PNG URLs are embedded in serialized Astro component props (escaped as
  // HTML entities), not necessarily exposed as an <img src> attribute.
  const source = html.match(/https:\/\/assets\.football-logos\.cc\/logos\/[^"'<>\s&]+\/512x512\/[^"'<>\s&]+\.png/)?.[0];
  if (!source) throw new Error(`No se encontró un PNG 512x512 de ${expectedName}`);
  const url = new URL(source);
  if (url.origin !== ASSETS || !url.pathname.startsWith("/logos/")) throw new Error("URL de imagen fuera del host permitido");
  return url.href;
}

function validatePng(bytes, label) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.readUInt32BE(16) !== 512 || bytes.readUInt32BE(20) !== 512) {
    throw new Error(`PNG inválido o de dimensiones distintas de 512×512: ${label}`);
  }
}

async function download([catalogId, country, slug, expectedName]) {
  const sourcePageUrl = `${SITE}/${country}/${slug}/`;
  const page = await fetchOk(sourcePageUrl, true);
  const sourceUrl = logoUrlFromPage(page, expectedName);
  const bytes = await fetchOk(sourceUrl);
  validatePng(bytes, catalogId);
  const fileName = `${catalogId.slice("club:".length)}.png`;
  const target = join(OUTPUT, fileName);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (existsSync(target)) {
    const existing = await readFile(target);
    if (createHash("sha256").update(existing).digest("hex") !== sha256) {
      throw new Error(`Se conserva el archivo existente porque difiere de la fuente: ${target}`);
    }
  } else {
    await writeFile(target, bytes, { flag: "wx" });
  }
  return { catalogId, name: expectedName, sourcePageUrl, sourceUrl, file: `/assets/football-logos/clubs/${fileName}`, dimension: 512, bytes: bytes.length, sha256 };
}

await mkdir(OUTPUT, { recursive: true });
const entries = [];
const failures = [];
for (let index = 0; index < CLUBS.length; index += 4) {
  const batch = await Promise.all(CLUBS.slice(index, index + 4).map(async club => {
    try { return { entry: await download(club) }; }
    catch (error) { return { error: `${club[0]}: ${error instanceof Error ? error.message : String(error)}` }; }
  }));
  for (const result of batch) {
    if (result.entry) entries.push(result.entry);
    else failures.push(result.error);
  }
}
const manifest = {
  schemaVersion: 1,
  source: { name: "Football Logos", website: SITE, license: `${SITE}/license/` },
  scope: { clubs: CLUBS.length, downloadedAssets: entries.length, failedAssets: failures.length, format: "PNG 512x512" },
  entries,
  failures,
};
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Football-Logos: ${entries.length}/${CLUBS.length} escudos guardados en ${OUTPUT}`);
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
