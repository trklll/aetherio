// One observer for the whole catalog, not one observer/scroll listener per card.
// A small look-ahead warms the next row without decoding the entire Home.
let observer: IntersectionObserver | undefined;
const subscribers = new Map<Element, Set<() => void>>();

function release(element: Element) {
  subscribers.delete(element);
  observer?.unobserve(element);
  if (subscribers.size === 0) {
    observer?.disconnect();
    observer = undefined;
  }
}

export function observeNearViewport(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => {};
  }
  if (!observer) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callbacks = subscribers.get(entry.target);
        if (!callbacks) continue;
        release(entry.target);
        for (const callback of callbacks) callback();
      }
    }, { rootMargin: "400px" });
  }
  let callbacks = subscribers.get(element);
  if (!callbacks) {
    callbacks = new Set();
    subscribers.set(element, callbacks);
    observer.observe(element);
  }
  callbacks.add(onVisible);
  return () => {
    // An already admitted element may have a new subscription after a remount.
    if (subscribers.get(element) !== callbacks) return;
    callbacks.delete(onVisible);
    if (callbacks.size === 0) release(element);
  };
}
