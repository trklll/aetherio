import { useEffect, useState } from "react";
import { EXPERIENCE_SCOPE_CHANGED_EVENT, getScopedStorageKey } from "../utils/localProfiles";

export function useDismissedIntegrationBanner(storageKey: string) {
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));

  useEffect(() => {
    const refresh = () => setDismissed(readDismissed(storageKey));
    window.addEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [storageKey]);

  function dismiss() {
    try {
      localStorage.setItem(getScopedStorageKey(storageKey), "1");
      setDismissed(true);
    } catch {
      // Keep the banner visible when persistence fails.
    }
  }

  return { dismissed, dismiss };
}

function readDismissed(storageKey: string) {
  try {
    return localStorage.getItem(getScopedStorageKey(storageKey)) === "1";
  } catch {
    return false;
  }
}
