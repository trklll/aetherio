import { useEffect, useRef } from "react";
import type { PlayerFeedbackKind } from "./PlayerActionFeedback";

interface KeyboardShortcutHandlers {
  togglePlay: () => void;
  jump: (offset: number) => void;
  applyVolume: (value: number) => void;
  flash: (kind: PlayerFeedbackKind, extra?: { deltaSeconds?: number; volume?: number }) => void;
  startSpaceAcceleration: () => boolean;
  stopSpaceAcceleration: () => void;
  volume: number;
  playing: boolean;
  enabled?: boolean;
}

export function usePlayerKeyboardShortcuts({
  togglePlay,
  jump,
  applyVolume,
  flash,
  startSpaceAcceleration,
  stopSpaceAcceleration,
  volume,
  playing,
  enabled = true,
}: KeyboardShortcutHandlers) {
  const handlersRef = useRef({
    togglePlay,
    jump,
    applyVolume,
    flash,
    startSpaceAcceleration,
    stopSpaceAcceleration,
    volume,
    playing,
  });
  handlersRef.current = {
    togglePlay,
    jump,
    applyVolume,
    flash,
    startSpaceAcceleration,
    stopSpaceAcceleration,
    volume,
    playing,
  };
  const spacePressedRef = useRef(false);
  const spaceAcceleratingRef = useRef(false);
  const spaceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        // Solo se cede el teclado al contexto de edición de texto. Los
        // sliders (input range: volumen y timeline) NO se excluyen: las
        // flechas los mueven de forma nativa sin seek ni OSD, y el foco se
        // queda en ellos tras arrastrarlos — de ahí que el signo de
        // adelante/atrás saliera "a veces sí, a veces no". Al dejarlos pasar,
        // cada rama hace preventDefault y dispara seek + flash siempre.
        const type = tag === "input" ? (target as HTMLInputElement).type.toLowerCase() : "";
        const isTextEntry =
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable ||
          (tag === "input" && type !== "range");
        if (isTextEntry) return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        // Espacio: solo OSD al soltar (toggle) o aceleración al mantener.
        // No despierta la barra — el feedback visual lo da el icono central.
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
        handlersRef.current.flash("forward", { deltaSeconds: 10 });
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlersRef.current.jump(-10);
        handlersRef.current.flash("rewind", { deltaSeconds: -10 });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = handlersRef.current.volume + 0.05;
        handlersRef.current.applyVolume(next);
        handlersRef.current.flash("volume", { volume: Math.min(2, Math.max(0, next)) });
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = handlersRef.current.volume - 0.05;
        handlersRef.current.applyVolume(next);
        handlersRef.current.flash("volume", { volume: Math.min(2, Math.max(0, next)) });
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
        const wasPlaying = handlersRef.current.playing;
        handlersRef.current.togglePlay();
        handlersRef.current.flash(wasPlaying ? "pause" : "play");
      }
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
  }, [enabled]);
}
