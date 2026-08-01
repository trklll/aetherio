const sourceLogoUrls = import.meta.glob("../assets/logosaddons/*.{png,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const SOURCE_LOGO_MAP: Record<string, string> = {};
for (const [path, url] of Object.entries(sourceLogoUrls)) {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  const cleanKey = name
    .replace(/-(logo|png)\.[a-z]+$/, "")
    .replace(/-png$/, "")
    .toLowerCase();
  SOURCE_LOGO_MAP[cleanKey] = String(url);

  const noHyphenKey = cleanKey.replace(/-/g, "");
  if (noHyphenKey !== cleanKey) {
    SOURCE_LOGO_MAP[noHyphenKey] = String(url);
  }
}

export function getSourceLogo(sourceName: string): string | null {
  const key = sourceName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SOURCE_LOGO_MAP[key]) return SOURCE_LOGO_MAP[key];
  if (key === "nyaasi" && SOURCE_LOGO_MAP.nyaa) return SOURCE_LOGO_MAP.nyaa;
  return SOURCE_LOGO_MAP[sourceName.toLowerCase()] ?? null;
}
