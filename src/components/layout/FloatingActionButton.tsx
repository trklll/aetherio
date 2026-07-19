import { useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion } from "../../utils/motion";

interface FloatingActionButtonProps {
  icon: ReactNode;
  onClick: () => void;
  title: string;
  animateOnClick?: boolean;
}

export default function FloatingActionButton({ icon, onClick, title, animateOnClick = false }: FloatingActionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  function handleClick() {
    if (animateOnClick) {
      const button = buttonRef.current;
      if (button && !prefersReducedMotion()) {
        gsap.killTweensOf(button);
        gsap.timeline()
          .to(button, { scale: 0.82, duration: 0.143, ease: "power2.in" })
          .to(button, { scale: 1.13, duration: 0.143, ease: "power2.out" })
          .to(button, { scale: 1, duration: 0.134, ease: "power2.out" });
      }
    }
    onClick();
  }

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      className="liquid-glass gsap-transition flex h-10 w-10 items-center justify-center rounded-md text-white/80 hover:text-white"
      title={title}
      aria-label={title}
      type="button"
    >
      {icon}
    </button>
  );
}
