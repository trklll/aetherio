import { describe, expect, it } from "vitest";
import { coverageSummary, emptyReason, handleAwardsRequest, pickFeatured } from "../api";
import { makeEnv } from "./helpers";
import type { AwardRecord, AwardSubject } from "../types";

let counter = 0;

function record(overrides: Partial<AwardRecord>): AwardRecord {
  counter += 1;
  return {
    id: `rec-${counter}`,
    ceremony: "oscar",
    edition: 96,
    awardYear: 2024,
    categoryEs: "Mejor Película",
    categoryOriginal: "Best Picture",
    status: "winner",
    subject: "work",
    recipients: [],
    workTitle: "Anora",
    sourceUrl: "https://example.test",
    sourceTier: "official",
    ...overrides,
  };
}

describe("pickFeatured", () => {
  it("devuelve null sin registros", () => {
    expect(pickFeatured([])).toBeNull();
  });

  it("ganadora antes que nominada y selección oficial", () => {
    const winner = record({ status: "winner" });
    const nominee = record({ status: "nominee" });
    const selection = record({ status: "official_selection", awardYear: 2025 });
    expect(pickFeatured([selection, nominee, winner])).toBe(winner);
  });

  it("obra antes que persona/song/técnica dentro del mismo estado", () => {
    const work = record({ subject: "work" });
    const person = record({ subject: "person" as AwardSubject });
    const technical = record({ subject: "technical" as AwardSubject });
    expect(pickFeatured([technical, person, work])).toBe(work);
  });

  it("edición más reciente antes que antigua", () => {
    const old = record({ awardYear: 2000, edition: 72 });
    const recent = record({ awardYear: 2024, edition: 96 });
    expect(pickFeatured([old, recent])).toBe(recent);
  });

  it("sigue el orden de ceremonia estable cuando todo lo demás empata", () => {
    const cannes = record({ ceremony: "cannes", workTitle: "Anora en Cannes" });
    const oscar = record({ workTitle: "Anora en Oscar" });
    expect(pickFeatured([cannes, oscar])).toBe(oscar);
  });

  it("prefiere ganadora de ceremonia superior aunque la nominación sea más reciente", () => {
    const oldWinner = record({ status: "winner", awardYear: 2023 });
    const newNominee = record({ status: "nominee", awardYear: 2025 });
    expect(pickFeatured([newNominee, oldWinner])).toBe(oldWinner);
  });
});

describe("coverageSummary", () => {
  it("agrupa ediciones por ceremonia según cobertura y estado", () => {
    const rows = [
      { ceremony: "oscar" as const, edition: 96, award_year: 2024, coverage: "complete" as const, status: "ok" as const, updated_at: "2026-03-01T00:00:00Z" },
      { ceremony: "oscar" as const, edition: 95, award_year: 2024, coverage: "partial" as const, status: "ok" as const, updated_at: "2026-03-02T00:00:00Z" },
      { ceremony: "oscar" as const, edition: 94, award_year: 2024, coverage: "complete" as const, status: "stale" as const, updated_at: "2026-03-03T00:00:00Z" },
      { ceremony: "cannes" as const, edition: 73, award_year: 2024, coverage: "complete" as const, status: "ok" as const, updated_at: "2026-03-04T00:00:00Z" },
    ];
    const summary = coverageSummary(rows);
    expect(summary.oscar.completeEditions).toEqual([96]);
    expect(summary.oscar.partialEditions).toEqual([95]);
    expect(summary.oscar.staleEditions).toEqual([94]);
    expect(summary.oscar.failedEditions).toEqual([]);
    expect(summary.oscar.lastSyncAt).toBe("2026-03-03T00:00:00Z");
    expect(summary.cannes.completeEditions).toEqual([73]);
  });

  it("reporta ediciones fallidas", () => {
    const rows = [
      { ceremony: "goya" as const, edition: 40, award_year: 2025, coverage: "complete" as const, status: "parser_failed" as const, updated_at: "2026-02-01T00:00:00Z" },
    ];
    const summary = coverageSummary(rows);
    expect(summary.goya.failedEditions).toEqual([40]);
  });
});

describe("emptyReason", () => {
  const edition = (overrides: Partial<Parameters<typeof emptyReason>[0]["editionRows"][number]> = {}) => ({
    ceremony: "oscar" as const,
    edition: 96,
    award_year: 2024,
    coverage: "complete" as const,
    status: "ok" as const,
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  });

  const manifest = (overrides: Partial<Parameters<typeof emptyReason>[0]["manifestRows"][number]> = {}) => ({
    ceremony: "oscar" as const,
    edition: 96,
    award_year: 2024,
    coverage_expected: "complete" as const,
    gap_type: null,
    primary_url: "https://example.test",
    extra_sources_json: "[]",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  });

  const base = {
    workKeys: ["anora"],
    resolutionStatus: "resolved",
    recordsCount: 0,
    workYear: 2024,
    editionRows: [],
    manifestRows: [],
  };

  it("devuelve null cuando hay registros", () => {
    expect(emptyReason({ ...base, recordsCount: 3 })).toBeNull();
  });

  it("identifica identidad no resuelta", () => {
    expect(emptyReason({ ...base, workKeys: [], resolutionStatus: "unresolved" })).toBe("identity_unresolved");
  });

  it("identifica identidad ambigua", () => {
    expect(emptyReason({ ...base, resolutionStatus: "ambiguous" })).toBe("identity_ambiguous");
  });

  it("diferencia ediciones pendientes de importar (solo dentro de los años de la obra)", () => {
    const reason = emptyReason({
      ...base,
      editionRows: [edition({ edition: 70, award_year: 1998 })],
      manifestRows: [manifest({ edition: 70, award_year: 1998 }), manifest()],
    });
    expect(reason).toBe("edition_not_imported");
  });

  it("reporta sincronización fallida cuando falló otra edición de la misma ceremonia", () => {
    const reason = emptyReason({
      ...base,
      editionRows: [edition(), edition({ edition: 70, award_year: 1998, status: "parser_failed" })],
      manifestRows: [manifest(), manifest({ edition: 70, award_year: 1998 })],
    });
    expect(reason).toBe("sync_failed");
  });

  it("confirma ausencia real cuando todo lo relevante está importado", () => {
    expect(emptyReason({ ...base, editionRows: [edition()], manifestRows: [manifest()] })).toBe("no_matching_records");
  });

  it("los huecos declarados no cuentan como pendientes", () => {
    const reason = emptyReason({
      ...base,
      manifestRows: [manifest({ coverage_expected: "gap" as const, gap_type: "canceled" as const })],
    });
    expect(reason).toBe("no_matching_records");
  });
});

describe("endpoints internos", () => {
  it("sincroniza el manifest solo con token y devuelve el total", async () => {
    const env = { ...makeEnv(), AWARDS_IMPORT_TOKEN: "secret" };
    const unauthorized = await handleAwardsRequest(
      new Request("https://test/api/internal/awards/manifest/sync", { method: "POST" }),
      env,
      new URL("https://test/api/internal/awards/manifest/sync"),
    );
    expect(unauthorized?.status).toBe(401);
    const response = await handleAwardsRequest(
      new Request("https://test/api/internal/awards/manifest/sync", { method: "POST", headers: { Authorization: "Bearer secret" } }),
      env,
      new URL("https://test/api/internal/awards/manifest/sync"),
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ ok: true, synced: expect.any(Number) });
  });
});
