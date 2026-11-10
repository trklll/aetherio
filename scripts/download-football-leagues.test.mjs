import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  parseCountryPages,
  parseLeagueLinks,
  parseLogoAssets,
  runDownload,
  validateAsset,
} from "./download-football-leagues.mjs";

const SITE = "https://football-logos.cc";
const league = { category: "england", slug: "premier-league", name: "Premier League", sourcePageUrl: `${SITE}/england/premier-league/` };
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0h100v100z"/></svg>');
const png = (size) => {
  const bytes = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(size, 16);
  bytes.writeUInt32BE(size, 20);
  bytes.write("IEND", 37);
  return bytes;
};
const serialize = (value) => Array.isArray(value) ? [1, value.map(serialize)]
  : [0, value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)])) : value];
const island = (component, props) => `<astro-island component-export="${component}" props='${JSON.stringify(serialize(props)[1])}'></astro-island>`;
// Eight PNG hashes (including 32 px), then SVG: the real site uses 72 chars.
const hash = "111111112222222233333333444444445555555566666666777777778888888899999999";
const logoPage = `<main><h1>Premier League Logo (PNG &amp; SVG)</h1>
  <div data-logo-downloads data-logo-download-source="lp" data-category-id="england" data-logo-id="premier-league" data-svg-hash="88888888">
    <select data-logo-png-download-select><option value="">Choose</option><option value="512::44444444">512</option><option value="3000::11111111">3000</option></select>
  </div></main>`;

test("discovers only country-index pages, deduplicated and confined to the source", () => {
  assert.deepEqual(parseCountryPages(`<main><div data-country-group>
    <a href="/england/">England</a><a href="/england/">England</a><a href="/spain/">Spain</a>
    <a href="https://example.org/france/">Other</a><a href="/england/arsenal/">Club</a>
  </div></main><footer><a href="/collections/">Packs</a></footer>`), [
    { category: "england", sourcePageUrl: `${SITE}/england/` },
    { category: "spain", sourcePageUrl: `${SITE}/spain/` },
  ]);
});

test("collects explicit league headings and the league index, never club cards", () => {
  const html = `<main><a href="/england/premier-league/"><h2>Premier League</h2></a>
    <a href="/england/arsenal/"><h3>Arsenal</h3></a>
    <a href="https://other.test/a/b/"><h2>External</h2></a>
    <section aria-labelledby="league-logos-heading"><a href="/england/premier-league/"><span>Premier League</span> 20 teams</a>
    <a href="/tournaments/uefa-champions-league/"><span>UEFA Champions League</span> 36 teams</a></section></main>`;
  assert.deepEqual(parseLeagueLinks(html).map(({ category, slug }) => `${category}/${slug}`), ["england/premier-league", "tournaments/uefa-champions-league"]);
});

test("uses published per-format hashes and includes named color/no-text variants", () => {
  const variant = { id: "premier-league--white", name: "White", h: hash, svg: { sizeBytes: 200 }, png: [{ dimension: 512 }, { dimension: 3000 }] };
  const html = logoPage + island("LogoColorVariants", { categoryId: "england", colorVariants: [variant], styleVariants: [{ ...variant, id: "premier-league--gold" }] })
    + island("LogoStylisticVariants", { categoryId: "england", variants: [variant, { ...variant, id: "arsenal" }] });
  const assets = parseLogoAssets(html, league);
  assert.equal(assets.length, 6);
  assert.deepEqual([...new Set(assets.map(({ logoId }) => logoId))], ["premier-league", "premier-league--white"]);
  assert.ok(assets.some(({ sourceUrl }) => sourceUrl === "https://images.football-logos.cc/england/premier-league.88888888.svg"));
  assert.ok(assets.some(({ sourceUrl }) => sourceUrl === "https://images.football-logos.cc/england/premier-league--white.99999999.svg"));
  assert.ok(assets.some(({ sourceUrl }) => sourceUrl === "https://images.football-logos.cc/england/3000/premier-league.11111111.png"));
  assert.ok(assets.some(({ sourceUrl }) => sourceUrl === "https://assets.football-logos.cc/logos/england/512x512/premier-league--white.44444444.png"));
});

test("never falls back to a club logo or accepts traversal in source identities", () => {
  assert.throws(() => parseLogoAssets(logoPage.replaceAll("premier-league", "arsenal"), league), /principal|ficha/i);
  assert.throws(() => parseLogoAssets(logoPage, { ...league, slug: "../arsenal" }), /identidad/i);
  assert.throws(() => parseLogoAssets(logoPage.replaceAll("88888888", "not-a-hash"), league), /hash/i);
});

test("handles PNG-only records and rejects empty download metadata", () => {
  const assets = parseLogoAssets(logoPage.replace('data-svg-hash="88888888"', 'data-svg-hash=""'), league, [512]);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].format, "png");
  assert.throws(() => parseLogoAssets('<main></main>', league), /ficha|principal/i);
});

