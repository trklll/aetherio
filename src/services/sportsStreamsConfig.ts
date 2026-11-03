import { publicSportsHttps } from "./fmhySportsHttp.ts";

export const SPORTS_STREAMS_ADDON_ID = "community.sports.fly";
export const SPORTS_STREAMS_PROVIDER_ID = "sports-streams";

/** Configuration paths can contain a personal free-user identifier: never log them. */
export function normalizeSportsStreamsManifestUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = publicSportsHttps(value.trim());
  if (!url || url.search || url.hash) return null;
  url.pathname = `${url.pathname.replace(/\/manifest\.json\/?$/, "").replace(/\/+$/, "")}/manifest.json`;
  return url.toString();
}

export function configuredSportsStreamsManifestUrl(): string {
  return normalizeSportsStreamsManifestUrl(import.meta.env.VITE_SPORTS_STREAMS_MANIFEST_URL)
    ?? "https://sports.highfly.to/manifest.json";
}
