import { beforeEach, describe, expect, it, vi } from "vitest";

const tmdbFetch = vi.fn();
vi.mock("../config/apiKeys.ts", () => ({ tmdbFetch: (path: string, init?: any) => tmdbFetch(path, init) }));

import { fetchTmdbArtwork, resetTmdbArtworkCache } from "./tmdbArtworkService";

function tvPayload(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Serie ${id}`,
    overview: "Una serie.",
    first_air_date: "2024-01-01",
    original_language: "ja",
    genres: [{ id: 16, name: "Animación" }],
    poster_path: `/p${id}.jpg`,
    backdrop_path: `/b${id}.jpg`,
    images: { logos: [{ iso_639_1: "es", file_path: `/logo${id}.png` }], backdrops: [] },
    ...over,
  };
}

function moviePayload(id: number) {
  return {
    id,
    title: `Pelicula ${id}`,
    overview: "Una pelicula.",
    release_date: "1999-05-05",
    original_language: "en",
    genres: [{ id: 28, name: "Accion" }],
    poster_path: `/pm${id}.jpg`,
    backdrop_path: `/bm${id}.jpg`,
    images: { logos: [{ iso_639_1: "en", file_path: `/logom${id}.png` }], backdrops: [] },
  };
}

function paths() {
  return tmdbFetch.mock.calls.map(call => String(call[0]));
}

beforeEach(() => {
  tmdbFetch.mockReset();
  resetTmdbArtworkCache();
});

describe("fetchTmdbArtwork", () => {
  it("pide detalle e imagenes en una sola llamada", async () => {
    tmdbFetch.mockResolvedValue(tvPayload(1));

    const artwork = await fetchTmdbArtwork("tv", 1);

    expect(paths()).toEqual(["/tv/1"]);
    const params = tmdbFetch.mock.calls[0][1].params;
    expect(params.append_to_response).toBe("images");
    expect(params.include_image_language).toBe("es,en,null");
    expect(artwork?.logo).toBe("https://image.tmdb.org/t/p/original/logo1.png");
    expect(artwork?.posterPath).toBe("/p1.jpg");
    expect(artwork?.year).toBe("2024");
  });

  it("no repite la peticion cuando varias pantallas piden el mismo id", async () => {
    tmdbFetch.mockResolvedValue(tvPayload(7));

    const [home, detail] = await Promise.all([
      fetchTmdbArtwork("tv", 7),
      fetchTmdbArtwork("tv", 7),
    ]);
    const third = await fetchTmdbArtwork("tv", 7);

    expect(paths()).toEqual(["/tv/7"]);
    expect(home).toBe(detail);
    expect(third).toBe(home);
  });

  it("prueba movie una sola vez cuando tv no existe, y lo recuerda en ambos namespaces", async () => {
    tmdbFetch.mockImplementation(async (path: string) =>
      path === "/movie/42" ? moviePayload(42) : null,
    );

    const first = await fetchTmdbArtwork("tv", 42);
    const second = await fetchTmdbArtwork("tv", 42);
    const asMovie = await fetchTmdbArtwork("movie", 42);

    expect(paths()).toEqual(["/tv/42", "/movie/42"]);
    expect(first?.type).toBe("movie");
    expect(first?.title).toBe("Pelicula 42");
    expect(second).toBe(first);
    // Resuelto bajo el namespace bueno: la pantalla que ya sabia que era
    // pelicula no vuelve a salir a la red.
    expect(asMovie).toBe(first);
  });

  it("un id que no existe en movie ni en tv no se vuelve a preguntar", async () => {
    tmdbFetch.mockResolvedValue(null);

    expect(await fetchTmdbArtwork("tv", 99)).toBeNull();
    expect(await fetchTmdbArtwork("tv", 99)).toBeNull();

    expect(paths()).toEqual(["/tv/99", "/movie/99"]);
  });

  it("marca una entrada de anime como tal para no buscar su id como pelicula", async () => {
    tmdbFetch.mockResolvedValue(tvPayload(5));

    const artwork = await fetchTmdbArtwork("tv", 5);

    expect(artwork?.isAnimation).toBe(true);
  });

  it("un id invalido no sale a la red", async () => {
    expect(await fetchTmdbArtwork("tv", 0)).toBeNull();
    expect(await fetchTmdbArtwork("movie", Number.NaN)).toBeNull();
    expect(tmdbFetch).not.toHaveBeenCalled();
  });
});
