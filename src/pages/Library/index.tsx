import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookMarked, Compass, Film, RefreshCw, Tv } from "lucide-react";
import { appleEase, gsap, prefersReducedMotion, tweenTo } from "../../utils/motion";
import PageContainer from "../../components/layout/PageContainer";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import {
  ANILIST_LIBRARY_CHANGED_EVENT,
  readAniListLibrary,
  syncAniListLibrary,
} from "../../integrations/aniList";
import { connectAniListAccount } from "../../auth/authClient";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import {
  CONTINUE_WATCHING_EVENT,
  readPlaybackStateEntries,
} from "../../utils/continueWatching";
import { LIBRARY_CHANGED_EVENT, readSavedLibrary } from "../../utils/library";
import {
  buildDiscoverCatalogs,
  buildLibraryItems,
  fetchDiscoverPage,
  filterLibrary,
  mergeUniqueMedia,
  readDiscoverSelection,
  readLibraryFilters,
  writeDiscoverSelection,
  writeLibraryFilters,
  type DiscoverCatalog,
  type FacetOption,
  type LibraryFilters,
} from "./libraryLogic";

type LibraryTab = "library" | "discover";
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

export default function LibraryPage() {
  const addons = useAddonStore(state => state.addons);
  const { gradient } = useProfileGradient();
  const [tab, setTab] = useState<LibraryTab>("library");
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<LibraryFilters>(readLibraryFilters);
  const [aniListSyncing, setAniListSyncing] = useState(false);
  const [aniListError, setAniListError] = useState("");

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient);
    }

    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    };
  }, [gradient]);

  useEffect(() => {
    const refresh = () => setVersion(value => value + 1);
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
  useLayoutEffect(() => {
    const panel = tabPanelRef.current;
    if (!panel) return;
    if (prefersReducedMotion()) {
      // §14 — short cross-fade, no slide/scale
      gsap.fromTo(panel, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power1.out" });
      return;
    }
    gsap.set(panel, { willChange: "transform,opacity" });
    gsap.fromTo(
      panel,
      { opacity: 0, y: 10, scale: 0.99 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.38,
        ease: appleEase,
        clearProps: "transform,opacity",
        onComplete: () => gsap.set(panel, { willChange: "auto" }),
      },
    );
  }, [tab]);

  return (
    <div className="home-page-scale min-h-screen">
      <PageContainer className="min-h-full pb-10 pt-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-[clamp(2.35rem,4.8vw,4.8rem)] font-black leading-none text-white">{tab === "library" ? "Mi biblioteca" : "Descubrir"}</h1>
          </div>
          <div className="liquid-glass inline-flex rounded-2xl p-1" style={{ transform: "translateZ(0)" }}>
            <TabButton active={tab === "library"} icon={<BookMarked size={17} />} onClick={() => setTab("library")}>
              Mi biblioteca
            </TabButton>
            <TabButton active={tab === "discover"} icon={<Compass size={17} />} onClick={() => setTab("discover")}>
              Descubrir
            </TabButton>
          </div>
        </div>

        <div key={tab} ref={tabPanelRef} className="flex flex-col gap-9">
          {tab === "library" ? (
            <>
              <AniListSyncBanner
                count={aniListEntries.length}
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
              />
              <LibrarySummary items={libraryItems.map(item => item.media)} />
              {libraryItems.length ? (
                <>
                  <LibrarySelectors
                    filters={filters}
                    lists={filtered.lists}
                    types={filtered.types}
                    genres={filtered.genres}
                    onChange={updateFilter}
                  />
                  {filtered.items.length ? (
                    <div
                      ref={libraryGridRef}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(207px, 207px))",
                        gap: 14,
                        alignItems: "start",
                        justifyContent: "center",
                      }}
                    >
                      {filtered.items.map(item => (
                        <LibraryGridCard key={item.key} item={item.media} />
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
          ) : (
            <DiscoverLibrary catalogs={buildDiscoverCatalogs(addons)} />
          )}
        </div>
      </PageContainer>
    </div>
  );
}

function DiscoverLibrary({
  catalogs,
}: {
  catalogs: DiscoverCatalog[];
}) {
  const stored = useMemo(readDiscoverSelection, []);
  const availableTypes = useMemo(() => Array.from(new Set(catalogs.map(catalog => catalog.type))), [catalogs]);
  const [type, setType] = useState(() => stored.type);
  const [catalogKey, setCatalogKey] = useState(() => stored.catalogKey);
  const [genre, setGenre] = useState(() => stored.genre);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(DISCOVER_VISIBLE_BATCH);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const loadedSelectionRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (loadedSelectionRef.current === selectionKey) return;
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
        setItems(mergeUniqueMedia([], result.items).items);
        setHasMore(result.hasMore);
        loadedSelectionRef.current = selectionKey;
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
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
    setLoadingMore(true);
    setError("");
    try {
      const nextPage = page + 1;
      const result = await fetchDiscoverPage(selectedCatalog, nextPage, selectedGenre);
      const merged = mergeUniqueMedia(items, result.items);
      setItems(merged.items);
      setVisibleCount(count => count + DISCOVER_VISIBLE_BATCH);
      setPage(nextPage);
      setHasMore(result.hasMore && merged.added > 0);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo cargar la siguiente página.");
      setHasMore(false);
    } finally {
      setLoadingMore(false);
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
        <Selector
          label="Tipo"
          value={selectedType}
          options={availableTypes.map(value => ({ value, label: typeLabel(value) }))}
          onChange={value => {
            setType(value);
            setCatalogKey("");
            setGenre("");
          }}
        />
        <Selector
          label="Catálogo"
          value={selectedCatalog?.key ?? ""}
          options={catalogsForType.map(value => ({ value: value.key, label: `${value.catalogName} · ${value.addonName}` }))}
          onChange={value => {
            setCatalogKey(value);
            setGenre("");
          }}
        />
        {selectedCatalog?.genres.length ? (
          <Selector
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
              gridTemplateColumns: "repeat(auto-fill, minmax(207px, 207px))",
              gap: 14,
              alignItems: "start",
              justifyContent: "center",
            }}
          >
            {visibleItems.map(item => <LibraryGridCard key={`${item.type}:${item.id}`} item={item} />)}
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
                <RefreshCw size={16} className={loadingMore ? "animate-spin" : ""} />
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
}: {
  filters: LibraryFilters;
  lists: FacetOption[];
  types: FacetOption[];
  genres: FacetOption[];
  onChange: <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => void;
}) {
  return (
    <div className="liquid-glass flex flex-wrap items-end gap-3 rounded-2xl px-5 py-4">
      <Selector label="Lista" value={filters.list} options={facetOptions(lists)} onChange={value => onChange("list", value)} />
      <Selector label="Tipo" value={filters.type} options={facetOptions(types)} onChange={value => onChange("type", value)} />
      {genres.length > 1 ? (
        <Selector label="Género" value={filters.genre} options={facetOptions(genres)} onChange={value => onChange("genre", value)} />
      ) : null}
      <Selector
        label="Orden"
        value={filters.sort}
        options={[
          { value: "added_desc", label: "Añadidos recientemente" },
          { value: "added_asc", label: "Añadidos primero" },
          { value: "title_asc", label: "Título A–Z" },
          { value: "title_desc", label: "Título Z–A" },
        ]}
        onChange={value => onChange("sort", value as LibraryFilters["sort"])}
      />
    </div>
  );
}

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
      <span className="text-sm font-black text-white">{label}</span>
      <select
        value={options.some(option => option.value === value) ? value : options[0]?.value ?? ""}
        onChange={event => onChange(event.target.value)}
        className="h-10 rounded-xl border border-white/10 bg-black/30 pl-3 pr-8 text-sm font-bold text-white outline-none"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function AniListSyncBanner({
  count,
  syncing,
  error,
  onConnect,
  onSync,
}: {
  count: number;
  syncing: boolean;
  error: string;
  onConnect: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
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
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void onConnect()} disabled={syncing} onPointerDown={e => { if (e.button === 0 && !syncing) tweenTo(e.currentTarget, { scale: 0.96 }); }} onPointerUp={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} onPointerCancel={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} className="gsap-transition inline-flex h-10 items-center rounded-full border border-white/12 px-4 text-xs font-black text-white disabled:opacity-55">
          Conectar cuenta
        </button>
        <button type="button" onClick={() => void onSync()} disabled={syncing} onPointerDown={e => { if (e.button === 0 && !syncing) tweenTo(e.currentTarget, { scale: 0.96 }); }} onPointerUp={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} onPointerCancel={e => tweenTo(e.currentTarget, { scale: 1 }, 0.24)} className="gsap-transition inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-black text-black disabled:opacity-55">
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </div>
    </div>
  );
}

function TabButton({ active, icon, children, onClick }: { active: boolean; icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={event => {
        if (event.button !== 0) return;
        tweenTo(event.currentTarget, { scale: 0.97 });
      }}
      onPointerUp={event => tweenTo(event.currentTarget, { scale: 1 }, 0.24)}
      onPointerCancel={event => tweenTo(event.currentTarget, { scale: 1 }, 0.24)}
      className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-extrabold"
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
      <Metric icon={<BookMarked size={18} />} label="En tu biblioteca" value={new Set(items.map(item => `${item.type}:${item.id}`)).size} />
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

function LibraryGridCard({ item }: { item: MediaItem }) {
  const navigate = useNavigate();
  const image = item.poster ?? item.background ?? "";
  const type = item.type ?? "series";

  const openDetail = () => {
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster: item.poster,
      background: item.background,
      logo: item.logo,
      description: item.description,
      year: item.year,
    });
    navigate(`/detail/${encodeURIComponent(type)}/${encodeURIComponent(item.id)}`);
  };

  return (
    <div style={{ width: 207 }} data-grid-entrance>
      <button
        type="button"
        onClick={openDetail}
        onMouseEnter={event => tweenTo(event.currentTarget, { scale: 1.05, y: -3, zIndex: 5 }, 0.32)}
        onMouseLeave={event => tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32)}
        onPointerDown={event => {
          if (event.button !== 0) return;
          tweenTo(event.currentTarget, { scale: 0.95, y: 0 });
        }}
        onPointerUp={event => tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32)}
        onPointerCancel={event => tweenTo(event.currentTarget, { scale: 1, y: 0, zIndex: 1 }, 0.32)}
        style={{ position: "relative", width: 207, height: 312, borderRadius: 10, overflow: "hidden", background: "#1c1c1e", border: "none", padding: 0, cursor: "pointer", textAlign: "left", boxShadow: "0 0 0 rgba(0,0,0,0)", willChange: "transform" }}
      >
        {image ? (
          <img src={image} alt={item.name} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
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
          gridTemplateColumns: "repeat(auto-fill, minmax(207px, 207px))",
          gap: 14,
          justifyContent: "center",
        }}
      >
        {[0, 1, 2, 3, 4, 5].map(card => <div key={card} className="skeleton h-[312px] w-[207px] rounded-xl" />)}
      </div>
    </div>
  );
}
