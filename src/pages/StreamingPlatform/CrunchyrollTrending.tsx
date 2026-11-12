import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gsap } from "gsap";
import { useHomePreferences } from "../../config/homePreferences";
import { GAMEPAD_ACTION_EVENT } from "../../hooks/useGamepad";
import { useBigPictureActive } from "../../navigation/spatialNav";
import { fetchAnilistTrendingAnime, resolveAnilistToTmdb } from "../../services/anilist";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { prefersReducedMotion } from "../../utils/motion";
import AppleSpinner from "../../components/ui/AppleSpinner";
import CatalogRow from "../Home/CatalogRow";
import "../Detail/SeasonTabs.css";
import "./CrunchyrollTrending.css";

const GENRES = [
  ["", "Todos"], ["Action", "Acción"], ["Adventure", "Aventura"], ["Sci-Fi", "Ciencia ficción"],
  ["Comedy", "Comedia"], ["Sports", "Deportes"], ["Drama", "Drama"], ["Ecchi", "Ecchi"],
  ["Fantasy", "Fantasía"], ["Mecha", "Mecha"], ["Mystery", "Misterio"], ["Music", "Música"],
  ["Psychological", "Psicológico"], ["Romance", "Romance"], ["Supernatural", "Sobrenatural"],
  ["Thriller", "Suspenso"], ["Horror", "Terror"], ["Slice of Life", "Vida cotidiana"],
] as const;

const EMPTY_ITEMS: MediaItem[] = [];
const GENRE_REPEAT_DELAY_MS = 400;
const GENRE_REPEAT_INTERVAL_MS = 240;

function genreAtOffset(current: string, offset: -1 | 1) {
  const currentIndex = GENRES.findIndex(([value]) => value === current);
  const index = currentIndex < 0 ? (offset > 0 ? 0 : GENRES.length - 1) : currentIndex;
  return GENRES[(index + offset + GENRES.length) % GENRES.length][0];
}

