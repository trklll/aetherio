import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Compass, Film, RefreshCw, Tv } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { useHomePreferences } from "../../config/homePreferences";
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
import CatalogRow from "../Home/CatalogRow";
import ContinueWatchingRow from "../Home/ContinueWatchingRow";
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

export default function LibraryPage() {
  const addons = useAddonStore(state => state.addons);
  const homePreferences = useHomePreferences();
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
  const libraryRow = useMemo(
    () => filtered.items.length
      ? buildRow("filtered-library", selectedListLabel(filtered.lists, filters.list), filtered.items.map(item => item.media))
      : null,
    [filtered.items, filtered.lists, filters.list],
  );

  const updateFilter = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value }));
  };

  return (
    <PageContainer className="min-h-full pb-10 pt-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-white/34">Aetherio</p>
          <h1 className="text-[clamp(2.35rem,4.8vw,4.8rem)] font-black leading-none text-white">Biblioteca</h1>
        </div>
        <div className="liquid-glass inline-flex rounded-2xl p-1">
          <TabButton active={tab === "library"} icon={<BookMarked size={17} />} onClick={() => setTab("library")}>
            Mi biblioteca
          </TabButton>
          <TabButton active={tab === "discover"} icon={<Compass size={17} />} onClick={() => setTab("discover")}>
            Descubrir
          </TabButton>
        </div>
      </div>

      {tab === "library" ? (
        <div className="flex flex-col gap-9">
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
          <ContinueWatchingRow />
          {libraryItems.length ? (
            <>
              <LibrarySelectors
                filters={filters}
                lists={filtered.lists}
                types={filtered.types}
                genres={filtered.genres}
                years={filtered.years}
                onChange={updateFilter}
              />
              {libraryRow ? (
                <CatalogRow row={libraryRow} posterLayout={homePreferences.posterLayout} disableHeaderNavigation />
              ) : (
                <EmptyFilteredLibrary />
              )}
            </>
          ) : (
            <EmptyLibrary />
          )}
        </div>
      ) : (
        <DiscoverLibrary posterLayout={homePreferences.posterLayout} catalogs={buildDiscoverCatalogs(addons)} />
      )}
    </PageContainer>
  );
}

function DiscoverLibrary({
  catalogs,
  posterLayout,
}: {
  catalogs: DiscoverCatalog[];
  posterLayout: "vertical" | "horizontal";
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
          <CatalogRow row={row} posterLayout={posterLayout} disableHeaderNavigation />
          {(visibleCount < items.length || hasMore) ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadNext()}
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
  years,
  onChange,
}: {
  filters: LibraryFilters;
  lists: FacetOption[];
  types: FacetOption[];
  genres: FacetOption[];
  years: FacetOption[];
  onChange: <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => void;
}) {
  return (
    <div className="liquid-glass flex flex-wrap items-end gap-3 rounded-2xl px-5 py-4">
      <Selector label="Lista" value={filters.list} options={facetOptions(lists)} onChange={value => onChange("list", value)} />
      <Selector label="Tipo" value={filters.type} options={facetOptions(types)} onChange={value => onChange("type", value)} />
      {genres.length > 1 ? (
        <Selector label="Género" value={filters.genre} options={facetOptions(genres)} onChange={value => onChange("genre", value)} />
      ) : null}
      {years.length > 1 ? (
        <Selector label="Año" value={filters.year} options={facetOptions(years)} onChange={value => onChange("year", value)} />
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
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/38">{label}</span>
      <select
        value={options.some(option => option.value === value) ? value : options[0]?.value ?? ""}
        onChange={event => onChange(event.target.value)}
        className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-bold text-white outline-none"
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
        <button type="button" onClick={() => void onConnect()} disabled={syncing} className="gsap-transition inline-flex h-10 items-center rounded-full border border-white/12 px-4 text-xs font-black text-white disabled:opacity-55">
          Conectar cuenta
        </button>
        <button type="button" onClick={() => void onSync()} disabled={syncing} className="gsap-transition inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-black text-black disabled:opacity-55">
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
      className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-extrabold gsap-transition"
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
        <span className="text-xs font-black uppercase tracking-[0.14em]">{label}</span>
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

function selectedListLabel(options: FacetOption[], selected: string) {
  return options.find(option => option.key === selected)?.label.replace(/\s+\(\d+\)$/, "") ?? "Tu biblioteca";
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
    <div className="flex flex-col gap-8 px-12">
      <div>
        <div className="skeleton mb-4 h-5 w-48 rounded" />
        <div className="flex gap-3">
          {[0, 1, 2, 3].map(card => <div key={card} className="skeleton h-[196px] w-[302px] shrink-0 rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
