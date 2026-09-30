import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import "./InfiniteHorizontalRow.css";

const DEFAULT_SPEED = 28;
const FOCUSABLE_SELECTOR = [
  "[data-row-card]",
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const CLONE_NAVIGATION_ATTRIBUTES = [
  "data-row-card",
  "data-item-index",
  "data-onboarding-autofocus",
  "data-row-key",
  "data-row-count",
  "data-row-scroller",
  "data-focus-center",
] as const;

const CLONE_EVENT_PROPS = [
  "onClick",
  "onDoubleClick",
  "onFocus",
  "onBlur",
  "onKeyDown",
  "onKeyUp",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onTouchStart",
] as const;

export interface InfiniteHorizontalRowProps {
  /** Accessible name for this row, for example "Competiciones continentales". */
  label: string;
  children: ReactNode;
  /** Carries existing row styles, such as `bp-sports__picks`. */
  className?: string;
  /** Existing spatial-navigation metadata. The visual copy never receives it. */
  rowKey?: string;
  itemCount?: number;
  /** Scrolling speed in CSS pixels per second. Defaults to 28. */
  speed?: number;
  direction?: "left" | "right";
  /** Controlled pause, in addition to hover, focus, visibility, and page state. */
  paused?: boolean;
  /** Override the visual gap between cards. Defaults to the Home rail spacing. */
  gap?: CSSProperties["gap"];
}

function makeVisualOnlyClone(children: ReactNode, isCardLevel = true): ReactNode {
  return Children.map(children, (child, index) => {
    if (!isValidElement<Record<string, unknown>>(child)) return child;

    const props = { ...child.props };
    if (props.children !== undefined) {
      props.children = makeVisualOnlyClone(props.children as ReactNode, false);
    }
    const wasInteractive = props.onClick !== undefined;

    // Avoid duplicate document ids and remove hooks used by spatial navigation
    // and onboarding autofocus from the decorative copy.
    props.id = undefined;
    for (const attribute of CLONE_NAVIGATION_ATTRIBUTES) props[attribute] = undefined;
    for (const eventProp of CLONE_EVENT_PROPS) props[eventProp] = undefined;
    if (isCardLevel) props["data-infinite-horizontal-row-item"] = index;

    const tag = typeof child.type === "string" ? child.type : "";
    const isFocusable =
      tag === "button" ||
      tag === "a" ||
      tag === "input" ||
      tag === "select" ||
      tag === "textarea" ||
      props.tabIndex !== undefined ||
      wasInteractive;
    if (isFocusable) props.tabIndex = -1;

    return cloneElement(child, props);
  });
}

export default function InfiniteHorizontalRow({
  label,
  children,
  className,
  rowKey,
  itemCount,
  speed = DEFAULT_SPEED,
  direction = "left",
  paused = false,
  gap,
}: InfiniteHorizontalRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const sourceGroupRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ row: 0, group: 0 });
  const [isInView, setIsInView] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const isOverflowing = sizes.group > sizes.row + 1;

  useEffect(() => {
    const row = rowRef.current;
    const sourceGroup = sourceGroupRef.current;
    if (!row || !sourceGroup) return;

    const measure = () => {
      const style = window.getComputedStyle(row);
      const horizontalPadding =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);
      const next = {
        row: Math.max(0, row.clientWidth - horizontalPadding),
        group: sourceGroup.getBoundingClientRect().width,
      };
      setSizes(current =>
        current.row === next.row && current.group === next.group ? current : next,
      );
    };

    measure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    observer?.observe(row);
    observer?.observe(sourceGroup);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateVisibility = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const pixelsPerSecond = Number.isFinite(speed) ? Math.max(1, speed) : DEFAULT_SPEED;
  const cycleDuration = sizes.group > 0 ? `${sizes.group / pixelsPerSecond}s` : "60s";
  const rowStyle = {
    "--ihr-end-offset": `-${sizes.group}px`,
    "--ihr-cycle-duration": cycleDuration,
    ...(gap === undefined ? {} : { "--ihr-gap": typeof gap === "number" ? `${gap}px` : gap }),
  } as CSSProperties;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.isContentEditable) return;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (target.closest("[data-infinite-horizontal-row-clone]")) return;

    const row = event.currentTarget;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !row.contains(activeElement)) return;

    const cards = Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(card =>
      !card.closest("[data-infinite-horizontal-row-clone]") &&
      !card.closest("[hidden], [aria-hidden='true']") &&
      card.tabIndex >= 0,
    );
    if (!cards.length) return;

    const currentCard = activeElement.matches(FOCUSABLE_SELECTOR)
      ? activeElement
      : activeElement.closest<HTMLElement>(FOCUSABLE_SELECTOR);
    const currentIndex = currentCard ? cards.indexOf(currentCard) : -1;
    let nextIndex: number;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = cards.length - 1;
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      if (currentIndex < 0) return;
      const step = event.key === "ArrowRight" ? 1 : -1;
      nextIndex = (currentIndex + step + cards.length) % cards.length;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    cards[nextIndex]?.focus();
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      // Keyboard mode uses native horizontal scrolling; start the marquee from
      // its clean origin when focus leaves the row.
      event.currentTarget.scrollLeft = 0;
    }
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === event.currentTarget) return;
    window.requestAnimationFrame(() => {
      if (target.isConnected && rowRef.current?.contains(target)) {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  };

  const handleCloneMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // Keep mouse users on the canonical, accessible card rather than focusing
    // the aria-hidden visual duplicate.
    event.preventDefault();
  };

  const handleCloneClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const visualCard = target.closest<HTMLElement>("[data-infinite-horizontal-row-item]");
    const cardIndex = Number(visualCard?.dataset.infiniteHorizontalRowItem);
    if (!Number.isInteger(cardIndex) || cardIndex < 0) return;

    const sourceCard = sourceGroupRef.current?.children.item(cardIndex) as HTMLElement | null;
    if (!sourceCard) return;
    event.preventDefault();
    event.stopPropagation();

    const action = sourceCard.matches("button, a[href], [role='button']")
      ? sourceCard
      : sourceCard.querySelector<HTMLElement>("button, a[href], [role='button']") ?? sourceCard;
    action.focus({ preventScroll: true });
    action.click();
  };

  const isPaused = paused || !isInView || !isDocumentVisible;

  return (
    <div
      ref={rowRef}
      className={`infinite-horizontal-row${className ? ` ${className}` : ""}${isPaused ? " is-paused" : ""}`}
      role="group"
      aria-label={label}
      aria-live="off"
      data-row-key={rowKey}
      data-row-count={itemCount}
      data-row-scroller
      data-focus-center
      data-direction={direction}
      data-overflowing={isOverflowing ? "true" : "false"}
      style={rowStyle}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="infinite-horizontal-row__track">
        <div ref={sourceGroupRef} className="infinite-horizontal-row__group">
          {children}
        </div>
        {isOverflowing ? (
          <div
            className="infinite-horizontal-row__group infinite-horizontal-row__group--clone"
            aria-hidden="true"
            data-infinite-horizontal-row-clone
            onMouseDownCapture={handleCloneMouseDown}
            onClickCapture={handleCloneClick}
          >
            {makeVisualOnlyClone(children)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
