import { afterEach, describe, expect, it } from "vitest";
import { importCapturedHtml, importEditionFromHtml, runImport } from "../import";
import { PARSERS } from "../parsers";
import { resetDomainStates } from "../fetch";
import { SqliteD1, stubHtmlFetch, type StubFetchRoute } from "./helpers";
import type { ParserMeta } from "../parser";
import type { ImportEnv } from "../import";

const OSCAR_URL = "https://www.oscars.org/oscars/ceremonies/2024";
const OSCAR_ROBOTS = "https://www.oscars.org/robots.txt";

const OSCAR_HTML = `
  <h2>Best Picture</h2>
  <ul>
    <li class="winner">Anora</li>
    <li>Conclave</li>
  </ul>
  <h3>Best Director</h3>
  <ul>
    <li class="winner">Sean Baker — Anora</li>
  </ul>`;

function makeEnv(): { env: ImportEnv; db: SqliteD1 } {
  const db = new SqliteD1();
  const env: ImportEnv = {
    AWARDS_DB: db as unknown as ImportEnv["AWARDS_DB"],
    TMDB_API_KEY: undefined,
    ANILIST_CLIENT_ID: undefined,
  };
  return { env, db };
}

function oscarMeta(): ParserMeta {
  return { ceremony: "oscar", edition: 96, awardYear: 2024, url: OSCAR_URL, coverage: "complete" };
}

async function countRecords(db: SqliteD1): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM award_records").bind().first<{ count: number }>();
  return Number(row?.count ?? 0);
}

afterEach(() => {
  resetDomainStates();
});

describe("importEditionFromHtml", () => {
  it("importa registros sin duplicados en una segunda pasada (idempotente)", async () => {
    const { env, db } = makeEnv();
    const first = await importEditionFromHtml(env, PARSERS.oscar, oscarMeta(), OSCAR_HTML, "checksum-a");
    expect(first.ok).toBe(true);
    expect(first.imported).toBe(3);
    expect(first.updated).toBe(0);
    expect(await countRecords(db)).toBe(3);

    const second = await importEditionFromHtml(env, PARSERS.oscar, oscarMeta(), OSCAR_HTML, "checksum-a");
    expect(second.ok).toBe(true);
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(3);
    expect(await countRecords(db)).toBe(3);
  });

  it("conserva el dataset anterior si el parser devuelve cero registros", async () => {
    const { env, db } = makeEnv();
    await importEditionFromHtml(env, PARSERS.oscar, oscarMeta(), OSCAR_HTML, "checksum-a");
    const broken = await importEditionFromHtml(env, PARSERS.oscar, oscarMeta(), "<div>sin estructura</div>", "checksum-b");
    expect(broken.ok).toBe(false);
    expect(await countRecords(db)).toBe(3);

    const edition = await db.prepare(
      "SELECT status, record_count FROM award_editions WHERE ceremony = 'oscar' AND edition = 96",
    ).bind().first<{ status: string; record_count: number }>();
    expect(edition?.status).toBe("parser_failed");
    expect(edition?.record_count).toBe(3);
  });

  it("deduplica registros repetidos dentro de la misma edición", async () => {
    const { env, db } = makeEnv();
    const html = `
      <h2>Best Picture</h2>
      <ul>
        <li class="winner">Anora</li>
        <li class="winner">Anora</li>
        <li>Conclave</li>
      </ul>`;
    const result = await importEditionFromHtml(env, PARSERS.oscar, oscarMeta(), html, "checksum-c");
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(2);
    expect(await countRecords(db)).toBe(2);
  });

  it("rechaza una caída anormal de registros y conserva el dataset activo", async () => {
    const { env, db } = makeEnv();
    await importEditionFromHtml(env, PARSERS.oscar, oscarMeta(), OSCAR_HTML, "checksum-a");
    const regression = await importEditionFromHtml(
      env,
      PARSERS.oscar,
      oscarMeta(),
      `<h2>Best Picture</h2><ul><li class="winner">Anora</li></ul>`,
      "checksum-b",
    );
    expect(regression.ok).toBe(false);
    expect(regression.error).toContain("caída anormal");
    expect(await countRecords(db)).toBe(3);

    const batch = await db.prepare(
      "SELECT outcome, rejection_reason FROM award_import_batches WHERE checksum = 'checksum-b'",
    ).bind().first<{ outcome: string; rejection_reason: string | null }>();
    expect(batch?.outcome).toBe("rejected");
    expect(batch?.rejection_reason).toContain("Caída anormal");

    const edition = await db.prepare(
      "SELECT status, record_count FROM award_editions WHERE ceremony = 'oscar' AND edition = 96",
    ).bind().first<{ status: string; record_count: number }>();
    expect(edition?.status).toBe("ok");
    expect(edition?.record_count).toBe(3);
  });

  it("importa HTML capturado sin salir a la red y omite pasadas con el mismo checksum", async () => {
    const { env, db } = makeEnv();
    const first = await importCapturedHtml(env, "oscar", 96, OSCAR_HTML);
    expect(first.ok).toBe(true);
    expect(first.imported).toBe(3);
    expect(await countRecords(db)).toBe(3);

    const second = await importCapturedHtml(env, "oscar", 96, OSCAR_HTML);
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(await countRecords(db)).toBe(3);
  });
});

