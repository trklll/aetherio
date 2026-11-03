import { SPORTS_ENTITY_BY_ID } from "../data/sports/catalog.ts";
import { followedIdsFor, hasAnyFollow } from "../data/sports/preferences.ts";
import type { SportsDiscipline, SportsPreferences } from "../data/sports/types.ts";

/**
 * Catálogo curado de repeticiones: la colección "Sports Replays" del addon
 * organiza los archivos en carpetas por deporte y catálogos por ventana
 * temporal (hoy, ayer, semana), competición y archivo (older). Eso alimenta
 * la fila curada de Repeticiones, que sustituye la cola genérica
 * `genre=Replays` cuando el usuario personaliza.
 *
 * Los catalogId son los del addon (`nuvio_sports_replays_*`). Solo "futbol" y
 * "mma" son disciplinas elegibles en la app, así que de las ocho carpetas de
 * la colección solo la de fútbol puede armar un plan curado: MMA no tiene
 * carpeta y sus repeticiones siguen saliendo de la cola genérica. Las otras
 * carpetas se documentan tal como las publica el addon, para cuando existan
 * más disciplinas; nadie las consulta hoy.
 */

export interface SportsReplayCatalog {
  catalogId: string;
  title: string;
}

export interface SportsReplayFolderData {
  id: string;
  title: string;
  /** Disciplina de la app que abre la carpeta; null mientras no sea elegible. */
  discipline: SportsDiscipline | null;
  /** Catálogos con ventana temporal, en orden de lectura de la fila. */
  buckets: readonly SportsReplayCatalog[];
  /** catalogId del addon por id de competición del catálogo de Aetherio. */
  competitions: Readonly<Record<string, string>>;
  older: SportsReplayCatalog;
  catchAll: SportsReplayCatalog;
  poster: string;
}

/** Arte oficial de cada carpeta, tal como lo manda la colección. */
const POSTER_URL = (sportToken: string) => `https://nuviosports.xyz/posters/replays/luffy_${sportToken}.jpg?v=luffy`;

export const SPORTS_REPLAY_FOLDERS: readonly SportsReplayFolderData[] = [
  {
    id: "football",
    title: "Fútbol",
    discipline: "futbol",
    buckets: [
      { catalogId: "nuvio_sports_replays_football_today", title: "Repeticiones de hoy" },
      { catalogId: "nuvio_sports_replays_football_yesterday", title: "Repeticiones de ayer" },
      { catalogId: "nuvio_sports_replays_football_this_week", title: "Repeticiones de la semana" },
    ],
    // Competiciones con catálogo curado en la colección. LaLiga o la Serie A
    // no tienen carpeta propia en el addon: sus repeticiones llegan por los
    // buckets y casan por título/participantes.
    competitions: {
      "comp:eng-premier": "nuvio_sports_replays_football_premier_league",
      "comp:uefa-champions": "nuvio_sports_replays_football_ucl",
    },
    older: { catalogId: "nuvio_sports_replays_football_older", title: "Repeticiones anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_football", title: "Todo el fútbol" },
    poster: POSTER_URL("football"),
  },
  {
    id: "motorsport",
    title: "Motor",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_motorsport_today", title: "Carreras de hoy" },
      { catalogId: "nuvio_sports_replays_motorsport_yesterday", title: "Carreras de ayer" },
      { catalogId: "nuvio_sports_replays_motorsport_this_week", title: "Carreras de la semana" },
    ],
    // El addon curó F1 (`nuvio_sports_replays_motorsport_f1`) pero Aetherio
    // todavía no tiene entidad de F1 que se pueda seguir.
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_motorsport_older", title: "Carreras anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_motorsport", title: "Todo el motor" },
    poster: POSTER_URL("motorsport"),
  },
  {
    id: "baseball",
    title: "Béisbol",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_baseball_today", title: "Partidos de hoy" },
      { catalogId: "nuvio_sports_replays_baseball_yesterday", title: "Partidos de ayer" },
      { catalogId: "nuvio_sports_replays_baseball_this_week", title: "Partidos de la semana" },
    ],
    // MLB (`nuvio_sports_replays_baseball_mlb`).
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_baseball_older", title: "Partidos anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_baseball", title: "Todo el béisbol" },
    poster: POSTER_URL("baseball"),
  },
  {
    id: "rugby",
    title: "Rugby",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_rugby_today", title: "Partidos de hoy" },
      { catalogId: "nuvio_sports_replays_rugby_yesterday", title: "Partidos de ayer" },
      { catalogId: "nuvio_sports_replays_rugby_this_week", title: "Partidos de la semana" },
    ],
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_rugby_older", title: "Partidos anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_rugby", title: "Todo el rugby" },
    poster: POSTER_URL("rugby"),
  },
  {
    id: "basketball",
    title: "Baloncesto",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_basketball_today", title: "Partidos de hoy" },
      { catalogId: "nuvio_sports_replays_basketball_yesterday", title: "Partidos de ayer" },
      { catalogId: "nuvio_sports_replays_basketball_this_week", title: "Partidos de la semana" },
    ],
    // NBA (`nuvio_sports_replays_basketball_nba`).
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_basketball_older", title: "Partidos anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_basketball", title: "Todo el baloncesto" },
    poster: POSTER_URL("basketball"),
  },
  {
    id: "tennis",
    title: "Tenis",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_tennis_today", title: "Partidos de hoy" },
      { catalogId: "nuvio_sports_replays_tennis_yesterday", title: "Partidos de ayer" },
      { catalogId: "nuvio_sports_replays_tennis_this_week", title: "Partidos de la semana" },
    ],
    // ATP (`nuvio_sports_replays_tennis_atp`).
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_tennis_older", title: "Partidos anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_tennis", title: "Todo el tenis" },
    poster: POSTER_URL("tennis"),
  },
  {
    id: "hockey",
    title: "Hockey",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_hockey_today", title: "Partidos de hoy" },
      { catalogId: "nuvio_sports_replays_hockey_yesterday", title: "Partidos de ayer" },
      { catalogId: "nuvio_sports_replays_hockey_this_week", title: "Partidos de la semana" },
    ],
    // NHL (`nuvio_sports_replays_hockey_nhl`).
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_hockey_older", title: "Partidos anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_hockey", title: "Todo el hockey" },
    poster: POSTER_URL("hockey"),
  },
  {
    id: "american_football",
    title: "Fútbol americano",
    discipline: null,
    buckets: [
      { catalogId: "nuvio_sports_replays_american_football_today", title: "Partidos de hoy" },
      { catalogId: "nuvio_sports_replays_american_football_yesterday", title: "Partidos de ayer" },
      { catalogId: "nuvio_sports_replays_american_football_this_week", title: "Partidos de la semana" },
    ],
    // NFL (`nuvio_sports_replays_american_football_nfl`).
    competitions: {},
    older: { catalogId: "nuvio_sports_replays_american_football_older", title: "Partidos anteriores" },
    catchAll: { catalogId: "nuvio_sports_replays_american_football", title: "Todo el fútbol americano" },
    poster: POSTER_URL("american_football"),
  },
];

