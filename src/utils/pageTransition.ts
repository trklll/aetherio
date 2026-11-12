import { gsap } from "gsap";

const PAGE_CURTAIN_MAX_DURATION_MS = 500;

/**
 * Owns the route curtain's full lifecycle. The timeout is a fail-safe for
 * renderers where GSAP's requestAnimationFrame ticker is delayed or paused.
 */
export function animatePageTransitionCurtain(element: HTMLElement, reducedMotion: boolean): () => void {
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let tween: ReturnType<typeof gsap.fromTo> | undefined;

  const settle = () => {
    if (settled) return;
    settled = true;
    if (timeout !== undefined) clearTimeout(timeout);
    tween?.kill();
    gsap.killTweensOf(element);
    gsap.set(element, { clearProps: "opacity,transform,willChange" });
  };

  if (reducedMotion) {
    settle();
    return () => undefined;
  }

  gsap.killTweensOf(element);
  timeout = setTimeout(settle, PAGE_CURTAIN_MAX_DURATION_MS);
  tween = gsap.fromTo(
    element,
    { opacity: 0.4, xPercent: 0, willChange: "transform,opacity" },
    {
      opacity: 0,
      xPercent: -22,
      duration: 0.38,
      ease: "power2.out",
      clearProps: "opacity,transform,willChange",
      onComplete: settle,
    },
  );

  return () => {
    if (settled) return;
    settled = true;
    if (timeout !== undefined) clearTimeout(timeout);
    tween?.kill();
    gsap.killTweensOf(element);
    gsap.set(element, { clearProps: "opacity,transform,willChange" });
  };
}

/** Remove any visual residue left by a route transition that was interrupted. */
export function restorePageTransition(element: HTMLElement | null): void {
  if (!element) return;
  gsap.killTweensOf(element);
  gsap.set(element, { clearProps: "opacity,transform,transformOrigin,willChange" });
}
