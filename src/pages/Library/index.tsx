import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Compass, Download, EyeOff, Film, RefreshCw, Tv } from "lucide-react";
import AppleSpinner from "../../components/ui/AppleSpinner";
import { gsap, prefersReducedMotion, tweenTo } from "../../utils/motion";
import { restorePageTransition } from "../../utils/pageTransition";
import PageContainer from "../../components/layout/PageContainer";
import LibraryIcon from "../../components/ui/LibraryIcon";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { buildDetailPath } from "../../utils/bigPictureDetail";
import LibrarySelector from "./LibrarySelector";
import OfflineDownloadsTab from "./OfflineDownloadsTab";
import { useDownloadsEnabled } from "../../config/downloadPreferences";
import { clearLibraryReturn, readLibraryReturn, saveLibraryReturn, type DiscoverReturnState } from "./libraryTvState";
import "./Library.css";
import { GAMEPAD_ACTION_EVENT, type GamepadActionDetail } from "../../hooks/useGamepad";
import { readLibraryTab, stepLibraryTab, writeLibraryTabSearch, type LibraryTab } from "./libraryTabs";
import { animateLibraryTabPanel } from "./libraryTransitions";
import {
  ANILIST_LIBRARY_CHANGED_EVENT,
  readAniListLibrary,
  syncAniListLibrary,
} from "../../integrations/aniList";
import { connectAniListAccount, getAniListAccessToken } from "../../auth/authClient";
import TraktImportCard from "../../components/library/TraktImportCard";
import RatingStar from "../../components/ratings/RatingStar";
import { useDismissedIntegrationBanner } from "../../hooks/useDismissedIntegrationBanner";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import {
  CONTINUE_WATCHING_EVENT,
  readPlaybackStateEntries,
} from "../../utils/continueWatching";
import { LIBRARY_CHANGED_EVENT, readSavedLibrary, updateSavedLibraryArtwork } from "../../utils/library";
import { formatFiveStarRating, getPersonalRatingFromMap, readUserRatings } from "../../utils/userRatings";
import { fetchTmdbArtwork } from "../../services/tmdbArtworkService";
import { tmdbImage } from "../../utils/tmdbArtwork";
import {
  buildDiscoverCatalogs,
  buildLibraryItems,
  fetchDiscoverPage,
  filterLibrary,
  getLibraryPoster,
  mergeUniqueMedia,
  readDiscoverSelection,
  readLibraryFilters,
  writeDiscoverSelection,
  writeLibraryFilters,
  type DiscoverCatalog,
  type FacetOption,
  type LibraryFilters,
} from "./libraryLogic";

const DISCOVER_VISIBLE_BATCH = 20;

