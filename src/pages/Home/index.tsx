import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  applyHomeCatalogPreferences,
  isAnimeFirst,
  useHomePreferences,
} from "../../config/homePreferences";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useAddonStore } from "../../store/addonStore";
import { getHomeScroll, saveHomeScroll, rowKey as makeRowKey } from "../../store/homeScrollStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import CatalogRow from "./CatalogRow";
import CinematicRow from "./CinematicRow";
import ContinueWatchingRow from "./ContinueWatchingRow";
import StreamingPlatformsRow from "./StreamingPlatformsRow";
import GenreShowcase from "./GenreShowcase";
import HeroSection from "./HeroSection";
import { gsap, prefersReducedMotion } from "../../utils/motion";
import { hasEntrancePlayed, isFreshHomeEntrance, markEntrancePlayed } from "../../utils/homeEntrance";
import { separateTopRows } from "../../utils/topRows";
import ShellDetailPreview from "../../components/layout/ShellDetailPreview";
import type { ShellPreviewRequest } from "../../utils/shellPreview";
import { isBigPictureLocation } from "../../utils/bigPictureDetail";
import {
  buildRestoredPreviewRequest,
  clearPendingShellPreview,
  savePendingShellPreview,
  takePendingShellPreview,
} from "../../store/shellPreviewStore";

export type { CatalogRowData, MediaItem };

// Entrada escalonada: el background aparece primero y la info entra con fade
// tras este hold. El trailer arranca 2.5s DESPUÉS de que la info sea visible.
const HOME_INFO_REVEAL_DELAY_MS = 2500;

