import { useEffect, useState } from "react";

export const DOWNLOADS_ENABLED_STORAGE_KEY = "aetherio-downloads-enabled";
export const DOWNLOADS_ENABLED_CHANGED_EVENT = "aetherio-downloads-enabled-changed";

export function getDownloadsEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined"
      && localStorage.getItem(DOWNLOADS_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveDownloadsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(DOWNLOADS_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Mantener la preferencia usable aunque el almacenamiento no esté disponible.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<boolean>(DOWNLOADS_ENABLED_CHANGED_EVENT, { detail: enabled }));
  }
}

export function useDownloadsEnabled() {
  const [enabled, setEnabled] = useState(getDownloadsEnabled);

  useEffect(() => {
    const refresh = () => setEnabled(getDownloadsEnabled());
    window.addEventListener(DOWNLOADS_ENABLED_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(DOWNLOADS_ENABLED_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return enabled;
}
