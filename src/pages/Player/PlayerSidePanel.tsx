import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { CONTEXT_GLASS_STYLE } from "../../components/ui/glassSurface";

interface PlayerSidePanelProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

export default function PlayerSidePanel({
  visible,
  title,
  subtitle,
  icon,
  children,
  onClose,
}: PlayerSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-player-controls-glass]")) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onClose, visible]);

  if (!visible) return null;

  return (
    <aside
      ref={panelRef}
      data-player-side-panel
      className="absolute z-40 w-[420px] max-w-[calc(100vw-32px)]"
      style={{
        top: "calc(var(--app-safe-top) + 62px)",
        right: "var(--app-safe-x)",
        bottom: "calc(100vh - var(--aetherio-player-controls-top, 80vh) + 12px)",
      }}
      aria-label={title}
    >
      <div
        data-player-episode-panel-glass
        className="flex h-full flex-col overflow-hidden rounded-[28px] p-5"
        style={CONTEXT_GLASS_STYLE}
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
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.08] text-white/90 gsap-transition hover:bg-white/[0.15]"
            title="Cerrar panel"
            aria-label="Cerrar panel"
          >
            <ChevronRight size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </aside>
  );
}
