import { gsap } from "gsap";
import { appleEase } from "../../utils/motion.ts";

const PANEL_ENTRANCE_FAILSAFE_MS = 500;

export function animateLibraryTabPanel(panel: HTMLElement, reducedMotion: boolean): () => void {
  gsap.killTweensOf(panel);
  let settled = false;
  let timeout: ReturnType<typeof setTimeout>;
  let tween: ReturnType<typeof gsap.fromTo> | undefined;
  const clearProps = reducedMotion ? "opacity,transform" : "opacity,transform,willChange";

  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    tween?.kill();
    gsap.killTweensOf(panel);
    gsap.set(panel, { clearProps });
  };

  timeout = setTimeout(settle, PANEL_ENTRANCE_FAILSAFE_MS);

  if (reducedMotion) {
    tween = gsap.fromTo(panel, { opacity: 0 }, {
      opacity: 1,
      duration: 0.2,
      ease: "power1.out",
      onComplete: settle,
    });
    return settle;
  }

  gsap.set(panel, { willChange: "transform,opacity" });
  tween = gsap.fromTo(
    panel,
    { opacity: 0, y: 10, scale: 0.99 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.38,
      ease: appleEase,
      clearProps: "transform,opacity",
      onComplete: settle,
    },
  );

  return settle;
}
