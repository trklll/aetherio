import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public/assets/football-logos/Trophies");
const MANIFEST = join(OUTPUT, "pngdownload-attribution.json");
const SITE = "https://pngdownload.io";
const ALLOWED_MEDIA_HOST = "pngdownload.io";
const ALLOWED_DOWNLOAD_HOST = "mypngdownload.s3.us-east-1.amazonaws.com";
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

// Exact competition-specific trophy pages; no generic cup is reused for a league.
const TROPHIES = [
  {
    id: "comp:eng-championship",
    name: "EFL Championship",
    file: "EFL-Championship-Trophy.png",
    temporaryFile: "EFL-Championship-Trophy.avif",
    slug: "efl-championship-trophy-english-football-league-championship-winners-trophy-transparent-image",
    titleStartsWith: "EFL Championship Trophy",
    assetFragment: "EFL-Championship-Trophy-English-Football.avif",
  },
  {
    id: "comp:eng-community-shield",
    name: "FA Community Shield",
    file: "FA-Community-Shield-Trophy.png",
    temporaryFile: "FA-Community-Shield-Trophy.webp",
    slug: "fa-community-shield-prestigious-football-trophy-soccer-transparent-png-image",
    titleStartsWith: "FA Community Shield",
    assetFragment: "FA-Community-Shield-Prestigious-Football-Trophy-Soccer-1024x945.webp",
  },
  {
    id: "comp:eng-efl-cup",
    name: "EFL Cup / Carabao Cup",
    file: "EFL-Carabao-Cup-Trophy.png",
    temporaryFile: "EFL-Carabao-Cup-Trophy.webp",
    slug: "efl-cup-carabao-cup-trophy-football-championship-transparent-png-image",
    titleStartsWith: "EFL Cup, Carabao Cup",
    assetFragment: "EFL-Cup-Carabao-Cup-trophy-football-championship-transparent-PNG-image-1024x951.webp",
  },
  {
    id: "comp:afc-asian-cup",
    name: "AFC Asian Cup",
    file: "AFC-Asian-Cup-Trophy.png",
    temporaryFile: "AFC-Asian-Cup-Trophy.avif",
    slug: "afc-asian-cup-trophy-asian-football-championship",
    titleStartsWith: "AFC Asian Cup Trophy",
    assetFragment: "AFC-Asian-Cup-Trophy-png-1.avif",
  },
  {
    id: "comp:concacaf-gold-cup",
    name: "CONCACAF Gold Cup",
    file: "CONCACAF-Gold-Cup-Trophy.png",
    temporaryFile: "CONCACAF-Gold-Cup-Trophy.webp",
    slug: "concacaf-gold-cup-trophy-north-american-football-championship-transparent-png-image",
    titleStartsWith: "CONCACAF Gold Cup Trophy",
    assetFragment: "CONCACAF-Gold-Cup-Trophy.avif",
  },
  {
    id: "comp:uefa-nations-league",
    name: "UEFA Nations League",
    file: "UEFA-Nations-League-Trophy.png",
    temporaryFile: "UEFA-Nations-League-Trophy.webp",
    slug: "uefa-nations-league-trophy-european-football-cup-silver-soccer-award-transparent-png-image",
    titleStartsWith: "UEFA Nations League Trophy",
    assetFragment: "UEFA-Nations-League-Trophy-PNG.webp",
  },
  {
    id: "comp:caf-africa-cup",
    name: "Africa Cup of Nations (AFCON)",
    file: "AFCON-Trophy.png",
    temporaryFile: "AFCON-Trophy.webp",
    slug: "afcon-trophy-africa-cup-of-nations-transparent-png-image",
    titleStartsWith: "AFCON, Trophy, Africa Cup of Nations",
    assetFragment: "AFCON-Trophy-Africa-Cup-of-Nations-transparent-PNG-image-jpg.webp",
  },
  {
    id: "comp:fifa-world-cup",
    name: "FIFA World Cup",
    file: "FIFA-World-Cup-Individual-Trophy.png",
    slug: "fifa-world-cup-football-trophy-transparent-png-image",
    titleStartsWith: "FIFA World Cup, football trophy",
  },
  {
    id: "comp:uefa-euro",
    name: "UEFA European Championship / Euro",
    file: "UEFA-Euro-Henri-Delaunay-Trophy.png",
    slug: "uefa-euro-trophy-european-football-championship-cup-henri-delaunay-trophy-transparent-png-image",
    titleStartsWith: "UEFA Euro Trophy",
  },
  {
    id: "comp:afc-champions",
    name: "AFC Champions League",
    file: "AFC-Champions-League-Individual-Trophy.png",
    slug: "afc-champions-league-trophy-award-for-asian-football-transparent-png-image",
    titleStartsWith: "AFC Champions League, Trophy",
  },
  {
    id: "comp:caf-champions",
    name: "CAF Champions League",
    file: "CAF-Champions-League-Individual-Trophy.png",
    slug: "caf-champions-league-trophy-african-football-png",
    titleStartsWith: "CAF Champions League Trophy",
  },
  {
    id: "comp:esp-copa",
    name: "Copa del Rey",
    file: "Copa-del-Rey-Individual-Trophy.png",
    slug: "copa-del-rey-spanish-football-cup-national-championship-trophy-transparent-png-image",
    titleStartsWith: "Copa del Rey, Spanish Football Cup",
  },
  {
    id: "comp:conmebol-libertadores",
    name: "Copa Libertadores",
    file: "Copa-Libertadores-Individual-Trophy.png",
    slug: "copa-libertadores-trophy-south-american-football-championship-cup",
    titleStartsWith: "Copa Libertadores Trophy",
  },
  {
    id: "comp:esp-laliga",
    name: "LaLiga",
    file: "LaLiga-Individual-Trophy.png",
    slug: "laliga-trophy-spanish-football-championship-cup-transparent-png",
    titleStartsWith: "LaLiga Trophy",
  },
];

