import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { dispatchGamepadAction, GAMEPAD_ACTION_EVENT, type GamepadActionId } from "../../hooks/useGamepad.ts";
import { installSpatialNavigation, exitDetailContentZone } from "../../navigation/spatialNav";
import { prefersReducedMotion, stopInertialScroll } from "../../utils/motion";
import {
  isShellPreviewInternalPath,
  isShellPreviewMessage,
  postShellPreviewMessage,
  fullResArtworkUrl,
  preloadArtwork,
  shellPreviewBounds,
  wrapDelta,
  SHELL_PREVIEW_MESSAGE_SOURCE,
  resolveShellPreviewInitialIndex,
  withShellPreviewQuery,
  type ShellPreviewRequest,
  type ShellPreviewItem,
} from "../../utils/shellPreview";
import BigPictureRail from "../../pages/BigPicture/BigPictureRail.tsx";
import "../../pages/BigPicture/BigPicture.css";
import "../../pages/BigPicture/ShellDetailPreview.css";

const DetailPage = lazy(() => import("../../pages/Detail"));
const DetailSectionPage = lazy(() => import("../../pages/Detail/DetailSectionPage"));
const PersonPage = lazy(() => import("../../pages/Person"));
const EntityPage = lazy(() => import("../../pages/Entity"));
const SPORTS_RAIL_MODULE = "/src/pages/Sports/SportsRail.tsx";
const SPORTS_MATCH_PAGE_MODULE = "/src/pages/Sports/SportsMatchPage.tsx";
const SportsRail = import.meta.env.DEV
  ? lazy(() => import(/* @vite-ignore */ SPORTS_RAIL_MODULE))
  : null;
const SportsMatchPage = import.meta.env.DEV
  ? lazy(() => import(/* @vite-ignore */ SPORTS_MATCH_PAGE_MODULE))
  : null;

interface ShellDetailPreviewProps {
  request: ShellPreviewRequest;
  /**
   * El overlay está cerrado pero sigue montado. Los iframes sobreviven para no
   * tirar la cache con la que ya viene cargado el Detail; mientras está en
   * `true` el overlay no captura ni teclado ni mando ni mensajes.
   */
  dismissed?: boolean;
  onClose: () => void;
  onNavigate: (path: string, activeIndex: number, background?: string) => void;
  /** Generated-art surfaces can paint their existing card material before the iframe is ready. */
  renderBackdrop?: (item: ShellPreviewItem, animated: boolean, backingWidth: number, backingHeight: number) => ReactNode;
}

// Ciclo de vida de la ficha, en el orden en el que se recorren:
//
//   morphing → held → revealing → open        (el preview, panel compacto)
//   open → expanded                            (fullscreen, detalle navegable)
//   expanded → collapsing → open               (el "atrás" devuelve al preview)
//   cualquiera → closing                       (al home, con el reverse)
//
// `morphing`/`held`/`revealing` son la coreografía de la referencia: el artwork
// crece hasta el panel, el panel se queda solo un instante y luego el contenido
// entra escalonado DENTRO del panel (la geometría no se mueve). El fullscreen
// queda como paso aparte para cuando el usuario quiere navegar temporadas.
type Stage = "morphing" | "held" | "revealing" | "open" | "collapsing" | "expanded" | "closing";

// El preview aún no es la superficie activa: el carrusel manda (flechas = otro
// shell, Enter/analógico abajo = fullscreen) y el iframe sigue inert.
function isPreviewStage(stage: Stage) {
  return stage === "morphing" || stage === "held" || stage === "revealing" || stage === "open";
}

// Apertura de la shell (referencia Apple TV): el rect de la card crece hasta el
// panel compacto en SHELL_OPEN_MS con deceleración simple (power3.out, el
// appleEase de motion.ts) y sin overshoot — el latigazo de la expo-out anterior
// se nota en el primer frame y rompe la sensación de "crecer" del artwork.
//
// Silencio tras el morph: el panel se queda solo con el artwork antes de que
// entre el contenido. Es el aire de la referencia (unos 2 s de hero antes de que
// se vea el título) y también lo que hace que la entrada escalonada se lea como
// una entrada y no como un volcado de datos.
const SHELL_OPEN_MS = 450;
const SHELL_HOLD_MS = 900;

// El colapso es UN movimiento, no dos. La ficha se redimensiona hasta su hueco
// del carrusel y el track se queda quieto: si el track transitara, cruzaría
// `index` anchos de panel (720ms con una expo-out muy agresiva al inicio) por
// encima del resize (360ms) y en el primer frame la ficha con su artwork ya
// había salido de pantalla —el hueco gris del vídeo— y después se veía la
// tarjeta vecina cruzando la pantalla entera.
//
// La duración la fija el padre como --shell-collapse para que el CSS y el timer
// de reposo no se separen nunca. power3.out en CSS (el appleEase de motion.ts).
const SHELL_COLLAPSE_MS = 460;

// Tras expandir, el foco cae en Reproducir: el Enter que expandió (o un doble
// Enter por hábito) no debe activar Reproducir y saltar a episode. Se arma el
// Enter pasado este margen; también se ignora el repeat de Enter (mantener
// Enter no debe disparar clicks repetidos). Las flechas con repeat sí se
// reenvían (scroll/movimiento).
const SHELL_ENTER_ARM_MS = 900;