// §3/§4/§14 — stagger grid cards in on change; reduced-motion collapses to a cross-fade.
// Only newly-mounted cards animate on each pass (tracked via a ref), so reuse (identity
// churn, "Mostrar más" appends) never re-webs the whole grid.
function useGridEntrance(containerRef: React.RefObject<HTMLElement | null>, deps: React.DependencyList) {
  const seenRef = useRef<WeakSet<Element>>(new WeakSet());
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-grid-entrance]")).filter(card => !seenRef.current.has(card));
    cards.forEach(card => seenRef.current.add(card));
    if (!cards.length) return;
    if (prefersReducedMotion()) {
      const timeline = gsap.timeline();
      timeline.to(cards, { opacity: 1, duration: 0.2, ease: "power1.out" });
      return () => {
        timeline.kill();
        gsap.set(cards, { clearProps: "opacity" });
      };
    }
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .fromTo(cards, { opacity: 0, y: 16, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, stagger: 0.05, clearProps: "opacity" })
      .set(cards, { clearProps: "transform" });
    return () => {
      timeline.kill();
      gsap.set(cards, { clearProps: "opacity,transform" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function LibraryPage({ bigPicture = false }: { bigPicture?: boolean }) {
  const addons = useAddonStore(state => state.addons);
  const downloadsEnabled = useDownloadsEnabled();
  const location = useLocation();
  const navigate = useNavigate();
  const [returnState] = useState(() => bigPicture && readLibraryTab(location.search) !== "downloads" ? readLibraryReturn() : null);
  const [tab, setTab] = useState<LibraryTab>(() => readLibraryTab(location.search) ?? returnState?.tab ?? "library");
  const visibleTab = downloadsEnabled || tab !== "downloads" ? tab : "library";
  const rootRef = useRef<HTMLDivElement>(null);
  const previousVisibleTabRef = useRef<LibraryTab | null>(null);
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<LibraryFilters>(readLibraryFilters);
  const [aniListSyncing, setAniListSyncing] = useState(false);
  const [aniListError, setAniListError] = useState("");
  const [aniListConnected, setAniListConnected] = useState(false);

  const selectTab = (next: LibraryTab) => {
    if (next === "downloads" && !downloadsEnabled) return;
    setTab(next);
    const search = writeLibraryTabSearch(location.search, next);
    if (search !== location.search) {
      navigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true, state: location.state });
    }
  };

  useLayoutEffect(() => {
    if (!bigPicture) return;
    const previous = previousVisibleTabRef.current;
    previousVisibleTabRef.current = visibleTab;
    if (previous === visibleTab) return;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-library-tab="${visibleTab}"]`)?.focus({ preventScroll: true });
  }, [bigPicture, visibleTab]);

  useEffect(() => {
    const requestedTab = readLibraryTab(location.search);
    if (requestedTab === "downloads" && !downloadsEnabled) {
      setTab("library");
      const search = writeLibraryTabSearch(location.search, "library");
      if (search !== location.search) {
        navigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true, state: location.state });
      }
      return;
    }
    if (requestedTab) setTab(requestedTab);
    else setTab(current => current === "downloads" ? "library" : current);
  }, [downloadsEnabled, location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!bigPicture) return;
    clearLibraryReturn();
    let frame = 0;
    let attempts = 0;
    const restoreFocus = () => {
      const root = rootRef.current;
      const card = returnState && Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-library-media-key]") ?? [])
        .find(button => button.dataset.libraryMediaKey === returnState.itemKey);
      if (card) {
        card.focus({ preventScroll: true });
        if (document.activeElement === card && returnState) {
          const shell = root?.closest<HTMLElement>("[data-aetherio-scroll-shell]");
          shell?.scrollTo({ top: returnState.scrollTop, behavior: "instant" as ScrollBehavior });
          return;
        }
      }
      if (returnState && attempts++ < 150) frame = requestAnimationFrame(restoreFocus);
    };
    frame = requestAnimationFrame(restoreFocus);
    return () => cancelAnimationFrame(frame);
  }, [bigPicture, returnState]);

  useEffect(() => {
    if (!bigPicture) return;
    const onGamepadAction = (event: Event) => {
      const id = (event as CustomEvent<GamepadActionDetail>).detail?.id;
      if (id !== "lb" && id !== "rb") return;
      const root = rootRef.current;
      if (!root || !root.isConnected || root.getClientRects().length === 0) return;
      if (document.querySelector('[data-spatial-modal]:not([hidden]), [data-aetherio-context-menu][data-context-open="true"]')) return;
      event.preventDefault();
      selectTab(stepLibraryTab(visibleTab, id === "lb" ? -1 : 1, downloadsEnabled));
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, [bigPicture, downloadsEnabled, location.hash, location.pathname, location.search, location.state, navigate, visibleTab]);

  useEffect(() => {
    const refresh = () => {
      setVersion(value => value + 1);
      void getAniListAccessToken().then(token => setAniListConnected(Boolean(token)));
    };
    refresh();
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
    window.addEventListener(ANILIST_LIBRARY_CHANGED_EVENT, refresh as EventListener);
    window.addEventListener(LIBRARY_CHANGED_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
      window.removeEventListener(ANILIST_LIBRARY_CHANGED_EVENT, refresh as EventListener);
      window.removeEventListener(LIBRARY_CHANGED_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => writeLibraryFilters(filters), [filters]);

  const playbackEntries = useMemo(() => readPlaybackStateEntries(), [version]);
  const aniListEntries = useMemo(() => readAniListLibrary(), [version]);
  const savedEntries = useMemo(() => readSavedLibrary(), [version]);
  const userRatings = useMemo(() => readUserRatings(), [version]);
  const libraryItems = useMemo(
    () => buildLibraryItems(savedEntries, playbackEntries, aniListEntries),
    [aniListEntries, playbackEntries, savedEntries],
  );
  const filtered = useMemo(() => filterLibrary(libraryItems, filters), [filters, libraryItems]);

  const updateFilter = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value }));
  };

  const libraryGridRef = useRef<HTMLDivElement>(null);
  useGridEntrance(libraryGridRef, [tab, filtered.items, filters]);

  const tabPanelRef = useRef<HTMLDivElement>(null);
  const lastAnimatedTabRef = useRef<LibraryTab | null>(null);
  useLayoutEffect(() => {
    const panel = tabPanelRef.current;
    if (!panel) return;
    if (lastAnimatedTabRef.current === tab) {
      // React Activity reconnects layout effects when a cached route returns.
      // Restore the settled panel rather than replaying its entrance.
      restorePageTransition(panel);
      return;
    }
    lastAnimatedTabRef.current = tab;
    return animateLibraryTabPanel(panel, prefersReducedMotion());
  }, [tab]);

  return (
    <div ref={rootRef} className={`home-page-scale min-h-screen${bigPicture ? " library-page--tv" : ""}`} data-bp-library={bigPicture || undefined}>
      <PageContainer className="min-h-full pb-10 pt-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-[clamp(2.35rem,4.8vw,4.8rem)] font-black leading-none text-white">{visibleTab === "library" ? "Mi biblioteca" : visibleTab === "discover" ? "Descubrir" : "Descargas"}</h1>
          </div>
          <div className="library-tabs liquid-glass inline-flex rounded-2xl p-1" role={bigPicture ? "tablist" : undefined} aria-label={bigPicture ? "Secciones de la biblioteca" : undefined} style={{ transform: "translateZ(0)" }}>
            <TabButton bigPicture={bigPicture} tab="library" active={visibleTab === "library"} icon={<LibraryIcon size={17} />} onClick={() => selectTab("library")}>
              Mi biblioteca
            </TabButton>
            <TabButton bigPicture={bigPicture} tab="discover" active={visibleTab === "discover"} icon={<Compass size={17} />} onClick={() => selectTab("discover")}>
              Descubrir
            </TabButton>
            {downloadsEnabled ? (
              <TabButton bigPicture={bigPicture} tab="downloads" active={visibleTab === "downloads"} icon={<Download size={17} />} onClick={() => selectTab("downloads")}>
                Descargas
              </TabButton>
            ) : null}
          </div>
        </div>

        <div key={visibleTab} id="library-tab-panel" role={bigPicture ? "tabpanel" : undefined} aria-labelledby={bigPicture ? `library-tab-${visibleTab}` : undefined} ref={tabPanelRef} className="flex flex-col gap-9">
          {visibleTab === "library" ? (
            <>
              <TraktImportCard />
              {!aniListConnected ? <AniListSyncBanner
                count={aniListEntries.length}
                connected={aniListConnected}
                syncing={aniListSyncing}
                error={aniListError}
                onConnect={async () => {
                  setAniListError("");
                  try {
                    await connectAniListAccount();
                  } catch (error) {
                    setAniListError(error instanceof Error ? error.message : "No se pudo conectar AniList.");
                  }
                }}
                onSync={async () => {
                  setAniListSyncing(true);
                  setAniListError("");
                  try {
                    await syncAniListLibrary();
                  } catch (error) {
                    setAniListError(error instanceof Error ? error.message : "No se pudo sincronizar AniList.");
                  } finally {
                    setAniListSyncing(false);
                  }
                }}
              /> : null}
              <LibrarySummary items={libraryItems.map(item => item.media)} />
              {libraryItems.length ? (
                <>
                  <LibrarySelectors
                    filters={filters}
                    lists={filtered.lists}
                    types={filtered.types}
                    genres={filtered.genres}
                    onChange={updateFilter}
                    bigPicture={bigPicture}
                  />
                  {filtered.items.length ? (
                    <div
                      ref={libraryGridRef}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(197px, 197px))",
                        gap: 14,
                        alignItems: "start",
                        justifyContent: "center",
                      }}
                    >
                      {filtered.items.map(item => (
                        <LibraryGridCard key={item.key} item={item.media} itemKey={item.key} bigPicture={bigPicture}
                          personalRating={getPersonalRatingFromMap(item.media.type, item.media.id, item.media.userRating, userRatings)}
                          onBeforeOpen={() => { if (bigPicture) saveLibraryReturn({ tab: "library", itemKey: item.key }); }} />
                      ))}
                    </div>
                  ) : (
                    <EmptyFilteredLibrary />
                  )}
                </>
              ) : (
                <EmptyLibrary />
              )}
            </>
          ) : visibleTab === "discover" ? (
            <DiscoverLibrary catalogs={buildDiscoverCatalogs(addons)} bigPicture={bigPicture} initialState={returnState?.discover} />
          ) : (
            <OfflineDownloadsTab bigPicture={bigPicture} />
          )}
        </div>
      </PageContainer>
    </div>
  );
}

function DiscoverLibrary({
  catalogs,
  bigPicture = false,
  initialState,
}: {
  catalogs: DiscoverCatalog[];
  bigPicture?: boolean;
  initialState?: DiscoverReturnState;
}) {
  const stored = useMemo(readDiscoverSelection, []);
  const availableTypes = useMemo(() => Array.from(new Set(catalogs.map(catalog => catalog.type))), [catalogs]);
  const [type, setType] = useState(() => stored.type);
  const [catalogKey, setCatalogKey] = useState(() => stored.catalogKey);
  const [genre, setGenre] = useState(() => stored.genre);
  const [items, setItems] = useState<MediaItem[]>(initialState?.items ?? []);
  const [visibleCount, setVisibleCount] = useState(initialState?.visibleCount ?? DISCOVER_VISIBLE_BATCH);
  const [page, setPage] = useState(initialState?.page ?? 1);
  const [hasMore, setHasMore] = useState(initialState?.hasMore ?? true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const loadedSelectionRef = useRef<string | null>(initialState?.selectionKey ?? null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const selectionRef = useRef("");
  const discoverGridRef = useRef<HTMLDivElement>(null);
  useGridEntrance(discoverGridRef, [items, visibleCount]);

  const selectedType = availableTypes.includes(type) ? type : availableTypes[0] ?? "";
  const catalogsForType = useMemo(
    () => catalogs.filter(catalog => catalog.type === selectedType),
    [catalogs, selectedType],
  );
  const selectedCatalog = catalogsForType.find(catalog => catalog.key === catalogKey) ?? catalogsForType[0];
  const selectedGenre = selectedCatalog?.genres.includes(genre) ? genre : "";
  const selectionKey = `${selectedType}|${selectedCatalog?.key ?? ""}|${selectedGenre}`;
  selectionRef.current = selectionKey;

  useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

  useEffect(() => {
    if (loadedSelectionRef.current === selectionKey) return;
    loadMoreAbortRef.current?.abort();
    setLoadingMore(false);
    if (!selectedCatalog) {
      setItems([]);
      setLoading(false);
      loadedSelectionRef.current = selectionKey;
      return;
    }
    setType(selectedType);
    setCatalogKey(selectedCatalog.key);
    setGenre(selectedGenre);
    writeDiscoverSelection({ type: selectedType, catalogKey: selectedCatalog.key, genre: selectedGenre });

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setItems([]);
    setVisibleCount(DISCOVER_VISIBLE_BATCH);
    setPage(1);
    setHasMore(true);
    void fetchDiscoverPage(selectedCatalog, 1, selectedGenre, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setItems(mergeUniqueMedia([], result.items).items);
        setHasMore(result.hasMore);
        loadedSelectionRef.current = selectionKey;
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : "No se pudo cargar este catálogo.");
        setHasMore(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedCatalog?.key, selectedGenre, selectedType, selectionKey]);

  const loadNext = async () => {
    if (visibleCount < items.length) {
      setVisibleCount(count => Math.min(count + DISCOVER_VISIBLE_BATCH, items.length));
      return;
    }
    if (!selectedCatalog || !hasMore || loadingMore) return;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    const requestSelection = selectionKey;
    setLoadingMore(true);
    setError("");
    try {
      const nextPage = page + 1;
      const result = await fetchDiscoverPage(selectedCatalog, nextPage, selectedGenre, controller.signal);
      if (controller.signal.aborted || selectionRef.current !== requestSelection) return;
      const merged = mergeUniqueMedia(items, result.items);
      setItems(merged.items);
      setVisibleCount(count => count + DISCOVER_VISIBLE_BATCH);
      setPage(nextPage);
      setHasMore(result.hasMore && merged.added > 0);
    } catch (error) {
      if (controller.signal.aborted || selectionRef.current !== requestSelection) return;
      setError(error instanceof Error ? error.message : "No se pudo cargar la siguiente página.");
      setHasMore(false);
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        setLoadingMore(false);
      }
    }
  };

  if (!catalogs.length) return <EmptyDiscover />;

  const visibleItems = items.slice(0, visibleCount);
  const row = selectedCatalog && visibleItems.length
    ? buildRow(selectedCatalog.catalogId, selectedCatalog.catalogName, visibleItems, selectedCatalog.addonId, selectedCatalog.addonName, selectedGenre)
    : null;

  return (
    <div className="flex flex-col gap-9">
      <div className="liquid-glass flex flex-wrap items-end gap-3 rounded-2xl px-5 py-4">
        <LibrarySelector
          bigPicture={bigPicture}
          label="Tipo"
          value={selectedType}
          options={availableTypes.map(value => ({ value, label: typeLabel(value) }))}
          onChange={value => {
            setType(value);
            setCatalogKey("");
            setGenre("");
          }}
        />
        <LibrarySelector
          bigPicture={bigPicture}
          label="Catálogo"
          value={selectedCatalog?.key ?? ""}
          options={catalogsForType.map(value => ({ value: value.key, label: `${value.catalogName} · ${value.addonName}` }))}
          onChange={value => {
            setCatalogKey(value);
            setGenre("");
          }}
        />
        {selectedCatalog?.genres.length ? (
          <LibrarySelector
            bigPicture={bigPicture}
            label="Género"
            value={selectedGenre}
            options={[
              { value: "", label: "Todos" },
              ...selectedCatalog.genres.map(value => ({ value, label: value })),
            ]}
            onChange={setGenre}
          />
        ) : null}
      </div>

      {loading ? <DiscoverSkeleton /> : error && !row ? <DiscoverError message={error} /> : row ? (
        <>
          <div
            ref={discoverGridRef}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(197px, 197px))",
              gap: 14,
              alignItems: "start",
              justifyContent: "center",
            }}
          >
            {visibleItems.map(item => <LibraryGridCard key={`${item.type}:${item.id}`} item={item} bigPicture={bigPicture}
              itemKey={`${item.type}:${item.id}`}
              onBeforeOpen={() => {
                if (bigPicture) saveLibraryReturn({ tab: "discover", itemKey: `${item.type}:${item.id}`,
                  discover: { selectionKey, items, visibleCount, page, hasMore } });
              }} />)}
          </div>
          {(visibleCount < items.length || hasMore) ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadNext()}
                onPointerDown={e => { if (e.button === 0 && !loadingMore) tweenTo(e.currentTarget, { scale: 0.96 }); }}
                onPointerUp={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)}
                onPointerCancel={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)}
                className="liquid-glass gsap-transition inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-black text-white disabled:opacity-50"
              >
                {loadingMore ? <AppleSpinner size={16} /> : <RefreshCw size={16} />}
                {loadingMore ? "Cargando…" : "Mostrar más"}
              </button>
            </div>
          ) : null}
          {error ? <p className="text-center text-xs font-semibold text-red-300/80">{error}</p> : null}
        </>
      ) : (
        <DiscoverError message="Este catálogo no devolvió contenido." />
      )}
    </div>
  );
}

function LibrarySelectors({
  filters,
  lists,
  types,
  genres,
  onChange,
  bigPicture = false,
}: {
  filters: LibraryFilters;
  lists: FacetOption[];
  types: FacetOption[];
  genres: FacetOption[];
  onChange: <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => void;
  bigPicture?: boolean;
}) {
  return (
    <div className="liquid-glass flex flex-wrap items-end gap-3 rounded-2xl px-5 py-4">
      <LibrarySelector bigPicture={bigPicture} label="Lista" value={filters.list} options={facetOptions(lists)} onChange={value => onChange("list", value)} />
      <LibrarySelector bigPicture={bigPicture} label="Tipo" value={filters.type} options={facetOptions(types)} onChange={value => onChange("type", value)} />
      {genres.length > 1 ? (
        <LibrarySelector bigPicture={bigPicture} label="Género" value={filters.genre} options={facetOptions(genres)} onChange={value => onChange("genre", value)} />
      ) : null}
      <LibrarySelector
        bigPicture={bigPicture}
        label="Orden"
        value={filters.sort}
        options={[
          { value: "added_desc", label: "Añadidos recientemente" },
          { value: "added_asc", label: "Añadidos primero" },
          { value: "title_asc", label: "Título A–Z" },
          { value: "title_desc", label: "Título Z–A" },
          { value: "rating_desc", label: "Por puntuación" },
        ]}
        onChange={value => onChange("sort", value as LibraryFilters["sort"])}
      />
    </div>
  );
}

function AniListSyncBanner({
  count,
  connected,
  syncing,
  error,
  onConnect,
  onSync,
}: {
  count: number;
  connected: boolean;
  syncing: boolean;
  error: string;
  onConnect: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const { dismissed, dismiss } = useDismissedIntegrationBanner("aetherio-anilist-banner-dismissed-v1");
  if (dismissed) return null;

  return (
    <div className="liquid-glass flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4">
      <div>
        <p className="text-sm font-black text-white">AniList</p>
        <p className="mt-1 text-xs font-semibold text-white/48">
          {error || (count
            ? `${count} animes sincronizados. El progreso se actualiza al completar episodios.`
            : "Conecta AniList para importar y mantener tu lista.")}
        </p>
      </div>
      <div className="library-anilist-actions flex flex-wrap items-center gap-2">
        {!connected ? <button type="button" onClick={() => void onConnect()} disabled={syncing} onPointerDown={e => { if (e.button === 0 && !syncing) tweenTo(e.currentTarget, { scale: 0.96 }); }} onPointerUp={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} onPointerCancel={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} className="inline-flex h-10 items-center rounded-full border border-white/12 px-4 text-xs font-black text-white disabled:opacity-55">
          Conectar cuenta
        </button> : null}
        <button type="button" onClick={() => void onSync()} disabled={syncing} onPointerDown={e => { if (e.button === 0 && !syncing) tweenTo(e.currentTarget, { scale: 0.96 }); }} onPointerUp={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} onPointerCancel={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} className="inline-flex h-10 items-center gap-2 rounded-full border border-transparent bg-white px-4 text-xs font-black text-black disabled:opacity-55">
          {syncing ? <AppleSpinner size={15} color="#111" /> : <RefreshCw size={15} />}
          {syncing ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
        <button type="button" onClick={dismiss} disabled={syncing} className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-bold text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-55" aria-label="No mostrar el aviso de AniList">
          <EyeOff size={15} aria-hidden="true" />
          No mostrar
        </button>
      </div>
    </div>
  );
}

function TabButton({ active, icon, children, onClick, bigPicture = false, tab }: {
  active: boolean; icon: React.ReactNode; children: React.ReactNode; onClick: () => void; bigPicture?: boolean; tab: LibraryTab;
}) {
  return (
      <button
        type="button"
        data-library-tab={tab}
        id={bigPicture ? `library-tab-${tab}` : undefined}
        role={bigPicture ? "tab" : undefined}
        aria-selected={bigPicture ? active : undefined}
        aria-pressed={bigPicture ? undefined : active}
        aria-controls={bigPicture ? "library-tab-panel" : undefined}
        tabIndex={bigPicture ? (active ? 0 : -1) : undefined}
      onClick={onClick}
      onPointerDown={event => {
        if (event.button !== 0) return;
        tweenTo(event.currentTarget, { scale: 0.97 });
      }}
      onPointerUp={event => tweenTo(event.currentTarget, { scale: 1 }, 0.24)}
      onPointerCancel={event => tweenTo(event.currentTarget, { scale: 1 }, 0.24)}
      className="library-tab-button inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      style={{
        background: active ? "rgba(255,255,255,0.94)" : "transparent",
        color: active ? "rgba(12,12,13,0.94)" : "rgba(255,255,255,0.62)",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function LibrarySummary({ items }: { items: MediaItem[] }) {
  const movies = new Set(items.filter(item => item.type === "movie").map(item => item.id));
  const shows = new Set(items.filter(item => item.type !== "movie").map(item => item.id));
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Metric icon={<LibraryIcon size={18} />} label="En tu biblioteca" value={new Set(items.map(item => `${item.type}:${item.id}`)).size} />
      <Metric icon={<Film size={18} />} label="Películas" value={movies.size} />
      <Metric icon={<Tv size={18} />} label="Series y anime" value={shows.size} />
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="liquid-glass rounded-2xl px-5 py-4">
      <div className="mb-3 flex items-center gap-2 text-white/54">
        {icon}
        <span className="text-sm font-black text-white">{label}</span>
      </div>
      <div className="text-3xl font-black text-white">{value}</div>
    </div>
  );
}

function buildRow(
  catalogId: string,
  name: string,
  items: MediaItem[],
  addonId = "aetherio-library",
  addonName = "Aetherio",
  genre = "",
): CatalogRowData {
  return {
    addonId,
    addonName,
    catalogId,
    type: items[0]?.type ?? "series",
    name,
    extraParams: genre ? { genre } : undefined,
    items,
  };
}

function facetOptions(options: FacetOption[]) {
  return options.map(option => ({ value: option.key, label: `${option.label} (${option.count})` }));
}

function typeLabel(type: string) {
  if (type === "movie") return "Películas";
  if (type === "series") return "Series";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function EmptyLibrary() {
  return (
    <div className="liquid-glass mx-12 rounded-2xl px-6 py-10 text-center text-white/54">
      <p className="text-lg font-black text-white">Tu biblioteca se llenará automáticamente.</p>
      <p className="mt-2 text-sm">Reproduce, marca contenido como visto o sincroniza AniList para verlo aquí.</p>
    </div>
  );
}

function EmptyFilteredLibrary() {
  return (
    <div className="liquid-glass mx-12 rounded-2xl px-6 py-10 text-center text-white/54">
      <p className="text-lg font-black text-white">No hay títulos con estos filtros.</p>
      <p className="mt-2 text-sm">Cambia la lista, el tipo, el género o el año.</p>
    </div>
  );
}

function LibraryGridCard({ item, itemKey, bigPicture = false, personalRating = null, onBeforeOpen }: {
  item: MediaItem;
  itemKey?: string;
  bigPicture?: boolean;
  personalRating?: number | null;
  onBeforeOpen?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const [resolvedPoster, setResolvedPoster] = useState("");
  const image = getLibraryPoster(item) ?? resolvedPoster;
  const type = item.type ?? "series";
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setResolvedPoster("");
    if (getLibraryPoster(item)) return () => { cancelled = true; };
    const match = /^tmdb:([1-9]\d*)$/.exec(item.id);
    if (!match || (type !== "movie" && type !== "series")) return () => { cancelled = true; };
    void fetchTmdbArtwork(type === "movie" ? "movie" : "tv", Number(match[1])).then(artwork => {
      const poster = tmdbImage(artwork?.posterPath, "w500");
      if (cancelled || !poster) return;
      setResolvedPoster(poster);
      updateSavedLibraryArtwork(type, item.id, poster);
    });
    return () => { cancelled = true; };
  }, [item.id, item.type, item.poster, item.originalPoster, type]);

  const openDetail = () => {
    onBeforeOpen?.();
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster: image || undefined,
      background: item.background,
      logo: item.logo,
      description: item.description,
      year: item.year,
    });
    navigate(buildDetailPath(type, item.id, undefined, location.pathname));
  };

  return (
    <div style={{ width: 197 }} data-grid-entrance>
      <button
        type="button"
        className="media-card-frame"
        aria-label={item.name}
        data-library-media-key={itemKey}
        onClick={openDetail}
        onMouseEnter={event => tweenTo(event.currentTarget, { scale: 1.05, y: -3, zIndex: 5 }, 0.32)}
        onMouseLeave={event => tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32)}
        onFocus={event => { if (bigPicture) tweenTo(event.currentTarget, { scale: 1.05, y: -3, zIndex: 5 }, 0.32); }}
        onBlur={event => { if (bigPicture) tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32); }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          tweenTo(event.currentTarget, { scale: 0.95, y: 0 });
        }}
        onPointerUp={event => tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32)}
        onPointerCancel={event => tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32)}
        style={{ position: "relative", width: 197, height: 296, borderRadius: 10, overflow: "hidden", background: "#1c1c1e", border: "none", padding: 0, cursor: "pointer", textAlign: "left", boxShadow: "0 0 0 rgba(0,0,0,0)", willChange: "transform" }}
      >
        {image && !failed ? (
          <img src={image} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : <span className="flex h-full items-center justify-center px-4 text-center text-sm font-semibold text-white/70">{item.name}</span>}
        {personalRating !== null ? (
          <span role="img" aria-label={`Tu valoración: ${formatFiveStarRating(personalRating)} de 5 estrellas`} style={{ position: "absolute", top: 9, right: 9, display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "5px 8px", color: "#fff", background: "rgba(0,0,0,0.65)", fontSize: 12, fontWeight: 800, backdropFilter: "blur(10px)" }}>
            <RatingStar fill={1} size={12} />{formatFiveStarRating(personalRating)}
          </span>
        ) : null}
      </button>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
        {item.name}
      </div>
    </div>
  );
}

function EmptyDiscover() {
  return (
    <div className="liquid-glass mx-12 rounded-2xl px-6 py-10 text-center text-white/54">
      <p className="text-lg font-black text-white">No hay catálogos para descubrir.</p>
      <p className="mt-2 text-sm">Instala o activa addons con catálogos que no requieran una búsqueda.</p>
    </div>
  );
}

function DiscoverError({ message }: { message: string }) {
  return (
    <div className="liquid-glass mx-12 rounded-2xl px-6 py-10 text-center text-white/54">
      <p className="text-lg font-black text-white">No se pudo mostrar este catálogo.</p>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(197px, 197px))",
          gap: 14,
          justifyContent: "center",
        }}
      >
        {[0, 1, 2, 3, 4, 5].map(card => <div key={card} className="skeleton h-[296px] w-[197px] rounded-xl" />)}
      </div>
    </div>
  );
}
