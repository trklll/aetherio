#!/usr/bin/env node
// Backfill reutilizable del catálogo de premiaciones.
//
// Uso:
//   node scripts/backfill-awards.mjs --ceremony oscar --editions 1-98
//   node scripts/backfill-awards.mjs --scope pending        (desde el manifest)
//   node scripts/backfill-awards.mjs --scope weekly
//   node scripts/backfill-awards.mjs --ceremony cannes,venice --editions 75-79
//
// Opciones:
//   --base-url   URL del worker (por defecto http://127.0.0.1:8787)
//   --token      Token de importación interna (o env AWARDS_IMPORT_TOKEN)
//   --scope      backfill | pending | weekly | manual (por defecto backfill)
//   --ceremony   Filtro por ceremonia (coma para varias)
//   --editions   "1-98", "1,3,5" o una edición (requiere --ceremony)
//   --batch      Máximo de ediciones por request (por defecto 10, tope 50)
//   --retries    Reintentos por lote ante fallos (por defecto 3)
//
// Notas:
//   - "pending" se resuelve localmente contra /api/awards/coverage y se
//     envía como scope "backfill" con targets explícitos: el worker solo
//     acepta backfill, weekly o manual.
//   - El éxito se mide por target (results[].ok / editionsFailed), no por
//     el tamaño del chunk: un 207 parcial no cuenta como éxito completo.

import { spawnSync } from "node:child_process";

const CEREMONY_IDS = [
  "oscar", "bafta", "golden_globes", "emmy", "goya", "japan_academy",
  "crunchyroll", "cannes", "venice", "mar_del_plata",
];

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args["base-url"] ?? process.env.AWARDS_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const token = args.token ?? process.env.AWARDS_IMPORT_TOKEN ?? "";
const scope = args.scope ?? "backfill";
const ceremonyFilter = args.ceremony ? args.ceremony.split(",").map(s => s.trim()).filter(Boolean) : null;
const editionsSpec = args.editions ?? null;
const batchSize = Math.min(50, Math.max(1, Number(args.batch ?? 10)));
const retries = Math.max(1, Math.min(5, Number(args.retries ?? 3)));

if (!["backfill", "pending", "weekly", "manual"].includes(scope)) {
  fail("El scope debe ser backfill, pending, weekly o manual.");
}
if (!token) {
  fail("Falta el token: --token o env AWARDS_IMPORT_TOKEN.");
}
if (ceremonyFilter) {
  const unknown = ceremonyFilter.filter(id => !CEREMONY_IDS.includes(id));
  if (unknown.length > 0) fail(`Ceremonias desconocidas: ${unknown.join(", ")}. Válidas: ${CEREMONY_IDS.join(", ")}.`);
}

const targets = await buildTargets();
// weekly deja que el worker calcule las ediciones (weeklyTargets del manifest);
// los demás scopes envían targets explícitos y exigen al menos uno.
const hasExplicitTargets = scope !== "weekly";
if (hasExplicitTargets && targets.length === 0) fail("No hay ediciones para importar.");

const workerScope = scope === "pending" ? "backfill" : scope;
console.log(`[awards-backfill] ${baseUrl} scope=${scope} targets=${hasExplicitTargets ? targets.length : "worker"} batch=${batchSize} retries=${retries}`);

let importedTotal = 0;
let okTotal = 0;
let failed = 0;
const failedEditions = [];

const batches = hasExplicitTargets
  ? Array.from({ length: Math.ceil(targets.length / batchSize) }, (_, index) => targets.slice(index * batchSize, index * batchSize + batchSize))
  : [null];

let chunkIndex = 0;

