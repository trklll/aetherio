import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "./BackButton";
import FloatingActionButton from "./FloatingActionButton";
import TopNav from "./TopNav";
import { Maximize } from "lucide-react";
import { toggleWindowFullscreen } from "../../utils/windowControls";
import { isAndroidRuntime, isWindowFullscreen, listenPlatformEvent, stopNativePlayback } from "../../runtime/platform";
import { tweenTo } from "../../utils/motion";

export default function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const isPlayer = loc.pathname === "/player";
  const isEpisodePage = loc.pathname === "/episode" || loc.pathname === "/streams";
  const isDetailPage = loc.pathname.startsWith("/detail/");
  const isPersonPage = loc.pathname.startsWith("/person/");
  const hideNav = isPlayer || isEpisodePage;
  const scrollRef = useRef<HTMLDivElement>(null);
  const backChromeRef = useRef<HTMLDivElement>(null);
  const actionChromeRef = useRef<HTMLDivElement>(null);
  const mouseBackAtRef = useRef(0);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(true);
  const [playerTransparent, setPlayerTransparent] = useState(false);
  const showBack = isEpisodePage || isPlayer || isDetailPage || isPersonPage;
  const chromeVisible = isPlayer ? playerChromeVisible : true;
  const androidRuntime = isAndroidRuntime();

  useEffect(() => {
    tweenTo([backChromeRef.current, actionChromeRef.current], { opacity: chromeVisible ? 1 : 0 }, 0.3);
  }, [chromeVisible]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!isPlayer) {
      setPlayerChromeVisible(true);
      setPlayerTransparent(false);
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
    if (!isPlayer) return;

    function handlePlayerTransparency(event: Event) {
      const detail = (event as CustomEvent<{ transparent?: boolean }>).detail;
      setPlayerTransparent(detail?.transparent === true);
    }

    window.addEventListener("aetherio-player-transparency", handlePlayerTransparency);
    return () => window.removeEventListener("aetherio-player-transparency", handlePlayerTransparency);
  }, [isPlayer]);

  useEffect(() => {
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
          if (await isWindowFullscreen()) {
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

  useEffect(() => {
    let disposed = false;
    const unlistenPromise = listenPlatformEvent("aetherio-mouse-back", () => {
      if (!disposed) goBack();
    });

    return () => {
      disposed = true;
      void unlistenPromise.then(unlisten => unlisten());
    };
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    function handleMouseNavigation(event: MouseEvent) {
      if (event.button !== 3) return;
      event.preventDefault();
      event.stopPropagation();

      const now = Date.now();
      if (now - mouseBackAtRef.current < 350) return;
      mouseBackAtRef.current = now;
      goBack();
    }

    window.addEventListener("mousedown", handleMouseNavigation, true);
    window.addEventListener("mouseup", handleMouseNavigation, true);
    window.addEventListener("auxclick", handleMouseNavigation, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseNavigation, true);
      window.removeEventListener("mouseup", handleMouseNavigation, true);
      window.removeEventListener("auxclick", handleMouseNavigation, true);
    };
  }, [loc.pathname, loc.search]);

  function goBack() {
    if (isDetailPage) {
      const params = new URLSearchParams(loc.search);
      const searchPath = getSearchReturnPath(params);
      if (searchPath) {
        navigate(searchPath, { replace: true });
        return;
      }
      navigate("/home", { replace: true });
      return;
    }

    if (isEpisodePage) {
      const params = new URLSearchParams(loc.search);
      const type = params.get("type");
      const id = params.get("id");
      if (type && id) {
        const detailParams = new URLSearchParams({ fromStreams: "1" });
        if (params.get("fromSearch") === "1") {
          detailParams.set("fromSearch", "1");
          const searchQuery = params.get("q");
          if (searchQuery) detailParams.set("q", searchQuery);
        }
        navigate(`/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}?${detailParams.toString()}`, { replace: true });
        return;
      }
      navigate(-1);
      return;
    }

    if (loc.pathname === "/player") {
      const params = new URLSearchParams(loc.search);
      const type = params.get("type");
      const id = params.get("id");
      const season = params.get("season");
      const episode = params.get("ep");
      const streamParams = type && id ? new URLSearchParams({ type, id }) : null;
      if (streamParams && season) streamParams.set("season", season);
      if (streamParams && episode) streamParams.set("ep", episode);
      if (streamParams && params.get("fromSearch") === "1") {
        streamParams.set("fromSearch", "1");
        const searchQuery = params.get("q");
        if (searchQuery) streamParams.set("q", searchQuery);
      }
      if (streamParams) streamParams.set("fromPlayer", "1");
      const streamsPath = streamParams ? `/episode?${streamParams.toString()}` : null;
      void stopNativePlayback()
        .finally(() => {
          if (streamsPath) {
            navigate(streamsPath, { replace: true });
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
        background: isPlayer && playerTransparent ? "transparent" : isPlayer ? "#000" : "#1f1f1f",
        color: "#fff",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 z-50"
        style={{ height: "var(--app-shell-nav-height)", paddingTop: "var(--app-safe-top)" }}
        data-tauri-drag-region
      >
        {showBack && (
          <div
            ref={backChromeRef}
            className="absolute"
            style={{
              left: "var(--app-safe-x)",
              top: "var(--app-safe-top)",
              opacity: 1,
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
          ref={actionChromeRef}
          className="absolute"
          style={{
            right: "var(--app-safe-x)",
            top: "var(--app-safe-top)",
            opacity: 1,
            pointerEvents: chromeVisible ? "auto" : "none",
          }}
        >
          {!androidRuntime && (!isPlayer || showBack) && (
            <FloatingActionButton
              onClick={toggleWindowFullscreen}
              title="Pantalla completa"
              icon={<Maximize size={18} />}
              animateOnClick
            />
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        data-aetherio-scroll-shell
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

function getSearchReturnPath(params: URLSearchParams) {
  if (params.get("fromSearch") !== "1") return null;
  const query = params.get("q")?.trim();
  return query ? `/search?q=${encodeURIComponent(query)}` : "/search";
}
