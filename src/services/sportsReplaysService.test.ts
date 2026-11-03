import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStreams, probeLiveSource } from "../types/stremioSports.ts";
import { ensureLocalNuvioSportsServer, readNuvioSportsMode } from "./nuvioSportsRuntime.ts";
import { fetchSportsReplayPlanPage, fetchSportsReplaysPage, primeSportsReplayPlayback, resolveSportsReplayStreams } from "./sportsReplaysService.ts";
import { SPORTS_REPLAY_SOURCE_STRIDE } from "./sportsReplayCollections.ts";
import type { SportsPreferences } from "../data/sports/types.ts";

vi.mock("./nuvioSportsRuntime.ts", async importOriginal => ({ ...await importOriginal<typeof import("./nuvioSportsRuntime.ts")>(), ensureLocalNuvioSportsServer: vi.fn(async () => {}), readNuvioSportsMode: vi.fn(() => "local") }));
vi.mock("../types/stremioSports.ts", async importOriginal => ({ ...await importOriginal<typeof import("../types/stremioSports.ts")>(), fetchStreams: vi.fn(), probeLiveSource: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); vi.mocked(readNuvioSportsMode).mockReturnValue("local"); });

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  return values;
}

describe("plugin replay catalog", () => {
  it("resolves each replay before showing it and bounds concurrent stream requests", async () => {
    storage();
    const metas = Array.from({ length: 100 }, (_, index) => ({ id: `nuvio_sport_rz_${index}`, type: "tv", name: `NBA Replay ${index}`, genres: ["BASKETBALL"], released: "2026-10-28T18:00:00Z" }));
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ metas })));
    vi.stubGlobal("fetch", request);
    let active = 0;
    let maxActive = 0;
    vi.mocked(fetchStreams).mockImplementation(async (_base, _type, id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active -= 1;
      return id.endsWith("0") ? [{ name: "Replay HD", url: `https://sports.test/${id}.mp4` }] : [];
    });
    const page = await fetchSportsReplaysPage(200);
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.nextSkip).toBe(300);
    expect(page.items[0]).toMatchObject({
      type: "sports-replay", name: "NBA Replay 0", requestId: "nuvio_sport_rz_0",
      streams: [{ url: "https://sports.test/nuvio_sport_rz_0.mp4" }],
    });
    expect(fetchStreams).toHaveBeenCalledTimes(100);
    expect(ensureLocalNuvioSportsServer).toHaveBeenCalledTimes(1);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(6);
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.pathname).toContain("/catalog/tv/nuvio_sports_catalog/");
    expect(url.pathname).toContain("genre=Replays");
    expect(url.pathname).toContain("skip=200");
    expect(url.pathname).toMatch(/\/catalog\/tv\/nuvio_sports_catalog\/genre=Replays&skip=200\.json$/);
    expect(JSON.parse(decodeURIComponent(url.pathname.split("/")[1]))).toMatchObject({ sports: "all", replayFilter: "all" });
  });

  it("omits replays with empty or failed source resolution without breaking page pagination", async () => {
    storage();
    const metas = [
      { id: "available", name: "Repetición disponible" },
      { id: "empty", name: "Sin fuentes" },
      { id: "failed", name: "Resolución fallida" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ metas }))));
    vi.mocked(fetchStreams).mockImplementation(async (_base, _type, id) => {
      if (id === "failed") throw new Error("provider unavailable");
      return id === "available" ? [{ url: "https://sports.test/available.mp4" }] : [];
    });

    const page = await fetchSportsReplaysPage(40);

    expect(page.items.map(item => item.requestId)).toEqual(["available"]);
    expect(page.items[0].streams).toHaveLength(1);
    expect(page.nextSkip).toBe(43);
    expect(page.hasMore).toBe(false);
  });

  it("reports a failed page as an error rather than ending pagination", async () => {
    storage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("offline", { status: 503 })));
    await expect(fetchSportsReplaysPage(100)).rejects.toThrow(/repeticiones/i);
  });

  it("filtra por los deportes elegidos y lo seguido antes de resolver fuentes", async () => {
    storage();
    const preferences = JSON.stringify({ version: 1, onboarding: "completed", sports: ["futbol"], followedCompetitions: ["comp:esp-laliga"], followedClubs: [], followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos" });
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "aetherio-sports-preferences" ? preferences : null, setItem: () => {} });
    const metas = [
      { id: "laliga", name: "LaLiga Repetición 1", genres: ["FOOTBALL"] },
      { id: "premier", name: "Premier League Repetición 1", genres: ["FOOTBALL"] },
      { id: "ufc", name: "UFC Repetición 1", genres: ["MMA"] },
      { id: "nfl", name: "Oakland Regression", genres: ["AMERICAN_FOOTBALL"] },
      { id: "sin-clasificar", name: "Repetición sin deporte" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ metas }))));
    vi.mocked(fetchStreams).mockResolvedValue([{ name: "HD", url: "https://sports.test/hd.mp4" }]);

    const page = await fetchSportsReplaysPage(0);

    // Solo la repetición seguida (LaLiga) entra: fútbol de ligas que no se
    // siguen, MMA, otro deporte o repeticiones sin deporte declarado quedan fuera.
    expect(page.items.map(item => item.requestId)).toEqual(["laliga"]);
    expect(fetchStreams).toHaveBeenCalledTimes(1);
  });

  it("keeps short and empty terminal pages distinct from a still syncing local archive", async () => {
    storage();
    vi.mocked(fetchStreams).mockResolvedValue([{ url: "https://sports.test/last.mp4" }]);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ metas: [{ id: "last", name: "F1 Replay", genres: ["MOTORSPORT"] }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ metas: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sync: { state: "running" } }))));
    expect(await fetchSportsReplaysPage(100)).toMatchObject({ hasMore: false, nextSkip: 101 });
    expect(await fetchSportsReplaysPage(0)).toMatchObject({ hasMore: false, pending: true, items: [] });
  });

  it("preserves the selected remote instance but removes football/MMA and mainstream replay filters", async () => {
    vi.mocked(readNuvioSportsMode).mockReturnValue("remote");
    const config = encodeURIComponent(JSON.stringify({ sports: "football,mma", replayFilter: "mainstream", timezone: "America/Lima" }));
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ nuvio: `https://custom.test/${config}` }) });
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ metas: [] })));
    vi.stubGlobal("fetch", request);
    expect(await fetchSportsReplaysPage(0)).toMatchObject({ hasMore: false, pending: false });
    const url = new URL(request.mock.calls[0][0]);
    expect(url.origin).toBe("https://custom.test");
    expect(JSON.parse(decodeURIComponent(url.pathname.split("/")[1]))).toMatchObject({ sports: "all", replayFilter: "all", timezone: "America/Lima" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not turn malformed catalog responses into a permanently empty row", async () => {
    storage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unavailable" }))));
    await expect(fetchSportsReplaysPage()).rejects.toThrow(/repeticiones/i);
  });

  it("allows an empty filtered page to continue to the next catalog page", async () => {
    storage();
    const metas = Array.from({ length: 100 }, (_, index) => ({ id: `empty-${index}`, name: `No sources ${index}` }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ metas }))));
    vi.mocked(fetchStreams).mockResolvedValue([]);

    const page = await fetchSportsReplaysPage(100);

    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(true);
    expect(page.nextSkip).toBe(200);
  });

  it("can show a replay after refreshing when its sources become available", async () => {
    storage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ metas: [{ id: "retry-source", name: "Repetición" }] }))));
    vi.mocked(fetchStreams)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ url: "https://sports.test/retry.mp4" }]);

    const firstAttempt = await fetchSportsReplaysPage();
    const retry = await fetchSportsReplaysPage();

    expect(firstAttempt.items).toEqual([]);
    expect(retry.items).toHaveLength(1);
    expect(retry.items[0].requestId).toBe("retry-source");
  });

  it("keeps VOD sources and headers but never marks a replay as live", async () => {
    const values = storage();
    vi.mocked(fetchStreams).mockResolvedValueOnce([{ name: "HD", url: "https://sports.test/replay.mp4", behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: "https://sports.test/" } } } }]);
    const replay = { id: "replay:nuvio_sport_rz_1", requestId: "nuvio_sport_rz_1", type: "sports-replay", name: "Final del torneo" };
    const streams = await resolveSportsReplayStreams(replay);
    expect(streams[0].behaviorHints).toMatchObject({ live: false, sportsReplay: true, headers: { Referer: "https://sports.test/" } });
    expect(streams[0].behaviorHints?.notWebReady).toBeUndefined();
    expect(fetchStreams).toHaveBeenCalledWith(expect.any(String), "tv", replay.requestId);
    expect(probeLiveSource).not.toHaveBeenCalled();
    primeSportsReplayPlayback(replay, streams);
    expect(JSON.parse(values.get("aetherio-selected-stream")!)).toMatchObject({ url: "https://sports.test/replay.mp4", behaviorHints: { live: false } });
  });

  it("does not open a stale player session when the replay has no usable sources", async () => {
    storage();
    vi.mocked(fetchStreams).mockResolvedValueOnce([{ url: "https://google.com/" }, { externalUrl: "https://example.test/embed" }]);
    await expect(resolveSportsReplayStreams({ id: "replay:missing", requestId: "missing", type: "sports-replay", name: "Repetición" })).rejects.toThrow(/fuentes/i);
  });
});

