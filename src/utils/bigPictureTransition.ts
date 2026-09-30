import aetherioLogo from "../assets/aetheriologo.png";
import aetherioTvLogo from "../../aetheriotvlogo.png";
import { gsap, prefersReducedMotion } from "./motion.ts";

/**
 * Transición cinematográfica normal <-> Big Picture (estilo Steam).
 *
 * Secuencia: COVER (0.3s) -> navigate bajo el velo -> HOLD hasta que el
 * destino existe y asienta -> REVEAL (0.55s).
 *
 * El HOLD es la pieza que evita el tirón del último frame: el montaje del
 * destino (chunk lazy, catálogos, backdrop/vídeo, toggle de clases) es el
 * trabajo más pesado y antes caía a mitad del reveal. Ahora cae bajo el
 * velo opaco y el reveal solo arranca con el DOM asentado (2 frames
 * seguidos con el modo visible, o timeout de 1.5s como red de seguridad).
 *
 * Apple §4/§7/§12:
 * - Simetría: entrar y salir recorren el mismo camino (cover expo.in,
 *   reveal expo.out espejado). Sin slides opuestos.
 * - Damping 1.0 (sin bounce): un cambio de modo no es un gesto con
 *   momentum, el overshoot estaría fuera de lugar.
 * - Solo transform + opacity sobre #root (compositor, §11). El velo es una
 *   capa opaca estática: NADA de blur animado a pantalla completa, que es
 *   lo que más frames cuesta y además crea containing block para los
 *   `position: fixed` del Big Picture.
 * - Interruptible (§3): overwrite:"auto", los .to() parten del valor de
 *   presentación; un token de generación invalida los holds viejos.
 * - Reduced motion (§14): corte directo, sin velo ni escala.
 *
 * El overlay vive en document.body (fuera de #root) para sobrevivir al
 * desmontaje de AppShell/BigPicturePage durante el navigate.
 */

export type ModeTransitionDirection = "enter" | "exit";
type ModeTransitionPhase = "idle" | "cover" | "reveal" | "brand";

const OVERLAY_ID = "aetherio-bp-mode";
const GLOW_SELECTOR = "[data-bp-mode-glow]";
const BRAND_SELECTOR = "[data-bp-mode-brand]";
const BRAND_LOGO_SELECTOR = "[data-bp-mode-brand-logo]";
const BIG_PICTURE_SELECTOR = "[data-aetherio-big-picture]";
const SCROLL_SHELL_SELECTOR = "#root [data-aetherio-scroll-shell]";

const COVER_DURATION = 0.3;
const REVEAL_DURATION = 0.55;
const VEIL_OUT_DURATION = 0.5;
const BRAND_NAVIGATION_DELAY = 0.95;
const BRAND_HOLD_DURATION = 0.3;
const READY_TIMEOUT_MS = 1500;
const SETTLED_FRAMES = 2;

let activeTl: gsap.core.Timeline | null = null;
let holdPulse: gsap.core.Tween | null = null;
let holdRaf = 0;
let holdTimeout = 0;
let phase: ModeTransitionPhase = "idle";
let runId = 0;

export function getModeTransitionPhase(): ModeTransitionPhase {
  return phase;
}

export function getModeBrandLogo(direction: ModeTransitionDirection): string {
  return direction === "enter" ? aetherioTvLogo : aetherioLogo;
}

function ensureOverlay(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("aria-hidden", "true");
  const glow = document.createElement("div");
  glow.setAttribute("data-bp-mode-glow", "");
  const brand = document.createElement("div");
  brand.setAttribute("data-bp-mode-brand", "");
  const logo = document.createElement("img");
  logo.src = aetherioTvLogo;
  logo.alt = "";
  logo.draggable = false;
  logo.setAttribute("data-bp-mode-brand-logo", "");
  logo.dataset.bpModeLogo = "tv";
  brand.appendChild(logo);
  overlay.append(glow, brand);
  document.body.appendChild(overlay);
  return overlay;
}

