import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(process.argv[2]);
const entrypoint = join(sourceRoot, "src/index.js");
const adapterPath = join(sourceRoot, "src/aetherioDesktop.cjs");
const hook = "require('./aetherioDesktop.cjs').configureDesktopProfile(container);";
const needle = "const container = require('./container');";
let source = readFileSync(entrypoint, "utf8");
if (!source.includes(hook)) {
  if (source.split(needle).length !== 2) throw new Error("Unsupported Nuvio entrypoint: cannot safely install the desktop profile.");
  source = source.replace(needle, `${needle}\n// Aetherio desktop: live-first catalogs and replays with bounded provider concurrency.\n${hook}`);
}
source = source.replace("// Aetherio desktop: live-only catalogs with bounded provider concurrency.", "// Aetherio desktop: live-first catalogs and replays with bounded provider concurrency.");
if (existsSync(adapterPath) && !readFileSync(adapterPath, "utf8").startsWith("// Aetherio managed desktop profile.")) {
  throw new Error(`Refusing to overwrite an unmarked file: ${adapterPath}`);
}
writeFileSync(adapterPath, readFileSync(join(scriptsDir, "nuvio-desktop-profile.cjs")));
writeFileSync(entrypoint, source);
console.log("[nuvio:stage] Desktop profile installed: all replay providers, live-first scheduling, max 4 catalog providers, no speculative stream prewarm.");