/**
 * El picker de arte o un menú contextual pueden abrirse ENCIMA de la shell
 * (p. ej. desde el menú de una card con el preview aún montado). En ese caso el
 * teclado/el mando son de esa capa: la shell no debe consumirlos ni
 * reenviarlos, o las flechas moverían el carrusel o expandirían el detalle
 * detrás del panel. `data-shell-preview` excluye la propia shell; los overlays
 * de dentro de un iframe viven en otro documento y no cuentan aquí (los cubre
 * la navegación espacial del propio iframe).
 */
function hasOverlayAboveShell(): boolean {
  return Boolean(document.querySelector(
    '[data-aetherio-context-menu][data-context-open="true"], [data-spatial-modal]:not([data-shell-preview]):not([hidden])',
  ));
}

export default function ShellDetailPreview({ request, dismissed = false, onClose, onNavigate, renderBackdrop }: ShellDetailPreviewProps) {
  const items = request.items?.length ? request.items : [request];
  const count = items.length;
  const initialIndex = resolveShellPreviewInitialIndex(request);
  // Posición sin techo en el carrusel: el carrusel es infinito, así que `pos`
  // solo crece (o baja) sin limite y `index` es su resto. Cada ficha se coloca
  // en el hueco que le toca respecto a `pos`, medido por el lado más corto
  // (wrapDelta): al pasar de la última a la primera, la ficha que envuelve
  // conserva su hueco y el salto se ve como un paso más, no como un teletransporte.
  const [pos, setPos] = useState(initialIndex);
  const index = ((pos % count) + count) % count;
  const [stage, setStage] = useState<Stage>("morphing");
  const [opened, setOpened] = useState(false);
  const [active, setActive] = useState(false);
  // El contenido del Detail solo entra cuando el beat termina. Hasta entonces el
  // iframe queda invisible y el panel muestra únicamente el artwork.
  const [revealed, setRevealed] = useState(false);
  const [ready, setReady] = useState(false);
  const [readyIndices, setReadyIndices] = useState<Set<number>>(() => new Set());
  const readyIndicesRef = useRef(readyIndices);
  readyIndicesRef.current = readyIndices;
  const [mountedIndices, setMountedIndices] = useState<Set<number>>(() => new Set([initialIndex]));
  const [artworkByIndex, setArtworkByIndex] = useState<Map<number, string>>(() => new Map());
  const [loadedArtworkKeys, setLoadedArtworkKeys] = useState<Set<string>>(() => new Set());
  const [revealedPreviewKeys, setRevealedPreviewKeys] = useState<Set<string>>(() => new Set());
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const compact = shellPreviewBounds(viewport.width, viewport.height);
  const [source, setSource] = useState(() => {
    const rect = request.cardElement?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : compact;
  });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const iframeRefs = useRef<Map<number, HTMLIFrameElement>>(new Map());
  useLayoutEffect(() => {
    // Home conserva montada la shell para reutilizar el cache de los iframes.
    // Al reabrir la misma fila, la key no cambia: sincroniza la ficha activa y
    // el origen del morph con el nuevo click en vez de conservar el anterior.
    const nextIndex = resolveShellPreviewInitialIndex(request);
    const rect = request.cardElement?.getBoundingClientRect();
    setSource(rect
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : shellPreviewBounds(window.innerWidth, window.innerHeight));
    setPos(nextIndex);
    setReady(iframeRefs.current.has(nextIndex) && readyIndicesRef.current.has(nextIndex));
    setMountedIndices(current => current.has(nextIndex) ? current : new Set(current).add(nextIndex));
    setStage("morphing");
    setOpened(false);
    setActive(false);
    setRevealed(false);
  }, [request]);
  const restoreFocusRef = useRef(true);
  const selectedRef = useRef(items[index]);
  selectedRef.current = items[index];
  const expanded = stage === "expanded";
  const fullSizeBackdrop = stage === "collapsing" || (stage === "expanded" && active);
  const reduced = prefersReducedMotion();
  const item = items[index];
  const artwork = artworkByIndex.get(index);
  const artworkKey = artwork ? `${item.detailPath}:${artwork}` : "";
  const previewKey = artwork ? `${index}:${artwork}` : "";
  const artworkReady = !artwork || loadedArtworkKeys.has(artworkKey);
  const previewRevealed = !artwork || revealedPreviewKeys.has(previewKey);
  // No se entra al detail hasta que el shell activo esta completo: iframe
  // listo + background resuelto cargado y revelado.
  const previewReady = ready && artworkReady && previewRevealed;
  const bounds = stage === "closing" || !opened ? source : expanded
    ? { left: 0, top: 0, width: viewport.width, height: viewport.height } : compact;

  const collapseTimerRef = useRef(0);
  const beatTimerRef = useRef(0);
  // El silencio ya venció: a partir de aquí el reveal solo espera al Detail.
  const beatDoneRef = useRef(false);
  // Espejo del stage para los timers, que se arman antes de existir el estado.
  const stageRef = useRef(stage);
  stageRef.current = stage;
  // Espejo de `opened` para el arranque de la apertura: evita setearla dos veces
  // si el efecto se reejecuta antes del segundo frame.
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;
  const close = useCallback(() => {
    window.clearTimeout(collapseTimerRef.current);
    window.clearTimeout(beatTimerRef.current);
    setStage("closing");
  }, []);
  const expand = useCallback(() => {
    // Reanudar la expansión durante un colapso a medio salir cancela el reposo:
    // si no, el timer dejaría la shell en "open" con la vista ya expandida.
    window.clearTimeout(collapseTimerRef.current);
    // No se entra a un Detail a medio cargar. El reveal va atado a lo mismo que
    // la entrada, así que forzar `revealed` aquí sin expansión solo sacaba el
    // esqueleto de la zona de contenido dentro del panel compacto.
    if (!previewReady || stageRef.current === "closing" || stageRef.current === "expanded") return;
    // Expandir cancela el beat pendiente: en fullscreen el contenido ya está
    // puesto, así que no le toca estelar por bloques ni esperar al silencio.
    window.clearTimeout(beatTimerRef.current);
    setRevealed(true);
    setStage("expanded");
  }, [previewReady]);
  // Back/B desde el detail expandido vuelve al carrusel (colapsa), no al
  // home: solo el back desde el carrusel ya colapsado cierra al home.
  //
  // "collapsing" es un stage propio para que el CSS sepa que el track no debe
  // transitar (ver SHELL_COLLAPSE_MS) y para que el reposo sea explícito en vez
  // de colarse con el propio keydown. Al colapsar, `active` pasa a false y el
  // Detail embebido recibe el activate:false, que es lo que repliega su blur y
  // su zona de contenido hacia el hero durante este mismo viaje.
  const collapse = useCallback(() => {
    setActive(false);
    setStage(current => (current === "expanded" ? "collapsing" : current));
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(
      // Al preview con su contenido ya revelado: se vuelve al punto en el que
      // estaba la ficha antes de entrar, no a un hero vacío otra vez.
      () => setStage(current => (current === "collapsing" ? "open" : current)),
      reduced ? 0 : SHELL_COLLAPSE_MS,
    );
    window.setTimeout(() => surfaceRef.current?.focus({ preventScroll: true }), 0);
  }, [reduced]);

// El beat: termina el silencio y el contenido entra escalonado dentro del
// panel. Se rearma desde cero al moverse de shell, para que cada ficha tenga
// su propio silencio antes de su texto.
//
// El silencio es el mínimo, no la señal: el reveal solo sale cuando el Detail
// además está listo (iframe `ready` + artwork cargado y revelado). Con el
// temporizador como único disparador el iframe se volvaba visible a los 1350 ms
// con la zona de contenido todavía en skeletons —el esqueleto se veía porque la
// page se montó con la metadata sembrada desde la card y `loading` seguía
// activo—. El panel se queda en artwork todo el tiempo que haga falta.
//
// No hay red de seguridad con reloj: el reveal y la expansion esperan a que el
// Detail realmente confirme `ready`, para no exponer skeletons si se pulsa A
// mientras el contenido sigue cargando. Escape sigue permitiendo cerrar.
const maybeReveal = useCallback(() => {
  if (revealed || !beatDoneRef.current || !previewReady) return;
  setRevealed(true);
  setStage(current => (current === "morphing" || current === "held") ? "revealing" : current);
}, [previewReady, revealed]);

const maybeRevealRef = useRef(maybeReveal);
maybeRevealRef.current = maybeReveal;

const beginReveal = useCallback((delay: number) => {
  beatDoneRef.current = false;
  window.clearTimeout(beatTimerRef.current);
  beatTimerRef.current = window.setTimeout(() => {
    beatDoneRef.current = true;
    maybeRevealRef.current();
  }, reduced ? 0 : delay);
}, [reduced]);

// El Detail puede terminar de cargar después de que el silencio ya haya
// vencido: se cierra el reveal en cuanto pasa a estar listo.
useEffect(() => { maybeReveal(); }, [maybeReveal]);

const restartBeat = useCallback(() => {
  setRevealed(false);
  setStage(current => (current === "revealing" || current === "open") ? "held" : current);
  // Si el morph todavía no ha terminado, el silencio nuevo empieza cuando
  // termine: si no, el texto entraría con el panel aún creciendo.
  const remaining = stageRef.current === "morphing" ? SHELL_OPEN_MS : 0;
  beginReveal(remaining + SHELL_HOLD_MS);
}, [beginReveal]);

  useEffect(() => () => {
    window.clearTimeout(collapseTimerRef.current);
    window.clearTimeout(beatTimerRef.current);
  }, []);

  useEffect(() => {
    // El cierre suelta el host (root inert + scroll del home) pero NO desmonta
    // el overlay: los iframes siguen montados detrás de `hidden` y con ellos su
    // cache de react-query, que es lo único que evita que el Detail vuelva a
    // pedirlo todo al reabrir. Cada iframe es un documento con su propio
    // QueryClient, así que si mueren se pierde la cache entera.
    if (dismissed) return;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    const shell = document.querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]");
    const previousOverflow = shell?.style.overflowY ?? "";
    if (shell) {
      stopInertialScroll(shell);
      shell.style.overflowY = "hidden";
    }
    return () => {
      if (root) root.inert = wasInert;
      if (shell) shell.style.overflowY = previousOverflow;
    };
  }, [dismissed, request.cardElement]);

  // Al reabrir una sesión tibia el morph se repite (la ficha vuelve a crecer
  // desde su card), pero el contenido ya está dentro: el reveal sale en cuanto
  // el artwork está listo, sin volver a pedir nada por red.
  useEffect(() => {
    if (!dismissed) return;
    window.clearTimeout(collapseTimerRef.current);
    window.clearTimeout(beatTimerRef.current);
    setStage("morphing");
    setOpened(false);
    setActive(false);
    setRevealed(false);
    if (restoreFocusRef.current) {
      const selected = selectedRef.current;
      if (selected.restoreFocus) selected.restoreFocus();
      else (selected.cardElement?.isConnected ? selected.cardElement : request.cardElement)?.focus({ preventScroll: true });
    }
  }, [dismissed, request.cardElement]);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (restoreFocusRef.current) {
        const selected = selectedRef.current;
        if (selected.restoreFocus) selected.restoreFocus();
        else (selected.cardElement?.isConnected ? selected.cardElement : request.cardElement)?.focus({ preventScroll: true });
      }
    };
  }, [request.cardElement]);