for (const chunk of batches) {
  const payload = chunk === null ? { scope: workerScope } : { scope: workerScope, targets: chunk };
  const url = `${baseUrl}/api/internal/awards/import`;
  const chunkSize = chunk === null ? 0 : chunk.length;

  let result = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    result = spawnSync("node", [
      "--input-type=module",
      "-e",
      `
        const res = await fetch(process.argv[1], {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.argv[2],
          },
          body: process.argv[3],
        });
        const text = await res.text();
        process.stdout.write(JSON.stringify({ status: res.status, body: text }));
      `,
      url,
      token,
      JSON.stringify(payload),
    ], { encoding: "utf8" });

    if (result.status !== 0) {
      if (attempt + 1 < retries) {
        console.error(`  proceso fallido (intento ${attempt + 1}); reintentando...`);
        await sleep(2000 * (attempt + 1));
      }
      continue;
    }
    const parsedAttempt = safeJson(result.stdout);
    const retryableHttp = parsedAttempt && [429, 500, 502, 503, 504].includes(parsedAttempt.status);
    if (retryableHttp && attempt + 1 < retries) {
      console.error(`  HTTP ${parsedAttempt.status} (intento ${attempt + 1}); reintentando...`);
      await sleep(2000 * (attempt + 1));
      continue;
    }
    break;
  }

  if (result === null || result.status !== 0) {
    failed += Math.max(chunkSize, 1);
    if (chunk) failedEditions.push(...chunk.map(target => `${target.ceremony} ${target.edition}`));
    else failedEditions.push("weekly batch");
    console.error(`  ${result?.stderr?.trim() || "Error de proceso."}`);
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    failed += Math.max(chunkSize, 1);
    if (chunk) failedEditions.push(...chunk.map(target => `${target.ceremony} ${target.edition}`));
    else failedEditions.push("weekly batch");
    console.error("  Respuesta inválida del worker.");
    continue;
  }

  if (!parsed || typeof parsed !== "object" || !Number.isInteger(parsed.status)) {
    failed += Math.max(chunkSize, 1);
    if (chunk) failedEditions.push(...chunk.map(target => `${target.ceremony} ${target.edition}`));
    else failedEditions.push("weekly batch");
    console.error("  Respuesta inválida del cliente HTTP.");
    continue;
  }
  if (parsed.status >= 400) {
    failed += Math.max(chunkSize, 1);
    if (chunk) failedEditions.push(...chunk.map(target => `${target.ceremony} ${target.edition}`));
    else failedEditions.push("weekly batch");
    console.error(`  HTTP ${parsed.status}: ${parsed.body?.slice(0, 300) ?? ""}`);
    continue;
  }

  const summary = safeJson(parsed.body);
  const results = Array.isArray(summary?.results) ? summary.results : null;
  if (!summary || (results === null && !Number.isFinite(Number(summary?.editionsOk)))) {
    failed += Math.max(chunkSize, 1);
    if (chunk) failedEditions.push(...chunk.map(target => `${target.ceremony} ${target.edition}`));
    else failedEditions.push("weekly batch");
    console.error("  Respuesta del worker sin resumen de importación válido.");
    continue;
  }
  const done = results ? results.filter(r => r?.ok === true).length : Number(summary?.editionsOk ?? 0);
  const chunkFailed = results
    ? results.filter(r => r?.ok !== true).length
    : Number(summary?.editionsFailed ?? 0);
  const imported = Number(summary?.recordsImported ?? 0);
  importedTotal += imported;
  okTotal += done;
  failed += chunkFailed;
  if (chunkFailed > 0 && results) {
    for (const target of results) {
      if (target?.ok !== true) {
        const tag = `${target?.ceremony ?? "?"} ${target?.edition ?? "?"}`;
        failedEditions.push(tag);
        console.error(`  falló ${tag}: ${target?.error ?? "sin detalle"}`);
      }
    }
  }
  console.log(`  chunk ${chunkIndex + 1}: ${done} ediciones, +${imported} registros${chunkFailed ? `, ${chunkFailed} fallidas` : ""}`);
  chunkIndex += 1;
}

console.log(`[awards-backfill] listo: ${okTotal} ediciones, +${importedTotal} registros, ${failed} fallidas.`);
if (failedEditions.length > 0) {
  console.error(`[awards-backfill] Fallidas: ${failedEditions.join(", ")}`);
}
process.exit(failed > 0 ? 1 : 0);

async function buildTargets() {
  if (scope === "weekly") return [];
  if (scope === "pending") {
    return pendingTargets();
  }
  if (!ceremonyFilter) fail("Con scope backfill/manual se requiere --ceremony.");
  if (!editionsSpec) fail("Con scope backfill/manual se requiere --editions.");
  const editions = parseEditions(editionsSpec);
  const list = [];
  for (const id of ceremonyFilter) {
    for (const edition of editions) {
      list.push({ ceremony: id, edition });
    }
  }
  return list;
}

async function syncManifestBeforePending() {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/internal/awards/manifest/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok && Number.isInteger(body.synced)) {
      console.log(`[awards-backfill] manifest sincronizado: ${body.synced} ediciones.`);
      return;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt + 1 >= retries) {
      fail(`No se pudo sincronizar el manifest (HTTP ${response.status}).`);
    }
    await sleep(2000 * (attempt + 1));
  }
}

/** Ediciones esperadas según el manifest que aún no tienen datos. */
async function pendingTargets() {
  let body = await fetchCoverage();
  const summaries = Object.values(body.byCeremony);
  const manifestEmpty = summaries.length === 0 || summaries.every(summary => !Array.isArray(summary?.expectedEditions) || summary.expectedEditions.length === 0);
  if (manifestEmpty) {
    await syncManifestBeforePending();
    body = await fetchCoverage();
  }
  if (!body?.byCeremony) fail("El coverage no tiene byCeremony.");

  const list = [];
  for (const [ceremony, summary] of Object.entries(body.byCeremony)) {
    if (ceremonyFilter && !ceremonyFilter.includes(ceremony)) continue;
    for (const edition of summary?.pendingEditions ?? []) {
      list.push({ ceremony, edition });
    }
  }
  if (list.length === 0) console.log("[awards-backfill] Sin ediciones pendientes en el manifest.");
  return list;
}

async function fetchCoverage() {
  const response = await fetch(`${baseUrl}/api/awards/coverage`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) fail(`El coverage no responde (HTTP ${response.status}).`);
  const body = await response.json().catch(() => null);
  if (!body?.byCeremony) fail("El coverage no tiene byCeremony.");
  return body;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseEditions(spec) {
  const out = [];
  for (const part of String(spec).split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = /^(\d+)-(\d+)$/.exec(trimmed);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < to) {
        for (let edition = from; edition <= to; edition += 1) out.push(edition);
      } else if (from > to) {
        for (let edition = from; edition >= to; edition -= 1) out.push(edition);
      } else {
        out.push(from);
      }
      continue;
    }
    const single = /^\d+$/.exec(trimmed);
    if (single) out.push(Number(single));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        index += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function fail(message) {
  console.error(`[awards-backfill] ${message}`);
  process.exit(2);
}