export default function CrunchyrollTrending() {
  const preferences = useHomePreferences();
  const bigPicture = useBigPictureActive();
  const [genre, setGenre] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousGenreRef = useRef(genre);
  const genreRepeatAtRef = useRef(0);
  const { data: items = EMPTY_ITEMS, isPending, isError, refetch } = useQuery({
    queryKey: ["crunchyroll", "anilist-trending", genre],
    queryFn: async () => resolveAnilistToTmdb(await fetchAnilistTrendingAnime(genre || undefined)),
    staleTime: 15 * 60 * 1000,
    retry: false,
  });

  const row = useMemo<CatalogRowData>(() => ({
    addonId: "anilist",
    addonName: "AniList",
    catalogId: "crunchyroll-trending",
    type: "anime",
    // CatalogRow treats "tendencia"/"top" as ranked rails. The visible
    // heading lives outside it; keep this internal row name unranked.
    name: "Anime",
    items,
  }), [items]);

  useLayoutEffect(() => {
    const results = resultsRef.current;
    if (!results || !isPending || prefersReducedMotion()) return;

    const spinner = results.querySelector<HTMLElement>(".aetherio-petal-spinner");
    if (!spinner) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(spinner, { autoAlpha: 0, scale: 0.82 }, {
        autoAlpha: 1,
        scale: 1,
        duration: 0.42,
        ease: "power3.out",
        clearProps: "transform",
      });
    }, results);

    return () => ctx.revert();
  }, [isPending]);

  useLayoutEffect(() => {
    const results = resultsRef.current;
    if (!results || isPending || isError || !items.length) return;

    const cards = results.querySelectorAll<HTMLElement>("[data-row-card]");
    if (!cards.length) return;
    if (prefersReducedMotion()) {
      gsap.set(cards, { clearProps: "opacity,visibility,transform" });
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(cards,
        { autoAlpha: 0, y: 14, scale: 0.99 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.46,
          stagger: 0.045,
          ease: "power3.out",
          clearProps: "opacity,visibility,transform",
        },
      );
    }, results);

    return () => ctx.revert();
  }, [isError, isPending, items]);

  useEffect(() => {
    const previousGenre = previousGenreRef.current;
    previousGenreRef.current = genre;
    if (previousGenre === genre) return;

    const tablist = tablistRef.current;
    const tab = tabRefs.current.get(genre);
    if (!tablist || !tab) return;

    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (genre === "") {
      tablist.scrollTo({ left: 0, behavior });
      return;
    }

    const listRect = tablist.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const styles = window.getComputedStyle(tablist);
    const visibleLeft = listRect.left + Number.parseFloat(styles.paddingLeft) + 8;
    const visibleRight = listRect.right - Number.parseFloat(styles.paddingRight) - 8;
    const scrollDelta = tabRect.left < visibleLeft
      ? tabRect.left - visibleLeft
      : tabRect.right > visibleRight
        ? tabRect.right - visibleRight
        : 0;

    if (scrollDelta !== 0) tablist.scrollTo({ left: tablist.scrollLeft + scrollDelta, behavior });
  }, [genre]);

  useEffect(() => {
    if (!bigPicture) return;

    const onGamepadAction = (event: Event) => {
      const action = (event as CustomEvent<{ id?: string; repeat?: boolean }>).detail;
      if (action?.id !== "lb" && action?.id !== "rb") return;

      const now = performance.now();
      if (action.repeat && now < genreRepeatAtRef.current) {
        event.preventDefault();
        return;
      }

      const direction = action.id === "lb" ? -1 : 1;
      setGenre(current => genreAtOffset(current, direction));
      genreRepeatAtRef.current = now + (action.repeat ? GENRE_REPEAT_INTERVAL_MS : GENRE_REPEAT_DELAY_MS);
      event.preventDefault();
    };

    // Same keyboard fallback as the season tabs: LB/RB map to PageUp/PageDown.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "PageUp" && event.key !== "PageDown") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      setGenre(current => genreAtOffset(current, event.key === "PageUp" ? -1 : 1));
      event.preventDefault();
    };

    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [bigPicture]);

  return (
    <section className="crunchyroll-trending" aria-labelledby="crunchyroll-trending-heading">
      <header className="crunchyroll-trending__header">
        <h2 id="crunchyroll-trending-heading">En tendencia ahora</h2>
      </header>

      <div
        ref={tablistRef}
        className="season-tabs crunchyroll-trending__genres"
        data-row-scroller
        data-focus-center
        data-trending-genres
        data-spatial-ignore={bigPicture ? true : undefined}
        role="tablist"
        aria-label="Géneros"
      >
        {GENRES.map(([value, label]) => (
          <button
            key={value}
            ref={element => {
              if (element) tabRefs.current.set(value, element);
              else tabRefs.current.delete(value);
            }}
            type="button"
            role="tab"
            aria-selected={genre === value}
            aria-disabled={bigPicture ? true : undefined}
            tabIndex={bigPicture ? -1 : undefined}
            className={`season-tab${genre === value ? " is-selected" : ""}`}
            style={bigPicture ? { pointerEvents: "none" } : undefined}
            onClick={() => {
              if (!bigPicture) setGenre(value);
            }}
          >{label}</button>
        ))}
      </div>

      <div ref={resultsRef} className="crunchyroll-trending__results" aria-busy={isPending}>
        {isPending ? (
          <div className="crunchyroll-trending__state crunchyroll-trending__state--loading" role="status" aria-label="Cargando tendencias de AniList">
            <AppleSpinner />
          </div>
        ) : isError ? (
          <div className="crunchyroll-trending__state" role="status">
            <p>No pudimos cargar las tendencias de AniList.</p>
            <button type="button" className="streaming-platform-retry" onClick={() => void refetch()}>Intentar de nuevo</button>
          </div>
        ) : items.length ? (
          <CatalogRow
            row={row}
            posterLayout={preferences.posterLayout}
            hideHeader
            persistHomeScroll={false}
            showViewMore={false}
          />
        ) : (
          <p className="crunchyroll-trending__state" role="status">No hay tendencias para este género.</p>
        )}
      </div>
    </section>
  );
}
