import { gsap } from "gsap";
import { motionTimings, prefersReducedMotion } from "./motion";

const VT_STORAGE_KEY = "aetherio-vt-shared-element";
const VT_RECT_KEY = "aetherio-vt-card-rect";

interface CardRect {
  left: number;
  top: number;
  width: number;
  height: number;
  imgSrc: string | undefined;
}

let overlayEl: HTMLImageElement | null = null;

export function setSharedElementName(type: string, id: string): string {
  const name = `${type}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  try { sessionStorage.setItem(VT_STORAGE_KEY, name); } catch {}
  return name;
}

export function getSharedElementName(): string | null {
  try { return sessionStorage.getItem(VT_STORAGE_KEY); } catch { return null; }
}

export function clearSharedElementName(): void {
  try {
    sessionStorage.removeItem(VT_STORAGE_KEY);
    sessionStorage.removeItem(VT_RECT_KEY);
  } catch {}
}

export function applySharedElementName(): () => void {
  return () => {};
}

export function captureCardRect(el: HTMLElement | null | undefined): CardRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const img = el.querySelector("img");
  const rect: CardRect = {
    left: r.left, top: r.top, width: r.width, height: r.height,
    imgSrc: img?.src ?? undefined,
  };
  try { sessionStorage.setItem(VT_RECT_KEY, JSON.stringify(rect)); } catch {}
  return rect;
}

export function playHeroExpandAnimation(heroEl: HTMLElement | null, onFinish: () => void): void {
  const rect = readCardRect();
  if (!heroEl || !rect || prefersReducedMotion() || !rect.imgSrc) {
    onFinish();
    return;
  }

  const lift = 0.06;
  const liftW = rect.width * (1 + lift);
  const liftH = rect.height * (1 + lift);

  overlayEl = document.createElement("img");
  overlayEl.src = rect.imgSrc;
  Object.assign(overlayEl.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: "10px",
    objectFit: "cover" as const,
    zIndex: "9999",
    pointerEvents: "none" as const,
    opacity: "1",
    boxShadow: "0 24px 56px rgba(0,0,0,0.56)",
    willChange: "transform, opacity, width, height",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlayEl);

  gsap.timeline({
    onComplete: () => {
      overlayEl?.remove();
      overlayEl = null;
      onFinish();
    },
  })
    .to(overlayEl, {
      width: liftW,
      height: liftH,
      x: -(liftW - rect.width) / 2,
      y: -(liftH - rect.height) / 2,
      borderRadius: 8,
      duration: 0.18,
      ease: "power2.out",
    })
    .to(overlayEl, {
      opacity: 0,
      duration: motionTimings.page * 0.55,
      ease: "power2.in",
    });
}

export function readCardRect(): CardRect | null {
  try {
    const raw = sessionStorage.getItem(VT_RECT_KEY);
    return raw ? JSON.parse(raw) as CardRect : null;
  } catch { return null; }
}

export function startSharedViewTransition(performNavigation: () => void): void {
  performNavigation();
}
