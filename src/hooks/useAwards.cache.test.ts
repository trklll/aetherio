import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryOptions {
  queryFn: () => Promise<unknown>;
  staleTime: number | ((query: { state: { data?: unknown } }) => number);
  refetchOnMount?: boolean | ((query: { state: { data?: unknown } }) => boolean | "always");
  refetchOnWindowFocus?: boolean | ((query: { state: { data?: unknown } }) => boolean | "always");
}

const { options } = vi.hoisted(() => ({ options: [] as QueryOptions[] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (queryOptions: QueryOptions) => {
    options.push(queryOptions);
    return { data: undefined, error: null, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };
  },
}));

import { useAwardsByTmdbId, usePersonAwards } from "./useAwards";

function staleTime(query: QueryOptions, data: unknown): number {
  return typeof query.staleTime === "function" ? query.staleTime({ state: { data } }) : query.staleTime;
}

describe("caché de premiaciones en el cliente", () => {
  beforeEach(() => {
    options.length = 0;
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("mantiene frescas 15 minutos las fichas sin premios, no cero segundos", () => {
    useAwardsByTmdbId("movie", 1, true);
    expect(staleTime(options[0], { records: [], resolution: { status: "unresolved" } })).toBe(900_000);
  });

  it("mantiene frescos una hora los premios resueltos", () => {
    useAwardsByTmdbId("movie", 1, true);
    expect(staleTime(options[0], { records: [{}], resolution: { status: "resolved" } })).toBe(3_600_000);
  });

  it("no fuerza recargas por montaje o por recuperar el foco", () => {
    useAwardsByTmdbId("movie", 1, true);
    const query = options[0];
    const empty = { state: { data: { records: [], resolution: { status: "unresolved" } } } };
    const onMount = typeof query.refetchOnMount === "function" ? query.refetchOnMount(empty) : query.refetchOnMount;
    const onFocus = typeof query.refetchOnWindowFocus === "function" ? query.refetchOnWindowFocus(empty) : query.refetchOnWindowFocus;
    expect(onMount).not.toBe("always");
    expect(onFocus).toBe(false);
  });

  it("permite utilizar la caché HTTP en las fichas", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      records: [], resolution: { status: "unresolved" }, coverage: {}, relevantCoverage: {},
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    useAwardsByTmdbId("movie", 1, true);
    await options[0].queryFn();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.cache).not.toBe("no-cache");
    expect(init?.cache).not.toBe("no-store");
  });

  it("permite utilizar la caché HTTP de las personas", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      records: [], resolution: { status: "unresolved" },
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    usePersonAwards(500, "Persona");
    await options[0].queryFn();
    const init = fetch.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.cache).not.toBe("no-cache");
    expect(init?.cache).not.toBe("no-store");
  });
});
