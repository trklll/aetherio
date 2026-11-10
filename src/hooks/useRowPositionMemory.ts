import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { LOCAL_PROFILES_CHANGED_EVENT } from "../utils/localProfiles";
import { gsap, stopInertialScroll } from "../utils/motion";

interface RowFocus {
  rowKey: string;
  itemIndex: string | null;
  platformId: string | null;
}

interface RowPosition {
  vertical: number;
  horizontal: Map<string, number>;
  focus: RowFocus | null;
}

// Roving-tabindex rows intentionally put inactive cards at -1. They remain
// programmatically focusable and must be restored, not a nested action button.
const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([disabled])";

/** Route-local viewport memory for every rail using the shared row attributes. */
export function useRowPositionMemory(shellRef: RefObject<HTMLElement | null>, routeKey: string): boolean {
  const positions = useRef(new Map<string, RowPosition>());
  const activeRoute = useRef(routeKey);
  const restoring = useRef(false);
  const cancelRestore = useRef<(() => void) | null>(null);
  const saved = positions.current.get(routeKey);
  // Children can focus in their layout effects before the shell's own effects.
  // Attribute those events to the incoming route, never to the page we left.
  activeRoute.current = routeKey;

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const capture = (target: EventTarget | null, rememberFocus: boolean) => {
      if (restoring.current || !(target instanceof HTMLElement) || !shell.contains(target)) return;
      if (!shell.querySelector("[data-row-key]")) return;
      const previous = positions.current.get(activeRoute.current);
      const horizontal = new Map(previous?.horizontal);
      // Focus/activation snapshots every rail. Scroll events only update their
      // own rail, so wheel/animation frames don't walk the entire Home DOM.
      if (rememberFocus || !previous) {
        for (const row of shell.querySelectorAll<HTMLElement>("[data-row-key]")) {
          const scroller = row.querySelector<HTMLElement>("[data-row-scroller]");
          if (scroller) horizontal.set(row.dataset.rowKey!, scroller.scrollLeft);
        }
      } else if (target.matches("[data-row-scroller]")) {
        const key = target.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
        if (key) horizontal.set(key, target.scrollLeft);
      }
      let focus = previous?.focus ?? null;
      const row = target.closest<HTMLElement>("[data-row-key]");
      if (rememberFocus && row && target.closest("[data-row-card], [data-item-index], [data-platform-id]")) {
        focus = {
          rowKey: row.dataset.rowKey!,
          itemIndex: target.closest<HTMLElement>("[data-item-index]")?.dataset.itemIndex ?? null,
          platformId: target.closest<HTMLElement>("[data-platform-id]")?.dataset.platformId ?? null,
        };
      }
      positions.current.set(activeRoute.current, { vertical: shell.scrollTop, horizontal, focus });
    };
    const onScroll = (event: Event) => capture(event.target, false);
    const onFocus = (event: FocusEvent) => capture(event.target, true);
    const onClick = (event: MouseEvent) => capture(event.target, true);
    const onProfileChange = () => {
      cancelRestore.current?.();
      positions.current.clear();
    };
    shell.addEventListener("scroll", onScroll, true);
    shell.addEventListener("focusin", onFocus);
    shell.addEventListener("click", onClick, true);
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, onProfileChange);
    return () => {
      shell.removeEventListener("scroll", onScroll, true);
      shell.removeEventListener("focusin", onFocus);
      shell.removeEventListener("click", onClick, true);
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, onProfileChange);
    };
  }, [shellRef]);

  useLayoutEffect(() => {
    activeRoute.current = routeKey;
    const shell = shellRef.current;
    if (!shell || !saved) return;
    restoring.current = true;
    shell.dataset.rowPositionRestoring = "true";
    stopInertialScroll(shell);
    gsap.killTweensOf(shell, "scrollTop");
    let frame = 0;
    let attempts = 0;
    let settledFrames = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
      delete shell.dataset.rowPositionRestoring;
      shell.removeEventListener("wheel", finish, true);
      shell.removeEventListener("pointerdown", finish, true);
      window.removeEventListener("keydown", finish, true);
    };
    // Async catalogs may mount after the focused row has already settled.
    // Restore each new scroller once without taking focus or moving the page.
    const restoredRails = new WeakSet<HTMLElement>();
    const restoreNewRails = () => {
      for (const row of shell.querySelectorAll<HTMLElement>("[data-row-key]")) {
        const scroller = row.querySelector<HTMLElement>("[data-row-scroller]");
        const left = saved.horizontal.get(row.dataset.rowKey!);
        if (!scroller || left === undefined || restoredRails.has(scroller)) continue;
        scroller.scrollTo({ left, behavior: "instant" });
        if (Math.abs(scroller.scrollLeft - left) <= 1) restoredRails.add(scroller);
      }
    };
    const observer = new MutationObserver(restoreNewRails);
    observer.observe(shell, { subtree: true, childList: true });
    const cleanup = () => {
      finish();
      observer.disconnect();
      cancelRestore.current = null;
    };
    cancelRestore.current = cleanup;
    shell.addEventListener("wheel", finish, { capture: true, passive: true });
    shell.addEventListener("pointerdown", finish, true);
    window.addEventListener("keydown", finish, true);
    const restore = () => {
      attempts++;
      const rows = Array.from(shell.querySelectorAll<HTMLElement>("[data-row-key]"));
      let complete = rows.length > 0;
      for (const [key, left] of saved.horizontal) {
        const row = rows.find(candidate => candidate.dataset.rowKey === key);
        // Missing/removed rows cannot prevent the surviving rows from restoring.
        if (!row) continue;
        const scroller = row.querySelector<HTMLElement>("[data-row-scroller]");
        if (!scroller) { complete = false; continue; }
        gsap.killTweensOf(scroller, "scrollLeft");
        scroller.scrollTo({ left, behavior: "instant" });
        if (Math.abs(scroller.scrollLeft - left) > 1) complete = false;
        else restoredRails.add(scroller);
      }
      if (saved.focus) {
        const row = rows.find(candidate => candidate.dataset.rowKey === saved.focus!.rowKey);
        if (row) {
          const holder = saved.focus.platformId !== null
            ? Array.from(row.querySelectorAll<HTMLElement>("[data-platform-id]")).find(candidate => candidate.dataset.platformId === saved.focus!.platformId)
            : Array.from(row.querySelectorAll<HTMLElement>("[data-item-index]")).find(candidate => candidate.dataset.itemIndex === saved.focus!.itemIndex);
          const target = holder?.matches(FOCUSABLE) ? holder : holder?.querySelector<HTMLElement>(FOCUSABLE);
          if (target && target.getBoundingClientRect().width > 0) {
            if (document.activeElement !== target) target.focus({ preventScroll: true });
          } else complete = false;
        }
      }
      shell.scrollTo({ top: saved.vertical, behavior: "instant" });
      if (Math.abs(shell.scrollTop - saved.vertical) > 1) complete = false;
      settledFrames = complete ? settledFrames + 1 : 0;
      // Allow virtualization and deferred page layout to settle after focus.
      if (settledFrames >= 4 || attempts >= 120) { finish(); return; }
      frame = requestAnimationFrame(restore);
    };
    restore();
    return cleanup;
    // A snapshot is fixed for this route entry, not for every focus/scroll render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, shellRef]);

  return Boolean(saved);
}