describe("runImport", () => {
  it("importa una edición y registra la corrida en award_sync_runs", async () => {
    const { env, db } = makeEnv();
    const routes: StubFetchRoute[] = [
      { url: OSCAR_ROBOTS, html: "User-agent: *\nDisallow:" },
      { url: OSCAR_URL, html: OSCAR_HTML },
    ];
    const restore = stubHtmlFetch(routes);
    try {
      const summary = await runImport(env, "manual", [{ ceremony: "oscar", edition: 96 }]);
      expect(summary.outcome).toBe("success");
      expect(summary.recordsImported).toBe(3);
      expect(summary.editionsOk).toBe(1);
      expect(summary.editionsFailed).toBe(0);
      expect(summary.results[0]).toMatchObject({ ceremony: "oscar", edition: 96, ok: true });

      const run = await db.prepare(
        "SELECT outcome, records_imported, records_updated FROM award_sync_runs",
      ).bind().first<{ outcome: string; records_imported: number; records_updated: number }>();
      expect(run?.outcome).toBe("success");
      expect(run?.records_imported).toBe(3);
    } finally {
      restore();
    }
  });

  it("omite ediciones sin cambios por checksum en la segunda pasada", async () => {
    const { env } = makeEnv();
    const routes: StubFetchRoute[] = [
      { url: OSCAR_ROBOTS, html: "User-agent: *\nDisallow:" },
      { url: OSCAR_URL, html: OSCAR_HTML },
    ];
    const restore = stubHtmlFetch(routes);
    try {
      const first = await runImport(env, "manual", [{ ceremony: "oscar", edition: 96 }]);
      expect(first.recordsImported).toBe(3);
      const second = await runImport(env, "manual", [{ ceremony: "oscar", edition: 96 }]);
      expect(second.recordsImported).toBe(0);
      expect(second.results[0].skipped).toBe(true);
      expect(second.outcome).toBe("success");
    } finally {
      restore();
    }
  });

  it("marca ediciones parciales sin importar HTML", async () => {
    const { env, db } = makeEnv();
    const veniceGaps = new Set((PARSERS.venice.gapEditions?.() ?? []).map(item => item.edition));
    const venicePartial = PARSERS.venice.archiveEditions().find(item => item.coverage === "partial" && !veniceGaps.has(item.edition));
    if (!venicePartial) throw new Error("Venecia sin ediciones parciales");
    // Sin fuentes secundarias disponibles: la edición queda marcada parcial.
    const restore = stubHtmlFetch([]);
    try {
      const summary = await runImport(env, "manual", [{ ceremony: "venice", edition: venicePartial.edition }]);
      expect(summary.outcome).toBe("success");
      expect(summary.results[0]).toMatchObject({ ok: true, skipped: true });
      const edition = await db.prepare(
        "SELECT coverage, status FROM award_editions WHERE ceremony = 'venice' AND edition = ?",
      ).bind(venicePartial.edition).first<{ coverage: string; status: string }>();
      expect(edition?.coverage).toBe("partial");
      expect(edition?.status).toBe("ok");
    } finally {
      restore();
    }
  });

  it("omite ediciones declaradas como hueco (canceladas) sin crear fila", async () => {
    const { env, db } = makeEnv();
    const cannesGap = PARSERS.cannes.gapEditions?.()?.[0];
    if (!cannesGap) throw new Error("Cannes sin huecos declarados");
    const summary = await runImport(env, "manual", [{ ceremony: "cannes", edition: cannesGap.edition }]);
    expect(summary.outcome).toBe("success");
    expect(summary.results[0]).toMatchObject({ ok: true, skipped: true });
    const edition = await db.prepare(
      "SELECT coverage_expected FROM award_edition_manifest WHERE ceremony = 'cannes' AND edition = ?",
    ).bind(cannesGap.edition).first<{ coverage_expected: string }>();
    expect(edition?.coverage_expected).toBe("gap");
  });

  it("reporta ediciones inexistentes sin romper la corrida", async () => {
    const { env } = makeEnv();
    const summary = await runImport(env, "manual", [{ ceremony: "oscar", edition: 9999 }]);
    expect(summary.outcome).toBe("partial");
    expect(summary.editionsFailed).toBe(1);
    expect(summary.results[0].ok).toBe(false);
  });

  it("weeklyTargets cubre las dos ediciones más recientes por ceremonia", async () => {
    const targets = (await import("../import")).weeklyTargets();
    expect(targets).toHaveLength(20);
    const oscarTargets = targets.filter(target => target.ceremony === "oscar");
    expect(oscarTargets).toEqual([
      { ceremony: "oscar", edition: 98 },
      { ceremony: "oscar", edition: 97 },
    ]);
  });
});
