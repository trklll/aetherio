import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Cloud, LogIn, RefreshCw, Unlink } from "lucide-react";
import { connectAniListAccount, getAniListAccessToken } from "../../auth/authClient";
import {
  ANILIST_LIBRARY_CHANGED_EVENT,
  syncAniListLibrary,
} from "../../integrations/aniList";
import {
  disconnectGoogleDrive,
  getGoogleDriveAuthSnapshot,
  GDRIVE_AUTH_CHANGED_EVENT,
  GDRIVE_SYNC_CHANGED_EVENT,
  startGoogleDriveAuthorization,
  syncGoogleDriveNow,
} from "../../gdrive";
import TraktImportCard from "./TraktImportCard";

export default function LibrarySyncSettings({ renderIntegration }: { renderIntegration?: (props: { title: string; description: string; children: ReactNode }) => ReactNode } = {}) {
  const Card = renderIntegration ?? IntegrationCard;
  const [aniListConnected, setAniListConnected] = useState(false);
  const [aniListBusy, setAniListBusy] = useState(false);
  const [aniListMessage, setAniListMessage] = useState("");
  const [aniListError, setAniListError] = useState("");
  const [googleDrive, setGoogleDrive] = useState(() => getGoogleDriveAuthSnapshot());
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMessage, setGoogleMessage] = useState("");
  const [googleError, setGoogleError] = useState("");

  const refreshAniList = useCallback(async () => {
    setAniListConnected(Boolean(await getAniListAccessToken()));
  }, []);

  useEffect(() => {
    void refreshAniList();
    window.addEventListener(ANILIST_LIBRARY_CHANGED_EVENT, refreshAniList);
    window.addEventListener("storage", refreshAniList);
    return () => {
      window.removeEventListener(ANILIST_LIBRARY_CHANGED_EVENT, refreshAniList);
      window.removeEventListener("storage", refreshAniList);
    };
  }, [refreshAniList]);

  useEffect(() => {
    const refresh = () => setGoogleDrive(getGoogleDriveAuthSnapshot());
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

  async function connectAniList() {
    setAniListBusy(true);
    setAniListError("");
    setAniListMessage("");
    try {
      await connectAniListAccount();
      await refreshAniList();
      setAniListMessage("Conexión con AniList iniciada. Completa la autorización si se abrió el navegador.");
    } catch (error) {
      setAniListError(errorMessage(error, "No se pudo conectar AniList."));
    } finally {
      setAniListBusy(false);
    }
  }

  async function syncAniList() {
    setAniListBusy(true);
    setAniListError("");
    setAniListMessage("");
    try {
      const entries = await syncAniListLibrary();
      setAniListMessage(`Biblioteca de AniList sincronizada: ${entries.length} títulos.`);
    } catch (error) {
      setAniListError(errorMessage(error, "No se pudo sincronizar AniList."));
    } finally {
      setAniListBusy(false);
      await refreshAniList();
    }
  }

  async function connectGoogleDrive() {
    setGoogleBusy(true);
    setGoogleError("");
    setGoogleMessage("");
    try {
      await startGoogleDriveAuthorization();
      setGoogleDrive(getGoogleDriveAuthSnapshot());
      setGoogleMessage("Autoriza Aetherio en Google. Volverás automáticamente a la app.");
    } catch (error) {
      setGoogleError(errorMessage(error, "No se pudo conectar Google Drive."));
    } finally {
      setGoogleBusy(false);
    }
  }

  async function syncGoogleDrive() {
    setGoogleBusy(true);
    setGoogleError("");
    setGoogleMessage("");
    try {
      await syncGoogleDriveNow();
      const snapshot = getGoogleDriveAuthSnapshot();
      setGoogleDrive(snapshot);
      if (snapshot.lastError) {
        setGoogleError(snapshot.lastError);
      } else {
        setGoogleMessage("Sincronización de Google Drive completada.");
      }
    } catch (error) {
      setGoogleError(errorMessage(error, "No se pudo sincronizar Google Drive."));
    } finally {
      setGoogleBusy(false);
    }
  }

  function disconnectDrive() {
    setGoogleBusy(true);
    setGoogleError("");
    try {
      disconnectGoogleDrive();
      setGoogleDrive(getGoogleDriveAuthSnapshot());
      setGoogleMessage("Google Drive desconectado. El respaldo existente se conserva.");
    } catch (error) {
      setGoogleError(errorMessage(error, "No se pudo desconectar Google Drive."));
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Card
        title="AniList"
        description={aniListConnected
          ? "Cuenta conectada. Sincroniza tu lista de anime para actualizar la Biblioteca."
          : "Conecta AniList y sincroniza tu lista de anime con la Biblioteca de Aetherio."}
      >
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => void connectAniList()} disabled={aniListBusy} icon={<LogIn size={16} />}>
            {aniListConnected ? "Reconectar AniList" : "Conectar AniList"}
          </ActionButton>
          <ActionButton onClick={() => void syncAniList()} disabled={aniListBusy || !aniListConnected} icon={<RefreshCw size={16} />}>
            {aniListBusy ? "Sincronizando…" : "Sincronizar ahora"}
          </ActionButton>
        </div>
        <Feedback message={aniListMessage} error={aniListError} />
      </Card>

      <Card
        title="Google Drive"
        description={googleDrive.connected
          ? googleDrive.syncing
            ? "Sincronizando con Google Drive…"
            : googleDrive.lastError
              ? `Último error: ${googleDrive.lastError}`
              : googleDrive.lastSyncedAt
                ? `Última sincronización: ${new Date(googleDrive.lastSyncedAt).toLocaleString()}. La sincronización también es automática.`
                : "Respaldo y sincronización automática activos para este perfil."
          : googleDrive.authorizationPending
            ? "Termina la autorización en Google o vuelve a conectarlo."
            : googleDrive.credentialsConfigured
              ? "Respalda la Biblioteca y el progreso en tu Google Drive privado."
              : "Google Drive no está configurado en esta versión de Aetherio."}
      >
        <div className="flex flex-wrap gap-2">
          {googleDrive.connected ? (
            <ActionButton onClick={disconnectDrive} disabled={googleBusy} icon={<Unlink size={16} />}>Desconectar</ActionButton>
          ) : (
            <ActionButton onClick={() => void connectGoogleDrive()} disabled={googleBusy || !googleDrive.credentialsConfigured} icon={<Cloud size={16} />}>
              {googleDrive.authorizationPending ? "Reabrir Google" : "Conectar Google Drive"}
            </ActionButton>
          )}
          <ActionButton onClick={() => void syncGoogleDrive()} disabled={googleBusy || !googleDrive.connected} icon={<RefreshCw size={16} />}>
            {googleBusy ? "Sincronizando…" : "Sincronizar ahora"}
          </ActionButton>
        </div>
        <Feedback message={googleMessage} error={googleError} />
      </Card>

      {renderIntegration ? <Card title="Trakt" description="Importa o reimporta tu biblioteca, historial y progreso desde una exportación de Trakt."><TraktImportCard alwaysVisible /></Card> : <TraktImportCard alwaysVisible />}
    </div>
  );
}

function IntegrationCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="liquid-glass grid gap-3 rounded-2xl border border-white/10 p-5">
      <div>
        <h2 className="text-base font-black text-white">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-white/58">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ActionButton({ children, icon, disabled, onClick }: {
  children: ReactNode;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-black transition-colors hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {children}
    </button>
  );
}

function Feedback({ message, error }: { message: string; error: string }) {
  if (!message && !error) return null;
  return <p className={`text-sm ${error ? "font-semibold text-red-300" : "text-white/60"}`} role="status">{error || message}</p>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
