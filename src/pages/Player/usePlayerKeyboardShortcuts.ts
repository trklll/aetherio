import { useEffect } from "react";

interface KeyboardShortcutHandlers {
  togglePlay: () => void;
  jump: (offset: number) => void;
  applyVolume: (value: number) => void;
  wakeControls: () => void;
  volume: number;
}

export function usePlayerKeyboardShortcuts({
  togglePlay,
  jump,
  applyVolume,
  wakeControls,
  volume,
}: KeyboardShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        togglePlay();
        wakeControls();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        jump(10);
        wakeControls();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        jump(-10);
        wakeControls();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        applyVolume(volume + 0.05);
        wakeControls();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        applyVolume(volume - 0.05);
        wakeControls();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyVolume, jump, togglePlay, volume, wakeControls]);
}
