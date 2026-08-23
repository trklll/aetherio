import { useAddonStore } from "../store/addonStore.ts";

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

function getAddonLogoBySourceName(sourceName: string): string | null {
  try {
    const addons = useAddonStore.getState()?.addons ?? [];
    const norm = sourceName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!norm) return null;
    for (const addon of addons) {
      const nameNorm = String(addon.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const idNorm = String(addon.id ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (nameNorm && nameNorm === norm) return addon.logo ?? addon.manifest?.logo ?? null;
      if (idNorm && idNorm === norm) return addon.logo ?? addon.manifest?.logo ?? null;
    }
    for (const addon of addons) {
      const nameNorm = String(addon.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const logo = addon.logo ?? addon.manifest?.logo;
      if (!logo || !nameNorm) continue;
      if (norm.includes(nameNorm) || nameNorm.includes(norm)) return logo;
    }
  } catch {
    // store not available (SSR / tests)
  }
  return null;
}

export function getSourceLogo(sourceName: string): string | null {
  const key = sourceName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SOURCE_LOGO_MAP[key]) return SOURCE_LOGO_MAP[key];
  if (key === "nyaasi" && SOURCE_LOGO_MAP.nyaa) return SOURCE_LOGO_MAP.nyaa;
  const direct = SOURCE_LOGO_MAP[sourceName.toLowerCase()];
  if (direct) return direct;
  // Fallback: any addon (including user custom) that exposes logo in manifest
  return getAddonLogoBySourceName(sourceName);
}

export function getStreamAddonLogo(stream: { addonId?: string; addonName?: string }): string | null {
  try {
    const addons: any[] = useAddonStore.getState()?.addons ?? [];
    if (!addons.length) return null;
    const addonId = stream.addonId?.trim();
    const addonName = stream.addonName?.trim();
    if (addonId) {
      const byId = addons.find(a => a.id === addonId);
      if (byId) return byId.logo ?? byId.manifest?.logo ?? null;
    }
    if (addonName) {
      const byName = addons.find(a => a.name.toLowerCase() === addonName.toLowerCase());
      if (byName) return byName.logo ?? byName.manifest?.logo ?? null;
      // normalized fallback
      const norm = addonName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const byNorm = addons.find(a => String(a.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === norm);
      if (byNorm) return byNorm.logo ?? byNorm.manifest?.logo ?? null;
    }
    // final fallback: reuse sourceName resolver
    if (addonName) return getAddonLogoBySourceName(addonName);
  } catch {
    return null;
  }
  return null;
}
