export function buildManifest(
  hubVersion: string,
  enabled: Array<{ id: string; name: string; description?: string; logo?: string; supportedTypes: string[]; contentLanguage?: string[]; enabled?: boolean }>,
) {
  return {
    // Campos que exige el protocolo de fuentes de Aetherio móvil.
    id: "com.aetherio.hub",
    name: "Aetherio Provider Hub",
    version: hubVersion,
    description: "Fuentes predeterminadas administradas para Aetherio (móvil y PC).",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    // Campos que consume el runtime de proveedores de Aetherio PC.
    scrapers: enabled.map(provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description ?? "",
      ...(provider.logo ? { logo: provider.logo } : {}),
      filename: `/scripts/${provider.id}.js`,
      enabled: provider.enabled !== false,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage ?? [],
      supportsExternalPlayer: true,
    })),
  };
}
