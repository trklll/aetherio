import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "../../runtime/platform";
import { gsap, prefersReducedMotion, tweenTo } from "../../utils/motion";
import "./UpdatePopup.css";

type UpdateStage = "available" | "downloading" | "installing" | "error";

function animateActionFocus(button: HTMLButtonElement, focused: boolean) {
  gsap.killTweensOf(button);
  if (prefersReducedMotion()) {
    gsap.set(button, { scale: 1, y: 0 });
    return;
  }
  gsap.to(button, {
    scale: focused ? 1.09 : 1,
    y: focused ? -4 : 0,
    duration: focused ? 0.38 : 0.24,
    ease: focused ? "back.out(2.4)" : "power3.out",
    overwrite: "auto",
  });
}

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
  const [isClosing, setIsClosing] = useState(false);
  const isClosingRef = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const closeAnimationRef = useRef<gsap.core.Timeline | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
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
      closeAnimationRef.current?.kill();
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
    if (busy || !update || isClosingRef.current) return;
    const pendingUpdate = update;
    if (prefersReducedMotion() || !backdropRef.current || !cardRef.current) {
      setUpdate(null);
      void pendingUpdate.close().catch(() => undefined);
      return;
    }

    isClosingRef.current = true;
    setIsClosing(true);
    closeAnimationRef.current = gsap.timeline({
      onComplete: () => {
        setUpdate(null);
        isClosingRef.current = false;
        setIsClosing(false);
        void pendingUpdate.close().catch(() => undefined);
      },
    })
      .to(cardRef.current, { opacity: 0, y: 18, scale: 0.94, duration: 0.24, ease: "power2.in" })
      .to(backdropRef.current, { opacity: 0, duration: 0.2, ease: "power1.in" }, "<0.04");
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) dismissUpdate();
  }

  return (
    <div
      ref={backdropRef}
      className="aetherio-popup-backdrop"
      role="presentation"
      onMouseDown={handleBackdropClick}
      style={backdropStyle}
    >
      <section
        ref={cardRef}
        className="aetherio-popup-card"
        role="dialog"
        aria-modal="true"
        data-spatial-modal
        aria-labelledby="aetherio-update-title"
        aria-describedby="aetherio-update-description"
        style={cardStyle}
      >
        <div style={{ minWidth: 0 }}>
          <h2 id="aetherio-update-title" style={titleStyle}>Aetherio {update.version}</h2>
          <p id="aetherio-update-description" style={descriptionStyle}>
            Hay una nueva versión lista para instalar.
          </p>
        </div>

        {update.body?.trim() ? (
          <div className="aetherio-popup-notes" style={notesStyle}>{update.body.trim()}</div>
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
            ref={primaryActionRef}
            type="button"
            onClick={() => void installUpdate()}
            disabled={busy || isClosing}
            className="aetherio-popup-action aetherio-popup-action--primary"
            style={{ ...primaryButtonStyle, opacity: busy ? 0.72 : 1 }}
            onFocus={event => animateActionFocus(event.currentTarget, true)}
            onBlur={event => animateActionFocus(event.currentTarget, false)}
          >
            {stage === "error" ? "Reintentar" : busy ? "Actualizando…" : "Actualizar ahora"}
          </button>
          <button
            type="button"
            onClick={dismissUpdate}
            disabled={busy || isClosing}
            className="aetherio-popup-action aetherio-popup-action--secondary"
            style={{ ...secondaryButtonStyle, opacity: busy ? 0.45 : 1 }}
            onFocus={event => animateActionFocus(event.currentTarget, true)}
            onBlur={event => animateActionFocus(event.currentTarget, false)}
          >
            Ahora no
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
  background: "rgba(0, 0, 0, 0.12)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
};

const cardStyle: CSSProperties = {
  position: "relative",
  width: "min(360px, calc(100vw - 40px))",
  minHeight: "min(300px, 76dvh, calc(100dvh - 40px))",
  maxHeight: "min(76dvh, calc(100dvh - 40px))",
  overflowY: "auto",
  display: "grid",
  alignContent: "space-between",
  gap: 20,
  padding: "24px 18px",
  borderRadius: 24,
  border: "1px solid rgba(255, 255, 255, 0.14)",
  background: "#2c2c2e",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
  color: "#fff",
};

const titleStyle: CSSProperties = {
  margin: "2px 6px 10px",
  fontSize: 22,
  lineHeight: 1.3,
  fontWeight: 700,
};

const descriptionStyle: CSSProperties = {
  margin: "0 6px 18px",
  color: "rgba(255,255,255,0.82)",
  fontSize: 16,
  lineHeight: 1.5,
  fontWeight: 500,
};

const notesStyle: CSSProperties = {
  maxHeight: "min(24dvh, 190px)",
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  margin: "0 6px 18px",
  color: "rgba(255,255,255,0.78)",
  fontSize: 15,
  lineHeight: 1.5,
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
  margin: "8px 6px 18px",
  color: "rgba(255,255,255,0.76)",
  fontSize: 14,
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#fca5a5",
  fontSize: 12,
  lineHeight: 1.45,
};

const actionsStyle: CSSProperties = {
  display: "grid",
  gap: 20,
  marginTop: 2,
};

const actionButtonStyle: CSSProperties = {
  width: "82%",
  justifySelf: "center",
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: 999,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  border: "none",
  background: "#e04444",
  color: "#fff",
};

const primaryButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  border: "none",
  background: "#087cff",
  color: "#fff",
  boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
};
