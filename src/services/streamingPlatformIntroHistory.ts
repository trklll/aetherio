const playedHistoryEntries = new Set<string>();
const MAX_TRACKED_ENTRIES = 128;

/** Play an intro only once for a platform's specific router history entry. */
export function shouldPlayPlatformIntroForEntry(
  platformId: string,
  entryKey: string,
  enabled: boolean,
): boolean {
  if (!enabled || !platformId || !entryKey) return false;
  const key = `${entryKey}:${platformId}`;
  if (playedHistoryEntries.has(key)) return false;
  playedHistoryEntries.add(key);
  if (playedHistoryEntries.size > MAX_TRACKED_ENTRIES) {
    const oldest = playedHistoryEntries.values().next().value;
    if (oldest) playedHistoryEntries.delete(oldest);
  }
  return true;
}