function cancelHold(): void {
  if (holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = 0;
  if (holdTimeout) window.clearTimeout(holdTimeout);
  holdTimeout = 0;
  holdPulse?.kill();
  holdPulse = null;
}

/** El chunk del destino ya descargado antes del primer Start evita el peor tirón. */
function prefetchModeChunks(): void {
  const load = () => {
    try {
      void import("../pages/BigPicture/index.tsx");
    } catch {
      // Prefetch best-effort: el cover lo tapa de todos modos.
    }
  };
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 2000 });
  } else {
    window.setTimeout(load, 1500);
  }
}

/** Monta el overlay una vez (llamar desde main.tsx, como installGsapAnimations). */
export function installModeTransition(): () => void {
  if (typeof document === "undefined") return () => undefined;
  ensureOverlay();
  prefetchModeChunks();
  return () => {
    runId += 1;
    cancelHold();
    activeTl?.kill();
    activeTl = null;
    phase = "idle";
    document.getElementById(OVERLAY_ID)?.remove();
  };
}

export function showBigPictureBrand(onComplete: () => void): () => void {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    onComplete();
    return () => undefined;
  }

  const overlay = ensureOverlay();
  const brand = overlay?.querySelector<HTMLElement>(BRAND_SELECTOR) ?? null;
  const logo = brand?.querySelector<HTMLImageElement>(BRAND_LOGO_SELECTOR) ?? null;
  if (!overlay || !brand || !logo) {
    onComplete();
    return () => undefined;
  }

  const myRun = ++runId;
  let finished = false;
  cancelHold();
  activeTl?.kill();
  gsap.killTweensOf(overlay);
  gsap.killTweensOf(brand);
  gsap.killTweensOf(logo);

  overlay.dataset.direction = "enter";
  overlay.style.pointerEvents = "auto";
  logo.src = getModeBrandLogo("enter");
  logo.dataset.bpModeLogo = "tv";
  phase = "brand";
  gsap.set(overlay, { opacity: 1 });
  gsap.set(brand, { autoAlpha: 0, scale: 0.96, transformOrigin: "50% 50%" });
  gsap.set(logo, { scale: 1, transformOrigin: "50% 50%" });

  const finish = () => {
    if (finished || myRun !== runId) return;
    finished = true;
    gsap.set(overlay, { opacity: 0 });
    gsap.set(brand, { clearProps: "opacity,visibility,transform" });
    gsap.set(logo, { clearProps: "transform" });
    overlay.style.pointerEvents = "none";
    activeTl = null;
    phase = "idle";
    onComplete();
  };

  const tl = gsap.timeline({ onComplete: finish });
  activeTl = tl;
  tl
    .to(overlay, { opacity: 1, duration: 0.32, ease: "power2.out", overwrite: "auto" })
    .to(brand, { autoAlpha: 1, scale: 1, duration: 0.46, ease: "power3.out", overwrite: "auto" }, "<0.06")
    .to(logo, { scale: 1.018, duration: 0.48, ease: "sine.inOut", overwrite: "auto" }, `+=${BRAND_HOLD_DURATION}`)
    .to(brand, { autoAlpha: 0, scale: 1.025, duration: 0.44, ease: "power2.inOut", overwrite: "auto" }, "+=0.12")
    .to(overlay, { opacity: 0, duration: 0.36, ease: "power2.inOut", overwrite: "auto" }, "<0.06");

  return () => {
    if (finished) return;
    finished = true;
    if (myRun === runId) runId += 1;
    activeTl?.kill();
    activeTl = null;
    gsap.set(overlay, { opacity: 0 });
    gsap.set(brand, { clearProps: "opacity,visibility,transform" });
    gsap.set(logo, { clearProps: "transform" });
    overlay.style.pointerEvents = "none";
    phase = "idle";
  };
}

/**
 * Cubre con el velo, navega debajo, espera al destino y revela.
 * navigateFn debe ser síncrono (p. ej. () => navigate("/big-picture")).
 */
