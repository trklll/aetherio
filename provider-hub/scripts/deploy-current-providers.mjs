#!/usr/bin/env node
/**
 * Empaqueta las fuentes actuales del registro KV en el Worker y despliega.
 * Workers no permite leer KV ni evaluar JavaScript dinámico dentro de un
 * handler. Al empaquetarlas como text module, se compilan en module-evaluation
 * durante el deploy, sin publicar una versión nueva de Aetherio.
 *
 * Uso: node scripts/deploy-current-providers.mjs
 */

import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HUB_URL = "https://aetherio-provider-hub.xoolinnbeats.workers.dev";
const OUTPUT = path.join(ROOT, "src", "generatedProviderScripts.ts");
const TEMP_OUTPUT = `${OUTPUT}.tmp`;
let logoOverrides = {};
try { logoOverrides = JSON.parse(process.env.HUB_PROVIDER_LOGOS_JSON || "{}"); } catch { /* usar logos del API */ }

async function getAdminToken() {
  const fromEnvironment = process.env.HUB_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  if (fromEnvironment) return fromEnvironment.trim();
  try { return (await readFile(path.join(ROOT, ".admin-token.local"), "utf8")).trim(); }
  catch { return ""; }
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const token = await getAdminToken();
  if (!token) throw new Error("Falta token: define HUB_ADMIN_TOKEN o crea .admin-token.local");
  const headers = { "x-admin-token": token };
  const providers = await getJson(`${HUB_URL}/admin/providers`, headers);
  if (!Array.isArray(providers)) throw new Error("El endpoint admin no devolvió una lista de proveedores");

  const scripts = [];
  for (const provider of providers.filter(item => item.enabled)) {
    const response = await fetch(`${HUB_URL}/scripts/${encodeURIComponent(provider.id)}.js`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Script ${provider.id}: HTTP ${response.status}`);
    const source = await response.text();
    if (!source || new TextEncoder().encode(source).byteLength > 512 * 1024) {
      throw new Error(`Script ${provider.id} vacío o supera 512 KB`);
    }
    scripts.push({
      id: provider.id,
      name: provider.name || provider.id,
      description: provider.description || "",
      logo: logoOverrides[provider.id] || provider.logo || undefined,
      supportedTypes: (provider.supportedTypes || []).filter(type => type === "movie" || type === "tv"),
      contentLanguage: provider.contentLanguage || [],
      enabled: provider.enabled !== false,
      updatedAt: Number(provider.updatedAt) || 0,
      source,
    });
  }

  const content = [
    "/** Generado por scripts/deploy-current-providers.mjs; no editar a mano. */",
    "export interface GeneratedProviderScript {",
    "  id: string; name: string; description: string; logo?: string;",
    '  supportedTypes: Array<"movie" | "tv">; contentLanguage: string[];',
    "  enabled: boolean; updatedAt: number; source: string;",
    "}",
    `export const GENERATED_PROVIDER_SCRIPTS: readonly GeneratedProviderScript[] = ${JSON.stringify(scripts)};`,
    "",
  ].join("\n");

  await writeFile(TEMP_OUTPUT, content, "utf8");
  await rename(TEMP_OUTPUT, OUTPUT);
  console.log(`Empaquetados ${scripts.length} scripts desde KV: ${scripts.map(item => item.id).join(", ")}`);

  const isWindows = process.platform === "win32";
  const deploy = spawnSync(isWindows ? "npx.cmd" : "npx", ["wrangler", "deploy"], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    shell: isWindows,
  });
  if (deploy.error) throw deploy.error;
  if (deploy.status !== 0) throw new Error(`wrangler deploy terminó con código ${deploy.status}`);

  const health = await getJson(`${HUB_URL}/health`);
  const compiled = new Set(health?.warmup?.compiled || []);
  const enabled = scripts.filter(item => item.enabled);
  const required = new Set(enabled.slice(0, 10).map(item => item.id));
  for (const type of ["movie", "tv"]) {
    for (const item of enabled.filter(provider => provider.supportedTypes.includes(type)).slice(0, 6)) {
      required.add(item.id);
    }
  }
  const missing = [...required].filter(id => !compiled.has(id));
  console.log(`Health: version=${health.version}, fase=${health.warmup?.phase}, compilados=${compiled.size}, fallidos=${health.warmup?.failed?.length || 0}`);
  if (missing.length) {
    throw new Error(`Faltan proveedores del fan-out móvil en el bundle: ${missing.join(", ")}`);
  }
}

main().catch(error => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
