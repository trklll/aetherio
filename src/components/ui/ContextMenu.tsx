import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AudioWaveform } from "lucide-react";
import { gsap, tweenTo, springTo, prefersReducedMotion, anchorTransformOrigin } from "../../utils/motion";
import { getPlayerGlassSurface } from "./glassSurface";

/** Hay algún menú contextual abierto (portal con data-aetherio-context-menu). */
export function isContextMenuOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(
    '[data-aetherio-context-menu][data-context-open="true"], [data-aetherio-context-menu]:not([data-context-open])',
  ) !== null;
}

export interface ContextMenuItem {
  label: string;
  description?: string;
  icon?: ReactNode;
  /**
   * Fila elegida. Va explicito porque `icon` esta sobrecargado: un chelon
   * significa "tiene submenú" y un check "esta elegida". Deducirlo del icono
   * dejaba en blanco toda fila con submenu.
   */
  selected?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  /** Insignia de tecnologia mostrada a la derecha de la fila. */
  badge?: { id: string; label: string };
  onSelect: () => void;
}

interface ContextMenuProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  avoidRef?: RefObject<HTMLElement | null>;
  items: ContextMenuItem[];
  onClose: () => void;
  width?: number;
  maxHeight?: number;
  placement?: "outside-right" | "above-end" | "below-start";
  /**
   * `apple` es la piel de la referencia de Big Picture: cabecera de seccion en
   * versalitas, filas altas con la seleccionada en blanco y la insignia de
   * tecnologia en la cabecera. `glass` es el menu compacto de siempre.
   */
  variant?: "glass" | "apple";
  header?: string;
  /**
   * Logos a la derecha de la cabecera. Se acepta uno o varios porque una
   * stream puede declarar dos cosas a la vez (Dolby Atmos y 5.1).
   */
  headerBadge?: { id: string; label: string; imageUrl?: string } | { id: string; label: string; imageUrl?: string }[] | null;
}

function toBadgeList(
  badge: ContextMenuProps["headerBadge"],
): { id: string; label: string; imageUrl?: string }[] {
  if (!badge) return [];
  return Array.isArray(badge) ? badge : [badge];
}