function decodeHtml(value) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8217;/g, "’");
}

async function fetchOk(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Aetherio trophy asset inventory", accept: "text/html,image/avif,image/webp,image/*" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

function downloadLinkFromPage(html, expectedTitle) {
  const heading = decodeHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "");
  if (!heading.startsWith(expectedTitle)) throw new Error(`La ficha no confirma «${expectedTitle}»: ${heading || "sin título"}`);
  const downloadPath = html.match(/https:\/\/pngdownload\.io\/download\/\d+\/\?tmstv=\d+/i)?.[0];
  if (!downloadPath) throw new Error(`No se encontró el enlace de descarga de ${expectedTitle}`);
  const downloadUrl = new URL(decodeHtml(downloadPath));
  if (downloadUrl.protocol !== "https:" || downloadUrl.hostname !== ALLOWED_MEDIA_HOST
    || !/^\/download\/\d+\/$/.test(downloadUrl.pathname)) {
    throw new Error(`URL de descarga fuera del host o ruta permitidos: ${downloadUrl.href}`);
  }
  return downloadUrl.href;
}

async function download(entry) {
  const sourcePageUrl = `${SITE}/png-image/${entry.slug}/`;
  const page = await (await fetchOk(sourcePageUrl)).text();
  const downloadUrl = downloadLinkFromPage(page, entry.titleStartsWith);
  const response = await fetchOk(downloadUrl);
  if (new URL(response.url).hostname !== ALLOWED_DOWNLOAD_HOST) {
    throw new Error(`Redirección de descarga fuera del storage oficial: ${response.url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) < 200 || bytes.readUInt32BE(20) < 200) {
    throw new Error(`La respuesta de ${downloadUrl} no es un PNG de tamaño válido`);
  }
  const target = join(OUTPUT, entry.file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (existsSync(target)) {
    const existing = await readFile(target);
    if (createHash("sha256").update(existing).digest("hex") !== sha256) {
      throw new Error(`No se sobrescribe el archivo existente: ${target}`);
    }
  } else {
    await writeFile(target, bytes, { flag: "wx" });
  }
  return {
    competitionId: entry.id,
    competition: entry.name,
    title: entry.titleStartsWith,
    sourcePageUrl,
    downloadUrl,
    file: `/assets/football-logos/Trophies/${entry.file}`,
    contentType: response.headers.get("content-type"),
    bytes: bytes.length,
    sha256,
  };
}

await mkdir(OUTPUT, { recursive: true });
const entries = [];
const failures = [];
for (let index = 0; index < TROPHIES.length; index += 3) {
  const batch = await Promise.all(TROPHIES.slice(index, index + 3).map(async entry => {
    try { return { entry: await download(entry) }; }
    catch (error) { return { error: `${entry.id}: ${error instanceof Error ? error.message : String(error)}` }; }
  }));
  for (const result of batch) {
    if (result.entry) entries.push(result.entry);
    else failures.push(result.error);
  }
}

const manifest = {
  schemaVersion: 1,
  source: {
    name: "PNGDownload.io",
    website: SITE,
    license: "https://pngdownload.io/license/",
    licenseName: "Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)",
    attribution: "Image by PNGDownload.io",
    commercialUse: "Not permitted without explicit permission from PNGDownload.io.",
  },
  entries,
  failures,
};
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
// These temporary browser-optimized copies were created by this script's initial
// draft; replace only the exact filenames declared above with original PNGs.
for (const entry of TROPHIES) {
  if (entry.temporaryFile) {
    const temporaryAsset = join(OUTPUT, entry.temporaryFile);
    if (existsSync(temporaryAsset)) await unlink(temporaryAsset);
  }
}
console.log(`PNGDownload.io: ${entries.length}/${TROPHIES.length} trofeos verificados y guardados en ${OUTPUT}`);
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
