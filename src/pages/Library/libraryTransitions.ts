import { gsap } from "gsap";
import { appleEase } from "../../utils/motion.ts";

export function animateLibraryTabPanel(panel: HTMLElement, reducedMotion: boolean): () => void {
  if (reducedMotion) {
    const tween = gsap.fromTo(panel, { opacity: 0 }, {
      opacity: 1,
      duration: 0.2,
      ease: "power1.out",
    });
    return () => {
      tween.kill();
      gsap.set(panel, { clearProps: "opacity,transform" });
    };
  }

  gsap.killTweensOf(panel);
  gsap.set(panel, { willChange: "transform,opacity" });
  const tween = gsap.fromTo(
    panel,
    { opacity: 0, y: 10, scale: 0.99 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.38,
      ease: appleEase,
      clearProps: "transform,opacity",
      onComplete: () => gsap.set(panel, { willChange: "auto" }),
    },
  );

  return () => {
    tween.kill();
    gsap.set(panel, { clearProps: "opacity,transform,willChange" });
  };
}
