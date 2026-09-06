import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function loadJikan() {
  return import("./jikan");
}

async function loadAnilist() {
  return import("./anilist");
}

describe("probeJikan", () => {
  it("true cuando la API responde y cachea el resultado", async () => {
    const seenUrls: unknown[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      seenUrls.push(url);
      return { ok: true, status: 200 } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { probeJikan } = await loadJikan();
    await expect(probeJikan()).resolves.toBe(true);
    await expect(probeJikan()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(seenUrls[0] ?? "")).toContain("/top/anime");
  });

  it("false cuando la API falla y no lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const { probeJikan } = await loadJikan();
    await expect(probeJikan()).resolves.toBe(false);
  });

  it("reabre el cortacircuitos al recuperarse tras el TTL", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (fail) throw new Error("down");
      return { ok: true, status: 200 } as Response;
    }));
    const mod = await loadJikan();
    await expect(mod.probeJikan()).resolves.toBe(false);
    fail = false;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(mod.probeJikan()).resolves.toBe(true);
    vi.useRealTimers();
  });
});

describe("probeAnilist", () => {
  it("true cuando GraphQL responde ok y cachea", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { probeAnilist } = await loadAnilist();
    await expect(probeAnilist()).resolves.toBe(true);
    await expect(probeAnilist()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("false con 403 (API suspendida) sin lanzar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 }) as Response));
    const { probeAnilist } = await loadAnilist();
    await expect(probeAnilist()).resolves.toBe(false);
  });
});
