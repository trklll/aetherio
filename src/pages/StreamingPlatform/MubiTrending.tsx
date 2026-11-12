import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gsap } from "gsap";
import AppleSpinner from "../../components/ui/AppleSpinner";
import { useHomePreferences } from "../../config/homePreferences";
import { GAMEPAD_ACTION_EVENT } from "../../hooks/useGamepad";
import { useBigPictureActive } from "../../navigation/spatialNav";
import {
  fetchMubiTrendingRows,
  MUBI_TRENDING_CATEGORIES,
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

export default function MubiTrending() {
  const preferences = useHomePreferences();
  const bigPicture = useBigPictureActive();
  const [genre, setGenre] = useState("");
  const genreOptions = useMemo(() => [
    { key: "", label: "Todos" },
    ...MUBI_TRENDING_CATEGORIES.map(({ key, label }) => ({ key, label })),
  ], []);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const persistedCache = useMemo(
    () => readStreamingPlatformTrendingCache("mubi", genre || undefined),
    [genre],
  );
  const { data: rows = EMPTY_ROWS, isPending, isError, refetch } = useQuery({
    queryKey: ["mubi", "global-trending", genre],
    queryFn: async () => {
      const freshRows = await fetchMubiTrendingRows(genre || undefined);
      writeStreamingPlatformTrendingCache("mubi", genre || undefined, freshRows);
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
    const previousTab = tabRefs.current.get(genre);
    const tablist = tablistRef.current;
    if (!tablist || !previousTab) return;

    const listRect = tablist.getBoundingClientRect();
    const tabRect = previousTab.getBoundingClientRect();
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
      setGenre(current => genreAtOffset(current, action.id === "lb" ? -1 : 1, MUBI_TRENDING_CATEGORIES));
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "PageUp" && event.key !== "PageDown" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      setGenre(current => genreAtOffset(current, event.key === "PageUp" ? -1 : 1, MUBI_TRENDING_CATEGORIES));
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
    <section className="mubi-trending" aria-labelledby="mubi-trending-heading">
      <header className="mubi-trending__header">
        <h2 id="mubi-trending-heading">En tendencia ahora</h2>
      </header>

      <div
        ref={tablistRef}
        className="season-tabs mubi-trending__genres"
        data-row-scroller
        data-focus-center
        data-trending-genres
        data-spatial-ignore={bigPicture ? true : undefined}
        role="tablist"
        aria-label="Géneros de MUBI disponibles en TMDB"
      >
        {genreOptions.map(({ key, label }) => (
          <button
            key={key || "all"}
            ref={element => {
              if (element) tabRefs.current.set(key, element);
              else tabRefs.current.delete(key);
            }}
            type="button"
            role="tab"
            aria-selected={genre === key}
            aria-disabled={bigPicture ? true : undefined}
            tabIndex={bigPicture ? -1 : undefined}
            className={`season-tab${genre === key ? " is-selected" : ""}`}
            style={bigPicture ? { pointerEvents: "none" } : undefined}
            onClick={() => {
              if (!bigPicture) setGenre(key);
            }}
          >{label}</button>
        ))}
      </div>

      <div ref={resultsRef} className="mubi-trending__results" aria-busy={isPending}>
        {isPending ? (
          <div className="mubi-trending__state mubi-trending__state--loading" role="status" aria-label="Cargando catálogos globales de MUBI">
            <AppleSpinner />
          </div>
        ) : isError && !visibleRows.length ? (
          <div className="mubi-trending__state" role="status">
            <p>No pudimos cargar los títulos disponibles en MUBI.</p>
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
          <p className="mubi-trending__state" role="status">No encontramos películas ni series disponibles en MUBI para esta categoría.</p>
        )}
      </div>
    </section>
  );
}