test("validates file signatures and dimensions and rejects executable SVG", () => {
  assert.doesNotThrow(() => validateAsset(svg, { format: "svg" }));
  assert.doesNotThrow(() => validateAsset(png(512), { format: "png", dimension: 512 }));
  for (const unsafe of ['<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"/>', '<svg><foreignObject/></svg>', '<svg><use href="javascript:alert(1)"/></svg>', '<html>error</html>']) {
    assert.throws(() => validateAsset(Buffer.from(unsafe), { format: "svg" }));
  }
  assert.throws(() => validateAsset(Buffer.from("error"), { format: "png", dimension: 512 }));
  assert.throws(() => validateAsset(png(128), { format: "png", dimension: 512 }));
});

test("downloads, records provenance, resumes without HTTP and does not replace existing assets", async () => {
  const cacheBase = join(import.meta.dirname, "../node_modules/.cache");
  await mkdir(cacheBase, { recursive: true });
  const root = await mkdtemp(join(cacheBase, "football-leagues-test-"));
  try {
    const outputRoot = join(root, "assets");
    const cacheRoot = join(root, "pages");
    let calls = 0;
    const fetchFn = async (url) => {
      calls++;
      if (url === `${SITE}/all/`) return new Response('<div data-country-group><a href="/england/">England</a></div>');
      if (url === `${SITE}/england/`) return new Response('<main><a href="/england/premier-league/"><h2>Premier League</h2></a></main>');
      if (url === league.sourcePageUrl) return new Response(logoPage);
      return new Response(url.endsWith(".svg") ? svg : png(/3000x3000|\/3000\//.test(url) ? 3000 : 512));
    };
    const options = { outputRoot, cacheRoot, fetchFn, log: () => {}, concurrency: 2 };
    const first = await runDownload(options);
    assert.equal(first.scope.leagues, 1);
    assert.equal(first.scope.downloadedAssets, 3);
    assert.equal(first.entries[0].status, "downloaded");
    assert.equal(JSON.parse(await readFile(join(outputRoot, "manifest.json"), "utf8")).source.website, SITE);
    const before = calls;
    await runDownload(options);
    assert.equal(calls, before);
    const localPath = join(outputRoot, first.entries[0].assets[0].file);
    await writeFile(localPath, "user content");
    const third = await runDownload(options);
    assert.equal(third.scope.failedAssets, 1);
    assert.equal(await readFile(localPath, "utf8"), "user content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports failed countries and missing league records without claiming completeness", async () => {
  const cacheBase = join(import.meta.dirname, "../node_modules/.cache");
  await mkdir(cacheBase, { recursive: true });
  const root = await mkdtemp(join(cacheBase, "football-leagues-errors-"));
  try {
    const manifest = await runDownload({
      outputRoot: join(root, "assets"), cacheRoot: join(root, "pages"), log: () => {},
      fetchFn: async (url) => url === `${SITE}/all/`
        ? new Response('<div data-country-group><a href="/england/">England</a></div><section aria-labelledby="league-logos-heading"><a href="/england/premier-league/">Premier League</a></section>')
        : new Response("Not found", { status: 404 }),
    });
    assert.equal(manifest.discoveryErrors.length, 1);
    assert.equal(manifest.entries[0].status, "unavailable");
    assert.equal(manifest.scope.downloadedAssets, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops using an origin after HTTP 403 and supports recording a known block without retrying", async () => {
  const cacheBase = join(import.meta.dirname, "../node_modules/.cache");
  await mkdir(cacheBase, { recursive: true });
  const root = await mkdtemp(join(cacheBase, "football-leagues-blocked-"));
  try {
    let downloadHostCalls = 0;
    const options = {
      outputRoot: join(root, "assets"), cacheRoot: join(root, "pages"), log: () => {}, concurrency: 1,
      fetchFn: async (url) => {
        if (url === `${SITE}/all/`) return new Response('<div data-country-group><a href="/england/">England</a></div>');
        if (url === `${SITE}/england/`) return new Response('<main><a href="/england/premier-league/"><h2>Premier League</h2></a></main>');
        if (url === league.sourcePageUrl) return new Response(logoPage);
        if (url.startsWith("https://images.football-logos.cc/")) {
          downloadHostCalls++;
          return new Response("Forbidden", { status: 403 });
        }
        return new Response(png(512));
      },
    };
    const first = await runDownload(options);
    assert.equal(downloadHostCalls, 1);
    assert.equal(first.scope.downloadedAssets, 1);
    assert.equal(first.scope.failedAssets, 2);
    assert.deepEqual(first.blockedOrigins, ["https://images.football-logos.cc"]);
    const second = await runDownload({ ...options, blockedOrigins: first.blockedOrigins });
    assert.equal(downloadHostCalls, 1);
    assert.equal(second.scope.downloadedAssets, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
