import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BackButton from "./BackButton";
import FloatingActionButton from "./FloatingActionButton";
import TopNav from "./TopNav";
import { Maximize } from "lucide-react";
import { toggleWindowFullscreen } from "../../utils/windowControls";

export default function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const isPlayer = loc.pathname === "/player";
  const hideNav = isPlayer || loc.pathname === "/streams";
  const transparentShell = isPlayer;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(true);
  const showBack = loc.pathname === "/streams" || isPlayer;
  const chromeVisible = isPlayer ? playerChromeVisible : true;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!isPlayer) {
      setPlayerChromeVisible(true);
      return;
    }

    function handlePlayerControls(event: Event) {
      const detail = (event as CustomEvent<{ visible?: boolean }>).detail;
      setPlayerChromeVisible(detail?.visible !== false);
    }

    window.addEventListener("aetherio-player-controls", handlePlayerControls);
    return () => window.removeEventListener("aetherio-player-controls", handlePlayerControls);
  }, [isPlayer]);

  useEffect(() => {
    const win = getCurrentWindow();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void toggleWindowFullscreen();
        return;
      }

      const isEscape = event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
      if (!isEscape) return;

      void (async () => {
        try {
          if (await win.isFullscreen()) {
            event.preventDefault();
            await toggleWindowFullscreen();
          }
        } catch {
          // Keyboard fullscreen controls are best-effort outside Tauri runtime.
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  function goBack() {
    if (loc.pathname === "/player") {
      const params = new URLSearchParams(loc.search);
      const type = params.get("type");
      const id = params.get("id");
      const detailPath = type && id ? `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}` : null;
      void invoke("stop_mpv")
        .catch(() => undefined)
        .finally(() => {
          if (detailPath) {
            navigate(detailPath, { replace: true });
            return;
          }
          navigate(-1);
        });
      return;
    }
    navigate(-1);
  }

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        background: transparentShell ? "transparent" : "#1f1f1f",
        color: "#fff",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 z-50"
        style={{ height: "var(--app-shell-nav-height)", paddingTop: "var(--app-safe-top)" }}
      >
        {showBack && (
          <div
            className="absolute transition-opacity duration-300"
            style={{
              left: "var(--app-safe-x)",
              top: "var(--app-safe-top)",
              opacity: chromeVisible ? 1 : 0,
              pointerEvents: chromeVisible ? "auto" : "none",
            }}
          >
            <BackButton onClick={goBack} />
          </div>
        )}

        {!hideNav && (
          <div
            className="absolute left-1/2 flex -translate-x-1/2 justify-center overflow-visible"
            style={{ top: "var(--app-safe-top)", maxWidth: "calc(100vw - (var(--app-safe-x) * 2) - 96px)" }}
          >
            <TopNav />
          </div>
        )}

        <div
          className="absolute transition-opacity duration-300"
          style={{
            right: "var(--app-safe-x)",
            top: "var(--app-safe-top)",
            opacity: chromeVisible ? 1 : 0,
            pointerEvents: chromeVisible ? "auto" : "none",
          }}
        >
          {(!isPlayer || showBack) && (
            <FloatingActionButton
              onClick={toggleWindowFullscreen}
              title="Pantalla completa"
              icon={<Maximize size={18} />}
            />
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          height: "100%",
          width: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          paddingTop: hideNav ? 0 : "var(--app-shell-nav-height)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
