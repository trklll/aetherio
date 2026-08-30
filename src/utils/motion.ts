import { gsap } from "gsap";
import { useLayoutEffect, useRef, type DependencyList } from "react";

export { gsap };

export const appleEase = "power3.out";
export const quickEase = "power2.out";
export const elegantEase = "expo.out";
export const elegantInEase = "expo.in";

// Apple spring mapping — damping 1.0 = critically damped (no bounce), 0.8 = slight overshoot
// GSAP has no true spring physics; we approximate with eases that are interruptible via overwrite:"auto"
// and sampled to match Apple's response durations. Damping 1.0 -> power3/expo, Damping 0.8 -> back/elastic subtle
export const appleSpring = {
  // Critically damped defaults (§4) — graceful, no bounce
  criticallyDamped: { ease: "power3.out", duration: 0.38 } as const,
  // Momentum-driven — a little bounce, only when gesture carried velocity (§4)
  withBounce: { ease: "back.out(1.15)", duration: 0.38 } as const,
  chromeIn: { ease: "power3.out", duration: 0.38 } as const,
  chromeOut: { ease: "power3.in", duration: 0.28 } as const,
} as const;

export const motionTimings = {
  hover: 0.18,
  row: 0.22,
  page: 0.52,
  hero: 0.64,
  chromeIn: 0.38,
  chromeOut: 0.28,
  playerBarIn: 0.45,
  playerBarOut: 0.32,
} as const;

type MotionTarget = gsap.TweenTarget;

export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function prefersReducedTransparency() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

export function prefersContrastMore() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-contrast: more)").matches;
}

// §9 Rubber-banding — progressive resistance at boundaries
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// §6 Momentum projection — Apple's exponential-decay form (decelerationRate 0.998 normal, 0.99 snappier)
export function project(initialVelocity: number, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

export function tweenTo(
  target: MotionTarget,
  vars: gsap.TweenVars,
  duration: number = motionTimings.hover,
) {
  const resolvedTarget = Array.isArray(target) ? target.filter(Boolean) : target;
  if (!resolvedTarget || (Array.isArray(resolvedTarget) && resolvedTarget.length === 0)) {
    return gsap.to({}, { duration: 0 });
  }
  if (prefersReducedMotion()) {
    // §14 Reduced motion — cross-fade, no slide/scale/blur, keep opacity/color
    const reducedVars: gsap.TweenVars = {};
    if (vars.opacity !== undefined) reducedVars.opacity = vars.opacity;
    // keep color/background changes that aid comprehension, drop transform/filter
    if (vars.backgroundColor !== undefined) reducedVars.backgroundColor = vars.backgroundColor;
    if (vars.color !== undefined) reducedVars.color = vars.color;
    if (vars.borderColor !== undefined) reducedVars.borderColor = vars.borderColor;
    // if only transform/filter was requested, cross-fade opacity instead
    const hasOpacity = reducedVars.opacity !== undefined;
    if (!hasOpacity && Object.keys(reducedVars).length === 0) {
      // element already visible — just snap, or fade if it was hidden
      const el = Array.isArray(resolvedTarget) ? resolvedTarget[0] : resolvedTarget;
      const currentOpacity = el instanceof HTMLElement ? Number(getComputedStyle(el).opacity) : 1;
      reducedVars.opacity = currentOpacity < 0.5 ? 1 : currentOpacity;
    }
    return gsap.to(resolvedTarget, {
      ...reducedVars,
      duration: 0.2,
      ease: "power1.out",
      overwrite: "auto",
      clearProps: vars.clearProps,
    });
  }
  return gsap.to(resolvedTarget, {
    ...vars,
    duration,
    ease: vars.ease ?? appleEase,
    overwrite: "auto",
  });
}

export function springTo(
  target: MotionTarget,
  vars: gsap.TweenVars,
  opts: { damping?: number; response?: number; duration?: number; ease?: string } = {},
) {
  const resolvedTarget = Array.isArray(target) ? target.filter(Boolean) : target;
  if (!resolvedTarget || (Array.isArray(resolvedTarget) && resolvedTarget.length === 0)) {
    return gsap.to({}, { duration: 0 });
  }
  if (prefersReducedMotion()) {
    // §14 — replace spring with short cross-fade
    const reducedVars: gsap.TweenVars = {};
    if (vars.opacity !== undefined) reducedVars.opacity = vars.opacity;
    if (vars.backgroundColor !== undefined) reducedVars.backgroundColor = vars.backgroundColor;
    return gsap.to(resolvedTarget, {
      ...reducedVars,
      duration: 0.2,
      ease: "power1.out",
      overwrite: "auto",
    });
  }
  // §4 — damping 1.0 no bounce, <1.0 slight bounce. Always animate from presentation value (overwrite:auto) + compositor props
  const damping = opts.damping ?? 1.0;
  const ease = opts.ease ?? (damping >= 1 ? appleSpring.criticallyDamped.ease : appleSpring.withBounce.ease);
  const duration = opts.duration ?? opts.response ?? appleSpring.criticallyDamped.duration;
  gsap.killTweensOf(resolvedTarget);
  return gsap.to(resolvedTarget, {
    ...vars,
    duration,
    ease: vars.ease ?? ease,
    overwrite: "auto",
  });
}

// Helper to compute transformOrigin anchored to trigger element (§7)
export function anchorTransformOrigin(anchorRect: DOMRect, menuLeft: number, menuTop: number, menuWidth: number, menuHeight: number) {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const originX = ((anchorCenterX - menuLeft) / Math.max(1, menuWidth)) * 100;
  const originY = ((anchorCenterY - menuTop) / Math.max(1, menuHeight)) * 100;
  return `${Math.min(100, Math.max(0, originX))}% ${Math.min(100, Math.max(0, originY))}%`;
}

export function useGsapState<T extends HTMLElement>(
  vars: gsap.TweenVars,
  dependencies: DependencyList,
  duration: number = motionTimings.row,
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    tweenTo(ref.current, vars, duration);
    return () => gsap.killTweensOf(ref.current);
  }, dependencies);
  return ref;
}

