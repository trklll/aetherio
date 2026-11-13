import { readExperienceJSON, writeExperienceJSON } from "../domain/experienceStorage";
import { mediaRefFromLegacy, mediaRefKey } from "../domain/mediaIdentity";
import { captureExperienceScope } from "./localProfiles";
import { LIBRARY_CHANGED_EVENT } from "./library";

const USER_RATINGS_KEY = "aetherio-user-ratings-v1";
export const USER_RATINGS_CHANGED_EVENT = "aetherio-user-ratings-changed";

export type UserRatingMap = Record<string, number>;

interface UserRatingsDocument {
  version: 1;
  ratings: UserRatingMap;
  changes?: Record<string, RatingChange>;
}

interface RatingChange {
  rating: number | null;
  updatedAt: number;
  operationId: string;
}

export function normalizeFiveStarRating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0.5 || value > 5 || !Number.isInteger(value * 2)) return null;
  return value;
}

/** Trakt stores personal ratings out of ten; each integer maps to a half star. */
export function importedRatingToFiveStars(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(10, Math.max(0, Math.round(value))) / 2 || null;
}

export function formatFiveStarRating(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function readUserRatings(): UserRatingMap {
  if (!hasBrowserStorage()) return {};
  const result = readExperienceJSON<UserRatingsDocument>(
    captureExperienceScope(),
    USER_RATINGS_KEY,
    isUserRatingsDocument,
  );
  return result.ok && result.value ? sanitizeRatings(result.value.ratings) : {};
}

export function getUserRating(type: string, id: string): number | null {
  const key = mediaRatingKey(type, id);
  return key ? readUserRatings()[key] ?? null : null;
}

export function getPersonalRatingFromMap(
  type: string,
  id: string,
  importedRating: unknown,
  ratings: UserRatingMap,
): number | null {
  const key = mediaRatingKey(type, id);
  const personalRating = key ? normalizeFiveStarRating(ratings[key]) : null;
  return personalRating ?? importedRatingToFiveStars(importedRating);
}

export function setUserRating(type: string, id: string, rating: number | null): boolean {
  if (!hasBrowserStorage()) return false;
  const key = mediaRatingKey(type, id);
  if (!key) return false;

  const normalizedRating = rating === null ? null : normalizeFiveStarRating(rating);
  if (rating !== null && normalizedRating === null) return false;

  const scope = captureExperienceScope();
  const current = readExperienceJSON<UserRatingsDocument>(scope, USER_RATINGS_KEY, isUserRatingsDocument);
  if (!current.ok) return false;
  const ratings = current.value ? sanitizeRatings(current.value.ratings) : {};
  const changes = normalizeRatingChanges(current.value);

  if (normalizedRating === null) {
    if (!Object.prototype.hasOwnProperty.call(ratings, key) && changes[key]?.rating === null) return true;
    delete ratings[key];
  } else {
    if (ratings[key] === normalizedRating) return true;
    ratings[key] = normalizedRating;
  }
  changes[key] = {
    rating: normalizedRating,
    updatedAt: Date.now(),
    operationId: createOperationId(),
  };

  return writeExperienceJSON(
    scope,
    USER_RATINGS_KEY,
    { version: 1, ratings, changes } satisfies UserRatingsDocument,
    [USER_RATINGS_CHANGED_EVENT, LIBRARY_CHANGED_EVENT],
  ).ok;
}

/** Merge a Drive copy into this profile, retaining per-rating edits and removals. */
export function mergeRemoteUserRatings(remoteValue: unknown): boolean {
  if (!hasBrowserStorage() || !isUserRatingsDocument(remoteValue)) return false;
  const scope = captureExperienceScope();
  const current = readExperienceJSON<UserRatingsDocument>(scope, USER_RATINGS_KEY, isUserRatingsDocument);
  if (!current.ok) return false;

  const merged = mergeUserRatingsDocuments(current.value, remoteValue);
  if (!merged) return false;
  if (current.value && JSON.stringify(current.value) === JSON.stringify(merged)) return true;

  return writeExperienceJSON(
    scope,
    USER_RATINGS_KEY,
    merged,
    [USER_RATINGS_CHANGED_EVENT, LIBRARY_CHANGED_EVENT],
  ).ok;
}

/** Pure merge helper also used to verify conflict and deletion behavior. */
export function mergeUserRatingsDocuments(
  localValue: unknown,
  remoteValue: unknown,
): UserRatingsDocument | null {
  const local = normalizeDocument(localValue);
  const remote = normalizeDocument(remoteValue);
  if (!local || !remote) return null;

  const mergedChanges: Record<string, RatingChange> = { ...(local.changes ?? {}) };
  for (const [key, remoteChange] of Object.entries(remote.changes ?? {})) {
    const localChange = mergedChanges[key];
    if (!localChange || compareRatingChanges(remoteChange, localChange) > 0) {
      mergedChanges[key] = remoteChange;
    }
  }

  const ratings: UserRatingMap = {};
  for (const [key, change] of Object.entries(mergedChanges)) {
    if (change.rating !== null) ratings[key] = change.rating;
  }
  return { version: 1, ratings, changes: mergedChanges };
}

function mediaRatingKey(type: string, id: string): string | null {
  if (!type.trim() || !id.trim()) return null;
  try {
    return mediaRefKey(mediaRefFromLegacy({ type, id }));
  } catch {
    return null;
  }
}

function isUserRatingsDocument(value: unknown): value is UserRatingsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Partial<UserRatingsDocument>;
  return document.version === 1
    && document.ratings !== null
    && typeof document.ratings === "object"
    && !Array.isArray(document.ratings);
}

function normalizeDocument(value: unknown): UserRatingsDocument | null {
  if (value === null || value === undefined) return { version: 1, ratings: {}, changes: {} };
  if (!isUserRatingsDocument(value)) return null;

  const ratings = sanitizeRatings(value.ratings);
  const changes = normalizeRatingChanges(value);
  // Older documents only had the ratings map. Give those entries a stable,
  // lowest-priority revision so newer timestamped edits and tombstones win.
  for (const [key, rating] of Object.entries(ratings)) {
    changes[key] ??= { rating, updatedAt: 0, operationId: `legacy:${key}:${rating}` };
  }
  return { version: 1, ratings, changes };
}

function normalizeRatingChanges(value: UserRatingsDocument | null | undefined): Record<string, RatingChange> {
  const changes = value?.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return {};
  return Object.fromEntries(
    Object.entries(changes).flatMap(([key, candidate]) => {
      if (!key || !candidate || typeof candidate !== "object") return [];
      const change = candidate as Partial<RatingChange>;
      const rating = change.rating === null ? null : normalizeFiveStarRating(change.rating);
      if (
        (change.rating !== null && rating === null)
        || typeof change.updatedAt !== "number"
        || !Number.isFinite(change.updatedAt)
        || typeof change.operationId !== "string"
      ) return [];
      return [[key, {
        rating,
        updatedAt: change.updatedAt,
        operationId: change.operationId,
      } satisfies RatingChange]];
    }),
  );
}

function compareRatingChanges(left: RatingChange, right: RatingChange): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? 1 : -1;
  return left.operationId.localeCompare(right.operationId);
}

function createOperationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function sanitizeRatings(ratings: UserRatingMap): UserRatingMap {
  return Object.fromEntries(
    Object.entries(ratings).flatMap(([key, value]) => {
      const rating = normalizeFiveStarRating(value);
      return key && rating !== null ? [[key, rating]] : [];
    }),
  );
}

function hasBrowserStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}
