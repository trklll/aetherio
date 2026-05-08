import { useCallback, useEffect, useRef, useState } from "react";

export function useControlsVisibility(timeoutMs = 800) {
  const hideTimer = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const wakeControls = useCallback((nextTimeoutMs = timeoutMs) => {
    setControlsVisible(true);
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), nextTimeoutMs);
  }, [clearHideTimer, timeoutMs]);

  const holdControls = useCallback(() => {
    setControlsVisible(true);
    clearHideTimer();
  }, [clearHideTimer]);

  const releaseControls = useCallback((multiplier = 1) => {
    wakeControls(timeoutMs * multiplier);
  }, [timeoutMs, wakeControls]);

  useEffect(() => {
    wakeControls();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [wakeControls]);

  return { controlsVisible, setControlsVisible, wakeControls, holdControls, releaseControls };
}