export function scrollByGsap(element: HTMLElement | null, left: number, duration = 0.48) {
  if (!element) return;
  tweenTo(element, { scrollLeft: element.scrollLeft + left }, duration);
}

export function scrollToElementGsap(element: HTMLElement | null, duration = 0.52) {
  if (!element) return;
  const scroller = element.closest<HTMLElement>("[data-aetherio-scroll-shell]");
  if (!scroller) {
    const top = window.scrollY + element.getBoundingClientRect().top;
    tweenTo(document.scrollingElement, { scrollTop: top }, duration);
    return;
  }
  const top = scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  tweenTo(scroller, { scrollTop: top }, duration);
}

interface InertialScrollState {
  target: number;
  tween: gsap.core.Tween | null;
}

const inertialScrollStates = new WeakMap<HTMLElement, InertialScrollState>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedWheelDelta(event: WheelEvent, viewportHeight: number) {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 18
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? viewportHeight
      : 1;
  return clamp(event.deltaY * unit, -240, 240);
}

function canScrollVertically(element: HTMLElement) {
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const overflow = getComputedStyle(element).overflowY;
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function canConsumeScroll(element: HTMLElement, delta: number) {
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  return delta < 0 ? element.scrollTop > 0 : element.scrollTop < max;
}

function resolveVerticalScroller(root: HTMLElement, target: EventTarget | null, delta: number) {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== root) {
    if (canScrollVertically(node) && canConsumeScroll(node, delta)) return node;
    node = node.parentElement;
  }
  return canConsumeScroll(root, delta) ? root : null;
}

export function stopInertialScroll(element: HTMLElement | null) {
  if (!element) return;
  const state = inertialScrollStates.get(element);
  state?.tween?.kill();
  inertialScrollStates.delete(element);
  gsap.killTweensOf(element, "scrollTop");
}

