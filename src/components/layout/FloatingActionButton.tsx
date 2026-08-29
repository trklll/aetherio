import { useEffect, useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion, tweenTo, elegantEase, motionTimings } from "../../utils/motion";

interface FloatingActionButtonProps {
  icon: ReactNode;
  onClick: () => void;
  title: string;
  animateOnClick?: boolean;
}

export default function FloatingActionButton({ icon, onClick, title, animateOnClick = false }: FloatingActionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el || prefersReducedMotion()) return;
    gsap.fromTo(el, { scale: 0.9, opacity: 0, filter: "blur(6px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.42, ease: elegantEase, clearProps: "filter" as unknown as string });
  }, []);

  function handleEnter() {
    const el = buttonRef.current;
    if (!el || prefersReducedMotion()) return;
    gsap.killTweensOf(el);
    tweenTo(el, { scale: 1.06, y: -1 }, motionTimings.hover);
  }

  function handleLeave() {
    const el = buttonRef.current;
    if (!el || prefersReducedMotion()) return;
    gsap.killTweensOf(el);
    tweenTo(el, { scale: 1, y: 0 }, motionTimings.hover);
  }

  function handleClick() {
    if (animateOnClick) {
      const button = buttonRef.current;
      if (button && !prefersReducedMotion()) {
        gsap.killTweensOf(button);
        gsap.timeline()
          .to(button, { scale: 0.84, duration: 0.13, ease: "power2.in" })
          .to(button, { scale: 1.1, duration: 0.16, ease: "expo.out" })
          .to(button, { scale: 1, duration: 0.18, ease: elegantEase });
      }
    }
    onClick();
  }

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="liquid-glass flex h-10 w-10 items-center justify-center rounded-md text-white/80 hover:text-white will-change-transform"
      title={title}
      aria-label={title}
      type="button"
      style={{ willChange: "transform, opacity, filter" }}
    >
      {icon}
    </button>
  );
}