describe("plan curado de repeticiones", () => {
  function catalogRouter(handler: (catalog: string, skip: number) => unknown) {
    return vi.fn(async (input: string | Request) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname.includes("provider-health")) return new Response(JSON.stringify({ sync: { state: "idle" } }));
      const match = /\/catalog\/tv\/(.+)&skip=(\d+)\.json$/.exec(url.pathname);
      if (!match) return new Response("route not found", { status: 404 });
      return new Response(JSON.stringify(handler(decodeURIComponent(match[1]), Number(match[2]))));
    });
  }

  function personalizedPrefs(patch: Partial<SportsPreferences> = {}) {
    const preferences = JSON.stringify({
      version: 1, onboarding: "completed", sports: [], followedCompetitions: [], followedClubs: [], followedNationalTeams: [],
      followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos", ...patch,
    });
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "aetherio-sports-preferences" ? preferences : null, setItem: () => {} });
  }

  it("salta los buckets vacíos de fútbol y cierra el plan sin botones vacíos", async () => {
    storage();
    personalizedPrefs({ sports: ["futbol"] });
    const requests: string[] = [];
    vi.stubGlobal("fetch", catalogRouter((catalog, skip) => {
      requests.push(`${catalog}&skip=${skip}`);
      return { metas: [] };
    }));

    const page = await fetchSportsReplayPlanPage(0);

    expect(requests).toEqual([
      "nuvio_sports_replays_football_today&skip=0",
      "nuvio_sports_replays_football_yesterday&skip=0",
      "nuvio_sports_replays_football_this_week&skip=0",
      "nuvio_sports_replays_football_older&skip=0",
    ]);
    expect(page.items).toEqual([]);
    expect(page.nextPage).toBeNull();
    expect(page.pending).toBe(false);
  });

  it("entrega el catálogo de una competición seguida sin filtrar por título", async () => {
    storage();
    personalizedPrefs({ sports: ["futbol"], followedCompetitions: ["comp:eng-premier", "comp:esp-laliga"] });
    vi.stubGlobal("fetch", catalogRouter((catalog) => {
      if (catalog === "nuvio_sports_replays_football_today") {
        return { metas: [{ id: "t0", type: "tv", name: "LaLiga Repetición 1", genres: ["FOOTBALL"] }] };
      }
      if (catalog === "nuvio_sports_replays_football_premier_league") {
        return { metas: [
          { id: "arsenal-chelsea", type: "tv", name: "Arsenal vs Chelsea Full Match" },
          { id: "liverpool-city", type: "tv", name: "Liverpool vs Manchester City Full Match" },
        ] };
      }
      return { metas: [] };
    }));
    vi.mocked(fetchStreams).mockResolvedValue([{ name: "HD", url: "https://sports.test/hd.mp4" }]);

    const first = await fetchSportsReplayPlanPage(0);
    // El bucket de hoy entregó una sola meta: la página siguiente es "ayer",
    // codificada como la segunda fuente del plan.
    expect(first.items.map(item => item.requestId)).toEqual(["t0"]);
    expect(first.nextPage).toBe(SPORTS_REPLAY_SOURCE_STRIDE);

    const second = await fetchSportsReplayPlanPage(SPORTS_REPLAY_SOURCE_STRIDE);
    // "Ayer" y "esta semana" están vacíos: la misma lectura aterriza en el
    // catálogo curado de la Premier, cuyos títulos no casan con lo seguido y
    // entran igual porque se pidió por ser la competición seguida.
    expect(second.items.map(item => item.requestId)).toEqual(["arsenal-chelsea", "liverpool-city"]);
    expect(second.nextPage).toBe(4 * SPORTS_REPLAY_SOURCE_STRIDE);

    const third = await fetchSportsReplayPlanPage(second.nextPage!);
    expect(third.items).toEqual([]);
    expect(third.nextPage).toBeNull();
    expect(fetchStreams).toHaveBeenCalledTimes(3);
  });

  it("rescata repeticiones tituladas por los equipos de una competición seguida", async () => {
    storage();
    personalizedPrefs({ sports: ["futbol"], followedCompetitions: ["comp:esp-laliga"] });
    vi.stubGlobal("fetch", catalogRouter(() => ({
      metas: [
        { id: "real-sevilla", type: "tv", name: "Real Madrid vs Sevilla Full Match" },
        { id: "arsenal-chelsea", type: "tv", name: "Arsenal vs Chelsea Full Match" },
      ],
    })));
    vi.mocked(fetchStreams).mockResolvedValue([{ name: "HD", url: "https://sports.test/hd.mp4" }]);

    const page = await fetchSportsReplayPlanPage(0);

    // El título no menciona LaLiga, pero los participantes la delatan; los del
    // Arsenal y el Chelsea no pertenecen a la competición seguida.
    expect(page.items.map(item => item.requestId)).toEqual(["real-sevilla"]);
  });

  it("la cola genérica entra cuando MMA está entre lo elegido", async () => {
    storage();
    personalizedPrefs({ sports: ["futbol", "mma"] });
    const requests: string[] = [];
    vi.stubGlobal("fetch", catalogRouter((catalog, skip) => {
      requests.push(`${catalog}&skip=${skip}`);
      if (catalog.includes("replays_football")) return { metas: [] };
      return { metas: [{ id: "ufc-300", type: "tv", name: "UFC 300 Repetición", genres: ["MMA"] }] };
    }));
    vi.mocked(fetchStreams).mockResolvedValue([{ name: "HD", url: "https://sports.test/hd.mp4" }]);

    const page = await fetchSportsReplayPlanPage(0);

    expect(requests).toEqual([
      "nuvio_sports_replays_football_today&skip=0",
      "nuvio_sports_replays_football_yesterday&skip=0",
      "nuvio_sports_replays_football_this_week&skip=0",
      "nuvio_sports_replays_football_older&skip=0",
      "nuvio_sports_catalog/genre=Replays&skip=0",
    ]);
    expect(page.items.map(item => item.requestId)).toEqual(["ufc-300"]);
    expect(page.nextPage).toBeNull();
  });

  it("una dirección de página más allá del plan cierra la paginación sin pedir nada", async () => {
    storage();
    personalizedPrefs({ sports: ["futbol"] });
    const request = catalogRouter(() => ({ metas: [] }));
    vi.stubGlobal("fetch", request);

    const page = await fetchSportsReplayPlanPage(9_999_000_000);

    expect(request).not.toHaveBeenCalled();
    expect(page).toEqual({ items: [], nextPage: null, pending: false });
  });
});
