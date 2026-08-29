import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { gsap, tweenTo } from "../../utils/motion";
import { CONTEXT_GLASS_STYLE } from "./glassSurface";

export interface ContextMenuItem {
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  closeOnSelect?: boolean;
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
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const [mounted, setMounted] = useState(open);

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
        const controlsTop = document
          .querySelector<HTMLElement>("[data-player-controls-glass]")
          ?.getBoundingClientRect().top;
        const upperBoundary = controlsTop === undefined
          ? anchorRect.top
          : Math.min(anchorRect.top, controlsTop);
        top = Math.max(margin, upperBoundary - menuHeight - 12);
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
    gsap.to(el, {
      opacity: 0,
      y: 6,
      scale: 0.98,
      filter: "blur(6px)",
      duration: 0.26,
      ease: "expo.in",
      overwrite: "auto",
      onComplete: () => setMounted(false),
    });
  }, [open]);

  useEffect(() => {
    if (!open || !mounted || !menuRef.current) return;
    const el = menuRef.current;
    gsap.killTweensOf(el);
    gsap.set(el, { opacity: 0, y: 6, scale: 0.98, filter: "blur(6px)" });
    gsap.to(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.36, ease: "expo.out", overwrite: "auto" });
  }, [open, mounted]);

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

  return createPortal(
    <div
      ref={menuRef}
      data-aetherio-context-menu
      data-player-floating-panel-glass
      role="menu"
      style={{
        ...CONTEXT_GLASS_STYLE,
        position: "fixed",
        left: position.left,
        top: position.top,
        zIndex: 1000,
        width,
        maxHeight,
        overflowY: maxHeight ? "auto" : "hidden",
        overflowX: "hidden",
        borderRadius: 16,
        padding: 5,
      }}
      onClick={event => event.stopPropagation()}
    >
      {sanitizedItems.map((item, index) => (
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
          style={{
            width: "100%",
            minHeight: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            border: "none",
            borderRadius: 11,
            background: "transparent",
            color: item.disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)",
            padding: "0 9px 0 11px",
            fontSize: 13,
            fontWeight: 500,
            textAlign: "left",
            cursor: item.disabled ? "default" : "pointer",
          }}
          onMouseEnter={event => {
            if (!item.disabled) tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.12)" });
          }}
          onMouseLeave={event => {
            tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0)" });
          }}
        >
          <span style={{ minWidth: 0, flex: 1, padding: item.description ? "5px 0" : 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.label}
            </span>
            {item.description ? (
              <span style={{ display: "block", marginTop: 2, color: "rgba(255,255,255,0.46)", fontSize: 11, fontWeight: 500, lineHeight: 1.25 }}>
                {item.description}
              </span>
            ) : null}
          </span>
          {item.icon ? (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.82)", flexShrink: 0 }}>
              {item.icon}
            </span>
          ) : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}
