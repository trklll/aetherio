import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import LoadingState from "../../components/ui/LoadingState";
import { useHomePreferences } from "../../config/homePreferences.ts";
import { useHomeCatalogs } from "../../hooks/useCatalogs.ts";
import {
  closeWindow,
  enterBigPictureWindow,
  exitBigPictureWindow,
  isWindowFullscreen,
  setBigPictureActive,
} from "../../runtime/platform.ts";
import { getContextGlassStyle } from "../../components/ui/glassSurface.ts";
import { useBackAction } from "../../input/inputActions.ts";
import { useAddonStore } from "../../store/addonStore.ts";
import { consumeAutoResolveBackPress } from "../../utils/autoResolveGuard.ts";
import { buildDetailPath, buildPlayerBackPath } from "../../utils/bigPictureDetail.ts";
import { isFreshHomeEntrance } from "../../utils/homeEntrance.ts";
import { gsap, installInertialScroll, prefersReducedMotion, springTo } from "../../utils/motion.ts";
import type { MediaItem } from "../../types/ui.ts";
import type { DetailEpisodeRequest } from "../Detail/index.tsx";
import HomePage from "../Home/index.tsx";
import BigPictureBackdrop from "./BigPictureBackdrop.tsx";
import BigPictureHero from "./BigPictureHero.tsx";
import BigPictureRail from "./BigPictureRail.tsx";
import BigPictureSearch from "./BigPictureSearch.tsx";
import BigPictureParty from "./BigPictureParty.tsx";
import BigPictureGenre from "./BigPictureGenre.tsx";
import "./BigPicture.css";
import "./BigPictureSettings.css";

const DetailPage = lazy(() => import("../Detail/index.tsx"));
const DetailSectionPage = lazy(() => import("../Detail/DetailSectionPage.tsx"));
const EpisodiePage = lazy(() => import("../Episodie/index.tsx"));
const PlayerPage = lazy(() => import("../Player/index.tsx"));
const PersonPage = lazy(() => import("../Person/index.tsx"));
const EntityPage = lazy(() => import("../Entity/index.tsx"));
const CatalogPage = lazy(() => import("../Catalog/index.tsx"));
const BigPictureSettings = lazy(() => import("./BigPictureSettings.tsx"));
const BigPictureAddons = lazy(() => import("./BigPictureAddons.tsx"));

// Episodie es sección del Detail (un solo fondo): las rutas /big-picture/episode
// y /big-picture/streams redirigen al Detail con la sección abierta.
function readEpisodeRequestFromSearch(search: string): DetailEpisodeRequest | null {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const id = params.get("id");
  if (!type || !id) return null;
  const season = Number(params.get("season"));
  const ep = Number(params.get("ep"));
  const request: DetailEpisodeRequest = {};
  if (Number.isFinite(season) && season >= 0) request.season = season;
  if (Number.isFinite(ep) && ep > 0) request.ep = ep;
  const epTitle = params.get("epTitle");
  if (epTitle) request.episodeName = epTitle;
  if (params.get("continue") === "1") request.continue = true;
  if (params.get("autoplay") === "1") request.autoplay = true;
  if (params.get("fromSearch") === "1") {
    request.fromSearch = true;
    const q = params.get("q");
    if (q) request.q = q;
  }
  if (params.get("fromPlayer") === "1") request.fromPlayer = true;
  return request;
}

function BigPictureEpisodeRedirect() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const type = params.get("type");
  const id = params.get("id");
  useEffect(() => {
    if (!type || !id) return;
    const episodeRequest = readEpisodeRequestFromSearch(location.search) ?? {};
    navigate(buildDetailPath(type, id, undefined, location.pathname), {
      replace: true,
      state: { ...(location.state as Record<string, unknown> ?? {}), episodeRequest },
    });
  }, [type, id, location.search, location.pathname, navigate]);
  if (!type || !id) {
    return (
      <Suspense fallback={<LoadingState label="Cargando episodio" shellPreviewLoading />}>
        <EpisodiePage />
      </Suspense>
    );
  }
  return <LoadingState label="Cargando episodio" shellPreviewLoading />;
}

