export function resolveEpisodeFocusKey(
  lastFocusedKey: string,
  resumeKey: string,
  availableKeys: readonly string[],
) {
  const available = new Set(availableKeys);
  if (lastFocusedKey && available.has(lastFocusedKey)) return lastFocusedKey;
  if (resumeKey && available.has(resumeKey)) return resumeKey;
  return availableKeys[0] ?? "";
}
