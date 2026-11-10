import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parsePeruvianTeams, runDownload } from "./download-peruvian-league-teams.mjs";

const site = "https://football-logos.cc";
const league = `${site}/peru/peruvian-primera-division/`;
const country = `${site}/peru/`;
const logoPage = (id, hash = "44477a49", category = "peru") => `<main><h1>${id} Logo (PNG &amp; SVG)</h1>
  <div data-logo-downloads data-logo-download-source="lp" data-category-id="${category}" data-logo-id="${id}" data-svg-hash="abcdef12">
    <select data-logo-png-download-select><option value="">Choose</option><option value="512::${hash}">512</option><option value="256::33333333">256</option></select>
  </div></main>`;
const png = (width, height = width) => {
  const bytes = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write("IEND", 37);
  return bytes;
};
const slugLink = (slug, name) => `<li><a href="/peru/${slug}/"><span>${name}</span></a></li>`;
const roster = (links = slugLink("universitario", "Universitario de Deportes")) =>
  `<section aria-labelledby="all-peruvian-primera-divisi-n-teams-heading"><h2>All Peruvian Primera División Teams</h2><article><ul>${links}</ul></article></section>`;

test("parses only clubs explicitly inside the Peruvian Primera División roster", () => {
  const html = `<main><a href="/peru/peruvian-primera-division/"><h2>Peruvian Primera División</h2></a>
    ${roster(`${slugLink("universitario", "Universitario de Deportes")}${slugLink("alianza-lima", "Alianza Lima")}`)}
    <section><h2>Other Logos from Peru</h2>${slugLink("peru-national-team", "Peru National Team")}${slugLink("deportivo-municipal", "Deportivo Municipal")}</section></main>`;
  assert.deepEqual(parsePeruvianTeams(html), [
    { slug: "alianza-lima", name: "Alianza Lima", sourcePageUrl: `${site}/peru/alianza-lima/` },
    { slug: "universitario", name: "Universitario de Deportes", sourcePageUrl: `${site}/peru/universitario/` },
  ]);
});

test("rejects duplicate, external, non-Peru, traversal and empty rosters", () => {
  const html = roster(`${slugLink("universitario", "Universitario")}${slugLink("universitario", "Universitario")}
    <li><a href="/spain/barcelona/"><span>Barcelona</span></a></li>
    <li><a href="/peru/../argentina/boca/"><span>Boca</span></a></li>
    <li><a href="https://example.org/peru/club/"><span>Other</span></a></li>`);
  assert.equal(parsePeruvianTeams(html).length, 1);
  assert.throws(() => parsePeruvianTeams(roster("")), /plantilla|equipos/i);
});

test("downloads only the 512 PNG matching the exact club and Peru record", async () => {
  const single = `<main><h1>Universitario Logo (PNG &amp; SVG)</h1>${logoPage("universitario").split("<main>")[1].split("</main>")[0]}</main>`;
  const manifest = await runDownload({
    outputRoot: "test-output", rosterHtml: roster(), clubPageHtml: single,
    outputPath: "test-output/manifest.json", READMEPath: "test-output/README.md", log: () => {},
  });
  assert.equal(manifest.scope.clubs, 1);
  assert.equal(manifest.scope.downloadedAssets, 1);
  assert.equal(manifest.entries[0].assets[0].sourceUrl, "https://assets.football-logos.cc/logos/peru/512x512/universitario.44477a49.png");
  await rm("test-output", { recursive: true, force: true });
});

test("rejects a team page whose logo identity differs from the roster slug", async () => {
  const dir = await mkdtemp(join(import.meta.dirname, "../node_modules/.cache/peru-teams-test-"));
  try {
    const manifest = await runDownload({
      outputRoot: join(dir, "assets"), cacheRoot: join(dir, "cache"),
      fetchFn: async url => url === `${site}/peru/` || url === league ? new Response(roster())
          : url === `${site}/peru/universitario/` ? new Response(logoPage("alianza-lima"))
            : new Response("not found", { status: 404 }), log: () => {},
    });
    assert.equal(manifest.entries[0].assets[0].status, "failed");
    assert.match(manifest.entries[0].assets[0].reason, /no publica un logo/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("writes an audit manifest, validates image bytes, reuses matching assets and preserves files", async () => {
  const base = join(import.meta.dirname, "../node_modules/.cache");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "peru-teams-sync-test-"));
  try {
    const outputRoot = join(root, "assets");
    const cacheRoot = join(root, "pages");
    const logo = png(512);
    const fetchFn = async url => url === `${site}/peru/` ? new Response(roster())
      : url === league ? new Response(roster())
        : url === `${site}/peru/universitario/` ? new Response(logoPage("universitario"))
          : new Response(logo);
    const first = await runDownload({ outputRoot, cacheRoot, fetchFn, log: () => {} });
    assert.equal(first.scope.downloadedAssets, 1);
    const file = join(outputRoot, first.entries[0].assets[0].file);
    assert.equal((await readFile(file)).byteLength, 45);
    const second = await runDownload({ outputRoot, cacheRoot, fetchFn: async () => { throw new Error("cache should avoid fetching existing files"); }, log: () => {} });
    assert.equal(second.entries[0].assets[0].reused, true);
    await writeFile(file, "user data");
    const third = await runDownload({ outputRoot, cacheRoot, fetchFn, log: () => {} });
    assert.equal(third.entries[0].assets[0].status, "failed");
    assert.equal(await readFile(file, "utf8"), "user data");
    assert.equal(JSON.parse(await readFile(join(outputRoot, "manifest.json"), "utf8")).source.name, "Football Logos");
  } finally { await rm(root, { recursive: true, force: true }); }
});
