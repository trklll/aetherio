import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../types/ui";
import BigPictureLibraryCard from "./BigPictureLibraryCard";
import {
  fetchDiscoverPage,
  mergeUniqueMedia,
  readDiscoverSelection,
  writeDiscoverSelection,
  type DiscoverCatalog,
} from "../Library/libraryLogic";
import "./BigPictureLibrary.css";

const DISCOVER_RETURN_KEY = "aetherio-big-picture-library-discover-return-v1";

interface DiscoverReturnCache {
  selectionKey: string;
  items: MediaItem[];
  page: number;
  hasMore: boolean;
  focusKey: string;
}

export default function BigPictureLibraryDiscover({ catalogs }: { catalogs: DiscoverCatalog[] }) {
  const stored = useMemo(readDiscoverSelection, []);
  const availableTypes = useMemo(() => Array.from(new Set(catalogs.map(catalog => catalog.type))), [catalogs]);
  const [type, setType] = useState(() => stored.type);
  const [catalogKey, setCatalogKey] = useState(() => stored.catalogKey);
  const [genre, setGenre] = useState(() => stored.genre);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const selectionKeyRef = useRef("");
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const selectedType = availableTypes.includes(type) ? type : availableTypes[0] ?? "";
  const catalogsForType = useMemo(() => catalogs.filter(catalog => catalog.type === selectedType), [catalogs, selectedType]);
  const selectedCatalog = catalogsForType.find(catalog => catalog.key === catalogKey) ?? catalogsForType[0];
  const selectedGenre = selectedCatalog?.genres.includes(genre) ? genre : "";
  const selectionKey = `${selectedType}|${selectedCatalog?.key ?? ""}|${selectedGenre}`;

  useEffect(() => {
    if (selectionKeyRef.current === selectionKey) return;
    selectionKeyRef.current = selectionKey;
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setLoadingMore(false);
    if (!selectedCatalog) {
      setItems([]);
      setLoading(false);
      return;
    }

    setType(selectedType);
    setCatalogKey(selectedCatalog.key);
    setGenre(selectedGenre);
    writeDiscoverSelection({ type: selectedType, catalogKey: selectedCatalog.key, genre: selectedGenre });

    const cached = consumeReturnCache(selectionKey);
    if (cached) {
      setItems(cached.items);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      setLoading(false);
      const restoreTimer = window.setTimeout(() => {
        const cachedWithScroll = cached as DiscoverReturnCache & { scrollTop?: number };
        const shell = document.querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]");
        if (shell && typeof cachedWithScroll.scrollTop === "number") {
          shell.scrollTo({ top: cachedWithScroll.scrollTop, behavior: "instant" as ScrollBehavior });
        }
        findMediaButton(cached.focusKey)?.focus({ preventScroll: true });
      }, 140);
      return () => window.clearTimeout(restoreTimer);
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setItems([]);
    setPage(1);
    setHasMore(true);
    void fetchDiscoverPage(selectedCatalog, 1, selectedGenre, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setItems(mergeUniqueMedia([], result.items).items);
        setHasMore(result.hasMore);
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "No se pudo cargar este catálogo.");
        setHasMore(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retryVersion, selectedCatalog, selectedGenre, selectedType, selectionKey]);

  useEffect(() => {
    if (readReturnCache()) return;
    const timer = window.setTimeout(() => typeSelectRef.current?.focus({ preventScroll: true }), 100);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

  const saveReturnPosition = (item: MediaItem) => {
    if (!selectedCatalog) return;
    try {
      const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
      sessionStorage.setItem(DISCOVER_RETURN_KEY, JSON.stringify({
        selectionKey,
        items,
        page,
        hasMore,
        focusKey: `${item.type}:${item.id}`,
        scrollTop: shell?.scrollTop ?? 0,
      } satisfies DiscoverReturnCache & { scrollTop: number }));
    } catch {
      // La vuelta desde detalle debe seguir funcionando si el storage está lleno.
    }
  };

  const loadMore = async () => {
    if (!selectedCatalog || !hasMore || loadingMore) return;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    setError("");
    try {
      const nextPage = page + 1;
      const result = await fetchDiscoverPage(selectedCatalog, nextPage, selectedGenre, controller.signal);
      if (controller.signal.aborted) return;
      const merged = mergeUniqueMedia(items, result.items);
      setItems(merged.items);
      setPage(nextPage);
      setHasMore(result.hasMore && merged.added > 0);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la siguiente página.");
      setHasMore(false);
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        setLoadingMore(false);
      }
    }
  };

  if (!catalogs.length) {
    return <p className="bp-library__status">Activa una extensión con catálogos para descubrir contenido.</p>;
  }

  const typeOptions = availableTypes.map(value => ({ value, label: typeLabel(value) }));
  return (
    <div className="bp-library__discover" data-bp-library-discover>
      <div className="bp-library__discover-controls">
        <label className="bp-library__discover-field">
          <span>Tipo</span>
          <select
            ref={typeSelectRef}
            aria-label="Tipo de contenido"
            value={selectedType}
            onChange={event => {
              setType(event.target.value);
              setCatalogKey("");
              setGenre("");
            }}
          >
            {typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="bp-library__discover-field">
          <span>Catálogo</span>
          <select
            aria-label="Catálogo para descubrir"
            value={selectedCatalog?.key ?? ""}
            onChange={event => {
              setCatalogKey(event.target.value);
              setGenre("");
            }}
          >
            {catalogsForType.map(catalog => (
              <option key={catalog.key} value={catalog.key}>{catalog.catalogName} · {catalog.addonName}</option>
            ))}
          </select>
        </label>
        {selectedCatalog?.genres.length ? (
          <label className="bp-library__discover-field">
            <span>Género</span>
            <select aria-label="Género para descubrir" value={selectedGenre} onChange={event => setGenre(event.target.value)}>
              <option value="">Todos</option>
              {selectedCatalog.genres.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {loading ? (
        <div className="bp-library__grid" aria-label="Cargando resultados">
          {Array.from({ length: 12 }).map((_, index) => <div key={index} className="bp-library__discover-skeleton" />)}
        </div>
      ) : error && !items.length ? (
        <div className="bp-library__discover-message" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => { selectionKeyRef.current = ""; setRetryVersion(value => value + 1); }}>
            Reintentar
          </button>
        </div>
      ) : items.length ? (
        <>
          <div className="bp-library__grid">
            {items.map((item, index) => (
              <BigPictureLibraryCard
                key={`${item.type}:${item.id}`}
                item={item}
                index={index}
                itemKey={`${item.type}:${item.id}`}
                onBeforeOpen={() => saveReturnPosition(item)}
              />
            ))}
          </div>
          {hasMore ? (
            <div className="bp-library__discover-more">
              <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Cargando…" : "Mostrar más"}
              </button>
            </div>
          ) : null}
          {error ? <p className="bp-library__discover-error" role="alert">{error}</p> : null}
        </>
      ) : (
        <p className="bp-library__status">Este catálogo no devolvió contenido.</p>
      )}
    </div>
  );
}

function typeLabel(type: string) {
  if (type === "movie") return "Películas";
  if (type === "series" || type === "tv") return "Series";
  if (type === "anime") return "Anime";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function readReturnCache(): DiscoverReturnCache | null {
  try {
    const raw = sessionStorage.getItem(DISCOVER_RETURN_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as DiscoverReturnCache;
    return Array.isArray(cache.items) ? cache : null;
  } catch {
    return null;
  }
}

function consumeReturnCache(selectionKey: string) {
  const cache = readReturnCache();
  if (!cache) return null;
  try { sessionStorage.removeItem(DISCOVER_RETURN_KEY); } catch { /* best effort */ }
  if (cache.selectionKey !== selectionKey) return null;
  return cache;
}

function findMediaButton(key: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-library-media-key]"))
    .find(button => button.dataset.libraryMediaKey === key);
}
