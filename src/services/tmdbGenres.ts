export type TmdbMediaType = "movie" | "series" | "tv" | "anime";

export interface TmdbGenreDefinition {
  id: number;
  name: string;
  aliases: readonly string[];
}

export interface GenreBearingMedia {
  type: string;
  genres?: string[];
  genreIds?: number[];
}

export interface LibraryGenreOption {
  key: string;
  label: string;
}

const MOVIE_GENRE_DEFINITIONS: readonly TmdbGenreDefinition[] = [
  { id: 28, name: "Acción", aliases: ["Action"] },
  { id: 12, name: "Aventura", aliases: ["Adventure"] },
  { id: 16, name: "Animación", aliases: ["Animation"] },
  { id: 35, name: "Comedia", aliases: ["Comedy", "Komödie"] },
  { id: 80, name: "Crimen", aliases: ["Crime", "Krimi"] },
  { id: 99, name: "Documental", aliases: ["Documentary", "Dokumentarfilm"] },
  { id: 18, name: "Drama", aliases: [] },
  { id: 10751, name: "Familia", aliases: ["Family", "Familie"] },
  { id: 14, name: "Fantasía", aliases: ["Fantasy"] },
  { id: 36, name: "Historia", aliases: ["History", "Historical"] },
  { id: 27, name: "Terror", aliases: ["Horror"] },
  { id: 10402, name: "Música", aliases: ["Music", "Musical"] },
  { id: 9648, name: "Misterio", aliases: ["Mystery"] },
  { id: 10749, name: "Romance", aliases: ["Liebesfilm"] },
  { id: 878, name: "Ciencia ficción", aliases: ["Science Fiction", "Sci-Fi", "Science-Fiction"] },
  { id: 10770, name: "Película de TV", aliases: ["TV Movie", "Television Movie"] },
  { id: 53, name: "Suspenso", aliases: ["Thriller"] },
  { id: 10752, name: "Guerra", aliases: ["War"] },
  { id: 37, name: "Western", aliases: ["Wester", "Western Film"] },
];

const TV_GENRE_DEFINITIONS: readonly TmdbGenreDefinition[] = [
  { id: 10759, name: "Acción y aventura", aliases: ["Action & Adventure", "Action and Adventure"] },
  { id: 16, name: "Animación", aliases: ["Animation"] },
  { id: 35, name: "Comedia", aliases: ["Comedy", "Komödie"] },
  { id: 80, name: "Crimen", aliases: ["Crime", "Krimi"] },
  { id: 99, name: "Documental", aliases: ["Documentary", "Dokumentarfilm"] },
  { id: 18, name: "Drama", aliases: [] },
  { id: 10751, name: "Familia", aliases: ["Family", "Familie"] },
  { id: 10762, name: "Infantil", aliases: ["Kids", "Children"] },
  { id: 9648, name: "Misterio", aliases: ["Mystery"] },
  { id: 10763, name: "Noticias", aliases: ["News"] },
  { id: 10764, name: "Reality", aliases: ["Reality TV", "Reality-TV"] },
  { id: 10765, name: "Ciencia ficción y fantasía", aliases: ["Sci-Fi & Fantasy", "Science Fiction & Fantasy", "Science Fiction and Fantasy"] },
  { id: 10766, name: "Telenovela", aliases: ["Soap", "Soap Opera"] },
  { id: 10767, name: "Talk show", aliases: ["Talk", "Talk Show"] },
  { id: 10768, name: "Guerra y política", aliases: ["War & Politics", "War and Politics"] },
  { id: 37, name: "Western", aliases: ["Wester", "Western Film"] },
];

export const TMDB_MOVIE_GENRES: Record<string, string> = Object.fromEntries(
  MOVIE_GENRE_DEFINITIONS.map(genre => [genre.name, String(genre.id)]),
);

export const TMDB_TV_GENRES: Record<string, string> = Object.fromEntries(
  TV_GENRE_DEFINITIONS.map(genre => [genre.name, String(genre.id)]),
);

const MOVIE_BY_ID = new Map(MOVIE_GENRE_DEFINITIONS.map(genre => [genre.id, genre]));
const TV_BY_ID = new Map(TV_GENRE_DEFINITIONS.map(genre => [genre.id, genre]));
const MOVIE_BY_NAME = makeNameMap(MOVIE_GENRE_DEFINITIONS);
const TV_BY_NAME = makeNameMap(TV_GENRE_DEFINITIONS);

export function tmdbGenreDefinitions(type: string): readonly TmdbGenreDefinition[] {
  return type.toLowerCase() === "movie" ? MOVIE_GENRE_DEFINITIONS : TV_GENRE_DEFINITIONS;
}

export function tmdbGenreName(type: string, id: number): string | undefined {
  const definitions = type.toLowerCase() === "movie" ? MOVIE_BY_ID : TV_BY_ID;
  return definitions.get(id)?.name;
}

export function tmdbGenreId(type: string, value: string): number | undefined {
  const definitions = type.toLowerCase() === "movie" ? MOVIE_BY_NAME : TV_BY_NAME;
  const id = definitions.get(normalizeGenreText(value));
  return id;
}

export function mediaGenreKey(type: string, value: string | number): string {
  if (typeof value === "number" || /^\d+$/.test(value)) return `tmdb:${value}`;
  const id = tmdbGenreId(type, value);
  return id == null ? `custom:${normalizeGenreText(value)}` : `tmdb:${id}`;
}

export function getMediaGenreKeys(media: GenreBearingMedia): string[] {
  const type = media.type.toLowerCase();
  const definitions = type === "movie" ? MOVIE_BY_ID : TV_BY_ID;
  const keys = new Set<string>();

  for (const id of media.genreIds ?? []) {
    if (definitions.has(id)) keys.add(`tmdb:${id}`);
  }

  for (const [index, raw] of (media.genres ?? []).entries()) {
    const genre = raw.trim();
    if (!genre) continue;
    const pairedId = media.genreIds?.[index];
    if (pairedId != null && definitions.has(pairedId)) {
      keys.add(`tmdb:${pairedId}`);
      continue;
    }
    keys.add(mediaGenreKey(type, genre));
  }

  return [...keys].sort((a, b) => a.localeCompare(b, "es"));
}

export function buildLibraryGenreOptions(media: readonly GenreBearingMedia[]): LibraryGenreOption[] {
  const options = new Map<string, string>();

  for (const item of media) {
    const type = item.type.toLowerCase();
    const definitions = type === "movie" ? MOVIE_BY_ID : TV_BY_ID;
    for (const id of item.genreIds ?? []) {
      const genre = definitions.get(id);
      if (genre) options.set(`tmdb:${id}`, genre.name);
    }

    for (const [index, raw] of (item.genres ?? []).entries()) {
      const label = raw.trim();
      if (!label) continue;
      const pairedId = item.genreIds?.[index];
      const paired = pairedId == null ? undefined : definitions.get(pairedId);
      const id = paired?.id ?? tmdbGenreId(type, label);
      const canonical = id == null ? undefined : definitions.get(id);
      const key = id == null ? `custom:${normalizeGenreText(label)}` : `tmdb:${id}`;
      options.set(key, canonical?.name ?? label);
    }
  }

  return [...options]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));
}

function makeNameMap(definitions: readonly TmdbGenreDefinition[]) {
  const names = new Map<string, number>();
  for (const genre of definitions) {
    for (const name of [genre.name, ...genre.aliases]) {
      names.set(normalizeGenreText(name), genre.id);
    }
  }
  return names;
}

function normalizeGenreText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
