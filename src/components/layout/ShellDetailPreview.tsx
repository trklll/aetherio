import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
  SHELL_PREVIEW_MESSAGE_SOURCE,
  withShellPreviewQuery,
  type ShellPreviewRequest,
} from "../../utils/shellPreview";
import BigPictureRail from "../../pages/BigPicture/BigPictureRail.tsx";
import "../../pages/BigPicture/BigPicture.css";
import "../../pages/BigPicture/ShellDetailPreview.css";

const DetailPage = lazy(() => import("../../pages/Detail"));
const DetailSectionPage = lazy(() => import("../../pages/Detail/DetailSectionPage"));
const PersonPage = lazy(() => import("../../pages/Person"));
const EntityPage = lazy(() => import("../../pages/Entity"));

interface ShellDetailPreviewProps {
  request: ShellPreviewRequest;
  onClose: () => void;
  onNavigate: (path: string, activeIndex: number, background?: string) => void;
}

type Stage = "entering" | "entered" | "collapsing" | "expanded" | "closing";

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

export default function ShellDetailPreview({ request, onClose, onNavigate }: ShellDetailPreviewProps) {
  const items = request.items?.length ? request.items : [request];
  const initialIndex = Math.max(0, Math.min(request.initialIndex ?? 0, items.length - 1));
  const [index, setIndex] = useState(initialIndex);
  const [stage, setStage] = useState<Stage>("entering");
  const [opened, setOpened] = useState(false);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [readyIndices, setReadyIndices] = useState<Set<number>>(() => new Set());
  const [mountedIndices, setMountedIndices] = useState<Set<number>>(() => new Set([initialIndex]));
  const [artworkByIndex, setArtworkByIndex] = useState<Map<number, string>>(() => new Map());
  const [loadedArtworkKeys, setLoadedArtworkKeys] = useState<Set<string>>(() => new Set());
  const [revealedPreviewKeys, setRevealedPreviewKeys] = useState<Set<string>>(() => new Set());
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const compact = shellPreviewBounds(viewport.width, viewport.height);
  const [source] = useState(() => {
    const rect = request.cardElement?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : compact;
  });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const iframeRefs = useRef<Map<number, HTMLIFrameElement>>(new Map());
  const restoreFocusRef = useRef(true);
  const selectedRef = useRef(items[index]);
  selectedRef.current = items[index];
  const expanded = stage === "expanded";
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
  const close = useCallback(() => {
    window.clearTimeout(collapseTimerRef.current);
    setStage("closing");
  }, []);
  const expand = useCallback(() => {
    // Reanudar la expansión durante un colapso a medio salir cancela el reposo:
    // si no, el timer dejaría la shell en "entered" con la vista ya expandida.
    window.clearTimeout(collapseTimerRef.current);
    setStage(current => (previewReady && current !== "closing" && current !== "expanded") ? "expanded" : current);
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
      () => setStage(current => (current === "collapsing" ? "entered" : current)),
      reduced ? 0 : SHELL_COLLAPSE_MS,
    );
    window.setTimeout(() => surfaceRef.current?.focus({ preventScroll: true }), 0);
  }, [reduced]);

  useEffect(() => () => window.clearTimeout(collapseTimerRef.current), []);

  useEffect(() => {
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    const shell = document.querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]");
    const previousOverflow = shell?.style.overflowY ?? "";
    if (shell) {
      stopInertialScroll(shell);
      shell.style.overflowY = "hidden";
    }
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => {
      if (root) root.inert = wasInert;
      if (shell) shell.style.overflowY = previousOverflow;
      window.removeEventListener("resize", resize);
      if (restoreFocusRef.current) {
        const selected = selectedRef.current;
        if (selected.restoreFocus) selected.restoreFocus();
        else (selected.cardElement?.isConnected ? selected.cardElement : request.cardElement)?.focus({ preventScroll: true });
      }
    };
  }, [request.cardElement]);

  useEffect(() => {
    const start = window.setTimeout(() => {
      surfaceRef.current?.focus({ preventScroll: true });
      setOpened(true);
    }, reduced ? 0 : 16);
    const settled = window.setTimeout(() => setStage(current => current === "entering" ? "entered" : current), reduced ? 0 : 516);
    return () => { window.clearTimeout(start); window.clearTimeout(settled); };
  }, [reduced]);

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

  // Precalienta los bytes finales (misma ventana visible que el render ±2):
  // cuando el Detail confirme el backdrop, el <img> lo saca de caché en vez
  // de descargarlo desde cero.
  useEffect(() => {
    for (let i = Math.max(0, index - 2); i <= Math.min(items.length - 1, index + 2); i++) {
      preloadArtwork(items[i]?.background);
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
    iframeRefs.current.forEach((frame, frameIndex) => {
      frame.contentWindow?.postMessage({
        source: SHELL_PREVIEW_MESSAGE_SOURCE, type: "activate", active: active && frameIndex === index,
        density: compact.density,
      }, targetOrigin);
    });
  }, [active, compact.density, index]);

  useEffect(() => { sendActivation(); }, [sendActivation, ready]);

  // Espejo por refs para los handlers (teclado, mensajes, mando): se registran
  // una sola vez y siempre leen el estado vigente (sin cierres obsoletos).
  const shellStateRef = useRef({ index, stage, active, count: items.length });
  shellStateRef.current = { index, stage, active, count: items.length };
  const shellReadyRef = useRef(readyIndices);
  shellReadyRef.current = readyIndices;
  const expandRef = useRef(expand);
  expandRef.current = expand;

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      const frameIndex = Array.from(iframeRefs.current.entries())
        .find(([, frame]) => frame.contentWindow === event.source)?.[0];
      if (frameIndex === undefined) return;
      if (!isShellPreviewMessage(event.data)) return;
      const message = event.data;
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
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape", "Esc", "Tab"].includes(key)) return;
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
      if (key === "Escape" || key === "Esc"
        || (key === "ArrowUp" && (state.stage === "entering" || state.stage === "entered"))) {
        close();
        return;
      }
      // Analógico abajo en el carrusel (sin expandir): expande la shell como
      // Enter, pero sin navegar a la page detail (solo expandir). Se permite
      // el repeat para poder mantener y seguir bajando dentro del detalle.
      if ((key === "ArrowDown" || (key === "Enter" && !event.repeat))
        && (state.stage === "entering" || state.stage === "entered")) {
        if (key === "Enter") expansionEnterRef.current = true;
        expandRef.current();
        return;
      }
      if ((state.stage === "entering" || state.stage === "entered")
        && (key === "ArrowLeft" || key === "ArrowRight")) {
        const next = Math.max(0, Math.min(state.count - 1, state.index + (key === "ArrowRight" ? 1 : -1)));
        if (next !== state.index) {
          setReady(shellReadyRef.current.has(next));
          setMountedIndices(current => current.has(next) ? current : new Set(current).add(next));
          setIndex(next);
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
      const id = (event as CustomEvent<{ id?: GamepadActionId; repeat?: boolean }>).detail?.id;
      const state = shellStateRef.current;
      // Analógico/D-pad abajo en el carrusel (sin expandir): expande la shell
      // como Enter, pero sin navegar a la page detail (solo expandir). Se
      // reclama la acción para que useGamepad no sintetice ArrowDown de más.
      if ((id === "open-controls" || id === "dpad-down")
        && (state.stage === "entering" || state.stage === "entered")) {
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
      style={{
        "--shell-density": compact.density,
        "--shell-gap": `${12 * compact.density}px`,
        "--shell-collapse": `${SHELL_COLLAPSE_MS}ms`,
      } as CSSProperties}>
      <div className="bp-shell-preview__backdrop" aria-hidden="true" />
      <div ref={surfaceRef} className="bp-shell-preview__viewport" role="dialog" aria-modal="true"
        aria-label={item.title} tabIndex={-1} onClick={!expanded ? expand : undefined}
        style={{ ...bounds, "--shell-index": expanded ? 0 : index } as CSSProperties}>
        <div className="bp-shell-preview__track">
          {items.map((entry, i) => {
            // Ventana visible del carrusel: el activo mas dos vecinos por
            // lado (como el nativo). Los iframes solo se montan al visitar
            // cada shell y ya no se desmontan, para conservar su estado.
            if (i !== index && (expanded || Math.abs(i - index) > 2)) return null;
            // Capas sin desmontaje: base de la card siempre visible + imagen
            // final del Detail fundida encima cuando está decodificada. Así
            // nunca hay negro ni recarga visible al moverse entre shells: la
            // base ya estaba pintada y el final hace dissolve sobre ella.
             const resolved = artworkByIndex.get(i);
             const baseBackground = fullResArtworkUrl(entry.background) ?? entry.background;
            const showFinal = !!resolved && resolved !== baseBackground;
            const baseArtworkKey = baseBackground ? `${entry.detailPath}:${baseBackground}` : "";
            const resolvedArtworkKey = resolved ? `${entry.detailPath}:${resolved}` : "";
            const resolvedPreviewKey = resolved ? `${i}:${resolved}` : "";
            const itemPreviewReady = i === index && ready && (!resolved
              || (loadedArtworkKeys.has(resolvedArtworkKey) && revealedPreviewKeys.has(resolvedPreviewKey)));
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
                aria-hidden={i !== index} style={{
                  left: expanded ? (i === index ? 0 : "100%") : `calc(${i} * (100% + var(--shell-gap)))`,
                  visibility: i === index || !expanded ? "visible" : "hidden",
                }}>
                {baseBackground ? <img
                  className={`bp-shell-preview__artwork${loadedArtworkKeys.has(baseArtworkKey) ? " is-loaded" : ""}`}
                  src={baseBackground}
                  alt=""
                  decoding="async"
                  fetchPriority={i === index ? "high" : "low"}
                  onLoad={() => markUrlLoaded(baseArtworkKey)}
                  onError={() => markUrlLoaded(baseArtworkKey)}
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
  const [detailReady, setDetailReady] = useState(false);
  // Gracia anti-doble-Enter del lado iframe (cubre el teclado físico, que va
  // directo al iframe sin pasar por el forward del parent).
  const previewActiveSinceRef = useRef(0);

  const signalDetailBackground = useCallback((background: string) => {
    postShellPreviewMessage({ type: "background", background });
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
      data-detail-ready={detailReady}
      style={{ "--app-shell-nav-height": "0px" } as CSSProperties}>
      <Suspense fallback={<div className="shell-preview-app__fallback" />}>
        <Routes>
          <Route path="/big-picture/detail/:type/:id" element={<DetailPage
            onShellPreviewBackground={signalDetailBackground}
            onShellPreviewReady={signalDetailReady}
          />} />
          <Route path="/big-picture/detail/:type/:id/:section" element={<DetailSectionPage />} />
          <Route path="/big-picture/person/:id" element={<PersonPage />} />
          <Route path="/big-picture/entity/:kind/:id" element={<EntityPage />} />
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
      {active && <BigPictureRail />}
    </div>
  );
}
