export interface AddonStreamNameFilter {
  mode: "include" | "exclude";
  prefixes: string[];
}

/** Upstream source name is authoritative; titles can mention unrelated sites. */
export function matchesAddonStreamFilter(
  stream: { name?: unknown; [key: string]: unknown },
  filter?: AddonStreamNameFilter,
): boolean {
  if (!filter) return true;
  const name = typeof stream?.name === "string" ? stream.name.trim().toLowerCase() : "";
  const matches = filter.prefixes.some(prefix => {
    const normalized = prefix.trim().toLowerCase();
    return name.startsWith(normalized) && !/[a-z0-9]/i.test(name.charAt(normalized.length));
  });
  return filter.mode === "include" ? matches : !matches;
}
