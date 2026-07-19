import { useEffect, useMemo, useState } from "react";
import { BookMarked, Compass, Film, Tv } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { applyHomeCatalogPreferences, useHomePreferences } from "../../config/homePreferences";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import {
  CONTINUE_WATCHING_EVENT,
  readPlaybackStateEntries,
  type ContinueWatchingEntry,
} from "../../utils/continueWatching";
import CatalogRow from "../Home/CatalogRow";
import ContinueWatchingRow from "../Home/ContinueWatchingRow";

type LibraryTab = "library" | "discover";

export default function LibraryPage() {
  const addons = useAddonStore(state => state.addons);
  const homePreferences = useHomePreferences();
  const { rows, loading } = useHomeCatalogs(addons);
  const [tab, setTab] = useState<LibraryTab>("library");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion(value => value + 1);
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const libraryRows = useMemo(() => buildLibraryRows(readPlaybackStateEntries()), [version]);
  const discoverRows = useMemo(
    () => applyHomeCatalogPreferences(rows, homePreferences),
    [homePreferences, rows],
  );

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
          <LibrarySummary entriesVersion={version} />
          <ContinueWatchingRow />
          {libraryRows.length ? (
            libraryRows.map(row => (
              <CatalogRow key={`${row.type}-${row.catalogId}`} row={row} posterLayout={homePreferences.posterLayout} />
            ))
          ) : (
            <EmptyLibrary />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-9">
          {loading ? (
            <DiscoverSkeleton />
          ) : discoverRows.length ? (
            discoverRows.map((row, index) => (
              <CatalogRow key={`${row.addonId}-${row.catalogId}-${index}`} row={row} posterLayout={homePreferences.posterLayout} />
            ))
          ) : (
            <EmptyDiscover />
          )}
        </div>
      )}
    </PageContainer>
  );
}

function TabButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
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

function LibrarySummary({ entriesVersion }: { entriesVersion: number }) {
  const stats = useMemo(() => {
    const entries = readPlaybackStateEntries();
    const completed = entries.filter(entry => entry.completed);
    const mediaKeys = new Set(completed.map(entry => entry.mediaKey));
    const movies = new Set(completed.filter(entry => entry.type === "movie").map(entry => entry.mediaKey));
    const shows = new Set(completed.filter(entry => entry.type !== "movie").map(entry => entry.mediaKey));
    return {
      total: mediaKeys.size,
      movies: movies.size,
      shows: shows.size,
    };
  }, [entriesVersion]);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Metric icon={<BookMarked size={18} />} label="Guardados por actividad" value={stats.total} />
      <Metric icon={<Film size={18} />} label="Peliculas vistas" value={stats.movies} />
      <Metric icon={<Tv size={18} />} label="Series vistas" value={stats.shows} />
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

function buildLibraryRows(entries: ContinueWatchingEntry[]): CatalogRowData[] {
  const completed = entries
    .filter(entry => entry.completed)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const movies = uniqueMediaItems(completed.filter(entry => entry.type === "movie"));
  const shows = uniqueMediaItems(completed.filter(entry => entry.type !== "movie"));
  return [
    movies.length ? buildRow("library-movies", "movie", "Peliculas vistas", movies) : null,
    shows.length ? buildRow("library-series", "series", "Series vistas", shows) : null,
  ].filter((row): row is CatalogRowData => row !== null);
}

function uniqueMediaItems(entries: ContinueWatchingEntry[]) {
  const byMedia = new Map<string, MediaItem>();
  for (const entry of entries) {
    if (byMedia.has(entry.mediaKey)) continue;
    byMedia.set(entry.mediaKey, {
      id: entry.id,
      type: entry.type,
      name: entry.name,
      poster: entry.poster,
      background: entry.background ?? entry.episodeStill,
      logo: entry.logo,
    });
  }
  return Array.from(byMedia.values()).slice(0, 24);
}

function buildRow(catalogId: string, type: string, name: string, items: MediaItem[]): CatalogRowData {
  return {
    addonId: "aetherio-library",
    addonName: "Aetherio",
    catalogId,
    type,
    name,
    items,
  };
}

function EmptyLibrary() {
  return (
    <div className="liquid-glass mx-12 rounded-2xl px-6 py-10 text-center text-white/54">
      <p className="text-lg font-black text-white">Tu biblioteca se llenara automaticamente.</p>
      <p className="mt-2 text-sm">Reproduce o marca contenido como visto para verlo aqui.</p>
    </div>
  );
}

function EmptyDiscover() {
  return (
    <div className="liquid-glass mx-12 rounded-2xl px-6 py-10 text-center text-white/54">
      <p className="text-lg font-black text-white">No hay catalogos para descubrir.</p>
      <p className="mt-2 text-sm">Instala o activa addons compatibles para poblar esta seccion.</p>
    </div>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="flex flex-col gap-8 px-12">
      {[0, 1, 2].map(row => (
        <div key={row}>
          <div className="skeleton mb-4 h-5 w-48 rounded" />
          <div className="flex gap-3">
            {[0, 1, 2, 3].map(card => <div key={card} className="skeleton h-[196px] w-[302px] shrink-0 rounded-xl" />)}
          </div>
        </div>
      ))}
    </div>
  );
}
