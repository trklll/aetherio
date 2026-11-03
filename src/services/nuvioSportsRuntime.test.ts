import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeCommand } from "../runtime/platform.ts";
import {
  buildNuvioSportsBaseUrl,
  DEFAULT_NUVIO_SPORTS_PROFILE,
  ensureLocalNuvioSportsServer,
  resolveNuvioSportsMode,
} from "./nuvioSportsRuntime.ts";

vi.mock("../runtime/platform.ts", () => ({
  invokeCommand: vi.fn(),
  isTauriRuntime: () => true,
}));

describe("Nuvio Sports runtime configuration", () => {
  it("defaults to the managed instance on desktop and remote on web", () => {
    expect(resolveNuvioSportsMode(null, true)).toBe("local");
    expect(resolveNuvioSportsMode(null, false)).toBe("remote");
  });

  it("honors only explicit local and remote mode values", () => {
    expect(resolveNuvioSportsMode("remote", true)).toBe("remote");
    expect(resolveNuvioSportsMode("local", false)).toBe("local");
    expect(resolveNuvioSportsMode("unknown", true)).toBe("local");
  });

  it("builds a config-segment URL with the Lima, football/MMA, Spanish preset", () => {
    const base = buildNuvioSportsBaseUrl("http://127.0.0.1:7310/");
    const parts = base.split("/");
    const encodedProfile = parts[parts.length - 1];

    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:7310\//);
    expect(JSON.parse(decodeURIComponent(encodedProfile ?? ""))).toEqual(DEFAULT_NUVIO_SPORTS_PROFILE);
    expect(DEFAULT_NUVIO_SPORTS_PROFILE).toEqual({
      timezone: "America/Lima",
      languages: "Spanish",
      sports: "football,mma",
    });
  });

  it("rejects cleartext non-loopback hosts", () => {
    expect(() => buildNuvioSportsBaseUrl("http://192.168.1.10:7310")).toThrow(/loopback/i);
    expect(() => buildNuvioSportsBaseUrl("ftp://127.0.0.1:7310")).toThrow(/http/i);
  });
});

describe("managed Nuvio startup", () => {
  const ready = { running: true, ready: true, pid: 42, port: 7310 };
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "local" } });
    vi.mocked(invokeCommand).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preserves native Tauri string errors instead of hiding the startup cause", async () => {
    vi.mocked(invokeCommand).mockRejectedValueOnce("No se encontró Node empaquetado.");
    await expect(ensureLocalNuvioSportsServer()).rejects.toMatchObject({ message: "No se encontró Node empaquetado." });
  });

  it("uses Sports in errors, including responses from an older native backend", async () => {
    vi.mocked(invokeCommand).mockRejectedValueOnce("Nuvio no respondió en 25 segundos. Detalles en service.log.");
    await expect(ensureLocalNuvioSportsServer()).rejects.toMatchObject({
      message: "Sports no respondió en 25 segundos. Detalles en service.log.",
    });
    vi.mocked(invokeCommand).mockResolvedValueOnce({ ...ready, ready: false });
    await expect(ensureLocalNuvioSportsServer()).rejects.toThrow("El servidor local de Sports no quedó listo.");
  });

  it("deduplicates simultaneous starts but rechecks readiness on the next refresh", async () => {
    vi.mocked(invokeCommand).mockResolvedValue(ready);
    await Promise.all([ensureLocalNuvioSportsServer(), ensureLocalNuvioSportsServer()]);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    await ensureLocalNuvioSportsServer();
    expect(invokeCommand).toHaveBeenCalledTimes(2);
  });
});