/**
 * Adds desktop wheel inertia without replacing native touch, keyboard or
 * scrollbar interaction. Nested vertical scrollers consume the gesture first.
 */
export function installInertialScroll(root: HTMLElement) {
  if (prefersReducedMotion()) return () => undefined;
  const controlled = new Set<HTMLElement>();

  const stopControlled = () => {
    controlled.forEach(stopInertialScroll);
    controlled.clear();
  };

  const onWheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      || event.deltaY === 0
    ) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("[data-disable-inertial-scroll]")) return;

    const delta = normalizedWheelDelta(event, root.clientHeight);
    const scroller = resolveVerticalScroller(root, event.target, delta);
    if (!scroller) return;

    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const existing = inertialScrollStates.get(scroller);
    const active = existing?.tween?.isActive() === true;
    const currentTarget = active ? existing.target : scroller.scrollTop;
    const trackpadGesture = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(event.deltaY) < 42;
    const multiplier = trackpadGesture ? 1.16 : 1.34;
    const nextTarget = clamp(currentTarget + delta * multiplier, 0, max);
    if (Math.abs(nextTarget - scroller.scrollTop) < 0.5) return;

    event.preventDefault();
    existing?.tween?.kill();

    const distance = Math.abs(nextTarget - scroller.scrollTop);
    const state: InertialScrollState = {
      target: nextTarget,
      tween: null,
    };
    state.tween = gsap.to(scroller, {
      scrollTop: nextTarget,
      duration: trackpadGesture ? clamp(0.28 + distance / 1800, 0.28, 0.52) : clamp(0.5 + distance / 1500, 0.5, 0.88),
      ease: trackpadGesture ? "power3.out" : "power4.out",
      overwrite: "auto",
      onComplete: () => {
        state.tween = null;
        state.target = scroller.scrollTop;
      },
    });
    inertialScrollStates.set(scroller, state);
    controlled.add(scroller);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      stopControlled();
    }
  };

  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("pointerdown", stopControlled, { passive: true });
  window.addEventListener("keydown", onKeyDown, true);

  return () => {
    root.removeEventListener("wheel", onWheel);
    root.removeEventListener("pointerdown", stopControlled);
    window.removeEventListener("keydown", onKeyDown, true);
    stopControlled();
  };
}

const initialized = new WeakSet<Element>();
const ignoredClassMutations = new WeakMap<Element, number>();
const restingStyles = new WeakMap<HTMLElement, ReturnType<typeof snapshotStyles>>();
const hoverProps = ["opacity", "color", "backgroundColor", "borderColor", "boxShadow", "transform", "filter"] as const;
const hoverClearProps = hoverProps.join(",");

/**
 * Installs the single animation runtime used by the React/Tauri UI.
 *
 * Semantic animation classes remain in the markup as durable hooks, but they
 * contain no CSS animation or transition. GSAP owns every tween and timeline.
 */
export function installGsapAnimations() {
  if (typeof document === "undefined") return () => undefined;

  const initializeTree = (root: ParentNode) => {
    if (root instanceof Element) initializeElement(root);
    root.querySelectorAll<HTMLElement>(motionSelector).forEach(initializeElement);
  };

  let _rafPending = false;
  const observer = new MutationObserver(records => {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) {
          const ignored = ignoredClassMutations.get(record.target) ?? 0;
          if (ignored > 0) {
            ignoredClassMutations.set(record.target, ignored - 1);
            continue;
          }
          if (record.attributeName === "class" && record.target.classList.contains("aetherio-fullscreen-pop")) {
            runFullscreenPop(record.target);
          }
          if (
            record.attributeName === "class" &&
            record.oldValue &&
            record.target.classList.contains("gsap-transition")
          ) {
            animateClassChange(record.target, record.oldValue);
          }
          continue;
        }
        record.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) initializeTree(node);
        });
        record.removedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          gsap.killTweensOf(node);
          gsap.killTweensOf(node.querySelectorAll("*"));
        });
      }
    });
  });

  initializeTree(document);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

