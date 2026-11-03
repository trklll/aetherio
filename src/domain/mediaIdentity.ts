export type MediaKind = "movie" | "series" | "anime";
export type MediaNamespace = "tmdb" | "imdb" | "mal" | "anilist" | "addon" | "legacy";

export interface MediaRef {
  kind: MediaKind;
  namespace: MediaNamespace;
  id: string;
  addonId?: string;
}

export interface EpisodeRef {
  media: MediaRef;
  season?: number;
  episode?: number;
}

export type MediaIdentityErrorCode =
  | "invalid-kind"
  | "invalid-namespace"
  | "invalid-id"
  | "missing-addon-id"
  | "unexpected-addon-id"
  | "invalid-episode-number"
  | "invalid-legacy-input";

export class MediaIdentityError extends Error {
  constructor(public readonly code: MediaIdentityErrorCode) {
    super(`Invalid media identity: ${code}`);
    this.name = "MediaIdentityError";
  }
}

export interface LegacyMediaRefInput {
  type: string;
  id: string;
  addonId?: string;
  /** Provenance is required to interpret an otherwise ambiguous bare id. */
  namespace?: Exclude<MediaNamespace, "addon" | "legacy">;
}

export interface LegacyMediaRefAdapter {
  ref: MediaRef;
  originalType: string;
  originalId: string;
}

export interface VerifiedMediaAlias {
  left: MediaRef;
  right: MediaRef;
  verified: boolean;
  basis: "provider-id-map" | "anime-installment-map";
}

const KNOWN_ID_PREFIXES = new Set(["tmdb", "imdb", "mal", "anilist"]);

export function adaptLegacyMediaRef(input: LegacyMediaRefInput): LegacyMediaRefAdapter {
  if (!input || typeof input !== "object") throw new MediaIdentityError("invalid-legacy-input");
  const originalType = typeof input?.type === "string" ? input.type : "";
  const originalId = typeof input?.id === "string" ? input.id : "";
  const kind = normalizeKind(originalType);
  if (!kind || !originalId.trim()) throw new MediaIdentityError("invalid-legacy-input");

  let ref: MediaRef;
  if (input.addonId !== undefined) {
    if (typeof input.addonId !== "string" || !input.addonId.trim()) throw new MediaIdentityError("missing-addon-id");
    ref = { kind, namespace: "addon", addonId: input.addonId.trim(), id: originalId };
  } else {
    const prefixed = /^([a-z][a-z0-9_-]*):(.*)$/i.exec(originalId);
    const prefix = prefixed?.[1].toLowerCase();
    if (prefixed) {
      if (prefix && KNOWN_ID_PREFIXES.has(prefix)) {
        const namespace = prefix as Exclude<MediaNamespace, "addon" | "legacy">;
        ref = { kind, namespace, id: normalizeProviderId(namespace, prefixed[2]) };
      } else {
        ref = { kind, namespace: "legacy", id: JSON.stringify([originalType, originalId]) };
      }
    } else if (/^tt\d+$/i.test(originalId)) {
      ref = { kind, namespace: "imdb", id: originalId.toLowerCase() };
    } else if (input.namespace) {
      ref = { kind, namespace: input.namespace, id: normalizeProviderId(input.namespace, originalId) };
    } else {
      // Do not guess a provider for bare numeric ids or unknown prefixes.
      ref = { kind, namespace: "legacy", id: JSON.stringify([originalType, originalId]) };
    }
  }

  validateMediaRef(ref);
  return { ref, originalType, originalId };
}

export function mediaRefFromLegacy(input: LegacyMediaRefInput): MediaRef {
  return adaptLegacyMediaRef(input).ref;
}

export function mediaRefKey(ref: MediaRef): string {
  validateMediaRef(ref);
  return JSON.stringify([ref.kind, ref.namespace, ref.addonId ?? "", ref.id]);
}

export function episodeRefKey(ref: EpisodeRef): string {
  if (!ref || typeof ref !== "object") throw new MediaIdentityError("invalid-legacy-input");
  validateMediaRef(ref.media);
  validateEpisodeNumber(ref.season);
  validateEpisodeNumber(ref.episode);
  return JSON.stringify([
    ref.media.kind,
    ref.media.namespace,
    ref.media.addonId ?? "",
    ref.media.id,
    ref.season ?? null,
    ref.episode ?? null,
  ]);
}

export function sameMedia(
  a: MediaRef,
  b: MediaRef,
  aliases: readonly VerifiedMediaAlias[] = [],
): boolean {
  const aKey = mediaRefKey(a);
  const bKey = mediaRefKey(b);
  if (a.kind !== b.kind) return false;
  if (aKey === bKey) return true;
  return aliases.some(alias => {
    if (!alias || alias.verified !== true) return false;
    const leftKey = mediaRefKey(alias.left);
    const rightKey = mediaRefKey(alias.right);
    const matches = (leftKey === aKey && rightKey === bKey) || (leftKey === bKey && rightKey === aKey);
    if (!matches) return false;
    if ((a.kind === "anime" || b.kind === "anime") && alias.basis !== "anime-installment-map") return false;
    return true;
  });
}

function normalizeKind(type: string): MediaKind | null {
  switch (type.trim().toLowerCase()) {
    case "movie": return "movie";
    case "tv":
    case "show":
    case "series": return "series";
    case "anime": return "anime";
    default: return null;
  }
}

function normalizeProviderId(namespace: Exclude<MediaNamespace, "addon" | "legacy">, value: string): string {
  const id = value.trim();
  if (!id) throw new MediaIdentityError("invalid-id");
  if ((namespace === "tmdb" || namespace === "mal" || namespace === "anilist") && !/^[1-9]\d*$/.test(id)) {
    throw new MediaIdentityError("invalid-id");
  }
  if (namespace === "imdb" && !/^tt\d+$/i.test(id)) throw new MediaIdentityError("invalid-id");
  return namespace === "imdb" ? id.toLowerCase() : id;
}

function validateMediaRef(ref: MediaRef): void {
  if (!ref || typeof ref !== "object") throw new MediaIdentityError("invalid-legacy-input");
  if (ref.kind !== "movie" && ref.kind !== "series" && ref.kind !== "anime") {
    throw new MediaIdentityError("invalid-kind");
  }
  if (!["tmdb", "imdb", "mal", "anilist", "addon", "legacy"].includes(ref.namespace)) {
    throw new MediaIdentityError("invalid-namespace");
  }
  if (typeof ref.id !== "string" || !ref.id.trim() || ref.id !== ref.id.trim()) {
    throw new MediaIdentityError("invalid-id");
  }
  if (ref.namespace === "addon") {
    if (typeof ref.addonId !== "string" || !ref.addonId.trim() || ref.addonId !== ref.addonId.trim()) {
      throw new MediaIdentityError("missing-addon-id");
    }
  } else if (ref.addonId !== undefined) {
    throw new MediaIdentityError("unexpected-addon-id");
  }
  if ((ref.namespace === "tmdb" || ref.namespace === "mal" || ref.namespace === "anilist") && !/^[1-9]\d*$/.test(ref.id)) {
    throw new MediaIdentityError("invalid-id");
  }
  if (ref.namespace === "imdb" && !/^tt\d+$/i.test(ref.id)) throw new MediaIdentityError("invalid-id");
}

function validateEpisodeNumber(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new MediaIdentityError("invalid-episode-number");
  }
}
