import { forwardRef } from "react";

interface ScrollRowArrowProps {
  direction: "left" | "right";
  top?: number | string;
  inset?: number;
  visible: boolean;
  enabled: boolean;
  onClick: () => void;
}

const ScrollRowArrow = forwardRef<HTMLDivElement, ScrollRowArrowProps>(
  function ScrollRowArrow({ direction, top, inset, visible, enabled, onClick }, ref) {
    const left = direction === "left";
    const label = left ? "Anterior" : "Siguiente";

    return (
      <div
        ref={ref}
        className="liquid-glass-arrow row-arrow-shell"
        style={{
          position: "absolute",
          ...(left ? { left: inset ?? 0 } : { right: inset ?? 0 }),
          top: top ?? "50%",
          zIndex: 10,
          transform: inset === undefined
            ? left ? "translate(-30%,-50%)" : "translate(30%,-50%)"
            : "translateY(-50%)",
          opacity: 0,
          pointerEvents: visible && enabled ? "auto" : "none",
        }}
      >
        <button
          type="button"
          onClick={onClick}
          title={label}
          aria-label={label}
          className="row-arrow-button"
          style={{
            width: 36,
            height: 60,
            borderRadius: 18,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <svg
            width="18"
            height="30"
            viewBox="0 -0.5 17 17"
            fill="#fff"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              ...(left ? { transform: "rotate(180deg)" } : {}),
              overflow: "visible",
            }}
          >
            <path d="M6.077,1.162 C6.077,1.387 6.139,1.612 6.273,1.812 L10.429,8.041 L6.232,14.078 C5.873,14.619 6.019,15.348 6.56,15.707 C7.099,16.068 7.831,15.922 8.19,15.382 L12.82,8.694 C13.084,8.3 13.086,7.786 12.822,7.39 L8.233,0.51 C7.873,-0.032 7.141,-0.178 6.601,0.181 C6.26,0.409 6.077,0.782 6.077,1.162 L6.077,1.162 Z" transform="scale(1.15,1.9) translate(-1.3,-3.5)" />
          </svg>
        </button>
      </div>
    );
  },
);

ScrollRowArrow.displayName = "ScrollRowArrow";

export default ScrollRowArrow;
