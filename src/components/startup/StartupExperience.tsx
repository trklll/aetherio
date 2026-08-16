import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import aetherioLogo from "../../assets/aetheriologo.png";
import { isAndroidRuntime, isTauriRuntime } from "../../runtime/platform";
import { gsap, prefersReducedMotion } from "../../utils/motion";
import { STARTUP_COMPLETE_EVENT, STARTUP_STATUS_EVENT } from "./startupEvents";
import "./StartupExperience.css";

interface StartupExperienceProps {
  children: ReactNode;
  ready: boolean;
  status: string;
}

export default function StartupExperience({ children, ready, status }: StartupExperienceProps) {
  if (isTauriRuntime() && !isAndroidRuntime()) {
    return (
      <NativeMainStartupCoordinator ready={ready} status={status}>
        {children}
      </NativeMainStartupCoordinator>
    );
  }

  return (
    <BrowserStartupExperience ready={ready} status={status}>
      {children}
    </BrowserStartupExperience>
  );
}

function NativeMainStartupCoordinator({ children, ready, status }: StartupExperienceProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const revealedRef = useRef(false);

  useLayoutEffect(() => {
    gsap.set(contentRef.current, { autoAlpha: 0, y: 12, scale: 0.997 });
  }, []);

  useEffect(() => {
    void emitTo("splash", STARTUP_STATUS_EVENT, status).catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (!ready || revealedRef.current) return;
    revealedRef.current = true;
    void emitTo("splash", STARTUP_COMPLETE_EVENT).catch(() => undefined);

    const timeout = window.setTimeout(() => {
      void (async () => {
        const mainWindow = getCurrentWindow();
        await mainWindow.show();
        await mainWindow.setFocus();

        if (prefersReducedMotion()) {
          gsap.set(contentRef.current, { autoAlpha: 1, clearProps: "transform" });
          return;
        }

        gsap.to(contentRef.current, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.72,
          ease: "power3.out",
          clearProps: "opacity,visibility,transform",
        });
      })().catch(() => {
        gsap.set(contentRef.current, { autoAlpha: 1, clearProps: "transform" });
      });
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [ready]);

  return (
    <div ref={contentRef} className="startup-app-content">
      {children}
    </div>
  );
}

function BrowserStartupExperience({ children, ready, status }: StartupExperienceProps) {
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef(Date.now());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const context = gsap.context(() => {
      gsap.set(contentRef.current, { autoAlpha: 0, y: 12, scale: 0.995 });
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(".startup-panel", { autoAlpha: 0, scale: 0.965, y: 10 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.62 })
        .fromTo(".startup-logo", { autoAlpha: 0, scale: 0.88 }, { autoAlpha: 1, scale: 1, duration: 0.48 }, "-=0.3")
        .fromTo(".startup-copy > *", { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.06 }, "-=0.22");
      gsap.to(".startup-spinner", { rotate: 360, duration: 1.05, repeat: -1, ease: "none" });
      gsap.to(".startup-logo", { scale: 1.025, duration: 1.8, repeat: -1, yoyo: true, ease: "sine.inOut" });
    }, root);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!ready || !visible) return;
    const remaining = Math.max(0, 850 - (Date.now() - startedAtRef.current));
    const timeout = window.setTimeout(() => {
      const reducedMotion = prefersReducedMotion();
      if (reducedMotion) {
        gsap.set(contentRef.current, { autoAlpha: 1, clearProps: "transform" });
        setVisible(false);
        return;
      }
      const timeline = gsap.timeline({
        defaults: { ease: "power3.inOut" },
        onComplete: () => {
          gsap.set(contentRef.current, { clearProps: "opacity,visibility,transform" });
          setVisible(false);
        },
      });
      timeline
        .to(".startup-copy, .startup-loader", { autoAlpha: 0, y: -5, duration: 0.28 })
        .to(".startup-logo", { autoAlpha: 0, scale: 0.9, duration: 0.3 }, "<")
        .to(".startup-panel", { autoAlpha: 0, scale: 0.975, duration: 0.42 }, "-=0.1")
        .to(rootRef.current, { autoAlpha: 0, duration: 0.46 }, "-=0.16")
        .to(contentRef.current, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7 }, "-=0.48");
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [ready, visible]);

  return (
    <>
      <div
        ref={contentRef}
        className="startup-app-content"
        aria-hidden={visible}
        style={{ pointerEvents: visible ? "none" : undefined }}
      >
        {children}
      </div>
      {visible ? (
        <div ref={rootRef} className="startup-experience" data-testid="aetherio-startup">
          <section className="startup-panel" role="status" aria-live="polite" aria-label={status}>
            <div className="startup-brand">
              <img className="startup-logo" src={aetherioLogo} alt="" />
            </div>
            <div className="startup-loader" aria-hidden="true">
              <span className="startup-spinner" />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
