import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  applyContentOrientationToItems,
  applyHomeCatalogPreferences,
  matchesContentOrientation,
  useHomePreferences,
} from "../../config/homePreferences";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useRefreshRate } from "../../hooks/useRefreshRate";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import CatalogRow from "./CatalogRow";
import ContinueWatchingRow from "./ContinueWatchingRow";
import HeroSection from "./HeroSection";
import StreamingProviderRowsGroup, {
  STREAMING_PROVIDERS,
  type StreamingProviderTheme,
} from "./StreamingProviderRowsGroup";

export type { CatalogRowData, MediaItem };

export default function HomePage() {
  const location = useLocation();
  const addons = useAddonStore(s => s.addons);
  const { rows, heroItems, loading } = useHomeCatalogs(addons);
  const homePreferences = useHomePreferences();

  const typeFilter = new URLSearchParams(location.search).get("type");
  const visibleRows = useMemo(
    () => applyHomeCatalogPreferences(rows, homePreferences),
    [homePreferences, rows],
  );

  const filteredRows = useMemo(
    () => typeFilter ? visibleRows.filter(row => row.type === typeFilter) : visibleRows,
    [typeFilter, visibleRows],
  );
  const streamingProviderGroups = useMemo(
    () => buildStreamingProviderGroups(filteredRows),
    [filteredRows],
  );
  const orientedHeroItems = useMemo(
    () => {
      const oriented = applyContentOrientationToItems(heroItems, homePreferences.contentOrientation);
      if (homePreferences.contentOrientation === "both") return oriented;
      const preferred = oriented.filter(item => matchesContentOrientation(item.type, homePreferences.contentOrientation));
      return preferred.length ? preferred : oriented;
    },
    [heroItems, homePreferences.contentOrientation],
  );

  if (loading) return <Skeleton />;

  return (
    <div className="home-page-scale relative flex min-h-full flex-col bg-black">
      {!typeFilter && <HomeHero items={orientedHeroItems} />}
      <div className="relative flex min-h-full flex-col bg-[#1f1f1f]">
        {!typeFilter && <ContinueWatchingRow />}
        {filteredRows.length ? (
          filteredRows.map((row, i) => {
            const providerGroup = streamingProviderGroups.find(group => group.anchorIndex === i);
            if (providerGroup) {
              return (
                <StreamingProviderRowsGroup
                  key={`${providerGroup.provider.id}-series-movies`}
                  provider={providerGroup.provider}
                  seriesRow={providerGroup.seriesRow}
                  moviesRow={providerGroup.moviesRow}
                  posterLayout={homePreferences.posterLayout}
                />
              );
            }
            if (streamingProviderGroups.some(group => group.hiddenIndex === i)) return null;
            return <CatalogRow key={`${row.addonId}-${row.catalogId}-${i}`} row={row} posterLayout={homePreferences.posterLayout} />;
          })
        ) : (
          <Empty typeFilter={typeFilter} />
        )}
      </div>
    </div>
  );
}

interface StreamingProviderGroup {
  provider: StreamingProviderTheme;
  seriesRow: CatalogRowData;
  moviesRow: CatalogRowData;
  anchorIndex: number;
  hiddenIndex: number;
}

function buildStreamingProviderGroups(rows: CatalogRowData[]): StreamingProviderGroup[] {
  const indexedRows = rows.map((row, index) => ({ row, index }));
  return STREAMING_PROVIDERS.flatMap(provider => {
    const providerRows = indexedRows.filter(({ row }) => matchesStreamingProvider(row, provider));
    const series = providerRows.find(({ row }) => row.type === "series" || row.type === "tv");
    const movies = providerRows.find(({ row }) => row.type === "movie");
    if (!series || !movies) return [];
    return [{
      provider,
      seriesRow: series.row,
      moviesRow: movies.row,
      anchorIndex: Math.min(series.index, movies.index),
      hiddenIndex: Math.max(series.index, movies.index),
    }];
  });
}

function matchesStreamingProvider(row: CatalogRowData, provider: StreamingProviderTheme) {
  const identity = normalizeProviderIdentity(`${row.catalogId} ${row.name}`);
  return provider.matchers.some(matcher => identity.includes(normalizeProviderIdentity(matcher)));
}

function normalizeProviderIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

function HomeHero({ items }: { items: MediaItem[] }) {
  const [heroIndex, setHeroIndex] = useState(0);
  const { frameMs } = useRefreshRate();

  useEffect(() => {
    if (!items.length) {
      setHeroIndex(0);
      return;
    }
    setHeroIndex(Math.floor(Math.random() * items.length));
  }, [items]);

  useEffect(() => {
    if (items.length < 2) return;
    const delay = Math.round(frameMs * Math.max(1, Math.round(6500 / frameMs)));
    const timer = window.setInterval(() => {
      setHeroIndex(index => {
        const next = Math.floor(Math.random() * items.length);
        return items.length > 1 && next === index ? (next + 1) % items.length : next;
      });
    }, delay);
    return () => window.clearInterval(timer);
  }, [frameMs, items.length]);

  const hero = items[heroIndex % Math.max(1, items.length)];
  if (!hero) return null;

  return <HeroSection item={hero} items={items} activeIndex={heroIndex} onSelect={setHeroIndex} />;
}

function Skeleton() {
  return (
    <div className="gsap-pulse">
      <div className="w-full skeleton" style={{ height: "74vh" }} />
      <div className="flex flex-col gap-8 px-10 py-8">
        {[0, 1, 2].map(i => (
          <div key={i}>
            <div className="h-4 w-40 skeleton rounded mb-4" />
            <div className="flex gap-3">
              {[0, 1, 2, 3, 4].map(j => <div key={j} className="skeleton rounded-card shrink-0" style={{ width: 300, height: 170 }} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
