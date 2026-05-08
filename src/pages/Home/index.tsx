import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import CatalogRow from "./CatalogRow";
import ContinueWatchingRow from "./ContinueWatchingRow";
import HeroSection from "./HeroSection";

export type { CatalogRowData, MediaItem };

export default function HomePage() {
  const [heroIndex, setHeroIndex] = useState(0);
  const location = useLocation();
  const addons = useAddonStore(s => s.addons);
  const { rows, heroItems, loading } = useHomeCatalogs(addons);

  const typeFilter = new URLSearchParams(location.search).get("type");

  useEffect(() => {
    setHeroIndex(0);
  }, [heroItems]);

  useEffect(() => {
    if (heroItems.length < 2) return;
    const timer = window.setInterval(() => setHeroIndex(index => (index + 1) % heroItems.length), 6500);
    return () => window.clearInterval(timer);
  }, [heroItems.length]);

  const filteredRows = typeFilter
    ? rows.filter(row => row.type === typeFilter)
    : rows;

  if (loading) return <Skeleton />;

  const hero = heroItems[heroIndex % Math.max(1, heroItems.length)];

  return (
    <div className="relative flex min-h-full flex-col bg-black">
      {hero && !typeFilter && (
        <HeroSection item={hero} items={heroItems} activeIndex={heroIndex} onSelect={setHeroIndex} />
      )}
      <div className="relative flex min-h-full flex-col bg-[#1f1f1f]">
        {!typeFilter && <ContinueWatchingRow />}
        {filteredRows.length ? (
          filteredRows.map((row, i) => (
            <CatalogRow key={`${row.addonId}-${row.catalogId}-${i}`} row={row} />
          ))
        ) : (
          <Empty typeFilter={typeFilter} />
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse">
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
        Instala un addon compatible para ver catalogos aqui.
      </p>
    </div>
  );
}
