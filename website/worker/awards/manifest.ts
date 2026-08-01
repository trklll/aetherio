// Manifest de ediciones esperadas por ceremonia.
// El manifest declara qué ediciones deben existir, cuáles son huecos legítimos
// (canceladas, sin archivo, bloqueadas) y de dónde importar. La cobertura del
// reporte se calcula contra él: pending = esperada sin datos, gap = hueco.

import { PARSERS } from "./parsers";
import type { AwardCeremony, AwardCoverage, EditionStatus } from "./types";
import type { GapType } from "./parser";

export interface ManifestRow {
  ceremony: AwardCeremony;
  edition: number;
  award_year: number;
  coverage_expected: AwardCoverage | "gap";
  gap_type: GapType | null;
  primary_url: string;
  extra_sources_json: string;
  updated_at: string;
}

export interface ManifestEnv {
  AWARDS_DB: D1Database;
}

/** Sincroniza el manifest desde los parsers: ediciones + huecos declarados. */
export async function syncManifest(env: ManifestEnv): Promise<number> {
  const rows: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  for (const parser of Object.values(PARSERS)) {
    const gaps = new Map((parser.gapEditions?.() ?? []).map(gap => [gap.edition, gap]));
    for (const spec of parser.archiveEditions()) {
      const gap = gaps.get(spec.edition);
      const coverageExpected: AwardCoverage | "gap" = gap ? "gap" : spec.coverage;
      const gapType = gap?.type ?? null;
      const extra = parser.extraSource ? parser.extraSource(spec.edition) : null;
      rows.push({
        ceremony: parser.ceremony,
        edition: spec.edition,
        awardYear: spec.awardYear,
        coverageExpected,
        gapType,
        primaryUrl: spec.url,
        extraSources: JSON.stringify(extra ? [extra] : []),
        updatedAt: now,
      });
    }
  }
  if (rows.length > 0) {
    // Un solo statement evita consumir el límite de subrequests de Workers al
    // sincronizar el histórico completo. D1 expone SQLite JSON1 (json_each).
    await env.AWARDS_DB.prepare(
      `INSERT OR REPLACE INTO award_edition_manifest (
        ceremony, edition, award_year, coverage_expected, gap_type, primary_url, extra_sources_json, updated_at
      )
      SELECT
        json_extract(value, '$.ceremony'),
        json_extract(value, '$.edition'),
        json_extract(value, '$.awardYear'),
        json_extract(value, '$.coverageExpected'),
        json_extract(value, '$.gapType'),
        json_extract(value, '$.primaryUrl'),
        json_extract(value, '$.extraSources'),
        json_extract(value, '$.updatedAt')
      FROM json_each(?)`,
    ).bind(JSON.stringify(rows)).run();
  }
  return rows.length;
}

export interface EditionCoverageRow {
  ceremony: AwardCeremony;
  edition: number;
  award_year: number;
  coverage: AwardCoverage;
  status: EditionStatus;
  updated_at: string;
}

export interface ManifestGapRow {
  ceremony: AwardCeremony;
  edition: number;
  award_year: number;
  gap_type: GapType;
}

export async function loadManifestRows(env: ManifestEnv): Promise<ManifestRow[]> {
  const result = await env.AWARDS_DB.prepare(
    `SELECT ceremony, edition, award_year, coverage_expected, gap_type, primary_url, extra_sources_json, updated_at
     FROM award_edition_manifest`,
  ).all<ManifestRow>();
  return result.results ?? [];
}

export interface CoverageByCeremony {
  ceremony: AwardCeremony;
  /** Ediciones esperadas (complete o partial) según el manifest. */
  expectedEditions: number[];
  /** Esperadas sin fila en award_editions: aún no importadas. */
  pendingEditions: number[];
  /** Huecos explícitos (canceladas, sin archivo, bloqueadas). */
  gapEditions: Array<{ edition: number; type: GapType }>;
  completeEditions: number[];
  partialEditions: number[];
  staleEditions: number[];
  failedEditions: number[];
  lastSyncAt: string | null;
}

export function coverageByCeremony(
  ceremony: AwardCeremony,
  editions: EditionCoverageRow[],
  manifest: ManifestRow[],
): CoverageByCeremony {
  const rows = editions.filter(row => row.ceremony === ceremony).sort((a, b) => a.edition - b.edition);
  const manifestRows = manifest.filter(row => row.ceremony === ceremony);
  const statusByEdition = new Map(rows.map(row => [row.edition, row.status]));
  let lastSyncAt: string | null = null;
  for (const row of rows) {
    if (row.updated_at && (lastSyncAt === null || row.updated_at > lastSyncAt)) lastSyncAt = row.updated_at;
  }
  return {
    ceremony,
    expectedEditions: manifestRows
      .filter(row => row.coverage_expected !== "gap")
      .map(row => row.edition)
      .sort((a, b) => a - b),
    // Pendiente = esperada sin fila, o con fila fallida/desactualizada:
    // esas ediciones deben reintentarse en el próximo backfill.
    pendingEditions: manifestRows
      .filter(row => {
        if (row.coverage_expected === "gap") return false;
        const status = statusByEdition.get(row.edition);
        return status === undefined || status === "parser_failed" || status === "stale";
      })
      .map(row => row.edition)
      .sort((a, b) => a - b),
    gapEditions: manifestRows
      .filter((row): row is ManifestRow & { gap_type: GapType } => row.coverage_expected === "gap" && row.gap_type !== null)
      .map(row => ({ edition: row.edition, type: row.gap_type }))
      .sort((a, b) => a.edition - b.edition),
    completeEditions: rows.filter(row => row.coverage === "complete" && row.status === "ok").map(row => row.edition),
    partialEditions: rows.filter(row => row.coverage === "partial").map(row => row.edition),
    staleEditions: rows.filter(row => row.status === "stale").map(row => row.edition),
    failedEditions: rows.filter(row => row.status === "parser_failed").map(row => row.edition),
    lastSyncAt,
  };
}
