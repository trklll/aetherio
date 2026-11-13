import { tweenTo } from "../../utils/motion";

const DETAIL_FOCUS_DURATION = 0.18;

/** Shared lift/scale used by every focusable card in the detail page. */
export function animateDetailCardFocus(element: HTMLElement, focused: boolean) {
  tweenTo(element, {
    scale: focused ? 1.05 : 1,
    y: focused ? -3 : 0,
    zIndex: focused ? 5 : 1,
  }, DETAIL_FOCUS_DURATION);

}
