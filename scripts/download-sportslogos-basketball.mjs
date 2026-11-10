import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public/assets/basketball-logos");
const SITE = "https://www.sportslogos.net";
const CDN = "https://content.sportslogos.net";
const LEAGUE_INDEX = `${SITE}/leagues/list_by_sport/3/Basketball-Logos/`;
const LEAGUE_PATH = /^\/teams\/list_by_league\/(\d+)\/([^/]+)\/([^/]+)\/logos\/$/;
const IMAGE_EXT = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp"]);

async function fetchResponse(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Aetherio basketball logo catalog (contact: project asset inventory)", accept: "text/html,image/*" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

async function fetchHtml(url) {
  return (await fetchResponse(url)).text();
}

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "content.sportslogos.net"
      || !(url.pathname.startsWith("/logos/") || url.pathname.startsWith("/leagues/thumbs/"))) return null;
    const extension = extname(url.pathname).toLowerCase();
    return IMAGE_EXT.has(extension) ? { url: url.href, extension } : null;
  } catch { return null; }
}

function parseBasketballLeagues(html) {
  const $ = load(html);
  const leagues = new Map();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const match = LEAGUE_PATH.exec(href);
    if (!match) return;
    const name = $(element).attr("title")?.replace(/\s+Logos?$/i, "").trim()
      || $(element).text().replace(/\s+/g, " ").trim();
    // Ignore the site-wide popular-league shortcut; use the twelve entries in
    // the Professional, Minor and International Basketball sections only.
    if (!name || href.includes("National-Basketball-Association-Logos")) return;
    leagues.set(match[1], { id: match[1], name, path: href });
  });
  return [...leagues.values()];
}

function parseLeaguePage(html, league) {
  const $ = load(html);
  const heading = $("h1").first().text().replace(/\s+/g, " ").trim();
  const badge = safeImageUrl($("meta[property='og:image']").attr("content") ?? "")
    ?? safeImageUrl($("img[src*='/leagues/']").first().attr("src") ?? "");
  const teams = [];
  $(".team-card").each((_, element) => {
    const card = $(element);
    const anchor = card.find("a[href^='/logos/list_by_team/']").first();
    const match = /^\/logos\/list_by_team\/(\d+)\/([^/]+)\/$/.exec(anchor.attr("href") ?? "");
    const image = safeImageUrl(card.find("img[src]").first().attr("src") ?? "");
    const name = card.find(".card-text span").first().text().replace(/\s+/g, " ").trim()
      || card.find("img[alt]").first().attr("alt")?.replace(/\s+Logo$/i, "").trim();
    const years = card.find(".card-text span").eq(1).text().replace(/\s+/g, " ").trim();
    if (!match || !image || !name) return;
    teams.push({ id: match[1], slug: match[2], name, years, teamPageUrl: new URL(anchor.attr("href"), SITE).href, source: image });
  });
  if (!heading || !badge || teams.length === 0) throw new Error(`No se pudo validar el catálogo de ${league.name}: ${heading}; equipos=${teams.length}`);
  return { ...league, heading, badge, teams };
}

async function mapConcurrent(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try { results[index] = await worker(values[index]); }
      catch (error) { results[index] = { error: error instanceof Error ? error.message : String(error) }; }
    }
  }));
  return results;
}

async function saveImage(source, relativePath) {
  const target = join(OUTPUT, relativePath);
  await mkdir(dirname(target), { recursive: true });
  const response = await fetchResponse(source.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100 || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) {
    throw new Error(`No parece una imagen válida: ${source.url}`);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (existsSync(target)) {
    const previous = createHash("sha256").update(await readFile(target)).digest("hex");
    if (previous !== hash) throw new Error(`Se conserva el archivo existente porque difiere: ${target}`);
  } else {
    await writeFile(target, bytes, { flag: "wx" });
  }
  return { path: `/assets/basketball-logos/${relativePath.replaceAll("\\", "/")}`, bytes: bytes.length, sha256: hash };
}

const leagueRows = parseBasketballLeagues(await fetchHtml(LEAGUE_INDEX));
if (leagueRows.length === 0) throw new Error("La página de baloncesto no devolvió ligas verificables.");
const catalogs = await mapConcurrent(leagueRows, 3, async league => parseLeaguePage(await fetchHtml(new URL(league.path, SITE).href), league));
const failures = catalogs.filter(row => row.error).map(row => row.error);
const validCatalogs = catalogs.filter(row => !row.error);
const logoJobs = [];
for (const league of validCatalogs) {
  logoJobs.push({ kind: "league", league, source: league.badge, relativePath: `leagues/${league.id}${league.badge.extension}` });
  for (const team of league.teams) {
    logoJobs.push({ kind: "team", league, team, source: team.source, relativePath: `teams/${league.id}/${team.id}${team.source.extension}` });
  }
}
const downloaded = await mapConcurrent(logoJobs, 4, async job => ({ ...job, asset: await saveImage(job.source, job.relativePath) }));
for (const item of downloaded) if (item.error) failures.push(`${item.kind} ${item.team?.name ?? item.league.name}: ${item.error}`);

const entries = downloaded.filter(item => !item.error).map(item => ({
  kind: item.kind,
  leagueId: item.league.id,
  league: item.league.name,
  ...(item.team ? { teamId: item.team.id, team: item.team.name, teamPageUrl: item.team.teamPageUrl, listedYears: item.team.years } : {}),
  sourcePageUrl: item.kind === "league" ? new URL(item.league.path, SITE).href : item.team.teamPageUrl,
  sourceUrl: item.source.url,
  ...item.asset,
}));

const manifest = {
  schemaVersion: 1,
  retrievedAt: new Date().toISOString(),
  scope: "All professional, minor and international basketball leagues listed on the supplied SportsLogos.Net Basketball page; one listed team mark per team/franchise and one league badge per league, not every historical alternate logo on each team page.",
  source: {
    name: "SportsLogos.Net / Chris Creamer's Sports Logos Page",
    index: LEAGUE_INDEX,
    usageNotice: "SportsLogos.Net states it does not own the depicted team/league/event marks and cannot grant usage rights. User reports having permission; rights to each underlying mark remain the user's responsibility.",
    attribution: "SportsLogos.Net — https://www.sportslogos.net/",
  },
  leagues: validCatalogs.map(({ id, name, path, heading, teams }) => ({ id, name, heading, sourcePageUrl: new URL(path, SITE).href, teams: teams.length })),
  totals: { leagues: validCatalogs.length, teams: validCatalogs.reduce((sum, league) => sum + league.teams.length, 0), downloaded: entries.length, failed: failures.length },
  entries,
  failures,
};
await mkdir(OUTPUT, { recursive: true });
await writeFile(join(OUTPUT, "sportslogos-basketball-attribution.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const teamMap = Object.fromEntries(entries.filter(entry => entry.kind === "team").map(entry => [
  `${entry.leagueId}:${entry.teamId}`,
  { name: entry.team, league: entry.league, years: entry.listedYears, src: entry.path, sourcePageUrl: entry.sourcePageUrl },
]));
const leagueMap = Object.fromEntries(entries.filter(entry => entry.kind === "league").map(entry => [
  entry.league,
  { src: entry.path, sourcePageUrl: entry.sourcePageUrl },
]));
const generated = `// Generated by scripts/download-sportslogos-basketball.mjs. Do not edit by hand.\nexport const SPORTLOGOS_BASKETBALL_TEAMS = ${JSON.stringify(teamMap, null, 2)} as const;\nexport const SPORTLOGOS_BASKETBALL_LEAGUES = ${JSON.stringify(leagueMap, null, 2)} as const;\n`;
await writeFile(join(ROOT, "src/data/sportsLogosBasketball.generated.ts"), generated, "utf8");

console.log(`SportsLogos basketball: ${validCatalogs.length} ligas, ${manifest.totals.teams} equipos, ${entries.length} imágenes descargadas; ${failures.length} fallos.`);
if (failures.length) process.exitCode = 1;
