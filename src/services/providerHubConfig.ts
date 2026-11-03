const configuredHubBase = (import.meta.env.VITE_PROVIDER_HUB_URL as string | undefined)?.trim();

export const PROVIDER_HUB_BASE_URL = (configuredHubBase || "https://aetherio-provider-hub.xoolinnbeats.workers.dev")
  .replace(/\/+$/, "");

export const PROVIDER_HUB_MANIFEST_URL = `${PROVIDER_HUB_BASE_URL}/manifest.json`;
export const PROVIDER_HUB_ADDONS_URL = `${PROVIDER_HUB_BASE_URL}/addons.json`;