export default function ContextMenu({
  open,
  anchorRef,
  avoidRef,
  items,
  onClose,
  width = 216,
  maxHeight,
  placement = "outside-right",
  variant = "glass",
  header,
  headerBadge = null,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const [mounted, setMounted] = useState(open);
  // Fila con el raton o el foco encima: es la que enseña su insignia.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Foco previo a la apertura: al cerrar con B/Escape se devuelve aquí (o al
  // ancla) para seguir con el mando donde estaba.
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const hadOpenedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchorRef, onClose, open]);

  // B del mando / Escape cierra el menú y consume el evento para que no
  // dispare la navegación de la página (ir atrás / salir de Big Picture).
  // En captura: precede a los handlers de burbuja (página, pickers); los de
  // captura en window (rail, AppShell) llevan su propia guarda.
  // Tab queda atrapado ciclando dentro del menú (zona exclusiva).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
        ).filter(el => el.getBoundingClientRect().width >= 2);
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const inside = active instanceof HTMLElement && menuRef.current?.contains(active);
        if ((event.shiftKey && (active === first || !inside)) || (!event.shiftKey && (active === last || !inside))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
        return;
      }
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, open]);

  useLayoutEffect(() => {
    if (!mounted) return;

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const avoidRect = avoidRef?.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      const menuWidth = menuRect?.width || width;
      const menuHeight = menuRect?.height || 44 * items.length;
      const margin = 10;

      let left = 0;
      let top = 0;

      if (placement === "below-start") {
        left = anchorRect.left;
        top = anchorRect.bottom + 7;
        if (left + menuWidth > window.innerWidth - margin) {
          left = anchorRect.right - menuWidth;
        }
      } else if (placement === "above-end") {
        left = anchorRect.right - menuWidth;
        // El menu de Big Picture se cuelga del icono que lo abre, no del borde
        // superior de la barra: colgarlo de la barra lo dejaba flotando muy
        // arriba, lejos del control al que pertenece.
        const upperBoundary = variant === "apple"
          ? anchorRect.top
          : document
            .querySelector<HTMLElement>("[data-player-controls-glass]")
            ?.getBoundingClientRect().top ?? anchorRect.top;
        const limit = Math.min(anchorRect.top, upperBoundary);
        top = Math.max(margin, limit - menuHeight - (variant === "apple" ? 10 : 12));
      } else {
        left = (avoidRect?.right ?? anchorRect.right) + 8;
        top = Math.max(margin, anchorRect.top - 8);

        if (left + menuWidth > window.innerWidth - margin) {
          left = (avoidRect?.left ?? anchorRect.left) - menuWidth - 8;
        }

        if (left < margin) {
          left = Math.min(window.innerWidth - menuWidth - margin, Math.max(margin, anchorRect.right - menuWidth));
          top = (avoidRect?.bottom ?? anchorRect.bottom) + 8;
        }
      }

      left = Math.min(window.innerWidth - menuWidth - margin, Math.max(margin, left));
      if (top + menuHeight > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - menuHeight - margin);
      }

      setPosition({ left, top });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, avoidRef, items.length, mounted, open, placement, width]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const el = menuRef.current;
    if (!el) {
      setMounted(false);
      return;
    }
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.to(el, {
        opacity: 0,
        duration: 0.18,
        ease: "power1.out",
        overwrite: "auto",
        onComplete: () => setMounted(false),
      });
      return;
    }
    // §3/§4 — spring exit, interruptible from presentation value
    springTo(el, {
      opacity: 0,
      y: 6,
      scale: 0.98,
      filter: "blur(6px)",
    } as unknown as gsap.TweenVars, { duration: 0.26, damping: 1.0 });
    // ensure unmount after animation; spring duration is bounded
    gsap.delayedCall(0.28, () => {
      if (!open) setMounted(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open || !mounted || !menuRef.current) return;
    const el = menuRef.current;
    const anchor = anchorRef.current;
    // §7 — anchor transformOrigin to trigger
    if (anchor && el) {
      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = el.getBoundingClientRect();
      const origin = anchorTransformOrigin(anchorRect, position.left, position.top, menuRect.width || width, menuRect.height || 44 * items.length);
      gsap.set(el, { transformOrigin: origin });
    }
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 0 });
      gsap.to(el, { opacity: 1, duration: 0.2, ease: "power1.out", overwrite: "auto" });
      return;
    }
    gsap.set(el, { opacity: 0, y: 6, scale: 0.98, filter: "blur(6px)" });
    // §3/§4 — critically damped spring, no bounce, interruptible
    springTo(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { duration: 0.36, damping: 1.0 });
  }, [open, mounted, position.left, position.top, width, items.length, anchorRef]);

  // Al abrir: recordar el foco previo y llevarlo al primer item (el motor
  // espacial queda atrapado dentro mientras haya menú abierto).
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open ]);

  useLayoutEffect(() => {
    if (!open || !mounted || !menuRef.current) return;
    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!open || !menu) return;
      // Prefer the currently selected option; otherwise land on the first row.
      // Waiting one frame is important in WebView2: the portal and its position
      // are committed together, and focusing during the initial commit can leave
      // the trigger as document.activeElement even though the menu is visible.
      const target = menu.querySelector<HTMLElement>(
        'button[data-selected="true"]:not([disabled])',
      ) ?? menu.querySelector<HTMLElement>("button:not([disabled])");
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, mounted]);

  // Al cerrar con B/Escape (o click fuera): devolver el foco al ancla (o al
  // previo) para seguir con el mando donde estaba. Solo si el foco sigue
  // dentro del menú o quedó perdido; no robarlo si ya cayó en otro control.
  useEffect(() => {
    if (open) {
      hadOpenedRef.current = true;
      return;
    }
    if (!hadOpenedRef.current) return;
    hadOpenedRef.current = false;
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && menuRef.current?.contains(active);
    if (inside || active === document.body || !active) {
      (anchorRef.current ?? prevFocusRef.current)?.focus({ preventScroll: true });
    }
  }, [open, anchorRef]);

  if (!mounted) return null;

  const sanitizedItems = items
    .map(item => {
      const cleanLabel = item.label
        .replace(/\b(captura|capture)\b/gi, "")
        .replace(/\bTO\s*AI\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      // oculta entradas que eran solo "captura" o quedaron vacías tras saneo
      if (!cleanLabel) return null;
      if (/^\s*TO\s*AI\s*$/i.test(item.label)) return null;
      if (/captura/i.test(item.label) && cleanLabel.length < 3) return null;
      return { ...item, label: cleanLabel || item.label };
    })
    .filter((item): item is ContextMenuItem => Boolean(item));

  // Si tras filtrar no queda nada, no renderiza el menú vacío que provocaba el artefacto "TO AI"
  if (!sanitizedItems.length) return null;

  // §14 — getPlayerGlassSurface mantiene el estilo de contraste alto. Dentro
  // del reproductor, el shader de MPV pone el desenfoque: este panel lleva
  // `data-player-floating-panel-glass`,
  // así que su rectángulo entra en la geometría del blur por GPU, y el
  // `backdrop-filter` de CSS encima era una segunda superficie de muestreo
  // sobre la superficie nativa del video, que en WebView2 sale a ratos; por eso
  // ahí se apaga. Fuera del reproductor no hay shader: el vidrio lo hace la
  // superficie de blur --lg-blur-xl.
  const glassStyle = getPlayerGlassSurface();
  const apple = variant === "apple";
  const inPlayer = Boolean(anchorRef.current?.closest("[data-player-controls-glass]"));
  return createPortal(
    <div
      ref={menuRef}
      data-aetherio-context-menu
      data-context-open={open ? "true" : "false"}
      data-player-floating-panel-glass
      data-context-variant={variant}
      className="aetherio-context-menu"
      role="menu"
      style={{
        ...(inPlayer
          ? { ...glassStyle, backdropFilter: "none", WebkitBackdropFilter: "none" }
          : glassStyle),
        position: "fixed",
        left: position.left,
        top: position.top,
        zIndex: 1000,
        width,
        maxHeight,
        overflowY: maxHeight ? "auto" : "hidden",
        overflowX: "hidden",
        borderRadius: apple ? 24 : 16,
        padding: apple ? 8 : 5,
        willChange: "transform, opacity, filter",
        transform: "translateZ(0)",
      }}
      onClick={event => event.stopPropagation()}
    >
      {apple && header ? (
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 16px 8px",
            // Sentence case, no versalitas: la referencia escribe "Audio".
            color: "rgba(255,255,255,0.62)",
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: "-0.005em",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{header}</span>
          {toBadgeList(headerBadge).map((badge, badgeIndex) => (
            <span
              key={`${badge.id}-${badgeIndex}`}
              data-audio-badge={badge.id}
              title={badge.label}
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                marginLeft: badgeIndex > 0 ? 10 : 0,
              }}
            >
              {/* El PNG del panel de streams ya lleva el nombre dentro (el
                  wordmark de Atmos, el "5.1" de canales): con texto al lado se
                  leia duplicado. */}
              {badge.imageUrl ? (
                <img
                  src={badge.imageUrl}
                  alt={badge.label}
                  style={{ height: 21, width: "auto", objectFit: "contain" }}
                />
              ) : (
                <span style={{ color: "rgba(255,255,255,0.86)", fontSize: 17, fontWeight: 700 }}>{badge.label}</span>
              )}
            </span>
          ))}
        </div>
      ) : null}
      {sanitizedItems.map((item, index) => {
        const selected = item.selected === true;
        const focused = activeIndex === index;
        // La insignia de tecnologia (Dolby Atmos) solo se ve en la fila que esta
        // en foco o la elegida: es lo que hace la referencia y evita repetirla
        // en todas las pistas.
        const showBadge = Boolean(item.badge) && (selected || activeIndex === index);
        return (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={event => {
            event.stopPropagation();
            if (item.disabled) return;
            item.onSelect();
            if (item.closeOnSelect !== false) onClose();
          }}
          data-selected={apple && selected ? "true" : undefined}
          data-menu-focused={focused ? "true" : undefined}
          style={{
            width: "100%",
            minHeight: apple ? 44 : 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            border: "none",
            borderRadius: apple ? 14 : 11,
            background: apple && selected
              ? "rgba(255,255,255,0.94)"
              : apple && focused
                ? "rgba(255,255,255,0.18)"
                : "transparent",
            boxShadow: apple && focused && !selected
              ? "inset 0 0 0 1px rgba(255,255,255,0.42), 0 0 12px rgba(255,255,255,0.10)"
              : "none",
            color: apple
              ? item.disabled
                ? "rgba(255,255,255,0.35)"
                : selected
                  ? "#0b0b0d"
                  : "rgba(255,255,255,0.88)"
              : item.disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)",
            padding: apple ? "0 14px" : "0 9px 0 11px",
            fontSize: apple ? 17 : 13,
            fontWeight: 500,
            textAlign: "left",
            cursor: item.disabled ? "default" : "pointer",
            // Respiro entre filas: en la referencia las pistas van separadas, no
            // pegadas unas a otras.
            marginBottom: apple && index < sanitizedItems.length - 1 ? 6 : 0,
            willChange: "transform, background-color",
            transform: "translateZ(0)",
          }}
          onPointerDown={event => {
            if (item.disabled || apple) return;
            // §1 Response — highlight on pointer-down instant, not hover
            gsap.killTweensOf(event.currentTarget);
            gsap.set(event.currentTarget, { scale: 0.97 });
            tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.14)", scale: 0.97 }, 0.1);
          }}
          onPointerUp={event => {
            if (item.disabled || apple) return;
            tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.12)", scale: 1 }, 0.14);
          }}
          onPointerLeave={event => {
            if (item.disabled || apple) return;
            tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0)", scale: 1 }, 0.14);
          }}
          onFocus={apple ? () => setActiveIndex(index) : undefined}
          onBlur={apple ? () => setActiveIndex(null) : undefined}
          onMouseEnter={event => {
            if (apple) setActiveIndex(index);
            // En la piel de la referencia la fila blanca se queda blanca: el
            // hover no la tiñe, solo mueve el foco.
            if (item.disabled || apple) return;
            tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.12)" });
          }}
          onMouseLeave={event => {
            if (apple) {
              setActiveIndex(null);
              return;
            }
            tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0)" });
          }}
        >
          <span style={{ minWidth: 0, flex: 1, padding: item.description ? "5px 0" : 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.label}
            </span>
            {item.description ? (
              <span style={{
                display: "block",
                marginTop: 2,
                color: apple && selected ? "rgba(11,11,13,0.62)" : "rgba(255,255,255,0.46)",
                fontSize: 11,
                fontWeight: 500,
                lineHeight: 1.25,
              }}>
                {item.description}
              </span>
            ) : null}
          </span>
          {showBadge && item.badge ? (
            <span
              data-audio-badge={item.badge.id}
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: apple && selected ? "rgba(11,11,13,0.72)" : "rgba(255,255,255,0.62)",
                fontSize: apple ? 13 : 11,
                fontWeight: 700,
              }}
            >
              <AudioWaveform size={apple ? 14 : 12} aria-hidden="true" />
              {item.badge.label}
            </span>
          ) : null}
          {item.icon ? (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", color: apple && selected ? "#0b0b0d" : "rgba(255,255,255,0.82)", flexShrink: 0 }}>
              {item.icon}
            </span>
          ) : null}
        </button>
        );
      })}
    </div>,
    document.body,
  );
}
