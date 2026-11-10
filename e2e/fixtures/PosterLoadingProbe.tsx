import { createRoot } from "react-dom/client";
import { useRef } from "react";
import SpatialPosterImage from "../../src/components/SpatialPosterImage";
import { useNearViewport } from "../../src/hooks/useNearViewport";
import { useSpatialPoster } from "../../src/hooks/useSpatialPoster";
import { DEFAULT_SPATIAL_POSTER_SETTINGS, saveSpatialPosterSettings } from "../../src/config/spatialPosters";

function PosterCard({ id }: { id: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useNearViewport(ref);
  const poster = useSpatialPoster(`tmdb:${id}`, "movie", `/__poster-probe/base-${id}.svg`, false, undefined, undefined, active);
  return <div ref={ref} style={{ width: 217, height: 326 }}>
    {active && <SpatialPosterImage src={poster.url} loading="lazy" alt={`Spatial ${id}`} width={217} height={326} />}
  </div>;
}

export function mountPosterLoadingProbe() {
  saveSpatialPosterSettings({ ...DEFAULT_SPATIAL_POSTER_SETTINGS, enabled: true, instanceUrl: location.origin });
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  createRoot(container).render(<div data-poster-probe style={{ position: "fixed", inset: 0, overflow: "auto", background: "#151515" }}>
    <SpatialPosterImage src="/__poster-probe/direct.svg" alt="Direct" width={217} height={326} />
    <PosterCard id={101} />
    <div style={{ height: 6000 }} />
    <PosterCard id={102} />
    <SpatialPosterImage src="/__poster-probe/lazy.svg" loading="lazy" alt="Lazy" width={217} height={326} />
    <SpatialPosterImage src="/api/poster/movie/103" loading="lazy" alt="Lazy Spatial" width={217} height={326} />
  </div>);
}
