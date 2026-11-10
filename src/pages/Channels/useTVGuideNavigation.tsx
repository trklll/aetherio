import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { openPictureRail } from "../../navigation/spatialNav";
import { DEMO_NOW, GUIDE_START, getProgrammeState, programmePosition, type GuideChannel, type GuideProgramme } from "./channelDemo";
import { adjacentChannelProgramme } from "./channelNavigation";

// Keep .tsx so Vite instruments this custom hook for React Fast Refresh.
// A changed hook order must remount ChannelsPage instead of reusing stale state.
export default function useTVGuideNavigation({
  enabled, rootRef, scrollRef, channels, selection,
}: {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  channels: GuideChannel[];
  selection: { channel: GuideChannel; programme: GuideProgramme };
}) {
  const timeRef = useRef(DEMO_NOW);
  const managedFocusRef = useRef(false);

  function focusProgramme(programme: GuideProgramme) {
    managedFocusRef.current = true;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-programme-id="${CSS.escape(programme.id)}"]`)
      ?.focus({ preventScroll: true });
    managedFocusRef.current = false;
  }

  function focusGuide() {
    const channel = channels.find(item => item.id === selection.channel.id) ?? channels[0];
    const programme = channel?.programmes.find(item => item.id === selection.programme.id)
      ?? channel?.programmes.find(item => getProgrammeState(item) === "current")
      ?? channel?.programmes.find(item => programmePosition(item));
    if (programme) focusProgramme(programme);
    else rootRef.current?.querySelector<HTMLButtonElement>(".channels-empty button")?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(".channels-program--selected")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, rootRef]);

  function revealProgramme(element: HTMLButtonElement, programme: GuideProgramme) {
    if (!enabled) return;
    if (!managedFocusRef.current) timeRef.current = Math.max(GUIDE_START, programme.start, Math.min(DEMO_NOW, programme.end - 1));
    const scroll = scrollRef.current;
    if (!scroll) return;
    const viewport = scroll.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const labelWidth = rootRef.current?.querySelector(".channels-guide__channel")?.getBoundingClientRect().width ?? 0;
    const headingHeight = rootRef.current?.querySelector(".channels-guide__times")?.getBoundingClientRect().height ?? 0;
    const start = viewport.left + labelWidth + 10;
    const end = viewport.right - 8;
    let left = scroll.scrollLeft;
    let top = scroll.scrollTop;
    if (rect.left < start || rect.width > end - start) left += rect.left - start;
    else if (rect.right > end) left += rect.right - end;
    if (rect.top < viewport.top + headingHeight + 5) top += rect.top - viewport.top - headingHeight - 5;
    else if (rect.bottom > viewport.bottom - 5) top += rect.bottom - viewport.bottom + 5;
    // Direct, bounded viewport following keeps rapid held directions in sync;
    // neither the outer shell nor the pinned preview should move.
    scroll.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: "instant" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (!rootRef.current?.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    const programmeButton = target.closest<HTMLButtonElement>("[data-programme-id]");
    if (programmeButton) {
      const channel = channels.find(item => item.id === programmeButton.dataset.channelId);
      const programmes = channel?.programmes.filter(item => programmePosition(item)) ?? [];
      const index = programmes.findIndex(item => item.id === programmeButton.dataset.programmeId);
      if (!channel || index < 0) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const next = adjacentChannelProgramme(channels, channel.id, timeRef.current, event.key === "ArrowDown" ? 1 : -1);
        if (next) focusProgramme(next.programme);
        else if (event.key === "ArrowUp") {
          rootRef.current.querySelector<HTMLButtonElement>(".channels-filters__button--active")?.focus({ preventScroll: true });
        }
        return;
      }
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? programmes.length - 1
        : index + (event.key === "ArrowRight" ? 1 : -1);
      const next = programmes[nextIndex];
      if (next) {
        timeRef.current = Math.max(GUIDE_START, next.start);
        focusProgramme(next);
      } else if (event.key === "ArrowLeft") openPictureRail();
      return;
    }
    if (event.key === "ArrowDown") {
      focusGuide();
      return;
    }
    if (event.key === "ArrowUp") {
      rootRef.current.querySelector<HTMLButtonElement>(".channels-filters__button--active")?.focus({ preventScroll: true });
      return;
    }
    const controls = Array.from(rootRef.current.querySelectorAll<HTMLButtonElement>("[data-guide-control]:not(:disabled)"));
    const index = controls.indexOf(target.closest("button") as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
      : index + (event.key === "ArrowRight" ? 1 : -1);
    if (controls[nextIndex]) controls[nextIndex].focus({ preventScroll: true });
    else if (event.key === "ArrowLeft") openPictureRail();
  }

  function focusNow() {
    timeRef.current = DEMO_NOW;
    const channel = channels.find(item => item.id === selection.channel.id) ?? channels[0];
    const current = channel?.programmes.find(item => getProgrammeState(item) === "current");
    if (current) focusProgramme(current);
  }

  return { onKeyDown, revealProgramme, focusGuide, focusNow };
}
