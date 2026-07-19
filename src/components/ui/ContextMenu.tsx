import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tweenTo } from "../../utils/motion";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
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
    if (!open) return;

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
        top = anchorRect.top - menuHeight - 8;
        if (top < margin) top = anchorRect.bottom + 8;
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
  }, [anchorRef, avoidRef, items.length, open, placement, width]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-aetherio-context-menu
      role="menu"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        zIndex: 1000,
        width,
        maxHeight,
        overflowY: maxHeight ? "auto" : "hidden",
        overflowX: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(225,230,238,0.09)",
        background: "linear-gradient(135deg, rgba(64,64,64,0.72), rgba(28,28,30,0.82))",
        backdropFilter: "blur(18px) saturate(180%)",
        WebkitBackdropFilter: "blur(18px) saturate(180%)",
        boxShadow: "0 20px 54px rgba(0,0,0,0.56), inset 0 1px 0 rgba(255,255,255,0.055)",
        padding: 5,
      }}
      onClick={event => event.stopPropagation()}
    >
      {items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={event => {
            event.stopPropagation();
            if (item.disabled) return;
            item.onSelect();
            onClose();
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
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.label}
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
