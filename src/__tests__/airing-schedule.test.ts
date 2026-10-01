import { describe, expect, it } from "vitest";

import { getAiringScheduleLabel } from "../lib/airing-schedule";

const DAY = 24 * 60 * 60 * 1000;

/** Fecha ISO de hace/adelante `n` dias respecto de hoy. */
function iso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

/**
 * Fecha ISO del proximo `dow` (0=domingo) que cae a `week` semanas de aqui.
 *
 * Los tests usan fechas relativas y no fijas a proposito: la logica descarta
 * cualquier proximo capitulo que no este en la ventana de 3 semanas, asi que
 * una fecha fija de 2026 solo pasaria hasta 2026.
 */
function nextDow(dow: number, weeksAhead = 1): string {
  const current = new Date().getUTCDay()
  const delta = (dow - current + 7) % 7 || 7
  return iso(delta + 7 * (weeksAhead - 1))
}

/**
 * `count` episodios que caen cada semana en el dia `dow`, terminando en
 * `lastWeekAgo` semanas atras. Devuelve tambien el ultimo emitido.
 */
function weeklyEpisodes(dow: number, count: number) {
  const dates: { air_date: string }[] = []
  for (let week = count - 1; week >= 1; week--) {
    dates.push({ air_date: nextDow(dow, week) })
  }
  return dates
}

describe("getAiringScheduleLabel", () => {
  it("no dice nada en peliculas", () => {
    expect(
      getAiringScheduleLabel({
        mediaType: "movie",
        nextEpisode: { air_date: nextDow(1) },
        tvStatus: "Returning Series",
        lang: "es",
      }),
    ).toBeNull()
  })

  it("no dice nada si la serie ya termino", () => {
    expect(
      getAiringScheduleLabel({
        mediaType: "tv",
        inProduction: false,
        tvStatus: "Ended",
        lastAirDate: iso(-400),
        nextEpisode: { air_date: nextDow(1) },
        lang: "es",
      }),
    ).toBeNull()
  })

  it("no dice nada si el proximo capitulo esta muy lejos", () => {
    // in_production sigue en true meses despues, asi que sin la ventana de
    // fechas apareceria el badge en series canceladas o en pausa larga.
    expect(
      getAiringScheduleLabel({
        mediaType: "tv",
        inProduction: true,
        lastAirDate: iso(-400),
        nextEpisode: { air_date: iso(120) },
        lang: "es",
      }),
    ).toBeNull()
  })

  it("detecta una serie semanal y dice el dia", () => {
    const label = getAiringScheduleLabel({
      mediaType: "tv",
      inProduction: true,
      tvStatus: "Returning Series",
      lastAirDate: iso(-7),
      nextEpisode: { air_date: nextDow(1) },
      seasonEpisodes: weeklyEpisodes(1, 5),
      lang: "es",
    })
    expect(label).toBe("Cada lunes")
  })

  it("une dos dias con 'y', en orden de lunes a domingo", () => {
    // Martes (2) y jueves (4): sale "martes y jueves", no al reves.
    const seasonEpisodes = [...weeklyEpisodes(2, 5), ...weeklyEpisodes(4, 5)]
    const label = getAiringScheduleLabel({
      mediaType: "tv",
      inProduction: true,
      tvStatus: "Returning Series",
      lastAirDate: iso(-3),
      nextEpisode: { air_date: nextDow(2) },
      seasonEpisodes,
      lang: "es",
    })
    expect(label).toBe("Cada martes y jueves")
  })

  it("no dice nada en una serie daily, porque no es un dia de la semana", () => {
    // Un daily emite los 7 dias, asi que los 7 cuentan como recurrentes (>=2
    // apariciones cada uno al cabo de 3 semanas). Con mas de 2 dias el badge se
    // calla: "Cada domingo y lunes y martes..." no describe nada util.
    const seasonEpisodes = [0, 1, 2, 3, 4, 5, 6].flatMap((dow) => weeklyEpisodes(dow, 3))
    expect(
      getAiringScheduleLabel({
        mediaType: "tv",
        inProduction: true,
        tvStatus: "Returning Series",
        lastAirDate: iso(-1),
        nextEpisode: { air_date: nextDow(2) },
        seasonEpisodes,
        lang: "es",
      }),
    ).toBeNull()
  })

  it("traduce el dia segun el lang de la request", () => {
    const base = {
      mediaType: "tv" as const,
      inProduction: true,
      tvStatus: "Returning Series",
      lastAirDate: iso(-7),
      nextEpisode: { air_date: nextDow(1) },
      seasonEpisodes: weeklyEpisodes(1, 5),
    }
    expect(getAiringScheduleLabel({ ...base, lang: "es" })).toBe("Cada lunes")
    expect(getAiringScheduleLabel({ ...base, lang: "it" })).toBe("Cada lunedì")
    expect(getAiringScheduleLabel({ ...base, lang: "en" })).toBe("Cada Monday")
    expect(getAiringScheduleLabel({ ...base, lang: "de" })).toBe("Cada Montag")
  })

  it("usa español cuando el idioma no se reconoce", () => {
    expect(
      getAiringScheduleLabel({
        mediaType: "tv",
        inProduction: true,
        tvStatus: "Returning Series",
        lastAirDate: iso(-7),
        nextEpisode: { air_date: nextDow(1) },
        seasonEpisodes: weeklyEpisodes(1, 5),
        lang: "xx",
      }),
    ).toBe("Cada lunes")
  })

  it("acepta el status traducido de TMDB en vez del ingles", () => {
    // Con lang=es, TMDB devuelve "En emisión" y no "Returning Series". Si solo
    // se aceptara el ingles, el badge no apareceria nunca en español.
    expect(
      getAiringScheduleLabel({
        mediaType: "tv",
        inProduction: false,
        tvStatus: "En emisión",
        lastAirDate: iso(-7),
        nextEpisode: { air_date: nextDow(1) },
        seasonEpisodes: weeklyEpisodes(1, 5),
        lang: "es",
      }),
    ).toBe("Cada lunes")
  })

  it("no dice nada si el status esta traducido pero no es 'en emisión'", () => {
    expect(
      getAiringScheduleLabel({
        mediaType: "tv",
        inProduction: false,
        tvStatus: "Finalizada",
        lastAirDate: iso(-7),
        nextEpisode: { air_date: nextDow(1) },
        seasonEpisodes: weeklyEpisodes(1, 5),
        lang: "es",
      }),
    ).toBeNull()
  })
})
