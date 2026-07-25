import { fetchJikanAnimeCharacters, type JikanCharacter } from "./jikan";
import { tmdbFetch } from "../config/apiKeys";

const ARM_IMDB = "https://arm.haglund.dev/api/v2/imdb?id=";
const ARM_TMDB = "https://arm.haglund.dev/api/v2/themoviedb?id=";
const ARM_INCLUDE = "&include=myanimelist";
const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const ANILIST_TIMEOUT_MS = 6000;

const malIdCache = new Map<string, number>();
const resolveAttempts = new Set<string>();

async function armImdbToMal(imdbId: string): Promise<number | undefined> {
  const clean = imdbId.split(":")[0];
  const key = `arm:imdb:${clean}`;
  if (malIdCache.has(key)) return malIdCache.get(key);
  if (resolveAttempts.has(key)) return undefined;
  resolveAttempts.add(key);
  try {
    const res = await fetch(`${ARM_IMDB}${encodeURIComponent(clean)}${ARM_INCLUDE}`);
    if (!res.ok) return undefined;
    const arm = await res.json();
    const malId = Array.isArray(arm) ? arm[0]?.myanimelist : arm?.myanimelist;
    if (typeof malId === "number" && Number.isFinite(malId) && malId > 0) {
      malIdCache.set(key, malId);
      return malId;
    }
  } catch {
  }
  return undefined;
}

async function armTmdbToMal(tmdbId: number): Promise<number | undefined> {
  const key = `arm:tmdb:${tmdbId}`;
  if (malIdCache.has(key)) return malIdCache.get(key);
  if (resolveAttempts.has(key)) return undefined;
  resolveAttempts.add(key);
  try {
    const res = await fetch(`${ARM_TMDB}${tmdbId}${ARM_INCLUDE}`);
    if (!res.ok) return undefined;
    const arm = await res.json();
    const malId = Array.isArray(arm) ? arm[0]?.myanimelist : arm?.myanimelist;
    if (typeof malId === "number" && Number.isFinite(malId) && malId > 0) {
      malIdCache.set(key, malId);
      return malId;
    }
  } catch {
  }
  return undefined;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function titlesMatch(searchTitle: string, candidate: string | undefined | null): boolean {
  if (!candidate) return false;
  const a = normalizeTitle(searchTitle);
  const b = normalizeTitle(candidate);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function anilistToMal(title: string, year?: number): Promise<number | undefined> {
  const norm = normalizeTitle(title);
  const key = `anilist:${norm}:${year ?? 0}`;
  if (malIdCache.has(key)) return malIdCache.get(key);
  if (resolveAttempts.has(key)) return undefined;
  resolveAttempts.add(key);
  const query = JSON.stringify({
    query: `query($search: String!, $year: Int){ Page(perPage: 5){ media(type: ANIME, search: $search, sort: SEARCH_MATCH, seasonYear: $year){ idMal title{ romaji english } } } }`,
    variables: { search: title, year: year ?? null },
  });
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: query,
      signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const json = await res.json();
    const media = json?.data?.Page?.media ?? [];
    for (const item of media) {
      if (typeof item.idMal === "number" && item.idMal > 0) {
        if (titlesMatch(title, item.title?.english) || titlesMatch(title, item.title?.romaji)) {
          malIdCache.set(key, item.idMal);
          return item.idMal;
        }
      }
    }
    if (media.length && typeof media[0].idMal === "number" && media[0].idMal > 0) {
      malIdCache.set(key, media[0].idMal);
      return media[0].idMal;
    }
  } catch {
  }
  return undefined;
}

const tmdbPersonCache = new Map<string, number>();

async function searchTmdbPerson(name: string): Promise<number | undefined> {
  const key = name.trim().toLowerCase();
  if (tmdbPersonCache.has(key)) return tmdbPersonCache.get(key);
  if (resolveAttempts.has(`tmdb-person:${key}`)) return undefined;
  resolveAttempts.add(`tmdb-person:${key}`);
  try {
    const data = await tmdbFetch<any>("/search/person", {
      params: { query: name, language: "en-US", page: "1" },
    });
    const match = (data?.results ?? []).find(
      (r: any) => r.known_for_department === "Acting" && r.name?.toLowerCase() === name.toLowerCase()
    ) ?? (data?.results ?? [])[0];
    if (match?.id) {
      tmdbPersonCache.set(key, match.id);
      return match.id;
    }
  } catch {
  }
  return undefined;
}

export interface AnimeResolveInput {
  malId?: number;
  imdbId?: string;
  tmdbId?: number;
  title?: string;
  year?: number;
}

export async function resolveMalId(input: AnimeResolveInput): Promise<number | undefined> {
  const { malId, imdbId, tmdbId, title, year } = input;
  if (typeof malId === "number" && Number.isFinite(malId) && malId > 0) return malId;
  if (typeof tmdbId === "number" && tmdbId > 0) {
    const viaTmdb = await armTmdbToMal(tmdbId);
    if (viaTmdb) return viaTmdb;
  }
  if (imdbId && imdbId.startsWith("tt")) {
    const viaImdb = await armImdbToMal(imdbId);
    if (viaImdb) return viaImdb;
  }
  if (title && title.trim().length >= 3) {
    const viaAnilist = await anilistToMal(title, year);
    if (viaAnilist) return viaAnilist;
  }
  return undefined;
}

export interface AniListCharacterPhoto {
  characterName: string;
  characterImage?: string;
  role?: string;
}

export async function fetchAniListCharacterPhotos(staffName: string): Promise<AniListCharacterPhoto[]> {
  const key = `anilist:char-photos:${staffName.toLowerCase()}`;
  if (resolveAttempts.has(key)) return [];
  resolveAttempts.add(key);
  const body = JSON.stringify({
    query: `query($name: String!){ Staff(search: $name){ characters(perPage: 10, sort: FAVOURITES_DESC){ edges { role node { name { full } image { large medium } } } } } }`,
    variables: { name: staffName },
  });
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const edges = json?.data?.Staff?.characters?.edges ?? [];
    return edges
      .filter((e: any) => e?.node?.image?.large || e?.node?.image?.medium)
      .map((e: any) => ({
        characterName: e.node.name?.full ?? "",
        characterImage: e.node.image?.large || e.node.image?.medium || undefined,
        role: e.role ?? undefined,
      }));
  } catch {
    return [];
  }
}