export function transitionToMode(
  direction: ModeTransitionDirection,
  navigateFn: () => void,
): void {
  if (typeof document === "undefined") {
    navigateFn();
    return;
  }
  // Cover + hold: el velo aún no garantiza tapa total / el destino no está
  // listo; un segundo Start aquí duplicaría entradas en el historial.
  // En reveal sí se puede revertir (parte del valor de presentación).
  if (phase === "cover" || phase === "brand") return;

  // §14 — corte directo, sin movimiento vestibular.
  if (prefersReducedMotion()) {
    navigateFn();
    return;
  }

  const overlay = ensureOverlay();
  if (!overlay) {
    navigateFn();
    return;
  }
  const glow = overlay.querySelector<HTMLElement>(GLOW_SELECTOR);
  const brand = overlay.querySelector<HTMLElement>(BRAND_SELECTOR);
  const logo = brand?.querySelector<HTMLImageElement>(BRAND_LOGO_SELECTOR) ?? null;
  const app = document.getElementById("root");

  const myRun = ++runId;
  cancelHold();
  activeTl?.kill();
  gsap.killTweensOf(overlay);
  if (glow) gsap.killTweensOf(glow);
  if (brand) gsap.killTweensOf(brand);
  if (logo) gsap.killTweensOf(logo);
  if (app) gsap.killTweensOf(app);

  overlay.dataset.direction = direction;
  overlay.style.pointerEvents = "auto";
  phase = "cover";

  const showBrand = Boolean(brand && logo);
  if (logo) {
    logo.src = getModeBrandLogo(direction);
    logo.dataset.bpModeLogo = direction === "enter" ? "tv" : "normal";
  }
  if (brand) {
    gsap.set(brand, {
      autoAlpha: 0,
      scale: 0.96,
      transformOrigin: "50% 50%",
      overwrite: "auto",
    });
  }
  if (logo) gsap.set(logo, { scale: 1, transformOrigin: "50% 50%", overwrite: "auto" });

  const tl = gsap.timeline();
  activeTl = tl;

  // 1. COVER — el modo actual retrocede y se hunde en el velo.
  //    Solo transform + opacity: sin repaints de pantalla completa.
  if (app) {
    tl.to(app, {
      scale: 0.97,
      y: 16,
      opacity: 0.35,
      transformOrigin: "50% 50%",
      duration: COVER_DURATION,
      ease: "expo.in",
      overwrite: "auto",
    }, 0);
  }
  tl.to(overlay, {
    opacity: 1,
    duration: COVER_DURATION,
    ease: "expo.in",
    overwrite: "auto",
  }, 0);
  if (glow) {
    tl.to(glow, {
      scale: 1,
      opacity: 1,
      transformOrigin: "50% 46%",
      duration: COVER_DURATION,
      ease: "expo.in",
      overwrite: "auto",
    }, 0);
  }
  if (brand && logo && showBrand) {
    tl.fromTo(brand, {
      autoAlpha: 0,
      scale: 0.96,
    }, {
      autoAlpha: 1,
      scale: 1,
      duration: 0.46,
      ease: "power3.out",
      overwrite: "auto",
    }, 0.08);
    tl.to(logo, {
      scale: 1.018,
      duration: 0.55,
      ease: "sine.inOut",
      overwrite: "auto",
    }, 0.34);
  }

  // 2. Cambio de modo bajo el velo + espera al destino.
  const navigateUnderOverlay = () => {
    if (myRun !== runId) return;
    try {
      navigateFn();
    } catch {
      // Navegación best-effort: el timeout revela de todos modos.
    }
    beginHold(myRun, direction);
  };

  if (showBrand) {
    tl.call(navigateUnderOverlay, [], BRAND_NAVIGATION_DELAY);
  } else {
    tl.call(navigateUnderOverlay);
  }
}

function isModeReady(direction: ModeTransitionDirection): boolean {
  const bp = document.querySelector(BIG_PICTURE_SELECTOR);
  if (direction === "enter") return bp !== null;
  return bp === null && document.querySelector(SCROLL_SHELL_SELECTOR) !== null;
}

