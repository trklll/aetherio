import { useEffect, useState } from "react";
import {
  GDRIVE_AUTH_CHANGED_EVENT,
  GDRIVE_SYNC_CHANGED_EVENT,
  getGoogleDriveAuthSnapshot,
  type GoogleDriveSyncSnapshot,
} from "../gdrive";

/**
 * Estado del respaldo en Google Drive para la UI (indicador junto al perfil).
 * Reacciona a cambios de auth, de progreso de sync y de otras ventanas.
 */
export function useGoogleDriveSyncStatus(): GoogleDriveSyncSnapshot {
  const [snapshot, setSnapshot] = useState<GoogleDriveSyncSnapshot>(() => getGoogleDriveAuthSnapshot());

  useEffect(() => {
    const refresh = () => setSnapshot(getGoogleDriveAuthSnapshot());
    refresh();
    window.addEventListener(GDRIVE_AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(GDRIVE_SYNC_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(GDRIVE_AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(GDRIVE_SYNC_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return snapshot;
}
