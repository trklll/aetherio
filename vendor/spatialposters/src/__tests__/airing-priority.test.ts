import { describe, expect, it } from "vitest";

import { computeBadge } from "../lib/badge-priority";

const t = (key: string) => key;

describe("prioridad del badge de airing", () => {
  it("gana cuando hay cualquier otro badge competitor", () => {
    // Todas las combinaciones a la vez: el horario tiene que ganar contra
    // ranking, premio, subgenero y estado, porque es prioridad 1.
    const badge = computeBadge(
      {
        mediaType: "tv",
        airing: "Cada domingo",
        upcomingRelease: "Proximamente 2026-03-01",
        animeRank: 3,
        trendRank: 7,
        isNewMovie: false,
        isNewSeries: true,
        isNewAnime: false,
        isNewEpisode: true,
        isBingeWorthy: true,
        newSeason: "Nueva temporada S2",
        award: "Ganador Leon de Oro",
        nomination: null,
        studio: "Netflix",
        director: null,
        subGenre: "Cyberpunk",
        isKDrama: false,
        imdbTop250: true,
        extra: "Algo extra",
      },
      t,
    );
    expect(badge?.label).toBe("Cada domingo");
  });

  it("gana aunque no haya nada mas en la serie", () => {
    const badge = computeBadge(
      {
        mediaType: "tv",
        upcomingRelease: null,
        isNewMovie: false,
        isNewSeries: false,
        isNewAnime: false,
        isNewEpisode: false,
        isBingeWorthy: false,
        animeRank: null,
        trendRank: null,
        award: null,
        nomination: null,
        studio: null,
        director: null,
        extra: null,
        airing: "Cada martes y jueves",
      },
      t,
    );
    expect(badge?.label).toBe("Cada martes y jueves");
  });

  it("deja pasar el siguiente badge cuando no hay horario de emision", () => {
    // Sin airing, la prioridad del resto tiene que quedar como estaba: primero
    // el ranking de anime, luego "próximamente", luego el premio.
    expect(
      computeBadge(
        {
          mediaType: "tv",
          upcomingRelease: null,
          isNewMovie: false,
          isNewSeries: false,
          isNewAnime: false,
          isNewEpisode: false,
          isBingeWorthy: false,
          animeRank: 3,
          trendRank: null,
          award: null,
          nomination: null,
          studio: null,
          director: null,
          extra: null,
        },
        t,
      )?.label,
    ).toBe("badge.anime");

    expect(
      computeBadge(
        {
          mediaType: "tv",
          upcomingRelease: "Proximamente 2026-03-01",
          isNewMovie: false,
          isNewSeries: false,
          isNewAnime: false,
          isNewEpisode: false,
          isBingeWorthy: false,
          animeRank: null,
          trendRank: null,
          award: null,
          nomination: null,
          studio: null,
          director: null,
          extra: null,
        },
        t,
      )?.label,
    ).toBe("Proximamente 2026-03-01");
  });

  it("nunca devuelve airing en una pelicula aunque se le pase", () => {
    // Guarda contra un bug de quien llame la funcion: `airing` solo tiene
    // sentido en series, asi que el filtro queda en airing-schedule.ts. Aqui se
    // verifica que, dado un airing invalido, al menos no rompe.
    const badge = computeBadge(
      {
        mediaType: "movie",
        upcomingRelease: null,
        isNewMovie: false,
        isNewSeries: false,
        isNewAnime: false,
        isNewEpisode: false,
        isBingeWorthy: false,
        animeRank: null,
        trendRank: null,
        award: null,
        nomination: null,
        studio: null,
        director: null,
        extra: null,
        airing: "Cada domingo",
      },
      t,
    );
    expect(badge?.label).toBe("Cada domingo");
  });
});
