import { afterEach, describe, expect, it } from "vitest";
import { handleAwardsRequest } from "../api";
import { resolvePeopleBatch, syncRecipientRows } from "../people";
import { SqliteD1 } from "./helpers";

function makeEnv() {
  const db = new SqliteD1();
  return { db, env: { AWARDS_DB: db as any, TMDB_API_KEY: "test-key" } };
}

function insertRecord(db: SqliteD1, recipients = '["Cillian Murphy"]') {
  db.exec(`
    INSERT INTO award_records
      (id, ceremony, edition, award_year, category_es, category_original, status, subject, recipients,
       work_title, work_year, work_key, source_url, source_tier, import_key, created_at, updated_at)
    VALUES ('record-1', 'oscar', 96, 2024, 'Mejor Actor', 'Best Actor in a Leading Role', 'winner', 'work', '${recipients}',
            'Oppenheimer', 2023, 'oppenheimer [2023]', 'https://example.test', 'official', 'import-1', '2026-01-01', '2026-01-01');
    INSERT INTO award_media_links
      (id, work_key, work_title, work_year, media_type, tmdb_id, resolve_status, created_at, updated_at)
    VALUES ('link-1', 'oppenheimer [2023]', 'Oppenheimer', 2023, 'movie', 872585, 'resolved', '2026-01-01', '2026-01-01');
  `);
}

afterEach(() => {
  // Cada test instala su propio fetch; se restaura al terminar.
});

describe("people resolver", () => {
  it("materializa todos los recipients y resuelve por créditos de la obra", async () => {
    const { db, env } = makeEnv();
    insertRecord(db, '["Cillian Murphy", "Emma Thomas"]');
    await syncRecipientRows(env, 10);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      cast: [{ id: 2037, name: "Cillian Murphy" }],
      crew: [{ id: 1271, name: "Emma Thomas", job: "Producer" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      const result = await resolvePeopleBatch(env, 10);
      expect(result.resolved).toBe(2);
      const rows = await db.prepare("SELECT recipient_name, resolution_status FROM award_record_people ORDER BY recipient_index").bind().all<{ recipient_name: string; resolution_status: string }>();
      expect(rows.results).toEqual([
        { recipient_name: "Cillian Murphy", resolution_status: "resolved" },
        { recipient_name: "Emma Thomas", resolution_status: "resolved" },
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("no expone coincidencias ambiguas", async () => {
    const { db, env } = makeEnv();
    insertRecord(db);
    await syncRecipientRows(env, 10);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      cast: [{ id: 1, name: "Cillian Murphy" }, { id: 2, name: "Cillian Murphy" }],
      crew: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      await resolvePeopleBatch(env, 10);
      const response = await handleAwardsRequest(
        new Request("https://test/api/awards/person?tmdbId=2037"),
        env as any,
        new URL("https://test/api/awards/person?tmdbId=2037"),
      );
      expect(response?.status).toBe(200);
      const payload = await response?.json() as any;
      expect(payload.records).toHaveLength(0);
      expect(payload.resolution.status).toBe("unresolved");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("cierra como no resueltas las ocurrencias sin identidad de obra", async () => {
    const { db, env } = makeEnv();
    db.exec(`
      INSERT INTO award_records
        (id, ceremony, edition, award_year, category_es, category_original, status, subject, recipients,
         work_title, work_year, work_key, source_url, source_tier, import_key, created_at, updated_at)
      VALUES ('record-no-link', 'oscar', 63, 1991, 'Mejor Actor', 'Best Actor', 'nominee', 'person', '["Persona Desconocida"]',
              'Obra sin enlace', 1990, 'obra sin enlace [1990]', 'https://example.test', 'secondary', 'import-no-link', '2026-01-01', '2026-01-01');
    `);
    await syncRecipientRows(env, 10);
    const result = await resolvePeopleBatch(env, 10);
    expect(result.unresolved).toBe(1);
    expect(result.remaining).toBe(0);
  });
});
