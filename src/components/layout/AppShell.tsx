import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "./BackButton";
import TopNav from "./TopNav";
import { isContextMenuOpen } from "../ui/ContextMenu";
import WindowControls from "./WindowControls";
import HomePartyModal, { PartyHomeButton, PartyPendingJoinHandler } from "../../party/HomePartyModal";
import { toggleWindowFullscreen } from "../../utils/windowControls";
import { listenPlatformEvent, stopNativePlayback } from "../../runtime/platform";
import { getHomeScroll } from "../../store/homeScrollStore";
import { gsap, installInertialScroll, springTo, prefersReducedMotion, stopInertialScroll, motionTimings } from "../../utils/motion";
import { consumeAutoResolveBackPress } from "../../utils/autoResolveGuard";
import { buildPlayerBackPath } from "../../utils/bigPictureDetail";
import { useBackAction } from "../../input/inputActions";
import { useParty } from "../../party/PartyContext";
import { findDetailReturnDelta, makeScrollKey } from "../../utils/detailReturn";

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
  const pendingScrollRafRef = useRef<number | null>(null);
  const backChromeRef = useRef<HTMLDivElement>(null);
  const actionChromeRef = useRef<HTMLDivElement>(null);
  const partyChromeRef = useRef<HTMLDivElement>(null);
  const mouseBackAtRef = useRef(0);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(true);
  const [playerTransparent, setPlayerTransparent] = useState(false);
  const [partyModalOpen, setPartyModalOpen] = useState(false);
  const [backZone, setBackZone] = useState(false);
  const [controlsZone, setControlsZone] = useState(false);
  const backHideTimerRef = useRef<number | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const showBack = isEpisodePage || isPlayer || isDetailPage || isPersonPage;

  // La sala vive solo dentro del flujo de reproducción (episode -> player).
  // Al abandonarlo —salir del player, volver al detalle, abrir otro medio—,
  // si era anfitrión la sala MUERE (closeRoom) y si era invitado solo se
  // desconecta. Así ninguna sala vieja reaparece en la siguiente reproducción.
  const { closeRoom: partyCloseRoom, leaveRoom: partyLeaveRoom, isOwner: partyIsOwner, roomCode: partyRoomCode } = useParty();
  const partyExitRef = useRef({ closeRoom: partyCloseRoom, leaveRoom: partyLeaveRoom, isOwner: false, roomCode: "" });
  partyExitRef.current = { closeRoom: partyCloseRoom, leaveRoom: partyLeaveRoom, isOwner: partyIsOwner, roomCode: partyRoomCode };
  const prevRouteRef = useRef({ path: loc.pathname, search: loc.search });
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = { path: loc.pathname, search: loc.search };
    if (prev.path === loc.pathname && prev.search === loc.search) return;
    const party = partyExitRef.current;
    if (!party.roomCode) return;
    const nowPlayer = loc.pathname === "/player";
    // episode -> player: se entra a reproducir, la sala sigue.
    // player -> player (siguiente episodio / Up Next): la sala sigue.
    if (nowPlayer) return;
    const wasPlayer = prev.path === "/player";
    const wasEpisode = prev.path === "/episode" || prev.path === "/streams";
    if (!wasPlayer && !wasEpisode) return;
    if (party.isOwner) party.closeRoom();
    else party.leaveRoom();
  }, [loc.pathname, loc.search]);

  // Scroll-based hide for window controls (outside player) — syncs with TopNav
  // Umbral y fuente idénticos a TopNav: max scrollTop de TODOS los shells
  // (Detail tiene su propio shell anidado) para que se contraigan en TODA la app.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (isPlayer) {
      setScrolled(false);
      return;
    }
    let raf = 0;
    function readY(): number {
      const shells = Array.from(document.querySelectorAll<HTMLElement>("[data-aetherio-scroll-shell]"));
      let max = 0;
      for (const s of shells) {
        if (s.scrollTop > max) max = s.scrollTop;
      }
      const docY = document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
      if (docY > max) max = docY;
      return max;
    }
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // Use same threshold as TopNav (220px) with slight damping to feel simultaneous
        setScrolled(readY() > 220);
      });
    }
    // capture:true atrapa scrolls de shells anidados (no burbujean)
    document.addEventListener("scroll", onScroll, { capture: true, passive: true } as AddEventListenerOptions);
    window.addEventListener("resize", onScroll);
    const t1 = window.setTimeout(onScroll, 50);
    const t2 = window.setTimeout(onScroll, 250);
    onScroll();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isPlayer, loc.pathname, loc.search]);

  // Back button visibility: independent zone (top-left corner)
  const backVisible = isPlayer ? (playerChromeVisible || backZone) : showBack ? backZone : true;
  // Window controls visibility: independent zone (top-right corner) + scroll hide
  // When scrolled, controlsVisible is false unless controlsZone is true (hover)
  const controlsVisible = isPlayer ? (playerChromeVisible || controlsZone) : (controlsZone || !scrolled);
  // Party button (top-left, no back button): same hide-on-scroll as window controls.
  const partyVisible = controlsZone || backZone || !scrolled;

  useEffect(() => {
    const el = backChromeRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: backVisible ? 1 : 0, y: 0, scale: 1, filter: "blur(0px)" });
      el.style.pointerEvents = backVisible ? "auto" : "none";
      return;
    }
    el.style.pointerEvents = backVisible ? "auto" : "none";
    if (backVisible) {
      gsap.set(el, { y: -8, scale: 0.96, filter: "blur(6px)" });
      springTo(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: motionTimings.chromeIn });
    } else {
      springTo(el, { opacity: 0, y: -10, scale: 0.97, filter: "blur(6px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: motionTimings.chromeOut });
    }
  }, [backVisible]);

  useEffect(() => {
    const el = actionChromeRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: controlsVisible ? 1 : 0, y: 0, scale: 1, filter: "blur(0px)" });
      el.style.pointerEvents = controlsVisible ? "auto" : "none";
      return;
    }
    el.style.pointerEvents = controlsVisible ? "auto" : "none";
    if (controlsVisible) {
      gsap.set(el, { y: -8, scale: 0.96, filter: "blur(6px)" });
      springTo(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: motionTimings.chromeIn });
    } else {
      springTo(el, { opacity: 0, y: -10, scale: 0.97, filter: "blur(6px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: motionTimings.chromeOut });
    }
  }, [controlsVisible]);

  useEffect(() => {
    const el = partyChromeRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: partyVisible ? 1 : 0, y: 0, scale: 1, filter: "blur(0px)" });
      el.style.pointerEvents = partyVisible ? "auto" : "none";
      return;
    }
    el.style.pointerEvents = partyVisible ? "auto" : "none";
    if (partyVisible) {
      gsap.set(el, { y: -8, scale: 0.96, filter: "blur(6px)" });
      springTo(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: motionTimings.chromeIn });
    } else {
      springTo(el, { opacity: 0, y: -10, scale: 0.97, filter: "blur(6px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: motionTimings.chromeOut });
    }
  }, [partyVisible]);

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

  // Guardar la posicion de scroll de forma CONTINUA, no al navegar. Al cambiar de
  // ruta el contenido viejo se desmonta antes de que monte el nuevo: hay un
  // instante en que el shell queda corto y el navegador recorta scrollTop a 0.
  // Leyendolo en el useLayoutEffect de la navegacion se guardaba ese 0 ya
  // recortado y la posicion se perdia para siempre (volver a la card exacta).
  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell) return;
    const onScroll = () => {
      scrollPositionsRef.current.set(activeScrollKeyRef.current, shell.scrollTop);
    };
    shell.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => shell.removeEventListener("scroll", onScroll);
  }, []);

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

    // La posicion de la page saliente ya esta guardada por el listener de scroll
    // de arriba: aqui ya estaria recortada a 0.
    stopInertialScroll(shell);
    const homeScroll = loc.pathname === "/home" ? getHomeScroll()?.vertical : undefined;
    const nextScroll = scrollPositionsRef.current.get(nextKey) ?? homeScroll ?? 0;
    activeScrollKeyRef.current = nextKey;

    if (pendingScrollRafRef.current !== null) {
      cancelAnimationFrame(pendingScrollRafRef.current);
      pendingScrollRafRef.current = null;
    }
    shell.scrollTo({ top: nextScroll, behavior: "instant" as ScrollBehavior });

    // Volver a una page que carga su contenido de forma asincrona (buscador,
    // catalogos, home) arrive con el contenedor casi sin alto: el scrollTo de
    // arriba lo recorta a 0 y la posicion se pierde. Se reintenta en frames
    // siguientes hasta que el destino sea alcanzable, y se corta en cuanto el
    // usuario toca la rueda para no pelear con el scroll manual.
    if (nextScroll > 0) {
      let lastApplied = shell.scrollTop;
      let attempts = 0;
      const tick = () => {
        const current = scrollRef.current;
        if (!current || activeScrollKeyRef.current !== nextKey) {
          pendingScrollRafRef.current = null;
          return;
        }
        attempts += 1;
        // Scroll manual: se respeta y se abandona el reintento.
        if (Math.abs(current.scrollTop - lastApplied) > 1) {
          pendingScrollRafRef.current = null;
          return;
        }
        current.scrollTo({ top: nextScroll, behavior: "instant" as ScrollBehavior });
        lastApplied = current.scrollTop;
        if (Math.abs(current.scrollTop - nextScroll) <= 1 || attempts > 60) {
          pendingScrollRafRef.current = null;
          return;
        }
        pendingScrollRafRef.current = requestAnimationFrame(tick);
      };
      pendingScrollRafRef.current = requestAnimationFrame(tick);
    }
  }, [loc.pathname, navigationScrollKey]);

  useEffect(() => () => {
    if (pendingScrollRafRef.current !== null) cancelAnimationFrame(pendingScrollRafRef.current);
  }, []);

  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell || isPlayer || isEpisodePage) return;
    return installInertialScroll(shell);
  }, [isEpisodePage, isPlayer, navigationScrollKey]);

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
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // B del mando / Esc / Borrar (acción central `back` de inputActions).
  // El hook ya cede ante inputs nativos; aquí solo se añaden los guardias
  // propios del shell (menú contextual y popup de sinopsis se cierran solos).
  useBackAction(() => {
    // Con menú contextual abierto, B/Escape lo cierra a él (su handler lo
    // consume); no navegar atrás encima.
    if (isContextMenuOpen()) return;
    // Popup de sinopsis del detail en Big Picture (sin X): B/Escape lo
    // cierra a él; no navegar atrás encima.
    if (typeof document !== "undefined" && document.querySelector("[data-aetherio-synopsis-popup]")) return;
    // Sección Episodie dentro del Detail: la cierra el propio Detail (misma
    // página, mismo fondo); no navegar encima.
    if (typeof document !== "undefined" && document.querySelector("[data-aetherio-episode-section]")) return;
    goBack();
  });

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
    // Loader de auto-resolve activo: atras/ESC cancela el
    // autoplay y revela el picker manual en vez de salir de la pagina.
    if (consumeAutoResolveBackPress()) return;

    // Reproductor: siempre a la page de Episodie (picker de fuentes) del mismo
    // medio. Va ANTES del chequeo de la sección porque las pages cacheadas siguen
    // montadas ocultas (Activity) y su `data-aetherio-episode-section` envenena el
    // DOM: sin esto el gesto se consumía aquí y el Player no se movía.
    if (loc.pathname === "/player") {
      const streamsPath = buildPlayerBackPath(loc.search, loc.pathname);
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

    // Sección Episodie dentro del Detail: limpia el request de la ubicación
    // actual y permanece en el mismo Detail / backdrop. Solo en rutas de
    // detalle: fuera de ellas el marcador solo puede venir de una page cacheada.
    if (isDetailPage && typeof document !== "undefined" && document.querySelector("[data-aetherio-episode-section]")) {
      const currentState = loc.state && typeof loc.state === "object"
        ? { ...(loc.state as Record<string, unknown>) }
        : {};
      delete currentState.episodeRequest;
      navigate(`${loc.pathname}${loc.search}`, {
        replace: true,
        state: Object.keys(currentState).length ? currentState : null,
      });
      return;
    }

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
        {showBack ? (
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
        ) : !isPlayer ? (
          <div
            ref={partyChromeRef}
            className="absolute"
            style={{
              left: "var(--app-safe-x)",
              top: "var(--app-safe-top)",
            }}
          >
            <PartyHomeButton onOpen={() => setPartyModalOpen(true)} />
          </div>
        ) : null}

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
            background: "rgba(0,0,0,0.25)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: "12px",
            padding: "4px",
            transform: "scale(1.1)",
            transformOrigin: "top right",
          }}
        >
          {(!isPlayer || showBack) && (
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
      <PartyPendingJoinHandler onJoinFailed={() => setPartyModalOpen(true)} />
      <HomePartyModal open={partyModalOpen} onClose={() => setPartyModalOpen(false)} />
    </div>
  );
}

function getRouterHistoryIndex() {
  const index = window.history.state?.idx;
  return typeof index === "number" && Number.isInteger(index) ? index : null;
}
