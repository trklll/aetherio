import { describe, expect, it } from "vitest";
import {
  buildPartyInviteLink,
  buildPartyJoinDeepLink,
  buildPlayerPathForMedia,
  normalizeInviteCode,
  parsePartyJoinDeepLink,
  sanitizePartyServerUrl,
} from "./invite";

describe("party invite links", () => {
  it("construye el link web con código válido", () => {
    expect(buildPartyInviteLink("abc123")).toBe("https://trkll.aetherio.workers.dev/join/ABC123");
    expect(buildPartyInviteLink("ABC123", "https://party.ejemplo.dev/")).toBe(
      "https://trkll.aetherio.workers.dev/join/ABC123?server=https%3A%2F%2Fparty.ejemplo.dev",
    );
    expect(buildPartyInviteLink("corto")).toBeNull();
    expect(buildPartyInviteLink("ABC123", "nota-url")).toBe("https://trkll.aetherio.workers.dev/join/ABC123");
  });

  it("construye y re-parsea el deep link (ida y vuelta)", () => {
    const deep = buildPartyJoinDeepLink("xrkhss", "https://party.ejemplo.dev");
    expect(deep).toBe("aetherio://party/join?code=XRKHSS&server=https%3A%2F%2Fparty.ejemplo.dev");
    expect(parsePartyJoinDeepLink(deep!)).toEqual({ code: "XRKHSS", server: "https://party.ejemplo.dev" });
    expect(parsePartyJoinDeepLink(buildPartyJoinDeepLink("ABC123")!)).toEqual({ code: "ABC123", server: "" });
  });

  it("rechaza deep links ajenos o malformados", () => {
    expect(parsePartyJoinDeepLink("aetherio://open/detail/movie/x")).toBeNull();
    expect(parsePartyJoinDeepLink("aetherio://party/join")).toBeNull();
    expect(parsePartyJoinDeepLink("aetherio://party/join?code=CORTO")).toBeNull();
    expect(parsePartyJoinDeepLink("https://otra.web/join/ABC123")).toBeNull();
    expect(parsePartyJoinDeepLink("no-es-url")).toBeNull();
  });

  it("sanea el servidor: solo https (más localhost para desarrollo)", () => {
    expect(sanitizePartyServerUrl("https://party.ejemplo.dev/")).toBe("https://party.ejemplo.dev");
    expect(sanitizePartyServerUrl("http://evil.example.com")).toBe("");
    expect(sanitizePartyServerUrl("javascript:alert(1)")).toBe("");
    expect(sanitizePartyServerUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(sanitizePartyServerUrl("")).toBe("");
  });

  it("normaliza el código a mayúsculas alfanuméricas", () => {
    expect(normalizeInviteCode("ab c-123")).toBe("ABC123");
    expect(normalizeInviteCode("!!")).toBe("");
  });

  it("construye la ruta del player para el contenido de la sala", () => {
    expect(buildPlayerPathForMedia({ type: "movie", id: "tt123" })).toBe("/player?type=movie&id=tt123");
    expect(buildPlayerPathForMedia({ type: "series", id: "tt1", season: 1, episode: 2 })).toBe(
      "/player?type=series&id=tt1&season=1&ep=2",
    );
    expect(buildPlayerPathForMedia(null)).toBeNull();
  });
});
