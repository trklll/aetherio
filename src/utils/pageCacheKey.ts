export function pageCacheKey(pathname: string, search: string): string {
  if (pathname === "/settings") return pathname;

  if (pathname === "/library") {
    const params = new URLSearchParams(search);
    params.delete("tab");
    const remainingSearch = params.toString();
    return remainingSearch ? `${pathname}?${remainingSearch}` : pathname;
  }

  return `${pathname}${search}`;
}