const motionSelector = [
  ".skeleton",
  ".gsap-pulse",
  ".gsap-spin",
  ".gsap-fade-in",
  ".aetherio-rating-cue",
  ".aetherio-breathe",
  ".aetherio-fullscreen-pop",
  ".aetherio-popup-backdrop",
  ".aetherio-popup-card",
  ".aetherio-page-enter",
  ".aetherio-nav-pop",
  ".aetherio-hero-image",
  ".aetherio-hero-content",
  ".aetherio-page-curtain",
  ".aetherio-player-handoff",
  ".person-page",
  ".gsap-transition",
  ".aetherio-detail-fade",
  ".detail-episode-card",
  ".detail-episode-card__media",
  ".detail-episode-card__menu",
  ".person-portrait",
  ".person-biography-preview",
  ".person-rail-arrow",
  ".person-known-card",
  ".person-credit-card",
].join(",");

const hoverSelector = [
  ".gsap-transition",
  ".detail-episode-card",
  ".detail-episode-card__media",
  ".detail-episode-card__menu",
  ".person-portrait",
  ".person-biography-preview",
  ".person-rail-arrow",
  ".person-known-card",
  ".person-credit-card",
].join(",");

function initializeElement(element: Element) {
  if (!(element instanceof HTMLElement) || initialized.has(element)) return;
  initialized.add(element);

  if (element.matches(hoverSelector)) installHoverTween(element);
  if (prefersReducedMotion()) return;

  if (element.classList.contains("skeleton")) {
    gsap.fromTo(element, { backgroundPosition: "200% 0" }, { backgroundPosition: "-200% 0", duration: 1.8, ease: "none", repeat: -1 });
  }
  if (element.classList.contains("gsap-pulse")) {
    gsap.to(element, { opacity: 0.5, duration: 1, ease: "power1.inOut", repeat: -1, yoyo: true });
  }
  if (element.classList.contains("gsap-spin")) {
    gsap.to(element, { rotation: 360, duration: 1, ease: "none", repeat: -1 });
  }
  if (element.classList.contains("gsap-fade-in")) {
    gsap.fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" });
  }
  if (element.classList.contains("aetherio-rating-cue")) runRatingCue(element);
  if (element.classList.contains("aetherio-breathe")) {
    gsap.fromTo(element, { opacity: 0.86 }, { opacity: 0.34, duration: 1.1, ease: "power1.inOut", repeat: -1, yoyo: true });
  }
  if (element.classList.contains("aetherio-fullscreen-pop")) runFullscreenPop(element);
  if (element.classList.contains("aetherio-popup-backdrop")) {
    gsap.fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.24, ease: "power1.out" });
  }
  if (element.classList.contains("aetherio-popup-card")) {
    gsap.fromTo(element, { opacity: 0, y: 14, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.34, ease: appleEase });
  }
  if (element.classList.contains("aetherio-page-enter")) {
    gsap.fromTo(element, { opacity: 0, x: 28, scale: 0.978, transformOrigin: "center top" }, { opacity: 1, x: 0, scale: 1, duration: motionTimings.page, ease: appleEase });
  }
  if (element.classList.contains("aetherio-nav-pop")) {
    gsap.fromTo(element, { opacity: 0, y: -6, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.2, ease: appleEase });
  }
  if (element.classList.contains("aetherio-hero-image")) {
    gsap.fromTo(element, { opacity: 0, x: 48, scale: 1.025 }, { opacity: 1, x: 0, scale: 1, duration: motionTimings.hero, ease: appleEase });
  }
  if (element.classList.contains("aetherio-hero-content")) {
    gsap.fromTo(element, { opacity: 0, x: 34 }, { opacity: 1, x: 0, duration: 0.42, ease: appleEase });
  }
  if (element.classList.contains("aetherio-page-curtain")) {
    gsap.fromTo(element, { opacity: 0.4, xPercent: 0 }, { opacity: 0, xPercent: -22, duration: 0.38, ease: appleEase });
  }
  if (element.classList.contains("aetherio-detail-fade")) {
    const children = element.children;
    if (children.length) {
      gsap.fromTo(children, { opacity: 0 }, { opacity: 1, duration: 0.46, ease: appleEase, stagger: 0.08 });
    } else {
      gsap.fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.46, ease: appleEase });
    }
  }
  if (element.classList.contains("aetherio-player-handoff")) runPlayerHandoff(element);
  if (element.classList.contains("person-page")) {
    gsap.fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.36, ease: appleEase });
  }
}

