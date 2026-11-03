import { describe, expect, it } from "vitest";
import { storageFailure, storageSuccess, type StorageResult } from "./storageResult";

describe("StorageResult", () => {
  it("returns a revision only for persisted success", () => {
    const result: StorageResult = storageSuccess(7);
    expect(result).toEqual({ ok: true, revision: 7 });
  });

  it("uses stable failure codes without leaking exception text", () => {
    const result = storageFailure("storage-unavailable", new Error("private raw message"));
    expect(result).toEqual({ ok: false, code: "storage-unavailable" });
    expect(JSON.stringify(result)).not.toContain("private raw message");
  });
});