useEffect(() => {
    // Cerrado: no se arma nada. Al reabrir el efecto se vuelve a ejecutar desde
    // cero y el morph se repite con la ficha ya cargada dentro.
    if (dismissed) return;
    // La apertura necesita que el estado inicial (panel en el rect de la card,
    // vecinos desplazados fuera de pantalla) est� pintado y confirmado por el
    // navegador ANTES de cambiar a la geometr�a final: si el cambio de estado
    // llegara antes del primer frame, no habr�a valor previo del que transitar
    // y el morph �y con �l la entrada lateral de los vecinos� saldr�a de golpe.
    // Dos frames seguidos lo garantizan (un solo rAF a�n puede caer en el mismo
    // frame que el primer paint).
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!openedRef.current) setOpened(true);
      });
    });
    surfaceRef.current?.focus({ preventScroll: true });
    if (reduced) setOpened(true);
    const settled = window.setTimeout(
      () => setStage(current => current === "morphing" ? "held" : current),
      reduced ? 0 : SHELL_OPEN_MS,
    );
    beginReveal(SHELL_OPEN_MS + SHELL_HOLD_MS);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(settled);
    };
  }, [beginReveal, dismissed, reduced]);

  useEffect(() => {
    if (stage !== "closing") return;
    setActive(false);
    const timer = window.setTimeout(onClose, reduced ? 0 : 260);
    return () => window.clearTimeout(timer);
  }, [stage, reduced, onClose]);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setTimeout(() => setActive(true), reduced ? 0 : 500);
    return () => window.clearTimeout(timer);
  }, [expanded, reduced]);

  // Marca temporal de la expansión para la gracia anti-doble-Enter.
  const expandedAtRef = useRef(0);
  useEffect(() => {
    if (stage === "expanded") expandedAtRef.current = Date.now();
  }, [stage]);

  useEffect(() => {
    setMountedIndices(current => current.has(index) ? current : new Set(current).add(index));
    setReady(readyIndices.has(index));
  }, [index, readyIndices]);

  // Precalienta los bytes finales (misma ventana visible que el render ±2, con
  // vuelta incluida porque el carrusel no tiene fin): cuando el Detail confirme
  // el backdrop, el <img> lo saca de caché en vez de descargarlo desde cero.
  useEffect(() => {
    for (let offset = -2; offset <= 2; offset += 1) {
      const neighbour = ((index + offset) % count + count) % count;
      preloadArtwork(items[neighbour]?.background);
    }
    // items es estable (vive en el request); el índice manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (!artwork || !ready || !artworkReady || previewRevealed) return;
    const timer = window.setTimeout(() => setRevealedPreviewKeys(current => {
      if (current.has(previewKey)) return current;
      return new Set(current).add(previewKey);
    }), reduced ? 0 : 120);
    return () => window.clearTimeout(timer);
  }, [artwork, artworkReady, previewKey, previewRevealed, ready, reduced]);

  const registerIframe = useCallback((frameIndex: number, node: HTMLIFrameElement | null) => {
    if (node) iframeRefs.current.set(frameIndex, node);
    else iframeRefs.current.delete(frameIndex);
  }, []);

  const sendActivation = useCallback(() => {
    const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
    const externalFlag = !!renderBackdrop;
    const animateFrame = !externalFlag && !dismissed && (stage === "expanded"
      || (isPreviewStage(stage) && revealed && previewReady));
    iframeRefs.current.forEach((frame, frameIndex) => {
      frame.contentWindow?.postMessage({
        source: SHELL_PREVIEW_MESSAGE_SOURCE, type: "activate", active: active && frameIndex === index,
        animated: animateFrame && frameIndex === index, externalFlag,
        density: compact.density,
      }, targetOrigin);
    });
  }, [active, compact.density, dismissed, index, previewReady, renderBackdrop, revealed, stage]);

  useEffect(() => { sendActivation(); }, [sendActivation, ready]);

  // El stagger vive dentro del iframe (los bloques son del Detail), así que el
  // reveal también viaja por postMessage: solo la ficha activa lo recibe y el
  // resto se queda en hero aunque su iframe siga montado.
  const sendReveal = useCallback(() => {
    const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
    iframeRefs.current.forEach((frame, frameIndex) => {
      frame.contentWindow?.postMessage({
        source: SHELL_PREVIEW_MESSAGE_SOURCE, type: "reveal",
        on: frameIndex === index && revealed && previewReady,
      }, targetOrigin);
    });
  }, [index, previewReady, revealed]);

  useEffect(() => { sendReveal(); }, [sendReveal, ready]);

  // Espejo por refs para los handlers (teclado, mensajes, mando): se registran
  // una sola vez y siempre leen el estado vigente (sin cierres obsoletos).
  const shellStateRef = useRef({ index, stage, active, count });
  shellStateRef.current = { index, stage, active, count };
  const posRef = useRef(pos);
  posRef.current = pos;
  const expandRef = useRef(expand);
  expandRef.current = expand;
  const restartBeatRef = useRef(restartBeat);
  restartBeatRef.current = restartBeat;

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      // Overlay cerrado: los iframes siguen vivos y pueden seguir avisando
      // (imágenes que terminan de decodificar), pero ya no se hace nada con ello.
      if (dismissedRef.current) return;
      const frameIndex = Array.from(iframeRefs.current.entries())
        .find(([, frame]) => frame.contentWindow === event.source)?.[0];
      if (frameIndex === undefined) return;
      if (!isShellPreviewMessage(event.data)) return;
      const message = event.data;
      if (message.type === "loading") {
        // `ready` no es permanente: un Detail cacheado puede revalidarse y un
        // iframe visitado puede desmontarse/recrearse. Invalidar su marca al
        // inicio de cada carga evita que un A posterior use un ready viejo y
        // revele el skeleton de la nueva carga.
        setReadyIndices(current => {
          if (!current.has(frameIndex)) return current;
          const next = new Set(current);
          next.delete(frameIndex);
          return next;
        });
        if (frameIndex === index) {
          setReady(false);
          setRevealed(false);
        }
        return;
      }
      if (message.type === "ready") {
        setReadyIndices(current => current.has(frameIndex) ? current : new Set(current).add(frameIndex));
        if (frameIndex === index) setReady(true);
        return;
      }
      if (message.type === "background") {
        const background = fullResArtworkUrl(message.background) ?? message.background;
        setArtworkByIndex(current => current.get(frameIndex) === background
          ? current
          : new Map(current).set(frameIndex, background));
        return;
      }
      // El reveal solo va en sentido contrario (parent → iframe): si un iframe lo
      // devolviera, se ignora en vez de caer en la rama de `navigate`.
      if (message.type === "reveal") return;
      if (frameIndex !== index) return;
      // Back/B desde el detail expandido: volver al carrusel (colapsar), no
      // al home. Solo cierra del todo si ya estaba colapsado.
      if (message.type === "close") {
        if (shellStateRef.current.stage === "expanded") collapse();
        else close();
        return;
      }
      const path = message.path;
      if (isShellPreviewInternalPath(path.split(/[?#]/, 1)[0])) return;
      // Embedded actions must never drop the user into desktop mode.
      const url = new URL(path, window.location.href);
      if (!url.pathname.startsWith("/big-picture/")) url.pathname = `/big-picture${url.pathname}`;
      url.searchParams.delete("shellPreview");
      restoreFocusRef.current = false;
      const background = artworkByIndex.get(frameIndex)
        ?? fullResArtworkUrl(items[frameIndex]?.background)
        ?? items[frameIndex]?.background;
      onNavigate(`${url.pathname}${url.search}${url.hash}`, frameIndex, background);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [artworkByIndex, close, collapse, index, items, onNavigate]);

  const expansionEnterRef = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Con el overlay cerrado el teclado es del home, no del carrusel.
      if (dismissedRef.current) return;
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape", "Esc", "Tab"].includes(key)) return;
      // Con otra capa encima (picker de arte, menú contextual) el teclado es
      // suyo: la shell ni consume ni reenvía, o las flechas moverían el
      // carrusel/expandirían el detalle detrás del panel.
      if (hasOverlayAboveShell()) return;
      const state = shellStateRef.current;
      event.preventDefault();
      event.stopImmediatePropagation();
      // La pulsación que expandió la shell puede soltar el botón cuando el
      // iframe ya está activo y enfocado en Reproducir. Consumir el down/up
      // completo evita que ese mismo A/Enter se convierta en un click de play.
      if (key === "Enter" && expansionEnterRef.current) {
        if (event.type === "keyup") expansionEnterRef.current = false;
        return;
      }
      if (state.active && state.stage === "expanded") {
        // Gracia anti-doble-Enter: el Enter que expandió no activa Reproducir.
        // El repeat de Enter tampoco se reenvía (un solo click por pulsación).
        if (key === "Enter" && (event.repeat
          || Date.now() - expandedAtRef.current < SHELL_ENTER_ARM_MS)) {
          return;
        }
        iframeRefs.current.get(state.index)?.contentWindow?.postMessage({
          source: SHELL_PREVIEW_MESSAGE_SOURCE, type: "key", key,
          eventType: event.type, repeat: event.repeat, shiftKey: event.shiftKey,
          hold: !!(event as KeyboardEvent & { aetherioGamepadHold?: boolean }).aetherioGamepadHold,
        }, window.location.origin === "null" ? "*" : window.location.origin);
        return;
      }
      if (event.type !== "keydown" || state.stage === "closing") return;
      // Back/B directo con el detail expandido pero aún sin activar (ventana
      // de ~500ms): colapsar al carrusel, no cerrar al home.
      if ((key === "Escape" || key === "Esc") && state.stage === "expanded") {
        collapse();
        return;
      }
      if (key === "Escape" || key === "Esc" || (key === "ArrowUp" && isPreviewStage(state.stage))) {
        close();
        return;
      }
      // Analógico abajo en el carrusel (sin expandir): expande la shell como
      // Enter, pero sin navegar a la page detail (solo expandir). Se permite
      // el repeat para poder mantener y seguir bajando dentro del detalle.
      // Si el Detail esta listo, Enter/abajo puede saltarse el beat y expandir;
      // expand() valida el readiness otra vez antes de mostrar el iframe.
      if ((key === "ArrowDown" || (key === "Enter" && !event.repeat)) && isPreviewStage(state.stage)) {
        if (key === "Enter") expansionEnterRef.current = true;
        expandRef.current();
        return;
      }
      if (isPreviewStage(state.stage) && (key === "ArrowLeft" || key === "ArrowRight")) {
        // El carrusel no tiene fin: `pos` no se acota nunca, así que desde la
        // última se sigue por la primera y desde la primera se vuelve a la
        // última (y al revés). El hueco de cada ficha se mide por wrapDelta, así
        // el cruce del borde es un paso más y no un salto.
        const step = key === "ArrowRight" ? 1 : -1;
        const next = posRef.current + step;
        const nextIndex = ((next % state.count) + state.count) % state.count;
        if (nextIndex !== state.index) {
          // `readyIndices` es memoria historica por ficha, pero un iframe que
          // salio de la ventana ±2 se desmonta. Si vuelve a entrar, su marca
          // anterior no vale para el nuevo documento: hasta que ese iframe
          // vuelva a emitir `ready`, debe permanecer cerrado.
          const frameStillMounted = iframeRefs.current.has(nextIndex);
          if (!frameStillMounted) {
            setReadyIndices(current => {
              if (!current.has(nextIndex)) return current;
              const refreshed = new Set(current);
              refreshed.delete(nextIndex);
              return refreshed;
            });
          }
          setReady(frameStillMounted && readyIndicesRef.current.has(nextIndex));
          setMountedIndices(current => current.has(nextIndex) ? current : new Set(current).add(nextIndex));
          setPos(next);
          restartBeatRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [close, collapse]);

  useEffect(() => {
    const onGamepadAction = (event: Event) => {
      if (dismissedRef.current) return;
      // Igual que el teclado: con una capa encima (picker/menú) las acciones
      // son para ella, no para el carrusel de debajo.
      if (hasOverlayAboveShell()) return;
      const id = (event as CustomEvent<{ id?: GamepadActionId; repeat?: boolean }>).detail?.id;
      const state = shellStateRef.current;
      // Analógico/D-pad abajo en el carrusel (sin expandir): expande la shell
      // como Enter, pero sin navegar a la page detail (solo expandir). Se
      // reclama la acción para que useGamepad no sintetice ArrowDown de más.
      if ((id === "open-controls" || id === "dpad-down") && isPreviewStage(state.stage)) {
        event.preventDefault();
        expandRef.current();
        return;
      }
      if (id !== "lb" && id !== "rb") return;
      if (!state.active || state.stage !== "expanded") return;
      iframeRefs.current.get(state.index)?.contentWindow?.postMessage({
        source: SHELL_PREVIEW_MESSAGE_SOURCE,
        type: "gamepad-action",
        id,
        repeat: Boolean((event as CustomEvent<{ repeat?: boolean }>).detail?.repeat),
      }, window.location.origin === "null" ? "*" : window.location.origin);
      // Prevent useGamepad from synthesizing PageUp/PageDown against the shell
      // iframe. The embedded Detail receives the normalized action instead.
      event.preventDefault();
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, []);

  return createPortal(
    <div className="bp-shell-preview" data-shell-preview data-spatial-modal data-stage={stage}
      data-opened={opened ? "true" : "false"}
      hidden={dismissed || undefined}
      style={{
        "--shell-density": compact.density,
        "--shell-gap": `${12 * compact.density}px`,
        "--shell-collapse": `${SHELL_COLLAPSE_MS}ms`,
        // Margen exterior del panel compacto: es lo que tienen que recorrer los
        // vecinos para entrar por su lado (ver data-shell-side en el CSS).
        "--shell-inset": `${compact.left}px`,
        // Hueco que ocupa la ficha activa; el track lo compensa para centrarla.
        "--shell-slot": pos,
      } as CSSProperties}>
      <div className="bp-shell-preview__backdrop" aria-hidden="true" />
      <div ref={surfaceRef} className="bp-shell-preview__viewport" role="dialog" aria-modal="true"
        aria-label={item.title} tabIndex={-1} onClick={!expanded ? expand : undefined}
        style={bounds as CSSProperties}>
        <div className="bp-shell-preview__track">
          {items.map((entry, i) => {
            // Hueco que ocupa esta ficha respecto a la activa, medido por el
            // lado más corto porque el carrusel da la vuelta. Al cruzar el
            // borde la ficha conserva su hueco y el desplazamiento del track
            // hace de paso: nunca se ve el salto.
            const slot = wrapDelta(i, index, count);
            // Ventana visible del carrusel: el activo mas dos vecinos por
            // lado (como el nativo). Los iframes solo se montan al visitar
            // cada shell y ya no se desmontan, para conservar su estado.
            if (slot !== 0 && (expanded || Math.abs(slot) > 2)) return null;
            // Capas sin desmontaje: la foto de la card primero (ya está en
            // caché de la fila, así pinta en el primer frame y su entrada
            // lateral se ve) y el `original` del Detail fundido encima cuando
            // esté decodificado. Nunca hay negro ni recarga visible.
            const resolved = artworkByIndex.get(i);
            const finalArtwork = fullResArtworkUrl(entry.background) ?? entry.background;
            const baseArtwork = entry.cardBackground ?? finalArtwork;
            const showFinal = !!resolved && resolved !== baseArtwork && resolved !== finalArtwork;
            const baseArtworkKey = baseArtwork ? `${entry.detailPath}:${baseArtwork}` : "";
            const finalArtworkKey = finalArtwork !== baseArtwork && finalArtwork ? `${entry.detailPath}:${finalArtwork}` : "";
            const resolvedArtworkKey = resolved ? `${entry.detailPath}:${resolved}` : "";
            const resolvedPreviewKey = resolved ? `${i}:${resolved}` : "";
            const itemPreviewReady = i === index && ready && (!resolved
              || (loadedArtworkKeys.has(resolvedArtworkKey) && revealedPreviewKeys.has(resolvedPreviewKey)));
            // Keep the shell-owned cloth running through reveal and expansion;
            // the selected iframe remains transparent and never replaces it.
            const animateBackdrop = i === index && !dismissed && stage !== "closing";
            const markUrlLoaded = (key: string) => {
              if (!key) return;
              setLoadedArtworkKeys(current => {
                if (current.has(key)) return current;
                const next = new Set(current);
                next.add(key);
                return next;
              });
            };
            return (
              <div className="bp-shell-preview__panel" key={entry.detailPath + i}
                data-shell-side={slot === 0 ? "active" : slot < 0 ? "start" : "end"}
                data-shell-external-flag={renderBackdrop ? "true" : undefined}
                aria-hidden={i !== index} style={{
                  left: `calc(${(pos + slot)} * (100% + var(--shell-gap)))`,
                  visibility: i === index || !expanded ? "visible" : "hidden",
                }}>
                {renderBackdrop && <div className="bp-shell-preview__match-backdrop" aria-hidden="true" inert>{renderBackdrop(entry, animateBackdrop,
                  fullSizeBackdrop ? viewport.width : compact.width, fullSizeBackdrop ? viewport.height : compact.height)}</div>}
                {baseArtwork ? <img
                  className={`bp-shell-preview__artwork${loadedArtworkKeys.has(baseArtworkKey) ? " is-loaded" : ""}`}
                  src={baseArtwork}
                  alt=""
                  decoding="async"
                  // Alta en las tres fichas visibles: la vecina tiene que estar
                  // pintada en el mismo frame que entra, o su deslizamiento
                  // lateral se vería sobre un hueco vacío.
                  fetchPriority="high"
                  onLoad={() => markUrlLoaded(baseArtworkKey)}
                  onError={() => markUrlLoaded(baseArtworkKey)}
                /> : null}
                {finalArtworkKey ? <img
                  className={`bp-shell-preview__artwork${loadedArtworkKeys.has(finalArtworkKey) ? " is-loaded" : ""}`}
                  src={finalArtwork}
                  alt=""
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => markUrlLoaded(finalArtworkKey)}
                  onError={() => markUrlLoaded(finalArtworkKey)}
                /> : null}
                {showFinal ? <img
                  className={`bp-shell-preview__artwork${loadedArtworkKeys.has(resolvedArtworkKey) ? " is-loaded" : ""}`}
                  src={resolved}
                  alt=""
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => markUrlLoaded(resolvedArtworkKey)}
                  onError={() => markUrlLoaded(resolvedArtworkKey)}
                /> : null}
                {mountedIndices.has(i) ? <iframe ref={node => registerIframe(i, node)} title={`Detalle de ${entry.title}`}
                   src={withShellPreviewQuery(entry.detailPath)} tabIndex={active && i === index ? 0 : -1}
                   inert={!active || i !== index} allow="autoplay; fullscreen; picture-in-picture"
                   referrerPolicy="same-origin" data-preview-ready={itemPreviewReady ? "true" : "false"}
                   data-shell-external-flag={renderBackdrop ? "true" : undefined}
                   data-preview-revealed={i === index && revealed && previewReady ? "true" : "false"}
                  onLoad={sendActivation} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>, document.body,
  );
}

/** Only the detail subtree runs in this document; no app shell or gamepad poller. */
export function ShellPreviewApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const initialPathRef = useRef(location.pathname);
  const [active, setActive] = useState(false);
  const [previewMotion, setPreviewMotion] = useState(false);
  const [externalFlag, setExternalFlag] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  // El padre manda cuándo entra el contenido: hasta ese momento el hero se ve
  // solo y los bloques del detalle esperan escondidos (ver data-hero-reveal).
  const revealedRef = useRef(false);
  // Gracia anti-doble-Enter del lado iframe (cubre el teclado físico, que va
  // directo al iframe sin pasar por el forward del parent).
  const previewActiveSinceRef = useRef(0);

  const signalDetailBackground = useCallback((background: string) => {
    postShellPreviewMessage({ type: "background", background });
  }, []);

  const signalDetailLoading = useCallback(() => {
    setDetailReady(false);
    postShellPreviewMessage({ type: "loading" });
  }, []);

  const signalDetailReady = useCallback(() => {
    setDetailReady(true);
    postShellPreviewMessage({ type: "ready" });
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("aetherio-shell-preview");
    return () => document.documentElement.classList.remove("aetherio-shell-preview");
  }, []);

  useEffect(() => { postShellPreviewMessage({ type: "navigate", path: currentPath }); }, [currentPath]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.source !== SHELL_PREVIEW_MESSAGE_SOURCE) return;
      if (message.type === "activate" && typeof message.active === "boolean") {
        // Una shell que deja de ser la superficie activa vuelve a su hero. El
        // preview compacto ya le da el alto del hero, así que es el estado en el
        // que una ficha debe descansar; y al colapsar, esto es lo que repliega el
        // blur y la zona de contenido durante el propio redimensionado, en vez
        // de dejar el carrusel con la ficha a media pantalla. El fade lo hace el
        // Detail al recibir el evento (va por su propio scroll).
        if (!message.active) exitDetailContentZone();
        setActive(message.active);
        if (typeof message.animated === "boolean") setPreviewMotion(message.animated);
        if (typeof message.externalFlag === "boolean") setExternalFlag(message.externalFlag);
      }
      if (message.type === "reveal" && typeof message.on === "boolean") {
        // This flag only drives CSS reveal selectors. Mutating the attribute
        // avoids rerendering the entire match/standings tree at the exact moment
        // the full-window iframe becomes visible over the live shell canvas.
        revealedRef.current = message.on;
        const app = document.querySelector<HTMLElement>(".shell-preview-app");
        if (app) app.dataset.previewRevealed = String(message.on);
        return;
      }
      if (message.type === "gamepad-action"
        && (message.id === "lb" || message.id === "rb")) {
        dispatchGamepadAction(message.id, Boolean(message.repeat));
        return;
      }
      if (message.type === "key" && active && ["keydown", "keyup"].includes(message.eventType)
        && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape", "Esc", "Tab"].includes(message.key)) {
        // Misma gracia que el parent: el Enter reenviado justo tras expandir
        // (doble pulsación) o con repeat no activa Reproducir.
        if (message.key === "Enter" && (!!message.repeat
          || Date.now() - previewActiveSinceRef.current < SHELL_ENTER_ARM_MS)) {
          return;
        }
        const event = new KeyboardEvent(message.eventType, { key: message.key, bubbles: true, cancelable: true, repeat: !!message.repeat, shiftKey: !!message.shiftKey });
        (event as KeyboardEvent & { aetherioGamepadHold?: boolean }).aetherioGamepadHold = !!message.hold;
        (document.activeElement ?? document.body).dispatchEvent(event);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    previewActiveSinceRef.current = Date.now();
    // Bloqueo en captura ANTES de la navegación espacial: el Enter físico
    // directo al iframe durante la gracia (o con repeat) no debe activar
    // Reproducir. Se registra antes de installSpatialNavigation para ganarle
    // en el orden de listeners del mismo nodo.
    const onGuard = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (!event.repeat && Date.now() - previewActiveSinceRef.current >= SHELL_ENTER_ARM_MS) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onGuard, true);
    window.addEventListener("keyup", onGuard, true);
    const uninstall = installSpatialNavigation();
    const focus = window.requestAnimationFrame(() => {
      (document.querySelector<HTMLElement>("[data-hero-primary]")
        ?? document.querySelector<HTMLElement>("button, [tabindex='0']"))?.focus({ preventScroll: true });
    });
    return () => {
      window.removeEventListener("keydown", onGuard, true);
      window.removeEventListener("keyup", onGuard, true);
      uninstall();
      window.cancelAnimationFrame(focus);
    };
  }, [active]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active) return;
      if (event.key === "Tab") {
        const controls = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0'], input"))
          .filter(el => !el.closest('[inert], [aria-hidden="true"]') && !el.hasAttribute("disabled") && el.getClientRects().length > 0);
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length];
        event.preventDefault();
        next?.focus({ preventScroll: true });
      }
      if (event.defaultPrevented || (event.key !== "Escape" && event.key !== "Esc")) return;
      event.preventDefault();
      event.stopPropagation();
      // El colapso es lo que corresponde: la ficha se encoge hasta su hueco del
      // carrusel y, por el camino, el Detail repliega su zona de contenido hacia
      // el hero (ver el activate:false de más abajo). Solo si el hero ya está
      // puesto esto no tiene nada que replegar y el "atrás" sí sale.
      if (location.pathname !== initialPathRef.current && !location.pathname.startsWith("/big-picture/detail/")) navigate(-1);
      else postShellPreviewMessage({ type: "close" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, location.pathname, navigate]);

  return (
    <div className="big-picture shell-preview-app" data-aetherio-big-picture data-preview-active={active}
      data-preview-revealed={revealedRef.current} data-detail-ready={detailReady}
      style={{ "--app-shell-nav-height": "0px" } as CSSProperties}>
      <Suspense fallback={<div className="shell-preview-app__fallback" />}>
        <Routes>
          <Route path="/big-picture/detail/:type/:id" element={<DetailPage
            onShellPreviewLoading={signalDetailLoading}
            onShellPreviewBackground={signalDetailBackground}
            onShellPreviewReady={signalDetailReady}
          />} />
          <Route path="/big-picture/detail/:type/:id/:section" element={<DetailSectionPage />} />
          <Route path="/big-picture/person/:id" element={<PersonPage />} />
          <Route path="/big-picture/entity/:kind/:id" element={<EntityPage />} />
          {SportsMatchPage && <Route path="/big-picture/sports/match/:matchId" element={<SportsMatchPage onShellPreviewLoading={signalDetailLoading} onShellPreviewReady={signalDetailReady} shellActive={active} shellAnimated={previewMotion} shellExternalFlag={externalFlag} />} />}
          <Route path="*" element={<div className="shell-preview-app__fallback" />} />
        </Routes>
      </Suspense>
      {/* La pill/sidebar de Big Picture vive fuera de la app shell, así que este
         documento la tiene que montar él mismo: al expandir la shell el overlay
         .bp-shell-preview (z-index 1500) tapa por completo la rail real del
         padre, y sin esta copia el detalle se queda sin navegación lateral.
         Se monta solo cuando el iframe es la superficie activa —en el carrusel
         colapsado sería un overlay suelto flotando sobre cada miniatura— y su
         navegación interna (detail/person/entity) no existe en este documento,
         así que al pulsar otro destino el <Routes> cae en "*" y el mensaje
         `navigate` (L434) hace que el parent entregue a la app real. */}
      {active && (location.pathname.startsWith("/big-picture/sports/") && SportsRail
        ? <Suspense fallback={<div className="shell-preview-app__fallback" />}><SportsRail /></Suspense>
        : <BigPictureRail />)}
    </div>
  );
}