function runRatingCue(element: HTMLElement) {
  gsap.killTweensOf(element);
  gsap.timeline()
    .set(element, { opacity: 0, y: -10 })
    .to(element, { opacity: 1, y: 0, duration: 0.84, ease: "power1.out" })
    .to(element, { opacity: 1, y: 0, duration: 4.62 })
    .to(element, { opacity: 0, y: -10, duration: 1.54, ease: "power1.in" });
}

function runFullscreenPop(element: HTMLElement) {
  if (prefersReducedMotion()) return;
  gsap.killTweensOf(element);
  gsap.timeline()
    .to(element, { scale: 0.82, duration: 0.143, ease: "power2.in" })
    .to(element, { scale: 1.13, duration: 0.143, ease: "power2.out" })
    .to(element, { scale: 1, duration: 0.134, ease: "power2.out" });
}

function runPlayerHandoff(element: HTMLElement) {
  const image = element.querySelector("img");
  const bar = element.querySelector(".aetherio-player-handoff-bar");
  gsap.fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.62, ease: appleEase });
  if (image) gsap.fromTo(image, { opacity: 1, scale: 1.025 }, { opacity: 0, scale: 1.065, duration: 0.62, ease: appleEase });
  if (bar) gsap.fromTo(bar, { xPercent: -120 }, { xPercent: 240, duration: 0.62, ease: "none", repeat: -1 });
}

function installHoverTween(element: HTMLElement) {
  let tween: gsap.core.Tween | null = null;
  restingStyles.set(element, snapshotStyles(element));

  const animateComputedState = (leaving: boolean) => {
    if (prefersReducedMotion() || element.matches(":disabled")) return;
    const current = snapshotStyles(element);
    gsap.set(element, { clearProps: hoverClearProps });
    const computed = snapshotStyles(element);
    const from = leaving ? current : (restingStyles.get(element) ?? current);
    const to = computed;
    if (leaving) restingStyles.set(element, computed);
    gsap.set(element, from);
    tween?.kill();
    tween = gsap.to(element, {
      ...to,
      duration: Number(element.dataset.gsapDuration || motionTimings.hover),
      ease: element.dataset.gsapEase || appleEase,
      overwrite: "auto",
      onComplete: leaving ? () => gsap.set(element, { clearProps: hoverClearProps }) : undefined,
    });
  };

  element.addEventListener("pointerenter", () => animateComputedState(false));
  element.addEventListener("pointerleave", () => animateComputedState(true));
  element.addEventListener("focus", () => animateComputedState(false));
  element.addEventListener("blur", () => animateComputedState(true));
}

function animateClassChange(element: HTMLElement, oldClassName: string) {
  if (prefersReducedMotion()) return;
  const nextClassName = element.className;
  const to = snapshotStyles(element);
  ignoredClassMutations.set(element, (ignoredClassMutations.get(element) ?? 0) + 2);
  element.className = oldClassName;
  gsap.set(element, { clearProps: hoverClearProps });
  const from = snapshotStyles(element);
  element.className = nextClassName;
  restingStyles.set(element, to);
  gsap.fromTo(element, from, {
    ...to,
    duration: Number(element.dataset.gsapDuration || motionTimings.hover),
    ease: element.dataset.gsapEase || appleEase,
    overwrite: "auto",
  });
}

function snapshotStyles(element: HTMLElement) {
  const style = getComputedStyle(element);
  return Object.fromEntries(hoverProps.map(property => [property, style[property]]));
}