export default function HomePage({ heroSlot, onContentVisibleChange }: { heroSlot?: (contentVisible: boolean) => ReactNode; onContentVisibleChange?: (visible: boolean) => void }) {
  const location = useLocation();
  const isBigPicture = isBigPictureLocation(location.pathname);
  const navigate = useNavigate();
  const addons = useAddonStore(s => s.addons);
  const homePreferences = useHomePreferences();
  const { rows, heroItems, loading } = useHomeCatalogs(addons, homePreferences.contentOrientation, homePreferences.bothPreference);
  const restoredVerticalRef = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const infoRevealStartedRef = useRef(false);
  const infoRevealTimerRef = useRef<number | null>(null);
  const revealDoneRef = useRef(false);
  // El escalonado (background -> info a los 2.5s) solo en entrada fresca a la
  // app. Al volver desde otra página todo aparece al instante.
  const [isEntrance] = useState(() => isFreshHomeEntrance(location) && !hasEntrancePlayed());
  const [homeInfoVisible, setHomeInfoVisible] = useState(!isEntrance);
  const [previewRequest, setPreviewRequest] = useState<ShellPreviewRequest | null>(null);
  // Cerrar el preview NO lo desmonta: se esconde. Los iframes del shell son
  // documentos con su propio QueryClient, así que si mueren al cerrar, al
  // reabrir el Detail vuelve a pedirlo todo desde cero. Escondido conserva la
  // cache y hace que reabrir la misma fila sea instantáneo. El `key` de abajo
  // sigue desmontando de verdad cuando se abre otra fila distinta.
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const handleOpenPreview = useCallback((request: ShellPreviewRequest) => {
    clearPendingShellPreview();
    setPreviewRequest(request);
    setPreviewDismissed(false);
  }, []);
  const openPreview = isBigPicture ? handleOpenPreview : undefined;
  const closePreview = useCallback(() => setPreviewDismissed(true), []);
  const navigateFromPreview = useCallback((path: string, activeIndex: number, background?: string) => {
    // Se entra a una page detail desde el carrusel: se guarda el carrusel para
    // volver a él al salir del detail (el Home se desmonta al navegar).
    // Guardado síncrono: el setState funcional podría no ejecutarse si el
    // componente se desmonta con el navigate inmediato.
    if (previewRequest) {
      const items = previewRequest.items?.length ? previewRequest.items : [previewRequest];
      const selectedIndex = Math.max(0, Math.min(activeIndex, items.length - 1));
      savePendingShellPreview({
        items: items.map(entry => ({
          detailPath: entry.detailPath,
          title: entry.title,
          background: entry.background,
        })),
        activeIndex: selectedIndex,
      });
      // Keep the resolved iframe artwork available on the first render of the
      // destination route. The preview itself stays mounted until navigation
      // commits, so the home/carrusel cannot flash between the two pages.
      navigate(path, {
        state: {
          fromShellPreview: true,
          routeBackground: background ?? items[selectedIndex]?.background,
        },
      });
      return;
    }
    navigate(path, { state: { fromShellPreview: true } });
  }, [navigate, previewRequest]);

  // Al volver al home desde un detail abierto desde el carrusel, se restaura
  // el carrusel en el mismo índice (volver al carrusel, no al home pelado).
  useEffect(() => {
    if (!isBigPicture || previewRequest) return;
    const pending = takePendingShellPreview();
    if (!pending?.items?.length) return;
    setPreviewRequest(buildRestoredPreviewRequest(pending));
  }, [isBigPicture, previewRequest]);

  useEffect(() => {
    if (!isEntrance || revealDoneRef.current) return;
    infoRevealStartedRef.current = false;
    if (infoRevealTimerRef.current !== null) {
      window.clearTimeout(infoRevealTimerRef.current);
      infoRevealTimerRef.current = null;
    }
    setHomeInfoVisible(false);
    return () => {
      if (infoRevealTimerRef.current !== null) {
        window.clearTimeout(infoRevealTimerRef.current);
        infoRevealTimerRef.current = null;
      }
    };
  }, [location.search, isEntrance]);

  useEffect(() => {
    if (!isEntrance) {
      revealDoneRef.current = true;
      setHomeInfoVisible(true);
      return;
    }
    // Start the visual delay only after the first hero surface can render. The
    // first network request may take longer than the reveal delay.
    if (infoRevealStartedRef.current || (loading && !heroItems.length)) return;
    infoRevealStartedRef.current = true;
    if (prefersReducedMotion()) {
      revealDoneRef.current = true;
      markEntrancePlayed();
      setHomeInfoVisible(true);
      return;
    }
    infoRevealTimerRef.current = window.setTimeout(() => {
      infoRevealTimerRef.current = null;
      revealDoneRef.current = true;
      markEntrancePlayed();
      setHomeInfoVisible(true);
    }, HOME_INFO_REVEAL_DELAY_MS);
  }, [heroItems.length, loading, location.search, isEntrance]);

  // Big Picture necesita la misma señal para arrancar su trailer 2.5s después
  // de que la info sea visible (el backdrop no la conoce por sí solo).
  useEffect(() => {
    onContentVisibleChange?.(homeInfoVisible);
  }, [homeInfoVisible, onContentVisibleChange]);

  useLayoutEffect(() => {
    if (!isBigPicture) return;
    const saved = getHomeScroll();
    const focus = saved?.focus;
    if (!saved || focus?.rowKey !== "streaming-platforms") return;

    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    const row = document.querySelector<HTMLElement>('[data-row-key="streaming-platforms"]');
    const card = row?.querySelector<HTMLElement>(`[data-platform-id="${focus.platformId}"]`);
    const scroller = row?.querySelector<HTMLElement>("[data-row-scroller]");
    if (!shell || !card) return;

    // Restore before the first frame or gamepad action. The platform page may
    // have reset the outer shell, so both axes and the exact source card matter.
    shell.scrollTo({ top: saved.vertical, behavior: "instant" as ScrollBehavior });
    const horizontal = saved.rows[focus.rowKey];
    if (scroller && Number.isFinite(horizontal)) scroller.scrollLeft = horizontal!;
    card.focus({ preventScroll: true });
    restoredVerticalRef.current = true;
    saveHomeScroll({ focus: null });
  }, [isBigPicture, location.pathname]);

  useLayoutEffect(() => {
    if (loading || restoredVerticalRef.current) return;
    const saved = getHomeScroll();
    if (saved && saved.vertical > 0) {
      const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
      if (shell) {
        shell.scrollTo({ top: saved.vertical, behavior: "instant" as ScrollBehavior });
        restoredVerticalRef.current = true;
      }
    }
  }, [loading]);

  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!isEntrance || loading || !root || !homeInfoVisible) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(
      "[data-home-entrance], :scope > div:last-child > *",
    ));
    if (!items.length) return;
    if (prefersReducedMotion()) {
      gsap.set(items, { clearProps: "opacity,transform" });
      return;
    }
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline.fromTo(
      items,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.72, stagger: 0.065, clearProps: "transform" },
    );
    return () => {
      timeline.kill();
      gsap.set(items, { clearProps: "opacity,transform" });
    };
  }, [homeInfoVisible, loading, location.search, isEntrance]);

  const typeFilter = new URLSearchParams(location.search).get("type");
  // La separación de tops aplica al orden por defecto; si el usuario reordena
  // manualmente, su orden explícito manda.
  const visibleRows = useMemo(
    () => homePreferences.catalogOrder.length > 0
      ? applyHomeCatalogPreferences(separateTopRows(rows), homePreferences)
      : separateTopRows(applyHomeCatalogPreferences(rows, homePreferences)),
    [homePreferences, rows],
  );

  const filteredRows = useMemo(
    () => typeFilter ? visibleRows.filter(row => row.type === typeFilter) : visibleRows,
    [typeFilter, visibleRows],
  );

  const { baseRows, animeRows } = useMemo(() => ({
    baseRows: filteredRows.filter(row => row.type !== "anime"),
    animeRows: filteredRows.filter(row => row.type === "anime"),
  }), [filteredRows]);

  // En modo "both" la sub-preferencia decide qué catálogos salen primero;
  // en "anime" siempre va el anime primero y en "movies-series" al revés.
  const animeFirst = isAnimeFirst(homePreferences);

  const renderCatalogRow = (row: CatalogRowData, key: string) => {
    const rowKey = makeRowKey(row.addonId, row.catalogId, row.type);
    const saved = getHomeScroll();
    const restoreScrollLeft = saved?.rows?.[rowKey];
    if (row.presentation === "cinematic") {
      return <CinematicRow key={key} row={row} restoreScrollLeft={restoreScrollLeft} onOpenPreview={openPreview} />;
    }
    return <CatalogRow key={key} row={row} posterLayout={homePreferences.posterLayout} restoreScrollLeft={restoreScrollLeft} onOpenPreview={openPreview} />;
  };

  const movieSeriesGenreAnchorIndex = useMemo(() => {
    const popularMoviesIndex = baseRows.findIndex(row => {
      if (row.type !== "movie") return false;
      const identity = `${row.catalogId} ${row.name}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return identity.includes("tmdb.top_movie")
        || (identity.includes("popular") && /peliculas?|movies?/.test(identity));
    });
    const lastMovieOrSeriesIndex = baseRows.reduce((last, row, index) => (
      row.type === "movie" || row.type === "series" || row.type === "tv" ? index : last
    ), -1);
    return popularMoviesIndex >= 0
      ? popularMoviesIndex
      : lastMovieOrSeriesIndex >= 0 ? lastMovieOrSeriesIndex : baseRows.length - 1;
  }, [baseRows]);

  const showMovieSeriesGenreShowcase = !typeFilter
    && homePreferences.contentOrientation !== "anime"
    && baseRows.some(row => row.type === "movie" || row.type === "series" || row.type === "tv");

  const renderBaseRows = () => {
    const rendered: ReactNode[] = [];
    let showcaseAdded = false;
    const appendGenreShowcase = () => {
      if (!showMovieSeriesGenreShowcase || showcaseAdded) return;
      rendered.push(<GenreShowcase key="genre-showcase-movie-series" mode="movie-series" />);
      showcaseAdded = true;
    };

    baseRows.forEach((row, index) => {
      rendered.push(renderCatalogRow(row, `${row.addonId}-${row.catalogId}-${index}`));

      if (index === movieSeriesGenreAnchorIndex) appendGenreShowcase();
    });

    appendGenreShowcase();
    return rendered;
  };

  return (
      <div ref={pageRef} className="home-page-scale relative flex min-h-full flex-col" style={{ marginTop: "calc(-1 * var(--app-shell-nav-height))", paddingTop: "var(--app-shell-nav-height)" }}>
        {!typeFilter && (heroSlot
          ? heroSlot(homeInfoVisible)
          : <HomeHero items={heroItems} contentVisible={homeInfoVisible} animateEntrance={isEntrance} />)}
        <div
          className="relative flex min-h-full flex-col"
          style={{
            paddingBottom: 56,
            visibility: homeInfoVisible ? "visible" : "hidden",
            pointerEvents: homeInfoVisible ? "auto" : "none",
          }}
        >
        {!typeFilter && <ContinueWatchingRow />}
        {!typeFilter && <StreamingPlatformsRow />}
        {animeFirst ? (
          <>
            {animeRows.slice(0, 2).map((row, i) => {
                return renderCatalogRow(row, `${row.addonId}-${row.catalogId}-${i}`);
              })}
            {!typeFilter && homePreferences.contentOrientation !== "movies-series" && <GenreShowcase />}
            {animeRows.slice(2).map((row, i) => {
                return renderCatalogRow(row, `${row.addonId}-${row.catalogId}-${i + 2}`);
              })}
            {renderBaseRows()}
          </>
        ) : (
          <>
            {renderBaseRows()}
            {animeRows.slice(0, 2).map((row, i) => {
                return renderCatalogRow(row, `${row.addonId}-${row.catalogId}-${i}`);
              })}
            {!typeFilter && homePreferences.contentOrientation !== "movies-series" && <GenreShowcase />}
            {animeRows.slice(2).map((row, i) => {
                return renderCatalogRow(row, `${row.addonId}-${row.catalogId}-${i + 2}`);
              })}
          </>
        )}
        {!baseRows.length && !animeRows.length && (
          <Empty typeFilter={typeFilter} />
        )}
      </div>
{isBigPicture && previewRequest ? (
    <ShellDetailPreview
      key={previewRequest.items?.[0]?.detailPath ?? previewRequest.detailPath}
      request={previewRequest}
      dismissed={previewDismissed}
      onClose={closePreview}
      onNavigate={navigateFromPreview}
    />
    ) : null}
    </div>
  );
}


function HomeHero({ items, contentVisible, animateEntrance }: { items: MediaItem[]; contentVisible: boolean; animateEntrance?: boolean }) {
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    if (!items.length) {
      setHeroIndex(0);
      return;
    }
    const saved = getHomeScroll();
    if (saved?.hero && saved.hero.kind === "single" && saved.hero.index >= 0 && saved.hero.index < items.length) {
      setHeroIndex(saved.hero.index);
    } else {
      setHeroIndex(Math.floor(Math.random() * items.length));
    }
  }, [items]);

  const handleVideoEnd = () => {
    if (items.length < 2) return;
    setHeroIndex(index => (index + 1) % items.length);
  };

  const handleOpenDetail = useCallback((idx: number) => {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    saveHomeScroll({
      vertical: shell?.scrollTop ?? 0,
      hero: { kind: "single", index: idx },
    });
  }, []);

  const hero = items[heroIndex % Math.max(1, items.length)];
  if (!hero) return null;

  return <HeroSection item={hero} items={items} activeIndex={heroIndex} onSelect={setHeroIndex} onOpenDetail={handleOpenDetail} onVideoEnd={handleVideoEnd} contentVisible={contentVisible} animateEntrance={animateEntrance} />;
}

function Empty({ typeFilter }: { typeFilter: string | null }) {
  const labels: Record<string, string> = { movie: "peliculas", series: "series", anime: "anime" };
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-8 pt-20 text-center">
      <p className="text-xl font-bold text-white">
        {typeFilter ? `No hay ${labels[typeFilter] ?? typeFilter} disponibles` : "Sin contenido"}
      </p>
      <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
        Instala un addon compatible para ver catálogos aquí.
      </p>
    </div>
  );
}
