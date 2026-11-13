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

  if (normalizedRating === null) {
    if (!Object.prototype.hasOwnProperty.call(ratings, key)) return true;
    delete ratings[key];
  } else {
    if (ratings[key] === normalizedRating) return true;
    ratings[key] = normalizedRating;
  }

  return writeExperienceJSON(
    scope,
    USER_RATINGS_KEY,
    { version: 1, ratings } satisfies UserRatingsDocument,
    [USER_RATINGS_CHANGED_EVENT, LIBRARY_CHANGED_EVENT],
  ).ok;
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
