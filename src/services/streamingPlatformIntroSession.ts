const PLAYED_INTROS_KEY = "aetherio.streaming-platform-intros.v1";

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Claim a platform intro once in the current browser/app session. */
export function claimStreamingPlatformIntro(platformId: string, storage: SessionStorageLike): boolean {
  let playedIds: string[] = [];
  try {
    const stored = storage.getItem(PLAYED_INTROS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed)) {
      playedIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // Recupera de datos corruptos sin impedir que la intro se reproduzca.
  }

  if (playedIds.includes(platformId)) return false;

  try {
    storage.setItem(PLAYED_INTROS_KEY, JSON.stringify([...playedIds, platformId]));
  } catch {
    // Si el storage está bloqueado, preferimos reproducir la intro igualmente.
  }
  return true;
}
