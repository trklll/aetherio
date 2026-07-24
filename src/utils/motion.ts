import { gsap } from "gsap";
import { useLayoutEffect, useRef, type DependencyList } from "react";

export { gsap };

export const appleEase = "power3.out";
export const quickEase = "power2.out";

export const motionTimings = {
  hover: 0.18,
  row: 0.22,
  page: 0.52,
  hero: 0.64,
} as const;

type MotionTarget = gsap.TweenTarget;

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  return gsap.to(resolvedTarget, {
    ...vars,
    duration: prefersReducedMotion() ? 0 : duration,
    ease: vars.ease ?? appleEase,
    overwrite: "auto",
  });
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
  ".detail-episode-card",
  ".detail-episode-card__image",
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
  ".detail-episode-card__image",
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
