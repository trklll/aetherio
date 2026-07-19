import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { CloudDownload, RefreshCw, Sparkles, X } from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isAndroidRuntime, isTauriRuntime } from "../../runtime/platform";
import { gsap, tweenTo } from "../../utils/motion";

type UpdateStage = "available" | "downloading" | "installing" | "error";

interface UpdateProgress {
  downloaded: number;
  total?: number;
}

let automaticUpdateCheck: Promise<Update | null> | null = null;

function getAutomaticUpdateCheck() {
  if (!automaticUpdateCheck) {
    automaticUpdateCheck = new Promise(resolve => {
      window.setTimeout(() => {
        void check({ timeout: 30_000 }).then(resolve).catch(error => {
          console.warn("[AETHERIO:UPDATER] automatic check failed", describeError(error));
          resolve(null);
        });
      }, 1_500);
    });
  }
  return automaticUpdateCheck;
}

export default function UpdatePopup() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [stage, setStage] = useState<UpdateStage>("available");
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0 });
  const [errorMessage, setErrorMessage] = useState("");
  const progressRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isTauriRuntime() || isAndroidRuntime()) return;
    let active = true;

    void getAutomaticUpdateCheck().then(availableUpdate => {
      if (!active || !availableUpdate) return;
      setUpdate(availableUpdate);
      window.setTimeout(() => primaryActionRef.current?.focus({ preventScroll: true }), 0);
    });

    return () => {
      active = false;
    };
  }, []);

  const progressRatio = progress.total && progress.total > 0
    ? Math.min(1, progress.downloaded / progress.total)
    : stage === "installing" ? 1 : 0;

  useEffect(() => {
    if (!progressRef.current) return;
    tweenTo(progressRef.current, { width: `${progressRatio * 100}%` }, 0.28);
  }, [progressRatio]);

  useEffect(() => {
    return () => {
      if (progressRef.current) gsap.killTweensOf(progressRef.current);
    };
  }, []);

  useEffect(() => {
    if (!update) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stage === "downloading" || stage === "installing") return;
      event.preventDefault();
      dismissUpdate();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [stage, update]);

  if (!update) return null;

  const busy = stage === "downloading" || stage === "installing";
  const percent = progress.total && progress.total > 0
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null;

  async function installUpdate() {
    if (!update || busy) return;
    setStage("downloading");
    setErrorMessage("");
    setProgress({ downloaded: 0 });

    let downloaded = 0;
    let total: number | undefined;
    try {
      await update.downloadAndInstall(event => {
        if (event.event === "Started") {
          total = event.data.contentLength;
          setProgress({ downloaded, total });
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress({ downloaded, total });
          return;
        }
        setStage("installing");
        setProgress(current => ({ downloaded: current.total ?? current.downloaded, total: current.total }));
      });
      setStage("installing");
      await relaunch();
    } catch (error) {
      setStage("error");
      setErrorMessage(describeError(error));
    }
  }

  function dismissUpdate() {
    if (busy || !update) return;
    const pendingUpdate = update;
    setUpdate(null);
    void pendingUpdate.close().catch(() => undefined);
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) dismissUpdate();
  }

  return (
    <div
      className="aetherio-popup-backdrop"
      role="presentation"
      onMouseDown={handleBackdropClick}
      style={backdropStyle}
    >
      <section
        className="aetherio-popup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aetherio-update-title"
        aria-describedby="aetherio-update-description"
        style={cardStyle}
      >
        <button
          type="button"
          aria-label="Cerrar actualización"
          onClick={dismissUpdate}
          disabled={busy}
          style={{ ...iconButtonStyle, opacity: busy ? 0.35 : 0.72, cursor: busy ? "default" : "pointer" }}
        >
          <X size={18} />
        </button>

        <div style={updateIconStyle} aria-hidden="true">
          <Sparkles size={25} strokeWidth={1.8} />
        </div>

        <div style={{ minWidth: 0 }}>
          <p style={eyebrowStyle}>ACTUALIZACIÓN</p>
          <h2 id="aetherio-update-title" style={titleStyle}>Aetherio {update.version}</h2>
          <p id="aetherio-update-description" style={descriptionStyle}>
            Hay una nueva versión lista para instalar.
          </p>
        </div>

        {update.body?.trim() ? (
          <div style={notesStyle}>{update.body.trim()}</div>
        ) : null}

        {busy || stage === "error" ? (
          <div aria-live="polite" style={{ display: "grid", gap: 9 }}>
            <div style={progressTrackStyle}>
              <div ref={progressRef} style={progressFillStyle} />
            </div>
            <div style={progressLabelStyle}>
              <span>
                {stage === "downloading" ? "Descargando actualización…" : stage === "installing" ? "Instalando y reiniciando…" : "No se pudo actualizar"}
              </span>
              {stage === "downloading" && percent !== null ? <span>{percent}%</span> : null}
            </div>
            {stage === "error" ? <p style={errorStyle}>{errorMessage}</p> : null}
          </div>
        ) : null}

        <div style={actionsStyle}>
          <button
            type="button"
            onClick={dismissUpdate}
            disabled={busy}
            style={{ ...secondaryButtonStyle, opacity: busy ? 0.45 : 1 }}
          >
            Ahora no
          </button>
          <button
            ref={primaryActionRef}
            type="button"
            onClick={() => void installUpdate()}
            disabled={busy}
            style={{ ...primaryButtonStyle, opacity: busy ? 0.72 : 1 }}
          >
            {stage === "error" ? <RefreshCw size={17} /> : <CloudDownload size={18} />}
            {stage === "error" ? "Reintentar" : busy ? "Actualizando…" : "Actualizar ahora"}
          </button>
        </div>
      </section>
    </div>
  );
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Ocurrió un error inesperado al instalar la actualización.";
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 5000,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "rgba(4, 4, 5, 0.68)",
  backdropFilter: "blur(16px) saturate(130%)",
  WebkitBackdropFilter: "blur(16px) saturate(130%)",
};

