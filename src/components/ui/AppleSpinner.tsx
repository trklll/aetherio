import type { CSSProperties } from "react";

interface AppleSpinnerProps {
  /** Diameter in CSS pixels. */
  size?: number;
  /** Defaults to neutral white; use current text color where appropriate. */
  color?: string;
  className?: string;
}

const PETAL_OPACITIES = [1, 0.88, 0.76, 0.63, 0.5, 0.4, 0.31, 0.22];

/** Eight-petal indeterminate activity indicator. */
export default function AppleSpinner({ size = 46, color = "#fff", className = "" }: AppleSpinnerProps) {
  const style = {
    "--aetherio-spinner-size": `${size}px`,
    "--aetherio-spinner-color": color,
  } as CSSProperties;

  return (
    <span className={`aetherio-petal-spinner ${className}`.trim()} style={style} aria-hidden="true">
      {PETAL_OPACITIES.map((opacity, index) => (
        <span className="aetherio-petal-spinner__petal" style={{ opacity }} key={index} />
      ))}
    </span>
  );
}