/**
 * Una fuente del plan. `catalog` lee un catálogo acotado del addon; `generic`
 * es la cola histórica `nuvio_sports_catalog genre=Replays` (infinita):
 * la única vía para MMA y el comportamiento sin personalización.
 */
export type SportsReplayPlanSource =
  | { kind: "catalog"; catalogId: string; /** Fijada: el catálogo se incluye porque la competición es seguida, y sus repeticiones no vuelven al filtro por título. */ competitionId?: string }
  | { kind: "generic" };

export interface SportsReplayPlan {
  sources: readonly SportsReplayPlanSource[];
  personalized: boolean;
}

/**
 * Dirección de página dentro del plan: un entero con el índice de fuente en
 * la parte alta y el skip propio en la parte baja, de modo que el pageParam
 * de la query es estable y auto-descriptivo.
 */
export const SPORTS_REPLAY_SOURCE_STRIDE = 1_000_000;

export function encodeReplayPageHandle(sourceIndex: number, skip: number): number {
  return sourceIndex * SPORTS_REPLAY_SOURCE_STRIDE + skip;
}

export function decodeReplayPageHandle(pageIndex: number): { sourceIndex: number; skip: number } {
  const handle = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
  return { sourceIndex: Math.floor(handle / SPORTS_REPLAY_SOURCE_STRIDE), skip: handle % SPORTS_REPLAY_SOURCE_STRIDE };
}

function followedSports(prefs: SportsPreferences): Set<SportsDiscipline> {
  const wanted = new Set<SportsDiscipline>(prefs.sports);
  const kinds = ["competition", "club", "national-team", "organization", "fighter"] as const;
  for (const kind of kinds) {
    for (const id of followedIdsFor(prefs, kind)) {
      const sport = SPORTS_ENTITY_BY_ID.get(id)?.sport;
      if (sport) wanted.add(sport);
    }
  }
  return wanted;
}

/**
 * Plan de la fila de Repeticiones según lo que eligió el usuario:
 *
 * - Sin nada elegido (saltó el asistente): solo la cola genérica, como siempre.
 * - Personalizado: buckets de fútbol (hoy/ayer/semana) si el fútbol está entre
 *   lo elegido o lo que arrastra lo seguido, un catálogo por competición
 *   seguida que la colección cura, el archivo (older) y, adelante, la cola
 *   genérica solo cuando MMA está en juego, porque no tiene carpeta.
 *
 * El orden cuenta: primero lo fresco, después lo seguido por competición y
 * al final el archivo grande.
 */
export function buildSportsReplayPlan(prefs: SportsPreferences): SportsReplayPlan {
  if (!(prefs.sports.length > 0 || hasAnyFollow(prefs))) {
    return { sources: [{ kind: "generic" }], personalized: false };
  }
  const wanted = followedSports(prefs);
  const sources: SportsReplayPlanSource[] = [];
  for (const folder of SPORTS_REPLAY_FOLDERS) {
    if (!folder.discipline || !wanted.has(folder.discipline)) continue;
    for (const bucket of folder.buckets) {
      sources.push({ kind: "catalog", catalogId: bucket.catalogId });
    }
    for (const competitionId of prefs.followedCompetitions) {
      const catalogId = folder.competitions[competitionId];
      if (catalogId) sources.push({ kind: "catalog", catalogId, competitionId });
    }
    sources.push({ kind: "catalog", catalogId: folder.older.catalogId });
  }
  if (wanted.has("mma")) sources.push({ kind: "generic" });
  if (!sources.length) return { sources: [{ kind: "generic" }], personalized: false };
  return { sources, personalized: true };
}

/** Clave de caché para el plan: cambiar preferencias cambia la fila de raíz. */
export function sportsReplayPlanSignature(prefs: SportsPreferences): string {
  return JSON.stringify({ plan: buildSportsReplayPlan(prefs) });
}
