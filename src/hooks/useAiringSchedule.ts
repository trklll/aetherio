import { useQuery } from "@tanstack/react-query";
import { tmdbFetch } from "../config/apiKeys.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPANISH_WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

interface TmdbEpisodeDate {
  air_date?: string | null;
  season_number?: number;
}

interface TmdbTvDetails {
  in_production?: boolean;
  status?: string;
  next_episode_to_air?: TmdbEpisodeDate | null;
  last_episode_to_air?: TmdbEpisodeDate | null;
}

interface TmdbSeasonDetails {
  episodes?: TmdbEpisodeDate[];
}

export interface AiringSchedule {
  label: string;
  weekdays: string[];
  nextAirDate: string;
}

export function supportsAiringSchedule(type: string, mediaId: string) {
  return isSeriesType(type) && parseTmdbId(mediaId) !== null;
}

export function useAiringSchedule(type: string, mediaId: string, enabled: boolean) {
  const tmdbId = isSeriesType(type) ? parseTmdbId(mediaId) : null;
  return useQuery({
    queryKey: ["tmdb", "airing-schedule", tmdbId],
    queryFn: () => fetchAiringSchedule(tmdbId as number),
    enabled: enabled && tmdbId !== null,
    staleTime: 1000 * 60 * 60 * 12,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  }).data ?? null;
}

async function fetchAiringSchedule(tmdbId: number): Promise<AiringSchedule | null> {
  const details = await tmdbFetch<TmdbTvDetails>(`/tv/${tmdbId}`, {
    params: { language: "es-ES" },
  });
  const nextEpisode = details?.next_episode_to_air;
  const nextAirDate = normalizeDate(nextEpisode?.air_date);
  if (!details || !nextEpisode || !nextAirDate || !isCurrentlyAiring(details, nextAirDate)) return null;

  const seasonNumber = Number(nextEpisode.season_number);
  const season = Number.isFinite(seasonNumber) && seasonNumber > 0
    ? await tmdbFetch<TmdbSeasonDetails>(`/tv/${tmdbId}/season/${seasonNumber}`, {
      params: { language: "es-ES" },
    })
    : null;

  const weekdays = inferRecurringWeekdays(
    season?.episodes ?? [],
    details.last_episode_to_air?.air_date,
    nextAirDate,
  );
  if (!weekdays.length) return null;

  return {
    label: weekdays.length === 1
      ? `Cada ${weekdays[0]}`
      : `Cada ${weekdays[0]} y ${weekdays[1]}`,
    weekdays,
    nextAirDate,
  };
}

function isCurrentlyAiring(details: TmdbTvDetails, nextAirDate: string) {
  if (!details.in_production && details.status !== "Returning Series") return false;
  const nextTime = dateValue(nextAirDate);
  if (nextTime === null) return false;
  const now = Date.now();
  if (nextTime < now - DAY_MS || nextTime > now + 21 * DAY_MS) return false;

  const lastTime = dateValue(details.last_episode_to_air?.air_date);
  return lastTime === null || lastTime >= now - 42 * DAY_MS;
}

function inferRecurringWeekdays(episodes: TmdbEpisodeDate[], lastAirDate: string | null | undefined, nextAirDate: string) {
  const datedEpisodes = episodes
    .map(episode => normalizeDate(episode.air_date))
    .filter((date): date is string => Boolean(date));
  const fallbackDates = [normalizeDate(lastAirDate), nextAirDate]
    .filter((date): date is string => Boolean(date));
  const dates = datedEpisodes.length ? datedEpisodes : fallbackDates;
  const counts = new Map<number, number>();

  for (const date of dates) {
    const weekday = weekdayIndex(date);
    if (weekday === null) continue;
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  }

  const recurring = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([weekday]) => weekday);
  let selected: number[];

  if (recurring.length === 1 || recurring.length === 2) {
    selected = recurring;
  } else if (recurring.length > 2) {
    // A daily strip cannot be described honestly as one or two weekly days.
    return [];
  } else {
    const nextTime = dateValue(nextAirDate);
    const nearby = [...new Set(dates
      .filter(date => {
        const value = dateValue(date);
        return value !== null && nextTime !== null && Math.abs(value - nextTime) <= 8 * DAY_MS;
      })
      .map(weekdayIndex)
      .filter((weekday): weekday is number => weekday !== null))];
    if (nearby.length < 1 || nearby.length > 2) return [];
    selected = nearby;
  }

  return selected
    .sort((a, b) => mondayFirstIndex(a) - mondayFirstIndex(b))
    .map(weekday => SPANISH_WEEKDAYS[weekday]);
}

function isSeriesType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "series" || normalized === "tv" || normalized === "anime";
}

function parseTmdbId(mediaId: string) {
  const match = /^tmdb:(\d+)$/i.exec(mediaId.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeDate(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateValue(value: string | null | undefined) {
  const date = normalizeDate(value);
  if (!date) return null;
  const time = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function weekdayIndex(value: string) {
  const time = dateValue(value);
  return time === null ? null : new Date(time).getUTCDay();
}

function mondayFirstIndex(weekday: number) {
  return weekday === 0 ? 6 : weekday - 1;
}