/**
 * Big Picture: el Home maximizado con hero propio (sin tarjetero).
 * El hero rota por los medios cargando sus clips; al terminar un clip pasa
 * al siguiente. El video va en el background maximizado con la lógica de
 * Detail (blur al bajar).
 */
export default function BigPicturePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Search Big Picture: port 1:1 del SearchScreen nativo (fondo sólido
  // propio, sin backdrop del Home). Party igual: page 10-foot con teclado
  // en pantalla (el modal de Home es patrón PC, no mando).
  // Detail: EXACTAMENTE la misma page de PC (mismo componente DetailPage),
  // solo cambia el chrome — sidebar (BigPictureRail) en vez de topnav bar.
  // Settings y Addons tienen páginas TV-native propias: no se reutiliza el
  // layout de escritorio porque sus inputs/selects no son una buena superficie
  // de interacción para un mando.
  const isSearch = location.pathname.startsWith("/big-picture/search");
  const isParty = location.pathname.startsWith("/big-picture/party");
  const isGenre = location.pathname.startsWith("/big-picture/genre");
  const isCatalog = location.pathname.startsWith("/big-picture/catalog");
  const isSettings = location.pathname.startsWith("/big-picture/settings");
  const isAddons = location.pathname.startsWith("/big-picture/addons");
  const isEpisode = location.pathname.startsWith("/big-picture/episode") || location.pathname.startsWith("/big-picture/streams");
  const isDetail = location.pathname.startsWith("/big-picture/detail/");
  const isPlayer = location.pathname.startsWith("/big-picture/player");
  const isPerson = location.pathname.startsWith("/big-picture/person/");
  const isEntity = location.pathname.startsWith("/big-picture/entity/");
  const isSubPage = isSearch || isParty || isGenre || isCatalog || isSettings || isAddons || isEpisode || isDetail || isPlayer || isPerson || isEntity;
  const addons = useAddonStore(s => s.addons);
  const prefs = useHomePreferences();
  const { heroItems } = useHomeCatalogs(addons, prefs.contentOrientation, prefs.bothPreference, !isSubPage);
  const [activeItem, setActiveItem] = useState<MediaItem | undefined>(undefined);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Mismo valor que calcula HomePage en este commit: escalonado solo al
  // entrar recién a la app, instantáneo al volver desde otra página.
  const [isEntrance] = useState(() => isFreshHomeEntrance(location));
  // Señal real del reveal de la info (vive en HomePage): el backdrop arranca
  // su conteo de 2.5s cuando la info ya está en pantalla.
  const [heroContentVisible, setHeroContentVisible] = useState(false);
  const handleHeroContentVisible = useCallback((visible: boolean) => {
    setHeroContentVisible(visible);
  }, []);
  // Sin backdrop duplicado: el Detail es dueño del único fondo. La sección
  // Episodie vive dentro del Detail y lo reutiliza en grayscale.

  // Círculo (Guía/combo/F10) doble dentro de Big Picture → advertencia de salida.
  useEffect(() => {
    const onExitRequest = () => setExitConfirmOpen(true);
    window.addEventListener("aetherio-bp-exit-request", onExitRequest);
    return () => window.removeEventListener("aetherio-bp-exit-request", onExitRequest);
  }, []);

  const confirmExit = useCallback(async () => {
    setExitConfirmOpen(false);
    try {
      await closeWindow();
    } catch {
      // Ventana best-effort.
    }
    // Big Picture NUNCA navega a modo normal por sí solo: la única salida a
    // la app normal es el botón Start del mando. En web/preview no hay
    // ventana que cerrar, así que quedarse en Big Picture (solo se cierra el modal).
  }, []);

  const handleActiveItem = useCallback((item: MediaItem | undefined) => {
    setActiveItem(prev => (prev?.id === item?.id && prev?.type === item?.type ? prev : item));
  }, []);

  // Steam: al entrar, pantalla completa exclusiva; al salir se devuelve
  // la ventana a su estado anterior (solo si este modo la puso).
  useEffect(() => {
    setBigPictureActive(true);
    let enteredFullscreen = false;
    let cancelled = false;
    void (async () => {
      try {
        const already = (await isWindowFullscreen().catch(() => false))
          || !!document.fullscreenElement;
        await enterBigPictureWindow();
        if (!cancelled && !already) enteredFullscreen = true;
      } catch {
        // Ventana best-effort; el modo funciona igual sin fullscreen.
      }
    })();
    return () => {
      cancelled = true;
      setBigPictureActive(false);
      if (enteredFullscreen) void exitBigPictureWindow();
    };
  }, []);

  // Steam: el cursor del SO desaparece; reaparece al mover el ratón y se
  // auto-oculta tras unos segundos quieto (o al navegar con mando/teclado).
  useEffect(() => {
    const root = document.documentElement;
    const HIDE_AFTER_MS = 2500;
    let timer = 0;
    const hide = () => root.classList.add("aetherio-bp-hide-cursor");
    const showTemporarily = () => {
      root.classList.remove("aetherio-bp-hide-cursor");
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, HIDE_AFTER_MS);
    };
    hide();
    const onMouseMove = () => showTemporarily();
    const onControllerNav = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow") || e.key === "Enter") hide();
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("keydown", onControllerNav, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onControllerNav, true);
      root.classList.remove("aetherio-bp-hide-cursor");
    };
  }, []);

  // Mismo scroll con inercia de la app normal (rueda del ratón).
  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell) return;
    return installInertialScroll(shell);
  }, []);

  // Al entrar al detalle, ajustes, addons, player, persona o entidad, el
  // scroll exterior queda arriba: el scroll real lo lleva el shell interior
  // de la propia page (igual que en PC con AppShell). Sin esto el hero heredaría el scroll.
  useEffect(() => {
    if (!isDetail && !isCatalog && !isSettings && !isAddons && !isEpisode && !isPlayer && !isPerson && !isEntity) return;
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" as ScrollBehavior });
  }, [isDetail, isCatalog, isSettings, isAddons, isEpisode, isPlayer, isPerson, isEntity, location.pathname]);

  // Root de la page que hay que fundir en cada cambio de ruta: el primer hijo
  // CON className del shell de scroll. Ese descriptor descarta a propósito los
  // <div> pelados de los <Suspense> (LoadingState / fondo negro), que no son la
  // page real, y no depende de conocer el root de cada page.
  const routeRoot = useCallback((): HTMLElement | null => {
    const shell = scrollRef.current;
    if (!shell) return null;
    for (const child of Array.from(shell.children)) {
      if (child instanceof HTMLElement && child.className.trim()) return child;
    }
    return null;
  }, []);

  // Transición de entrada: en vez de un corte seco, la page aparece con un
  // fade suave (search → medio, medio → medio, volver a la anterior, etc.).
  //
  // Se anima el root que la propia page monta y no un wrapper alrededor:
  // Detail/Entity/Person usan la cadena del nav-band (marginTop negativo +
  // height 100vh / min-height 100%), así que un div intermedio con altura
  // automática rompería ese encadenado. Ningún root lleva opacity propia (las
  // pages animan a sus hijos), así que no pelea con su coreografía.
  //
  // Las pages lazy entran detrás de <Suspense>, así que se espera con rAF a
  // que exista el root (con tope de tiempo) en lugar de animar el primer hijo
  // del shell, que sería el fallback. El poll se cancela si la ruta cambia
  // antes de encontrarlo.
  useEffect(() => {
    if (isPlayer || isEpisode || prefersReducedMotion()) return;
    const shell = scrollRef.current;
    if (!shell) return;
    let frame = 0;
    let waited = 0;
    let tween: ReturnType<typeof gsap.to> | null = null;
    const reveal = () => {
      const root = routeRoot();
      if (!root) {
        waited += 32;
        if (waited < 1200) frame = requestAnimationFrame(reveal);
        return;
      }
      tween = gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.32, ease: "power2.out", clearProps: "opacity" });
    };
    frame = requestAnimationFrame(reveal);
    return () => {
      cancelAnimationFrame(frame);
      tween?.kill();
    };
  }, [location.pathname, isPlayer, isEpisode, routeRoot]);

  // Salida: desvanece el contenido del shell y navega al terminar. Se limpia
  // el opacity del SHELL (no el del root) justo antes de navegar, para que la
  // page entrante pueda hacer su propio fade desde 0 sin quedar heredando un
  // container invisible. El rail y el backdrop viven fuera del shell, así que
  // la navegación lateral se mantiene visible durante el fundido.
  const fadeOutThen = useCallback((go: () => void) => {
    const shell = scrollRef.current;
    if (!shell || prefersReducedMotion()) {
      go();
      return;
    }
    gsap.killTweensOf(shell);
    gsap.to(shell, { opacity: 0, duration: 0.16, ease: "power1.in", onComplete: () => { gsap.set(shell, { clearProps: "opacity" }); go(); } });
  }, []);

  // B del mando / Esc / Borrar (acción central `back` de inputActions):
  // - En el home (/big-picture): un toque abre la advertencia de salida
  //   (salir de la app). NUNCA vuelve a la app normal: la única salida a
  //   modo normal es el botón Start del mando.
  // - En las sub-páginas (/big-picture/search, /big-picture/party,
  //   /big-picture/genre, /big-picture/settings, /big-picture/addons,
  //   /big-picture/episode, /big-picture/player, /big-picture/person,
  //   /big-picture/entity,
  //   /big-picture/detail/...): B retrocede a la página
  //   anterior, igual que Escape en la app normal (siempre dentro de Big Picture).
  const handleBack = useCallback(() => {
    // Con el modal de salida abierto, B lo cierra a él; no actuar encima.
    if (exitConfirmOpen) return;
    if (document.querySelector("[data-shell-preview]")) return;
    // Popup de sinopsis del detail (sin X): B lo cierra a él; no retroceder.
    if (document.querySelector("[data-aetherio-synopsis-popup]")) return;
    // Reproductor: siempre a la page de Episodie (picker de fuentes) del mismo
    // medio, nunca a la ficha. `navigate(-1)` dependía de qué quedara en el
    // historial y desde la pantalla de carga solía devolver el detail. El
    // Player se encarga de parar la reproducción nativa al desmontarse.
    if (isPlayer) {
      const streamsPath = buildPlayerBackPath(location.search, location.pathname);
      const target = streamsPath ?? "/big-picture";
      fadeOutThen(() => navigate(target, { replace: true }));
      return;
    }
    // Sección Episodie dentro del Detail: la cierra el propio Detail (misma
    // página, mismo fondo); no navegar encima.
    if (isDetail && document.querySelector("[data-aetherio-episode-section]")) return;
    if (isEpisode && consumeAutoResolveBackPress()) return;
    if (isSubPage) {
      fadeOutThen(() => navigate(-1));
      return;
    }
    setExitConfirmOpen(true);
  }, [location.pathname, location.search, navigate, exitConfirmOpen, isDetail, isEpisode, isPlayer, isSubPage, fadeOutThen]);
  useBackAction(handleBack);

  return (
    <div className="big-picture big-picture--home-maximized" data-aetherio-big-picture>
      {!isSubPage && (
        <BigPictureBackdrop items={heroItems} scrollRef={scrollRef} onActiveItem={handleActiveItem} animateEntrance={isEntrance} contentVisible={heroContentVisible} />
      )}
      {!isPlayer && !isEpisode && <BigPictureRail />}
      {exitConfirmOpen && (
        <ExitConfirm
          onCancel={() => setExitConfirmOpen(false)}
          onConfirm={() => void confirmExit()}
        />
      )}
      <div
        ref={scrollRef}
        data-aetherio-scroll-shell
        className={`big-picture__scroll${isPlayer ? " big-picture__scroll--static" : ""}`}
      >
        {isSearch ? (
          <BigPictureSearch />
        ) : isParty ? (
          <BigPictureParty />
        ) : isGenre ? (
          <BigPictureGenre />
        ) : isCatalog ? (
          <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
            <CatalogPage bigPicture />
          </Suspense>
        ) : isSettings ? (
          <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
            <BigPictureSettings />
          </Suspense>
        ) : isAddons ? (
          <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
            <BigPictureAddons />
          </Suspense>
        ) : isEpisode ? (
          <BigPictureEpisodeRedirect />
        ) : isPlayer ? (
          <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
            <PlayerPage />
          </Suspense>
        ) : isPerson ? (
          <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
            <Routes>
              <Route path="/big-picture/person/:id" element={<PersonPage />} />
            </Routes>
          </Suspense>
        ) : isEntity ? (
          <Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}>
            <Routes>
              <Route path="/big-picture/entity/:kind/:id" element={<EntityPage />} />
            </Routes>
          </Suspense>
        ) : isDetail ? (
          <Suspense fallback={<LoadingState label="Cargando detalle" />}>
            <Routes>
              <Route
                path="/big-picture/detail/:type/:id"
                element={<DetailPage />}
              />
              <Route path="/big-picture/detail/:type/:id/:section" element={<DetailSectionPage />} />
            </Routes>
          </Suspense>
        ) : (
          <HomePage
            heroSlot={contentVisible => (
              <BigPictureHero item={activeItem ?? heroItems[0]} contentVisible={contentVisible} />
            )}
            onContentVisibleChange={handleHeroContentVisible}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Advertencia de salida (círculo del mando doble / F10 doble) — material
 * liquid glass y entrada con spring críticamente amortiguado (Apple §12/§4).
* B/Escape cancela; el foco cae en "Cancelar" para el mando.
 */
function ExitConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const cardRef = useRef(null as HTMLDivElement | null);
  const backdropRef = useRef(null as HTMLDivElement | null);
  const cancelRef = useRef(null as HTMLButtonElement | null);
  const enteredRef = useRef(false);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    if (!card || !backdrop || enteredRef.current) return;
    enteredRef.current = true;
    if (prefersReducedMotion()) {
      gsap.set([card, backdrop], { opacity: 0 });
      gsap.to([card, backdrop], { opacity: 1, duration: 0.2, overwrite: "auto" });
    } else {
      gsap.set(backdrop, { opacity: 0 });
      gsap.set(card, { opacity: 0, y: 10, scale: 0.96, filter: "blur(6px)" });
      springTo(backdrop, { opacity: 1 } as unknown as gsap.TweenVars, { duration: 0.3, damping: 1.0 });
      springTo(card, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { duration: 0.4, damping: 1.0 });
    }
    requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const glassStyle = getContextGlassStyle();

  return (
    <div data-bp-exit-confirm style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div
        ref={backdropRef}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", pointerEvents: "auto", cursor: "pointer" }}
        onClick={onCancel}
      />
      <div
        ref={cardRef}
        style={{
          ...glassStyle,
          position: "relative",
          pointerEvents: "auto",
          width: "min(380px, 90vw)",
          borderRadius: 22,
          padding: "28px 26px 22px",
          textAlign: "center",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
        }}
      >
        <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#fff" }}>¿Quieres salir de la app?</p>
        <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.45, color: "rgba(255,255,255,0.62)" }}>
          Tus datos y lo que estás viendo se guardan. Puedes volver cuando quieras.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "center" }}>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              borderRadius: 999,
              padding: "10px 26px",
              fontWeight: 800,
              fontSize: 14,
              border: "none",
              cursor: "pointer",
              background: "#fff",
              color: "#000",
              boxShadow: "0 3px 12px rgba(0,0,0,0.38)",
            }}
          >
            Salir
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              borderRadius: 999,
              padding: "10px 26px",
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
