import { gsap } from "gsap";

/** Remove any visual residue left by a route transition that was interrupted. */
export function restorePageTransition(element: HTMLElement | null): void {
  if (!element) return;
  gsap.killTweensOf(element);
  gsap.set(element, { clearProps: "opacity,transform,transformOrigin,willChange" });
}
