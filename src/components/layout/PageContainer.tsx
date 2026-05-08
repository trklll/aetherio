import type { ReactNode } from "react";
import clsx from "clsx";

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  fullBleed?: boolean;
}

export default function PageContainer({ children, className, fullBleed = false }: PageContainerProps) {
  return (
    <div
      className={clsx(
        fullBleed ? "w-full" : "mx-auto w-full max-w-[1600px]",
        className
      )}
      style={{ paddingLeft: "var(--app-safe-x)", paddingRight: "var(--app-safe-x)" }}
    >
      {children}
    </div>
  );
}
