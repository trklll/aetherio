import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { CONTEXT_GLASS_STYLE } from "../../components/ui/glassSurface";
import { gsap, tweenTo } from "../../utils/motion";

interface PlayerSidePanelProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  bigPicture?: boolean;
  onClose: () => void;
}

export default function PlayerSidePanel({
  visible,
  title,
  subtitle,
  icon,
  children,
  bigPicture,
  onClose,
}: PlayerSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    else if (innerRef.current) {
      const el = innerRef.current;
      gsap.killTweensOf(el);
      // Solo opacidad: el vidrio es seguido por la máscara episodePanel del
      // shader de blur GPU; transformar desincroniza la máscara unos frames.
      tweenTo(el, { opacity: 0 }, 0.28);
      window.setTimeout(() => setMounted(false), 300);
    } else {
      setMounted(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !mounted) return;
    const el = innerRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    gsap.set(el, { opacity: 0 });
    tweenTo(el, { opacity: 1 }, 0.34);
  }, [mounted, visible]);

  // Big Picture + mando: foco inicial en el episodio actual (o el primero
  // de la lista) y velo único reconciliado desde document.activeElement,
  // igual que el overlay de subtítulos.
  useEffect(() => {
    if (!visible || !mounted || !bigPicture) return;
    const timer = window.setTimeout(() => {
      const root = innerRef.current;
      if (!root || root.contains(document.activeElement)) return;
      const target = root.querySelector<HTMLElement>(
        '[data-episode-list] button[aria-current="true"]:not([disabled]), [data-episode-list] button:not([disabled]), button[aria-current="true"]:not([disabled]), button:not([disabled])',
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [visible, mounted, bigPicture]);

  useEffect(() => {
    if (!visible || !mounted || !bigPicture) return;
    const root = innerRef.current;
    if (!root) return;
    const clearPanelFocus = () => {
      root.querySelectorAll<HTMLElement>("[data-bp-focus], .spatial-focus").forEach(element => {
        element.removeAttribute("data-bp-focus");
        element.classList.remove("spatial-focus");
      });
    };
    const getActiveButton = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
      const button = active.matches("button:not([disabled])")
        ? active
        : active.closest<HTMLElement>("button:not([disabled])");
      return button && root.contains(button) ? button : null;
    };
    const reconcile = () => {
      const activeButton = getActiveButton();
      clearPanelFocus();
      activeButton?.setAttribute("data-bp-focus", "true");
      // El scroll sigue al foco: al bajar con el mando la lista acompaña.
      activeButton?.scrollIntoView({ block: "nearest" });
    };
    root.addEventListener("focusin", reconcile);
    root.addEventListener("focusout", reconcile);
    reconcile();
    const veilTimer = window.setInterval(reconcile, 100);
    return () => {
      root.removeEventListener("focusin", reconcile);
      root.removeEventListener("focusout", reconcile);
      window.clearInterval(veilTimer);
      clearPanelFocus();
    };
  }, [visible, mounted, bigPicture]);

  const stopPanelKeys = (event: React.KeyboardEvent) => {
    if (
      event.key === " " ||
      event.code === "Space" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      event.stopPropagation();
    }
  };

  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-player-controls-glass]")) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Consumir para que B del mando no dispare además el "volver" global.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onClose, visible]);

  if (!mounted) return null;

  return (
    <aside
      ref={panelRef}
      data-player-side-panel
      className={bigPicture
        ? "absolute z-40 w-[580px] max-w-[calc(100vw-64px)]"
        : "absolute z-40 w-[420px] max-w-[calc(100vw-32px)]"}
      style={{
        top: "calc(var(--app-safe-top) + 62px)",
        right: "var(--app-safe-x)",
        bottom: "calc(100vh - var(--aetherio-player-controls-top, 80vh) + 12px)",
      }}
      aria-label={title}
    >
      <div
        ref={innerRef}
        data-player-episode-panel-glass
        {...(bigPicture ? { "data-spatial-modal": "true" } : {})}
        role="dialog"
        aria-label={title}
        onKeyDown={stopPanelKeys}
        className="flex h-full flex-col overflow-hidden rounded-[28px] p-5 will-change-transform"
        style={{ ...CONTEXT_GLASS_STYLE, willChange: "transform, opacity, filter", transform: "translateZ(0)" }}
      >
        <header className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-white/88">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-[-0.02em] text-white">{title}</h2>
              {subtitle ? <p className="mt-0.5 truncate text-xs font-medium text-white/48">{subtitle}</p> : null}
            </div>
          </div>
          {bigPicture ? null : (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.08] text-white/90 gsap-transition hover:bg-white/[0.15]"
              title="Cerrar panel"
              aria-label="Cerrar panel"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </aside>
  );
}