async function resolveVoiceActorIds(chars: JikanCharacter[]): Promise<JikanCharacter[]> {
  const uniqueNames = [...new Set(chars.map((c) => c.voiceActor).filter((n): n is string => Boolean(n)))];
  const idMap = new Map<string, number>();
  await Promise.all(
    uniqueNames.map(async (name) => {
      const id = await searchTmdbPerson(name);
      if (id) idMap.set(name, id);
    })
  );
  return chars.map((c) => ({
    ...c,
    voiceActorId: c.voiceActor ? idMap.get(c.voiceActor) : undefined,
  }));
}

export async function fetchAnimeCast(malId: number): Promise<JikanCharacter[]> {
  let chars: JikanCharacter[];
  try {
    chars = await fetchJikanAnimeCharacters(malId);
    if (chars.length) {
      chars = await resolveVoiceActorIds(chars);
      return chars;
    }
  } catch {
  }
  chars = await fetchAniListCharacters(malId);
  return await resolveVoiceActorIds(chars);
}

interface AniListCharEdge {
  role: string | null;
  voiceActors: { name: { full: string } }[];
  node: { name: { full: string }; image: { large?: string; medium?: string } } | null;
}

async function fetchAniListCharacters(malId: number): Promise<JikanCharacter[]> {
  if (typeof malId !== "number" || !Number.isFinite(malId) || malId <= 0) return [];
  const key = `anilist:chars:${malId}`;
  if (resolveAttempts.has(key)) return [];
  resolveAttempts.add(key);
  const body = JSON.stringify({
    query: `query($mal: Int){ Media(idMal: $mal, type: ANIME){ characters(perPage: 25){ edges { role voiceActors { name { full } } node { name { full } image { large medium } } } } } }`,
    variables: { mal: malId },
  });
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const edges: AniListCharEdge[] = json?.data?.Media?.characters?.edges ?? [];
    if (!edges.length) return [];
    let i = 0;
    return edges
      .map((edge) => {
        const node = edge?.node;
        const name = node?.name?.full;
        if (!name) return null;
        i += 1;
        const va = edge.voiceActors?.find((v) => v?.name?.full);
        return {
          malId: i,
          name,
          image: node?.image?.large || node?.image?.medium || undefined,
          role: edge.role === "MAIN" ? "Main" : edge.role === "SUPPORTING" ? "Supporting" : edge.role || undefined,
          voiceActor: va?.name?.full,
        } as JikanCharacter;
      })
      .filter((c): c is JikanCharacter => c !== null);
  } catch {
    return [];
  }
}
