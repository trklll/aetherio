import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import aetherioLogo from "../../assets/aetheriologo.png";
import { gsap } from "../../utils/motion";
import { STARTUP_COMPLETE_EVENT, STARTUP_STATUS_EVENT } from "./startupEvents";
import "./StartupExperience.css";

export default function NativeSplashWindow() {
  const rootRef = useRef<HTMLElement>(null);
  const closingRef = useRef(false);
  const [status, setStatus] = useState("Iniciando Aetherio");

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const context = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(".startup-logo", { autoAlpha: 0, scale: 0.86 }, { autoAlpha: 1, scale: 1, duration: 0.55 })
        .fromTo(".startup-copy > *", { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.36, stagger: 0.06 }, "-=0.24")
        .fromTo(".startup-loader", { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.32 }, "-=0.18");
      gsap.to(".startup-spinner", { rotate: 360, duration: 1.05, repeat: -1, ease: "none" });
      gsap.to(".startup-logo", { scale: 1.025, duration: 1.8, repeat: -1, yoyo: true, ease: "sine.inOut" });
    }, root);
    return () => context.revert();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenStatus: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    void listen<string>(STARTUP_STATUS_EVENT, event => {
      if (!disposed) setStatus(event.payload);
    }).then(unlisten => {
      if (disposed) unlisten();
      else unlistenStatus = unlisten;
    });

    void listen(STARTUP_COMPLETE_EVENT, () => {
      if (closingRef.current) return;
      closingRef.current = true;
      const root = rootRef.current;
      if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        void getCurrentWindow().close();
        return;
      }

      gsap.timeline({ defaults: { ease: "power3.inOut" }, onComplete: () => void getCurrentWindow().close() })
        .to(".startup-copy, .startup-loader", { autoAlpha: 0, y: -5, duration: 0.25 })
        .to(".startup-logo", { autoAlpha: 0, scale: 0.9, duration: 0.3 }, "<")
        .to(root, { autoAlpha: 0, scale: 0.975, duration: 0.38 }, "-=0.08");
    }).then(unlisten => {
      if (disposed) unlisten();
      else unlistenComplete = unlisten;
    });

    return () => {
      disposed = true;
      unlistenStatus?.();
      unlistenComplete?.();
    };
  }, []);

  return (
    <main
      ref={rootRef}
      className="native-startup-window"
      data-tauri-drag-region
      data-testid="aetherio-native-splash"
      role="status"
      aria-live="polite"
      aria-label={status}
    >
      <div className="startup-brand" data-tauri-drag-region>
        <img className="startup-logo" src={aetherioLogo} alt="" draggable={false} />
        <div className="startup-copy" data-tauri-drag-region>
          <strong>Aetherio</strong>
        </div>
      </div>
      <div className="startup-loader" aria-hidden="true" data-tauri-drag-region>
        <span className="startup-spinner" />
      </div>
    </main>
  );
}
