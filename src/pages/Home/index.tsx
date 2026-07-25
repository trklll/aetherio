import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  applyHomeCatalogPreferences,
  useHomePreferences,
} from "../../config/homePreferences";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import { useAddonStore } from "../../store/addonStore";
import { getHomeScroll, saveHomeScroll, rowKey as makeRowKey } from "../../store/homeScrollStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { tmdbFetch } from "../../config/apiKeys";
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
  const homePreferences = useHomePreferences();
  const { rows, heroItems, loading } = useHomeCatalogs(addons, homePreferences.contentOrientation);
  const { gradient } = useProfileGradient();
  const restoredVerticalRef = useRef(false);

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient)
    }
    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg")
    }
  }, [gradient])

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

  useEffect(() => {
    if (!filteredRows.length) return;
    const streamingItems: MediaItem[] = [];
    for (const group of buildStreamingProviderGroups(filteredRows)) {
      for (const item of group.seriesRow.items) {
        if (!item.logo) streamingItems.push(item);
      }
      for (const item of group.moviesRow.items) {
        if (!item.logo) streamingItems.push(item);
      }
    }
    if (!streamingItems.length) return;
    let cancelled = false;
    async function enrich() {
      for (const item of streamingItems) {
        if (cancelled || item.logo) continue;
        try {
          const idPart = item.id.split(":")[0];
          let tmdbId: number | null = null;
          let tmdbType: "movie" | "tv" | null = null;
          if (item.type === "movie" || item.type === "series" || item.type === "tv") {
            tmdbType = item.type === "series" ? "tv" : item.type as "movie" | "tv";
          }
          if (idPart.startsWith("tmdb:")) {
            tmdbId = parseInt(idPart.slice(5), 10);
          } else if (idPart.startsWith("tt")) {
            const fd = await tmdbFetch<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(
              `/find/${encodeURIComponent(idPart)}`,
              { params: { external_source: "imdb_id", language: "es-ES" } },
            );
            if (fd?.movie_results?.length) { tmdbId = fd.movie_results[0].id; tmdbType = "movie"; }
            else if (fd?.tv_results?.length) { tmdbId = fd.tv_results[0].id; tmdbType = "tv"; }
          }
          if (!tmdbId || !tmdbType) continue;
          const images = await tmdbFetch<{ logos?: { iso_639_1?: string; file_path?: string }[] }>(
            `/${tmdbType}/${tmdbId}/images`,
            { params: { include_image_language: "es,en,null" } },
          );
          const logo = images?.logos?.find((l: any) => l?.iso_639_1 === "es" && typeof l?.file_path === "string")
            ?? images?.logos?.find((l: any) => l?.iso_639_1 === "en" && typeof l?.file_path === "string")
            ?? images?.logos?.find((l: any) => l?.iso_639_1 === null && typeof l?.file_path === "string")
            ?? images?.logos?.find((l: any) => typeof l?.file_path === "string");
          if (logo?.file_path) {
            item.logo = `https://image.tmdb.org/t/p/w342${logo.file_path}`;
          }
        } catch {}
      }
    }
    void enrich();
    return () => { cancelled = true; };
  }, [filteredRows]);

  if (loading) return <Skeleton />;

  return (
    <div className="home-page-scale relative flex min-h-full flex-col" style={{ marginTop: "calc(-1 * var(--app-shell-nav-height))", paddingTop: "var(--app-shell-nav-height)" }}>
      {!typeFilter && (
        <HomeHero items={heroItems} />
      )}
      <div className="relative flex min-h-full flex-col">
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
            const rKey = makeRowKey(row.addonId, row.catalogId, row.type);
            const saved = getHomeScroll();
            return <CatalogRow key={`${row.addonId}-${row.catalogId}-${i}`} row={row} posterLayout={homePreferences.posterLayout} restoreScrollLeft={saved?.rows?.[rKey]} />;
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

  return <HeroSection item={hero} items={items} activeIndex={heroIndex} onSelect={setHeroIndex} onOpenDetail={handleOpenDetail} onVideoEnd={handleVideoEnd} />;
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
