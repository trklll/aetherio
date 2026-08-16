import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "./BackButton";
import TopNav from "./TopNav";
import WindowControls from "./WindowControls";
import { toggleWindowFullscreen } from "../../utils/windowControls";
import { isAndroidRuntime, listenPlatformEvent, stopNativePlayback } from "../../runtime/platform";
import { getHomeScroll } from "../../store/homeScrollStore";
import { gsap, installInertialScroll, tweenTo, prefersReducedMotion, stopInertialScroll } from "../../utils/motion";

export default function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const isPlayer = loc.pathname === "/player";
  const isEpisodePage = loc.pathname === "/episode" || loc.pathname === "/streams";
  const isDetailPage = loc.pathname.startsWith("/detail/");
  const isPersonPage = loc.pathname.startsWith("/person/");
  const navigationScrollKey = makeScrollKey(loc.pathname, loc.search);
  const hideNav = isPlayer || isEpisodePage;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const routeHistoryRef = useRef(new Map<number, string>());
  const activeScrollKeyRef = useRef(makeScrollKey(loc.pathname, loc.search));
  const backChromeRef = useRef<HTMLDivElement>(null);
  const actionChromeRef = useRef<HTMLDivElement>(null);
  const mouseBackAtRef = useRef(0);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(true);
  const [playerTransparent, setPlayerTransparent] = useState(false);
  const [backZone, setBackZone] = useState(false);
  const [controlsZone, setControlsZone] = useState(false);
  const backHideTimerRef = useRef<number | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const showBack = isEpisodePage || isPlayer || isDetailPage || isPersonPage;

  // Back button visibility: independent zone (top-left corner)
  const backVisible = isPlayer ? (playerChromeVisible || backZone) : showBack ? backZone : true;
  // Window controls visibility: independent zone (top-right corner)
  const controlsVisible = isPlayer ? (playerChromeVisible || controlsZone) : showBack ? controlsZone : true;
  const androidRuntime = isAndroidRuntime();

  useEffect(() => {
    const els = [backChromeRef.current].filter(Boolean);
    gsap.set(els, { opacity: backVisible ? 1 : 0 });
    tweenTo(els, { opacity: backVisible ? 1 : 0 }, 0.3);
  }, [backVisible]);

  useEffect(() => {
    const els = [actionChromeRef.current].filter(Boolean);
    gsap.set(els, { opacity: controlsVisible ? 1 : 0 });
    tweenTo(els, { opacity: controlsVisible ? 1 : 0 }, 0.3);
  }, [controlsVisible]);

  useEffect(() => {
    function clearHideTimer(ref: React.MutableRefObject<number | null>) {
      if (ref.current !== null) {
        window.clearTimeout(ref.current);
        ref.current = null;
      }
    }
    function scheduleHide(ref: React.MutableRefObject<number | null>, setter: (v: boolean) => void) {
      clearHideTimer(ref);
      ref.current = window.setTimeout(() => setter(false), 1800);
    }
    function onMouseMove(event: MouseEvent) {
      const x = event.clientX;
      const y = event.clientY;
      const w = window.innerWidth;
      // Top-left corner: back button
      const inBackCorner = x < 220 && y < 90;
      if (inBackCorner) {
        clearHideTimer(backHideTimerRef);
        setBackZone(prev => prev !== true ? true : prev);
      } else {
        setBackZone(prev => {
          if (prev) scheduleHide(backHideTimerRef, setBackZone);
          return prev;
        });
      }
      // Top-right corner: window controls
      const inControlsCorner = x > w - 220 && y < 90;
      if (inControlsCorner) {
        clearHideTimer(controlsHideTimerRef);
        setControlsZone(prev => prev !== true ? true : prev);
      } else {
        setControlsZone(prev => {
          if (prev) scheduleHide(controlsHideTimerRef, setControlsZone);
          return prev;
        });
      }
    }
    function onMouseLeave() {
      setBackZone(false);
      setControlsZone(false);
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseout", onMouseLeave);

    if (isPlayer) {
      setBackZone(true);
      setControlsZone(true);
    }

    return () => {
      clearHideTimer(backHideTimerRef);
      clearHideTimer(controlsHideTimerRef);
      window.removeEventListener("mousemove", onMouseMove, { passive: true } as AddEventListenerOptions);
      document.removeEventListener("mouseout", onMouseLeave);
    };
  }, [isPlayer, showBack]);

  useLayoutEffect(() => {
    const shell = scrollRef.current;
    if (!shell) return;

    const nextKey = navigationScrollKey;
    const historyIndex = getRouterHistoryIndex();
    if (historyIndex !== null) {
      routeHistoryRef.current.set(historyIndex, nextKey);
    }
    const previousKey = activeScrollKeyRef.current;
    if (previousKey === nextKey) return;

    scrollPositionsRef.current.set(previousKey, shell.scrollTop);

    stopInertialScroll(shell);
    const homeScroll = loc.pathname === "/home" ? getHomeScroll()?.vertical : undefined;
    const nextScroll = scrollPositionsRef.current.get(nextKey) ?? homeScroll ?? 0;
    shell.scrollTo({ top: nextScroll, behavior: "instant" as ScrollBehavior });
    activeScrollKeyRef.current = nextKey;
  }, [loc.pathname, navigationScrollKey]);

  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell || androidRuntime || isPlayer || isEpisodePage) return;
    return installInertialScroll(shell);
  }, [androidRuntime, isEpisodePage, isPlayer, navigationScrollKey]);

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
    const shell = scrollRef.current;
    if (!shell) return;
    let prevW = window.innerWidth;
    let prevH = window.innerHeight;
    let animating = false;
    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === prevW && h === prevH) return;
      const dw = Math.abs(w - prevW);
      const dh = Math.abs(h - prevH);
      prevW = w;
      prevH = h;
      if (animating) return;
      if (dw < 40 && dh < 40) return;
      animating = true;
      if (prefersReducedMotion()) { animating = false; return; }
      gsap.killTweensOf(shell);
      gsap.timeline()
        .to(shell, { scale: 0.985, duration: 0.12, ease: "power2.in" })
        .to(shell, { scale: 1, duration: 0.18, ease: "power2.out", onComplete: () => { animating = false; } });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void toggleWindowFullscreen();
        return;
      }

      const isEscape = event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
      if (!isEscape) return;

      // Don't intercept Escape on input/textarea/search contexts.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      event.preventDefault();
      event.stopPropagation();
      goBack();
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
      const historyIndex = getRouterHistoryIndex();
      const returnDelta = historyIndex === null
        ? null
        : findDetailReturnDelta(
            routeHistoryRef.current,
            historyIndex,
            makeScrollKey(loc.pathname, loc.search),
          );
      if (returnDelta !== null) {
        navigate(returnDelta);
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
        background: `${isPlayer && playerTransparent ? "transparent" : isPlayer ? "#000" : isPersonPage ? "#2b2b2d" : "transparent"}`,
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
              pointerEvents: backVisible ? "auto" : "none",
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
          className="absolute flex items-center gap-2"
          style={{
            right: "var(--app-safe-x)",
            top: "var(--app-safe-top)",
            pointerEvents: controlsVisible ? "auto" : "none",
          }}
        >
          {!androidRuntime && (!isPlayer || showBack) && (
            <WindowControls />
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        data-aetherio-scroll-shell
        style={{
          height: "100%",
          width: "100%",
          overflowY: isEpisodePage ? "hidden" : "auto",
          overflowX: "hidden",
          overscrollBehavior: isEpisodePage ? "none" : undefined,
          paddingTop: hideNav ? 0 : "var(--app-shell-nav-height)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function makeScrollKey(pathname: string, search: string) {
  if (pathname === "/settings") return pathname;
  return `${pathname}${search}`;
}

function getRouterHistoryIndex() {
  const index = window.history.state?.idx;
  return typeof index === "number" && Number.isInteger(index) ? index : null;
}

function findDetailReturnDelta(
  history: Map<number, string>,
  currentIndex: number,
  currentPath: string,
) {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = history.get(index);
    if (!candidate) continue;
    const pathname = candidate.split("?")[0];
    if (pathname === "/episode" || pathname === "/streams" || pathname === "/player") continue;
    if (candidate === currentPath) continue;
    return index - currentIndex;
  }
  return null;
}
