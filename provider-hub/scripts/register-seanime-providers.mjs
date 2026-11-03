#!/usr/bin/env node
/** Explicit additive rollout. Uses the existing Wrangler login; never reads,
 * changes or prints ADMIN_TOKEN. Without --apply it only backs up and plans. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HUB = "https://aetherio-provider-hub.xoolinnbeats.workers.dev";
const NAMESPACE = "25d80e365fae4fbab09124cf0ec19bc5";
const TEMP_ROOT = "C:/Users/Administrator/AppData/Local/Temp/opencode";

export function mergeSeanimeRecords(index, imported) {
  if (!index || index.version !== 2 || !Array.isArray(index.records)
    || index.records.some(record => !record || typeof record !== "object" || typeof record.id !== "string")) {
    throw new Error("Índice KV inválido o incompatible; no se sobrescribirá.");
  }
  const records = index.records.slice();
  const existing = new Set(records.map(record => record.id));
  for (const provider of imported.filter(provider => !provider.excluded)) {
    if (existing.has(provider.id)) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider.id)) throw new Error("ID importado inválido");
    records.push({
      id: provider.id, name: provider.name, description: provider.description ?? "",
      logo: provider.logo, enabled: provider.enabled !== false,
      supportedTypes: ["movie", "tv"], contentLanguage: [provider.lang],
      mobileHeaders: "drop", updatedAt: 0,
    });
    existing.add(provider.id);
  }
  return { ...index, records };
}

function wrangler(args, capture = true) {
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "npx.cmd" : "npx", ["wrangler", ...args], {
    cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
    shell: windows, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0) throw new Error(`Wrangler falló (${args.slice(0, 3).join(" ")}); no se ha restablecido ni borrado ningún dato.`);
  return capture ? result.stdout.trim() : "";
}

function readRemoteIndex() {
  const raw = wrangler(["kv", "key", "get", "providers:index", "--namespace-id", NAMESPACE, "--remote", "--text"]);
  let index;
  try { index = JSON.parse(raw); } catch { throw new Error("No se pudo leer el índice KV como JSON; se cancela sin escribir."); }
  mergeSeanimeRecords(index, []); // Reject unknown schemas before touching data.
  return { raw, index };
}

const fingerprint = value => createHash("sha256").update(value).digest("hex");

export async function registerSeanimeProviders(apply = false) {
  const config = await readFile(path.join(ROOT, "wrangler.toml"), "utf8");
  if (!config.includes('name = "aetherio-provider-hub"') || !config.includes(NAMESPACE)) throw new Error("El Worker o namespace no coincide con el destino revisado.");
  const { records: imported } = JSON.parse(await readFile(path.join(ROOT, "src/seanime/catalog.lock.json"), "utf8"));
  const before = readRemoteIndex();
  const merged = mergeSeanimeRecords(before.index, imported);
  const oldIds = new Set(before.index.records.map(record => record.id));
  const added = merged.records.filter(record => !oldIds.has(record.id));
  const backup = await mkdtemp(path.join(TEMP_ROOT, "aetherio-seanime-kv-before-"));
  await writeFile(path.join(backup, "providers-index.json"), before.raw, { mode: 0o600 });
  const planned = path.join(backup, "providers-index-planned.json");
  await writeFile(planned, JSON.stringify(merged), { mode: 0o600 });
  console.log(`Plan: conservar ${before.index.records.length} registros y añadir ${added.length}; ${added.filter(record => !record.enabled).length} nuevas fuentes pausadas.`);
  console.log(`Copia privada: ${backup}`);
  if (!apply) { console.log("Solo comprobación. Para desplegar y registrar: --apply"); return { added: added.map(record => record.id), backup }; }

  // Bundle first. A failed deployment must never expose uncompiled new scripts.
  wrangler(["deploy"], false);
  const response = await fetch(HUB + "/health", { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  const health = await response.json();
  const compiled = new Set(health.warmup?.compiled ?? []);
  const missing = imported.filter(provider => !provider.excluded && !compiled.has(provider.id));
  if (!response.ok || missing.length || health.warmup?.failed?.length) throw new Error("El bundle activo no pasó el warmup; no se modificó el índice KV.");

  const latest = readRemoteIndex();
  if (fingerprint(latest.raw) !== fingerprint(before.raw)) throw new Error("El índice cambió durante el despliegue. Se cancela la escritura para conservar las ediciones nuevas.");
  wrangler(["kv", "key", "put", "providers:index", "--namespace-id", NAMESPACE, "--remote", "--path", planned], false);
  // No secrets, addon directory, personal URLs or existing scripts are changed.
  console.log(`Registradas ${added.length} nuevas fuentes. Las eliminaciones futuras no se reponen automáticamente.`);
  return { added: added.map(record => record.id), backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  registerSeanimeProviders(process.argv.includes("--apply")).catch(error => { console.error(error.message); process.exitCode = 1; });
}