function beginHold(myRun: number, direction: ModeTransitionDirection): void {
  const overlay = document.getElementById(OVERLAY_ID);
  const glow = overlay?.querySelector<HTMLElement>(GLOW_SELECTOR) ?? null;
  // Pulso tenue mientras se espera: el velo nunca parece congelado.
  // Solo opacity sobre una capa con will-change -> compositor, barato.
  if (glow) {
    gsap.set(glow, { scale: 1, opacity: 1 });
    holdPulse = gsap.to(glow, {
      opacity: 0.55,
      duration: 0.6,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      overwrite: "auto",
    });
  }
  const deadline = performance.now() + READY_TIMEOUT_MS;
  let settledFrames = 0;
  const tick = () => {
    holdRaf = 0;
    if (myRun !== runId) return;
    settledFrames = isModeReady(direction) ? settledFrames + 1 : 0;
    if (settledFrames >= SETTLED_FRAMES || performance.now() >= deadline) {
      playReveal(myRun);
      return;
    }
    holdRaf = requestAnimationFrame(tick);
  };
  holdRaf = requestAnimationFrame(tick);
  // Red de seguridad: nunca atrapar al usuario bajo el velo.
  holdTimeout = window.setTimeout(() => {
    holdTimeout = 0;
    if (myRun !== runId) return;
    playReveal(myRun);
  }, READY_TIMEOUT_MS + 100);
}

function playReveal(myRun: number): void {
  if (myRun !== runId || phase !== "cover") return;
  cancelHold();
  const overlay = document.getElementById(OVERLAY_ID);
  const glow = overlay?.querySelector<HTMLElement>(GLOW_SELECTOR) ?? null;
  const brand = overlay?.querySelector<HTMLElement>(BRAND_SELECTOR) ?? null;
  const logo = brand?.querySelector<HTMLImageElement>(BRAND_LOGO_SELECTOR) ?? null;
  const app = document.getElementById("root");
  if (!overlay || !app) {
    if (overlay) {
      gsap.set(overlay, { opacity: 0 });
      if (brand) gsap.set(brand, { clearProps: "opacity,visibility,transform" });
      if (logo) gsap.set(logo, { clearProps: "transform" });
      overlay.style.pointerEvents = "none";
    }
    activeTl = null;
    phase = "idle";
    return;
  }
  phase = "reveal";

  const tl = gsap.timeline({
    onComplete: () => {
      gsap.set(app, { clearProps: "transform,opacity" });
      gsap.set(overlay, { opacity: 0 });
      if (glow) gsap.set(glow, { clearProps: "all" });
      if (brand) gsap.set(brand, { clearProps: "opacity,visibility,transform" });
      if (logo) gsap.set(logo, { clearProps: "transform" });
      overlay.style.pointerEvents = "none";
      activeTl = null;
      phase = "idle";
    },
  });
  activeTl = tl;

  // 3. REVEAL — el destino (ya asentado) avanza hacia el espectador,
  //    espejo del cover. El velo levanta con un pelo de retraso (§8).
  tl.set(app, { scale: 1.03, y: -10, opacity: 0, transformOrigin: "50% 50%" });
  tl.to(app, {
    scale: 1,
    y: 0,
    opacity: 1,
    duration: REVEAL_DURATION,
    ease: "expo.out",
    overwrite: "auto",
  });
  if (brand) {
    tl.to(brand, {
      autoAlpha: 0,
      scale: 1.025,
      duration: VEIL_OUT_DURATION,
      ease: "expo.out",
      overwrite: "auto",
    }, 0);
  }
  tl.to(overlay, {
    opacity: 0,
    duration: VEIL_OUT_DURATION,
    ease: "expo.out",
    overwrite: "auto",
  }, "<0.08");
  if (glow) {
    tl.to(glow, {
      scale: 1.04,
      opacity: 0,
      duration: VEIL_OUT_DURATION,
      ease: "expo.out",
      overwrite: "auto",
    }, "<");
  }
}
