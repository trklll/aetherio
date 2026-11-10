export type LibraryTab = "library" | "discover" | "downloads";

export function readLibraryTab(search: string): LibraryTab | null {
  const value = new URLSearchParams(search).get("tab");
  if (value === "library" || value === "discover") return value;
  if (value === "downloads" || value === "offline") return "downloads";
  return null;
}

export function stepLibraryTab(
  current: LibraryTab,
  direction: -1 | 1,
  downloadsEnabled: boolean,
): LibraryTab {
  const tabs: LibraryTab[] = downloadsEnabled
    ? ["library", "discover", "downloads"]
    : ["library", "discover"];
  const index = tabs.indexOf(current);
  const currentIndex = index >= 0 ? index : 0;
  return tabs[(currentIndex + direction + tabs.length) % tabs.length];
}

export function writeLibraryTabSearch(search: string, tab: LibraryTab): string {
  const params = new URLSearchParams(search);
  if (tab === "downloads") params.set("tab", "downloads");
  else params.delete("tab");
  const value = params.toString();
  return value ? `?${value}` : "";
}
