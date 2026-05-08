import type { ReactNode } from "react";

interface FloatingActionButtonProps {
  icon: ReactNode;
  onClick: () => void;
  title: string;
}

export default function FloatingActionButton({ icon, onClick, title }: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="liquid-glass flex h-10 w-10 items-center justify-center rounded-md text-white/80 transition hover:text-white"
      title={title}
      aria-label={title}
      type="button"
    >
      {icon}
    </button>
  );
}
