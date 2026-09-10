import { describe, expect, it } from "vitest";
import {
  buildPartyJoinDeepLink,
  buildPartyJoinPage,
  parseJoinPath,
  sanitizeJoinServer,
} from "./party-join";

describe("party join page", () => {
  it("acepta códigos de 6 en /join/", () => {
    expect(parseJoinPath("/join/ABC123")).toBe("ABC123");
    expect(parseJoinPath("/join/abc123/")).toBe("ABC123");
    expect(parseJoinPath("/join/corto")).toBeNull();
    expect(parseJoinPath("/join/ABC123/extra")).toBeNull();
    expect(parseJoinPath("/join/ABC-12")).toBeNull();
    expect(parseJoinPath("/otro/ABC123")).toBeNull();
  });

  it("solo acepta servidores https", () => {
    expect(sanitizeJoinServer("https://party.ejemplo.dev/")).toBe("https://party.ejemplo.dev");
    expect(sanitizeJoinServer("http://evil.example.com")).toBe("");
    expect(sanitizeJoinServer("javascript:alert(1)")).toBe("");
    expect(sanitizeJoinServer(null)).toBe("");
  });

  it("la página incluye el código y el deep link", () => {
    const html = buildPartyJoinPage("XRKHSS", "https://party.ejemplo.dev");
    expect(html).toContain("XRKHSS");
    expect(html).toContain("aetherio://party/join?code=XRKHSS");
    expect(html).toContain("server=https%3A%2F%2Fparty.ejemplo.dev");
    expect(buildPartyJoinDeepLink("ABC123", "")).toBe("aetherio://party/join?code=ABC123");
  });

  it("neutraliza inyecciones en el parámetro server", () => {
    const html = buildPartyJoinPage("ABC123", "https://x.example/\"><script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("\"><script>");
  });
});
