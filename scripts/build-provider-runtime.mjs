import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "public");
await mkdir(outputDirectory, { recursive: true });

await build({
  stdin: {
    contents: `
      import axios from "axios";
      import * as cheerio from "cheerio";
      import CryptoJS from "crypto-js";
      self.__NUVIO_PROVIDER_DEPS__ = { axios, cheerio, CryptoJS };
    `,
    resolveDir: root,
    sourcefile: "nuvio-provider-deps-entry.js",
  },
  outfile: resolve(outputDirectory, "nuvio-provider-deps.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  banner: { js: "var window = globalThis; var global = globalThis;" },
  define: {
    "process.env.NODE_ENV": '"production"',
    global: "globalThis",
  },
});

await build({
  stdin: {
    contents: `
      import ts from "typescript";
      self.__NUVIO_PROVIDER_DEPS__ = { ...(self.__NUVIO_PROVIDER_DEPS__ || {}), ts };
    `,
    resolveDir: root,
    sourcefile: "seanime-typescript-deps-entry.js",
  },
  outfile: resolve(outputDirectory, "seanime-typescript-deps.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  banner: { js: "var window = globalThis; var global = globalThis;" },
  define: {
    "process.env.NODE_ENV": '"production"',
    global: "globalThis",
  },
});
