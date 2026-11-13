import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "../../utils/motion";
import { subscribeExperienceScope } from "../../utils/localProfiles";
import { getSavedLibraryRating } from "../../utils/library";
import {
  formatFiveStarRating,
  getUserRating,
  importedRatingToFiveStars,
  setUserRating,
  USER_RATINGS_CHANGED_EVENT,
} from "../../utils/userRatings";
import RatingStar from "./RatingStar";
import "./MediaRatingControl.css";

const RATING_STEPS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);
const NO_RATING_ALIASES: Array<{ type: string; id: string }> = [];

export default function MediaRatingControl({
  type,
  id,
  bigPicture = false,
  aliases = NO_RATING_ALIASES,
}: {
  type: string;
  id: string;
  bigPicture?: boolean;
  aliases?: Array<{ type: string; id: string }>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstStepRef = useRef<HTMLButtonElement>(null);
  const feedbackRatingRef = useRef<HTMLSpanElement>(null);
  const [savedRating, setSavedRating] = useState(() =>
    readRating(type, id, aliases),
  );
  const [preview, setPreview] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackMediaKey, setFeedbackMediaKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const mediaKey = `${type}:${id}`;

  useEffect(() => {
    const refresh = () => setSavedRating(
      readRating(type, id, aliases),
    );
    window.addEventListener(USER_RATINGS_CHANGED_EVENT, refresh);
    const unsubscribeScope = subscribeExperienceScope(refresh);
    refresh();
    return () => {
      window.removeEventListener(USER_RATINGS_CHANGED_EVENT, refresh);
      unsubscribeScope();
    };
  }, [aliases, id, type]);

  useEffect(() => {
    setPreview(null);
    setExpanded(false);
    setFeedbackMediaKey(null);
    setStatus("");
  }, [id, type]);

  // Sincroniza el feedback con el final de la entrada de la ficha. Así no se
  // pierde detrás del fade de la página, especialmente en PC.
  useEffect(() => {
    const onDetailEntranceComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id !== id) return;
      const rating = readRating(type, id, aliases);
      if (rating === null) return;
      setExpanded(false);
      setPreview(null);
      setFeedbackRating(rating);
      setFeedbackMediaKey(mediaKey);
    };
    window.addEventListener("aetherio:detail-entrance-complete", onDetailEntranceComplete);
    return () => {
      window.removeEventListener("aetherio:detail-entrance-complete", onDetailEntranceComplete);
    };
  }, [aliases, id, mediaKey, type]);

  useLayoutEffect(() => {
    if (!expanded || prefersReducedMotion()) return;
    const stars = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(".media-rating-control__stars .aetherio-rating-star") ?? [],
    ).slice(1);
    if (!stars.length) return;

    const starSpacing = (bigPicture ? 24 : 20) * 2;
    gsap.fromTo(
      stars,
      { x: (_index, target) => -starSpacing * (stars.indexOf(target as HTMLElement) + 1), scale: 0.28, opacity: 0 },
      {
        x: 0,
        scale: 1,
        opacity: 1,
        duration: 0.38,
        stagger: 0.055,
        ease: "power3.out",
        overwrite: "auto",
      },
    );

    return () => gsap.killTweensOf(stars);
  }, [bigPicture, expanded]);

  useLayoutEffect(() => {
    const label = feedbackRatingRef.current;
    if (feedbackRating === null || feedbackMediaKey !== mediaKey || !label) return;
    if (prefersReducedMotion()) {
      setFeedbackRating(null);
      return;
    }

    const tween = gsap.fromTo(
      label,
      { x: 0, scale: 1, opacity: 1 },
      {
        x: Number.isInteger(feedbackRating) ? 26 : 33,
        scale: 0.5,
        opacity: 0,
        delay: 0.5,
        duration: 0.48,
        ease: "power3.in",
        overwrite: "auto",
        onComplete: () => setFeedbackRating(null),
      },
    );
    return () => {
      tween.kill();
    };
  }, [bigPicture, feedbackMediaKey, feedbackRating, mediaKey]);

  const shownRating = expanded ? preview ?? savedRating ?? 0 : savedRating ? 1 : 0;
  const closePicker = () => {
    setExpanded(false);
    setPreview(null);
  };

  const handleMouseLeave = () => {
    const root = rootRef.current;
    const focusInside = root?.contains(document.activeElement) ?? false;
    if (bigPicture && focusInside) return;
    if (focusInside) firstStepRef.current?.focus({ preventScroll: true });
    closePicker();
  };

  const saveRating = (value: number) => {
    const nextRating = value;
    if (!setUserRating(type, id, nextRating)) {
      setStatus("No se pudo guardar la valoración.");
      return;
    }
    setSavedRating(nextRating);
    setPreview(null);
    setExpanded(false);
    setFeedbackRating(nextRating);
    setFeedbackMediaKey(mediaKey);
    setStatus("Valoración guardada.");
  };

  return (
    <div
      ref={rootRef}
      className="media-rating-control"
      role="group"
      aria-label="Valorar este medio"
      data-expanded={expanded ? "true" : "false"}
      data-big-picture={bigPicture ? "true" : undefined}
      onMouseEnter={() => {
        setExpanded(true);
        setPreview(savedRating);
        setStatus("");
      }}
      onMouseLeave={handleMouseLeave}
      onBlur={event => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        closePicker();
      }}
    >
      <div
        className="media-rating-control__pill"
        data-expanded={expanded ? "true" : "false"}
        data-feedback={feedbackRating !== null && feedbackMediaKey === mediaKey ? "true" : "false"}
        data-feedback-kind={feedbackRating === null || feedbackMediaKey !== mediaKey ? undefined : Number.isInteger(feedbackRating) ? "integer" : "decimal"}
      >
      {feedbackRating !== null && feedbackMediaKey === mediaKey ? (
        <span ref={feedbackRatingRef} className="media-rating-control__saved-rating" aria-hidden="true">
          {formatFiveStarRating(feedbackRating)}
        </span>
      ) : null}
      <div className="media-rating-control__track">
        <span className="media-rating-control__stars" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <RatingStar key={index} size={bigPicture ? 26 : 20} fill={shownRating - index} />
          ))}
        </span>
        <span className="media-rating-control__steps">
          {RATING_STEPS.map((value, index) => {
            const selected = savedRating === value;
            const ratingLabel = formatFiveStarRating(value);
            return (
              <button
                key={value}
                ref={index === 0 ? firstStepRef : undefined}
                type="button"
                className="media-rating-control__step"
                aria-label={selected
                  ? `Quitar mi valoración de ${ratingLabel} estrellas`
                  : `Valorar con ${ratingLabel} estrellas`}
                aria-pressed={selected}
                title={selected
                  ? `Quitar valoración de ${ratingLabel} estrellas`
                  : `Valorar con ${ratingLabel} estrellas`}
                data-hero-action
                tabIndex={expanded || index === 0 ? 0 : -1}
                onFocus={() => {
                  const wasCollapsed = !expanded;
                  setExpanded(true);
                  setPreview(wasCollapsed ? savedRating : value);
                  setStatus("");
                }}
                onMouseEnter={() => {
                  setPreview(value);
                  setStatus("");
                }}
                onClick={() => saveRating(value)}
              />
            );
          })}
        </span>
      </div>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{status}</span>
    </div>
  );
}

function readRating(type: string, id: string, aliases: Array<{ type: string; id: string }>): number | null {
  const identities = [{ type, id }, ...aliases];
  for (const identity of identities) {
    const rating = getUserRating(identity.type, identity.id);
    if (rating !== null) return rating;
  }
  for (const identity of identities) {
    const rating = importedRatingToFiveStars(getSavedLibraryRating(identity.type, identity.id));
    if (rating !== null) return rating;
  }
  return null;
}
