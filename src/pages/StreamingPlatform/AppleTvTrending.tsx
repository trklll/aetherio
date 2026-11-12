import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gsap } from "gsap";
import AppleSpinner from "../../components/ui/AppleSpinner";
import { useHomePreferences } from "../../config/homePreferences";
import { GAMEPAD_ACTION_EVENT } from "../../hooks/useGamepad";
import { useBigPictureActive } from "../../navigation/spatialNav";
import {
  APPLE_TV_TRENDING_GENRES,
  fetchAppleTvTrendingRows,
} from "../../services/streamingPlatforms";
import {
  readStreamingPlatformTrendingCache,
  STREAMING_TRENDING_GC_TIME_MS,
  STREAMING_TRENDING_STALE_TIME_MS,
  writeStreamingPlatformTrendingCache,
} from "../../services/streamingPlatformTrendingCache";
import type { CatalogRowData } from "../../types/ui";
import { prefersReducedMotion } from "../../utils/motion";
import CatalogRow from "../Home/CatalogRow";
import "../Detail/SeasonTabs.css";
import "./MubiTrending.css";

const EMPTY_ROWS: CatalogRowData[] = [];

function genreAtOffset(current: string, offset: -1 | 1, genres: readonly { key: string; label: string }[]) {
  const options = [{ key: "", label: "Todos" }, ...genres];
  const currentIndex = options.findIndex(genre => genre.key === current);
  const index = currentIndex < 0 ? (offset > 0 ? 0 : options.length - 1) : currentIndex;
  return options[(index + offset + options.length) % options.length].key;
}

export default function AppleTvTrending() {
  const preferences = useHomePreferences();
  const bigPicture = useBigPictureActive();
  const [genre, setGenre] = useState("");
  const genreOptions = useMemo(() => [
    { key: "", label: "Todos" },
    ...APPLE_TV_TRENDING_GENRES.map(({ key, label }) => ({ key, label })),
  ], []);
  const resultsRef = useRef<HTMLDivElement>(null);
  const genreTabsRef = useRef<HTMLDivElement>(null);
  const genreTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const persistedCache = useMemo(
    () => readStreamingPlatformTrendingCache("apple-tv-plus", genre || undefined),
    [genre],
  );
  const { data: rows = EMPTY_ROWS, isPending, isError, refetch } = useQuery({
    queryKey: ["apple-tv", "global-trending", genre],
    queryFn: async () => {
      const freshRows = await fetchAppleTvTrendingRows(genre || undefined);
      writeStreamingPlatformTrendingCache("apple-tv-plus", genre || undefined, freshRows);
      return freshRows;
    },
    initialData: persistedCache?.rows,
    initialDataUpdatedAt: persistedCache?.updatedAt,
    staleTime: STREAMING_TRENDING_STALE_TIME_MS,
    gcTime: STREAMING_TRENDING_GC_TIME_MS,
    retry: false,
  });

  const visibleRows = useMemo(() => {
    const selectedCatalog = genre ? `.genre.${genre}` : ".genre.all";
    return rows.filter(row => row.catalogId.endsWith(selectedCatalog) && row.items.length > 0);
  }, [genre, rows]);

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
    if (!results || isPending || !visibleRows.length) return;
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
  }, [genre, isPending, visibleRows]);

  useEffect(() => {
    const selectedTab = genreTabRefs.current.get(genre);
    const tablist = genreTabsRef.current;
    if (!tablist || !selectedTab) return;

    const listRect = tablist.getBoundingClientRect();
    const tabRect = selectedTab.getBoundingClientRect();
    const styles = window.getComputedStyle(tablist);
    const visibleLeft = listRect.left + Number.parseFloat(styles.paddingLeft) + 8;
    const visibleRight = listRect.right - Number.parseFloat(styles.paddingRight) - 8;
    const delta = tabRect.left < visibleLeft
      ? tabRect.left - visibleLeft
      : tabRect.right > visibleRight ? tabRect.right - visibleRight : 0;
    if (delta) tablist.scrollTo({ left: tablist.scrollLeft + delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [genre]);

  useEffect(() => {
    if (!bigPicture) return;
    const onGamepadAction = (event: Event) => {
      const action = (event as CustomEvent<{ id?: string }>).detail;
      if (action?.id !== "lb" && action?.id !== "rb") return;
      setGenre(current => genreAtOffset(current, action.id === "lb" ? -1 : 1, APPLE_TV_TRENDING_GENRES));
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== "PageUp" && event.key !== "PageDown") || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      setGenre(current => genreAtOffset(current, event.key === "PageUp" ? -1 : 1, APPLE_TV_TRENDING_GENRES));
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
    <section className="mubi-trending apple-tv-trending" aria-labelledby="apple-tv-trending-heading">
      <header className="mubi-trending__header">
        <h2 id="apple-tv-trending-heading">En tendencia ahora</h2>
      </header>

      <div
        ref={genreTabsRef}
        className="season-tabs mubi-trending__genres"
        data-row-scroller
        data-focus-center
        data-trending-genres
        data-spatial-ignore={bigPicture ? true : undefined}
        role="tablist"
        aria-label="Géneros de Apple TV+ disponibles en TMDB"
      >
        {genreOptions.map(option => (
          <button
            key={option.key || "all"}
            ref={element => {
              if (element) genreTabRefs.current.set(option.key, element);
              else genreTabRefs.current.delete(option.key);
            }}
            type="button"
            role="tab"
            aria-selected={genre === option.key}
            aria-disabled={bigPicture ? true : undefined}
            tabIndex={bigPicture ? -1 : undefined}
            className={`season-tab${genre === option.key ? " is-selected" : ""}`}
            style={bigPicture ? { pointerEvents: "none" } : undefined}
            onClick={() => {
              if (!bigPicture) setGenre(option.key);
            }}
          >{option.label}</button>
        ))}
      </div>

      <div ref={resultsRef} className="mubi-trending__results" aria-busy={isPending}>
        {isPending ? (
          <div className="mubi-trending__state mubi-trending__state--loading" role="status" aria-label="Cargando catálogos globales de Apple TV+">
            <AppleSpinner />
          </div>
        ) : isError && !visibleRows.length ? (
          <div className="mubi-trending__state" role="status">
            <p>No pudimos cargar los títulos disponibles en Apple TV+.</p>
            <button type="button" className="streaming-platform-retry" onClick={() => void refetch()}>Intentar de nuevo</button>
          </div>
        ) : visibleRows.length ? (
          visibleRows.map(row => (
            <CatalogRow
              key={row.catalogId}
              row={row}
              posterLayout={preferences.posterLayout}
              titleOverride={row.type === "movie" ? "Películas" : "Series"}
              disableHeaderNavigation
              persistHomeScroll={false}
              showViewMore={false}
            />
          ))
        ) : (
          <p className="mubi-trending__state" role="status">No encontramos títulos disponibles en Apple TV+ para esta categoría.</p>
        )}
      </div>
    </section>
  );
}
