import type { AwardStatus, MediaType } from "./types";

const TMDB_BASE = "https://api.themoviedb.org/3";
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export interface PeopleEnv {
  AWARDS_DB: D1Database;
  TMDB_API_KEY?: string;
  ANILIST_CLIENT_ID?: string;
}

export function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2020\u2021*]+/g, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function personIdForExternal(kind: "tmdb" | "imdb" | "wikidata" | "anilist", value: string | number): string {
  return `person:${kind}:${String(value).trim().toLowerCase()}`;
}

/** Crea las ocurrencias para registros existentes; no asigna identidades por nombre. */
export async function syncRecipientRows(env: PeopleEnv, limit = 5000): Promise<{ processed: number; created: number }> {
  const rows = await env.AWARDS_DB.prepare(
    `SELECT r.id, r.recipients
     FROM award_records r
     WHERE json_array_length(r.recipients) > 0
       AND EXISTS (SELECT 1 FROM json_each(r.recipients) j)
       AND NOT EXISTS (SELECT 1 FROM award_record_people p WHERE p.record_id = r.id)
     LIMIT ?`,
  ).bind(limit).all<{ id: string; recipients: string }>();
  const statements: D1PreparedStatement[] = [];
  let processed = 0;
  for (const row of rows.results ?? []) {
    let recipients: unknown;
    try { recipients = JSON.parse(row.recipients); } catch { recipients = []; }
    if (!Array.isArray(recipients)) continue;
    recipients.forEach((value, index) => {
      if (typeof value !== "string" || !value.trim()) return;
      processed += 1;
      statements.push(env.AWARDS_DB.prepare(
        `INSERT OR IGNORE INTO award_record_people
         (id, record_id, recipient_index, recipient_name, recipient_norm, resolution_status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).bind(crypto.randomUUID(), row.id, index, value.trim(), normalizePersonName(value), new Date().toISOString()));
    });
  }
  for (let start = 0; start < statements.length; start += 80) await env.AWARDS_DB.batch(statements.slice(start, start + 80));
  return { processed, created: statements.length };
}

interface PendingRecipient {
  relation_id: string;
  record_id: string;
  recipient_name: string;
  recipient_norm: string;
  work_key: string;
  work_title: string;
  work_year: number | null;
  media_type: MediaType | null;
  tmdb_id: number | null;
  anilist_id: number | null;
}

interface Credit { id: number; name?: string; original_name?: string; known_for_department?: string; job?: string; character?: string; }

async function tmdbCredits(env: PeopleEnv, row: PendingRecipient): Promise<Credit[] | null> {
  const key = env.TMDB_API_KEY?.trim();
  if (!key || row.tmdb_id == null) return null;
  const kind = row.media_type === "tv" || row.media_type === "anime" ? "tv" : "movie";
  try {
    const response = await fetch(`${TMDB_BASE}/${kind}/${row.tmdb_id}/credits?api_key=${encodeURIComponent(key)}&language=en-US`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { cast?: Credit[]; crew?: Credit[] };
    return [...(data.cast ?? []), ...(data.crew ?? [])];
  } catch { return null; }
}

async function tmdbPersonExternalIds(env: PeopleEnv, personId: number): Promise<{ imdbId: string | null; wikidataId: string | null }> {
  const key = env.TMDB_API_KEY?.trim();
  if (!key) return { imdbId: null, wikidataId: null };
  try {
    const response = await fetch(`${TMDB_BASE}/person/${personId}/external_ids?api_key=${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { imdbId: null, wikidataId: null };
    const data = await response.json() as { imdb_id?: string | null; wikidata_id?: string | null };
    return {
      imdbId: typeof data.imdb_id === "string" && data.imdb_id ? data.imdb_id : null,
      wikidataId: typeof data.wikidata_id === "string" && data.wikidata_id ? data.wikidata_id : null,
    };
  } catch { return { imdbId: null, wikidataId: null }; }
}

async function anilistStaff(env: PeopleEnv, row: PendingRecipient): Promise<Credit[] | null> {
  if (row.anilist_id == null) return null;
  try {
    const response = await fetch(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(env.ANILIST_CLIENT_ID ? { Authorization: `Bearer ${env.ANILIST_CLIENT_ID}` } : {}) },
      body: JSON.stringify({ query: `query ($id: Int) { Media(id: $id) { staff { edges { node { id name { full native } } } } characters { edges { voiceActors { id name { full native } } } } } }`, variables: { id: row.anilist_id } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json() as any;
    const staff = (data.data?.Media?.staff?.edges ?? []).map((edge: any) => ({ id: Number(edge.node?.id), name: edge.node?.name?.full, original_name: edge.node?.name?.native }));
    const voices = (data.data?.Media?.characters?.edges ?? []).flatMap((edge: any) => (edge.voiceActors ?? []).map((actor: any) => ({ id: Number(actor.id), name: actor.name?.full, original_name: actor.name?.native })));
    return [...staff, ...voices].filter((item: Credit) => Number.isFinite(item.id));
  } catch { return null; }
}

function matchingCredits(row: PendingRecipient, credits: Credit[]): Credit[] {
  const wanted = normalizePersonName(row.recipient_name);
  const matches = credits.filter(credit => [credit.name, credit.original_name].filter(Boolean).some(name => normalizePersonName(name as string) === wanted));
  return [...new Map(matches.map(match => [match.id, match])).values()];
}

async function upsertResolvedPerson(env: PeopleEnv, row: PendingRecipient, credit: Credit, now: string): Promise<string> {
  const id = personIdForExternal(row.tmdb_id != null ? "tmdb" : "anilist", credit.id);
  const tmdbId = row.tmdb_id != null ? credit.id : null;
  const anilistId = row.tmdb_id == null ? credit.id : null;
  const externalIds = tmdbId !== null ? await tmdbPersonExternalIds(env, tmdbId) : { imdbId: null, wikidataId: null };
  await env.AWARDS_DB.prepare(
    `INSERT INTO award_people
      (id, canonical_name, canonical_name_norm, tmdb_id, imdb_id, wikidata_id, anilist_staff_id, resolution_status, resolution_reason, confidence, matched_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved', 'context_credit', 1.0, 'work_credit', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       canonical_name = excluded.canonical_name,
       canonical_name_norm = excluded.canonical_name_norm,
       tmdb_id = COALESCE(excluded.tmdb_id, award_people.tmdb_id),
       imdb_id = COALESCE(excluded.imdb_id, award_people.imdb_id),
       wikidata_id = COALESCE(excluded.wikidata_id, award_people.wikidata_id),
       anilist_staff_id = COALESCE(excluded.anilist_staff_id, award_people.anilist_staff_id),
       resolution_status = 'resolved', resolution_reason = excluded.resolution_reason,
       confidence = excluded.confidence, matched_by = excluded.matched_by, updated_at = excluded.updated_at`,
  ).bind(id, credit.name ?? credit.original_name ?? row.recipient_name, normalizePersonName(credit.name ?? credit.original_name ?? row.recipient_name), tmdbId, externalIds.imdbId, externalIds.wikidataId, anilistId, now, now).run();
  await env.AWARDS_DB.prepare(
    `INSERT OR IGNORE INTO award_person_aliases (id, person_id, alias, alias_norm, source) VALUES (?, ?, ?, ?, 'credit')`,
  ).bind(crypto.randomUUID(), id, row.recipient_name, row.recipient_norm).run();
  return id;
}

export interface PeopleResolutionResult {
  processed: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  remaining: number;
}

export async function resolvePeopleBatch(env: PeopleEnv, limit = 40, force = false): Promise<PeopleResolutionResult> {
  await syncRecipientRows(env, Math.max(limit * 10, 100));
  const statusClause = force ? "('pending', 'ambiguous', 'unresolved', 'resolved')" : "('pending')";
  const result = await env.AWARDS_DB.prepare(
    `SELECT MIN(p.id) relation_id, MIN(p.record_id) record_id, MIN(p.recipient_name) recipient_name, p.recipient_norm,
            r.work_key, MIN(r.work_title) work_title, MIN(r.work_year) work_year, l.media_type, l.tmdb_id, l.anilist_id
     FROM award_record_people p
     JOIN award_records r ON r.id = p.record_id
     LEFT JOIN award_media_links l ON l.work_key = r.work_key
     WHERE p.resolution_status IN ${statusClause}
     GROUP BY r.work_key, p.recipient_norm, l.media_type, l.tmdb_id, l.anilist_id
     ORDER BY MIN(p.updated_at) ASC LIMIT ?`,
  ).bind(limit).all<PendingRecipient>();
  let resolved = 0, ambiguous = 0, unresolved = 0;
  const creditsCache = new Map<string, Promise<Credit[] | null>>();
  const personCache = new Map<string, Promise<string>>();
  const updateRelations = async (
    row: PendingRecipient,
    personId: string | null,
    status: "resolved" | "ambiguous" | "unresolved",
    reason: string,
  ): Promise<number> => {
    const info = await env.AWARDS_DB.prepare(
      `UPDATE award_record_people
       SET person_id = ?, resolution_status = ?, resolution_reason = ?, updated_at = ?
       WHERE record_id IN (SELECT id FROM award_records WHERE work_key = ?)
         AND recipient_norm = ?
         AND resolution_status IN ${statusClause}`,
    ).bind(personId, status, reason, new Date().toISOString(), row.work_key, row.recipient_norm).run();
    return Number(info.meta?.changes ?? 1) > 0 ? 1 : 0;
  };
  const pendingRows = result.results ?? [];
  const processRow = async (row: PendingRecipient): Promise<void> => {
    if (row.tmdb_id == null && row.anilist_id == null) {
      await updateRelations(row, null, "unresolved", "work_identity_unresolved");
      unresolved += 1;
      return;
    }
    const creditsKey = `${row.media_type ?? ""}:${row.tmdb_id ?? ""}:${row.anilist_id ?? ""}`;
    let creditsPromise = creditsCache.get(creditsKey);
    if (!creditsPromise) {
      creditsPromise = row.tmdb_id != null ? tmdbCredits(env, row) : anilistStaff(env, row);
      creditsCache.set(creditsKey, creditsPromise);
    }
    const credits = await creditsPromise;
    if (credits === null) return;
    const matches = matchingCredits(row, credits);
    const now = new Date().toISOString();
    if (matches.length === 1) {
      const personKey = `${row.tmdb_id != null ? "tmdb" : "anilist"}:${matches[0].id}`;
      let personPromise = personCache.get(personKey);
      if (!personPromise) {
        personPromise = upsertResolvedPerson(env, row, matches[0], now);
        personCache.set(personKey, personPromise);
      }
      const personId = await personPromise;
      await updateRelations(row, personId, "resolved", "context_credit");
      resolved += 1;
    } else if (matches.length > 1) {
      await updateRelations(row, null, "ambiguous", "multiple_context_credits");
      ambiguous += 1;
    } else {
      await updateRelations(row, null, "unresolved", "name_not_in_context_credits");
      unresolved += 1;
    }
  };
  for (let start = 0; start < pendingRows.length; start += 8) {
    await Promise.all(pendingRows.slice(start, start + 8).map(processRow));
  }
  const remainingRow = await env.AWARDS_DB.prepare(`SELECT COUNT(*) count FROM award_record_people WHERE resolution_status = 'pending'`).bind().first<{ count: number }>();
  return { processed: pendingRows.length, resolved, ambiguous, unresolved, remaining: Number(remainingRow?.count ?? 0) };
}

export function awardPersonRecordStatus(value: string): AwardStatus {
  return value === "winner" || value === "official_selection" ? value : "nominee";
}