const cardStyle: CSSProperties = {
  position: "relative",
  width: "min(520px, calc(100vw - 48px))",
  maxHeight: "min(660px, calc(100vh - 48px))",
  overflowY: "auto",
  display: "grid",
  gap: 18,
  padding: "30px 30px 26px",
  borderRadius: 28,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  background: "linear-gradient(145deg, rgba(50, 50, 53, 0.96), rgba(24, 24, 26, 0.98))",
  boxShadow: "0 34px 100px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  color: "#fff",
};

const iconButtonStyle: CSSProperties = {
  position: "absolute",
  top: 18,
  right: 18,
  width: 34,
  height: 34,
  display: "grid",
  placeItems: "center",
  border: "none",
  borderRadius: 999,
  background: "rgba(255, 255, 255, 0.07)",
  color: "#fff",
};

const updateIconStyle: CSSProperties = {
  width: 52,
  height: 52,
  display: "grid",
  placeItems: "center",
  borderRadius: 17,
  color: "#f4f4f5",
  background: "linear-gradient(145deg, rgba(255,255,255,0.17), rgba(255,255,255,0.055))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.24)",
};

const eyebrowStyle: CSSProperties = {
  margin: "0 0 7px",
  color: "rgba(255,255,255,0.48)",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.16em",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 27,
  lineHeight: 1.12,
  letterSpacing: "-0.035em",
};

const descriptionStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "rgba(255,255,255,0.62)",
  fontSize: 14,
  lineHeight: 1.5,
};

const notesStyle: CSSProperties = {
  maxHeight: 190,
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  padding: "14px 16px",
  borderRadius: 17,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.035)",
  color: "rgba(255,255,255,0.72)",
  fontSize: 13,
  lineHeight: 1.55,
};

const progressTrackStyle: CSSProperties = {
  height: 7,
  overflow: "hidden",
  borderRadius: 999,
  background: "rgba(255,255,255,0.09)",
};

const progressFillStyle: CSSProperties = {
  width: 0,
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #f4f4f5, #a1a1aa)",
};

const progressLabelStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  color: "rgba(255,255,255,0.58)",
  fontSize: 12,
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#fca5a5",
  fontSize: 12,
  lineHeight: 1.45,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 2,
};

const actionButtonStyle: CSSProperties = {
  minHeight: 42,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "0 17px",
  borderRadius: 13,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.045)",
  color: "rgba(255,255,255,0.72)",
};

const primaryButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  border: "1px solid rgba(255,255,255,0.86)",
  background: "#f4f4f5",
  color: "#18181b",
  boxShadow: "0 9px 24px rgba(0,0,0,0.28)",
};
