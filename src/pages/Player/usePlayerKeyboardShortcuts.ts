import { useEffect, useRef } from "react";

interface KeyboardShortcutHandlers {
  togglePlay: () => void;
  jump: (offset: number) => void;
  applyVolume: (value: number) => void;
  wakeControls: () => void;
  startSpaceAcceleration: () => boolean;
  stopSpaceAcceleration: () => void;
  volume: number;
}

export function usePlayerKeyboardShortcuts({
  togglePlay,
  jump,
  applyVolume,
  wakeControls,
  startSpaceAcceleration,
  stopSpaceAcceleration,
  volume,
}: KeyboardShortcutHandlers) {
  const handlersRef = useRef({
    togglePlay,
    jump,
    applyVolume,
    wakeControls,
    startSpaceAcceleration,
    stopSpaceAcceleration,
    volume,
  });
  handlersRef.current = {
    togglePlay,
    jump,
    applyVolume,
    wakeControls,
    startSpaceAcceleration,
    stopSpaceAcceleration,
    volume,
  };
  const spacePressedRef = useRef(false);
  const spaceAcceleratingRef = useRef(false);
  const spaceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        handlersRef.current.wakeControls();
        if (spacePressedRef.current || event.repeat) return;
        spacePressedRef.current = true;
        spaceTimerRef.current = window.setTimeout(() => {
          spaceTimerRef.current = null;
          spaceAcceleratingRef.current = handlersRef.current.startSpaceAcceleration();
        }, 260);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handlersRef.current.jump(10);
        handlersRef.current.wakeControls();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlersRef.current.jump(-10);
        handlersRef.current.wakeControls();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        handlersRef.current.applyVolume(handlersRef.current.volume + 0.05);
        handlersRef.current.wakeControls();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        handlersRef.current.applyVolume(handlersRef.current.volume - 0.05);
        handlersRef.current.wakeControls();
      }
    };

    const releaseSpace = (toggleOnShortPress: boolean) => {
      if (!spacePressedRef.current && !spaceAcceleratingRef.current) return;
      const wasAccelerating = spaceAcceleratingRef.current;
      spacePressedRef.current = false;
      spaceAcceleratingRef.current = false;
      if (spaceTimerRef.current !== null) {
        window.clearTimeout(spaceTimerRef.current);
        spaceTimerRef.current = null;
      }
      if (wasAccelerating) {
        handlersRef.current.stopSpaceAcceleration();
      } else if (toggleOnShortPress) {
        handlersRef.current.togglePlay();
      }
      handlersRef.current.wakeControls();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " && event.code !== "Space") return;
      event.preventDefault();
      releaseSpace(true);
    };
    const onBlur = () => releaseSpace(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      releaseSpace(false);
    };
  }, []);
}
