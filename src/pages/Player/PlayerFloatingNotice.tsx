import type { ReactNode } from "react";
import { getPlayerGlassSurface } from "../../components/ui/glassSurface";

interface PlayerFloatingNoticeProps {
  children: ReactNode;
  top: number;
  nativeSurfaceVisible: boolean;
  interactive?: boolean;
  playbackSelection?: boolean;
}

export default function PlayerFloatingNotice({
  children,
  top,
  nativeSurfaceVisible,
  interactive = false,
  playbackSelection = false,
}: PlayerFloatingNoticeProps) {
  const glass = getPlayerGlassSurface();

  return (
    <div
      data-player-glass-notice
      data-player-interactive={interactive ? "" : undefined}
      data-playback-selection-notice={playbackSelection ? "" : undefined}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 max-w-[calc(100vw-32px)] break-words rounded-full px-4 py-2 text-center text-sm font-semibold leading-5 text-white"
      style={{
        ...glass,
        top,
        ...(nativeSurfaceVisible
          ? { backdropFilter: "none", WebkitBackdropFilter: "none" }
          : {}),
      }}
    >
      {children}
    </div>
  );
}
