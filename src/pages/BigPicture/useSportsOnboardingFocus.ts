import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { GAMEPAD_ACTION_EVENT, type GamepadActionDetail } from "../../hooks/useGamepad.ts";
import { isBackspaceKey, isEscapeKey } from "../../input/inputActions.ts";
import { findOnboardingNeighbor, type OnboardingDirection, type OnboardingFocusItem } from "./sportsOnboardingFocus.ts";

interface FocusTarget extends OnboardingFocusItem { element: HTMLElement; indexInGroup: number }

function targetsIn(root: HTMLElement): FocusTarget[] {
  const groupCounts = new Map<string, number>();
  return Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']"))
    .filter(element => element.getBoundingClientRect().width > 0 && !element.closest("[hidden]"))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const group = element.closest<HTMLElement>("[data-onboarding-focus-group]")?.dataset.onboardingFocusGroup ?? "content";
      const indexInGroup = groupCounts.get(group) ?? 0;
      groupCounts.set(group, indexInGroup + 1);
      return {
        id: element.dataset.onboardingFocusId ?? String(index),
        group, indexInGroup,
        left: rect.left, top: rect.top, width: rect.width, element,
      };
    });
}

/** Only scroll the local viewport. Native scrollIntoView also moves the shell
 * and can hide the persistent toolbar. Immediate retargeting keeps held D-pad
 * input stable; no delayed tween can restore an older position or focus.
 */
function reveal(element: HTMLElement) {
  const area = element.closest<HTMLElement>("[data-onboarding-scroll]");
  if (!area) return;
  const box = element.getBoundingClientRect();
  const view = area.getBoundingClientRect();
  const pad = 6;
  if (box.top < view.top + pad) area.scrollTop += box.top - view.top - pad;
  else if (box.bottom > view.bottom - pad) area.scrollTop += box.bottom - view.bottom + pad;
}

export function useSportsOnboardingFocus(
  rootRef: RefObject<HTMLDivElement | null>,
  step: string,
  onBack: () => void,
) {
  const previousStep = useRef<string | null>(null);
  const lastFocus = useRef<FocusTarget | null>(null);
  const lastContent = useRef<FocusTarget | null>(null);
  const preferredX = useRef<number | undefined>(undefined);

  const focus = (target?: FocusTarget) => {
    if (!target) return;
    target.element.focus({ preventScroll: true });
    reveal(target.element);
  };

  const restore = (targets: FocusTarget[], saved: FocusTarget | null) => {
    if (!saved) return undefined;
    const group = targets.filter(item => item.group === saved.group);
    return targets.find(item => item.element === saved.element)
      ?? group.find(item => item.id === saved.id)
      ?? group[Math.min(saved.indexInGroup, group.length - 1)];
  };

  const contentTarget = (targets: FocusTarget[]) => restore(targets, lastContent.current)
    ?? targets.find(item => item.group !== "actions" && item.element.hasAttribute("data-onboarding-autofocus"))
    ?? targets.find(item => item.group !== "actions");

  const actionTarget = (targets: FocusTarget[]) => targets.find(item => item.element.hasAttribute("data-onboarding-primary-action"))
    ?? targets.find(item => item.group === "actions");

  const move = (direction: OnboardingDirection) => {
    const root = rootRef.current;
    if (!root) return;
    const targets = targetsIn(root);
    const current = targets.find(item => item.element === document.activeElement);
    if (!current) { focus(contentTarget(targets)); return; }
    if (current.group === "actions" && direction === "down") {
      preferredX.current = undefined;
      focus(contentTarget(targets));
      return;
    }
    const vertical = direction === "up" || direction === "down";
    if (!vertical || preferredX.current === undefined) preferredX.current = current.left + current.width / 2;
    const next = findOnboardingNeighbor(targets, current, direction, preferredX.current);
    if (next?.group !== current.group) preferredX.current = undefined;
    focus(next?.group === "actions" && vertical ? actionTarget(targets) : next);
  };

  const toggleActions = () => {
    const root = rootRef.current;
    if (!root) return;
    const targets = targetsIn(root);
    const current = targets.find(item => item.element === document.activeElement);
    focus(current?.group === "actions" ? contentTarget(targets) : actionTarget(targets));
    preferredX.current = undefined;
  };

  const page = (direction: "up" | "down") => {
    const root = rootRef.current;
    const active = document.activeElement as HTMLElement | null;
    const area = root?.querySelector<HTMLElement>("[data-onboarding-scroll]");
    const rows = Math.max(1, Math.floor((area?.clientHeight ?? 300) / Math.max(60, active?.offsetHeight ?? 60)) - 1);
    for (let index = 0; index < rows; index++) move(direction);
  };

  // Focus survives filtered-out selections, empty results and responsive reflow.
  // Only recover a detached target; never steal focus from another surface.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = targetsIn(root);
    if (previousStep.current !== step) {
      previousStep.current = step;
      lastFocus.current = null;
      lastContent.current = null;
      preferredX.current = undefined;
      const area = root.querySelector<HTMLElement>("[data-onboarding-scroll]");
      if (area) area.scrollTop = 0;
      focus(contentTarget(targets) ?? actionTarget(targets));
    } else if (document.activeElement === document.body || root.contains(document.activeElement)) {
      const current = targets.find(item => item.element === document.activeElement);
      focus(current ?? restore(targets, lastFocus.current)
        ?? targets.find(item => item.element.hasAttribute("data-onboarding-filter"))
        ?? contentTarget(targets) ?? actionTarget(targets));
    }
  });

  const handleAction = useRef<(event: Event) => void>(() => undefined);
  handleAction.current = (event: Event) => {
    const root = rootRef.current;
    if (!root?.contains(document.activeElement) || event.defaultPrevented) return;
    const { id } = (event as CustomEvent<GamepadActionDetail>).detail;
    if (id === "back") { event.preventDefault(); onBack(); }
    if (id === "y") { event.preventDefault(); toggleActions(); }
    if (id === "lb" || id === "rb") { event.preventDefault(); page(id === "lb" ? "up" : "down"); }
  };

  useEffect(() => {
    const listener = (event: Event) => handleAction.current(event);
    window.addEventListener(GAMEPAD_ACTION_EVENT, listener);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, listener);
  }, []);

  useEffect(() => {
    const area = rootRef.current?.querySelector<HTMLElement>("[data-onboarding-scroll]");
    if (!area) return;
    const observer = new ResizeObserver(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && area.contains(active)) reveal(active);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [rootRef]);

  return {
    onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => {
      const direction: Record<string, OnboardingDirection> = {
        ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
      };
      if (isEscapeKey(event.nativeEvent) || isBackspaceKey(event.nativeEvent)) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) onBack();
      } else if (direction[event.key]) {
        event.preventDefault(); event.stopPropagation(); move(direction[event.key]);
      } else if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault(); event.stopPropagation(); page(event.key === "PageUp" ? "up" : "down");
      } else if (event.key === "Home") {
        event.preventDefault(); event.stopPropagation(); toggleActions();
      } else if (event.key === "Enter" && event.repeat) {
        event.preventDefault(); event.stopPropagation();
      }
    },
    onFocusCapture: (event: FocusEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) return;
      const target = targetsIn(root).find(item => item.element === event.target);
      if (!target) return;
      lastFocus.current = target;
      if (target.group !== "actions") lastContent.current = target;
      reveal(target.element);
    },
  };
}
