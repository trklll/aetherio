import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSportsPreferences } from "../../data/sports/preferences.ts";
import { getLiveSportsConfig } from "../../services/liveSportsService.ts";
import { sportsReplayPlanSignature } from "../../services/sportsReplayCollections.ts";
import { fetchSportsReplayPlanPage, getSportsReplaysBaseUrl, primeSportsReplayPlayback, resolveSportsReplayStreams } from "../../services/sportsReplaysService.ts";
import type { CatalogRowData, MediaItem } from "../../types/ui.ts";
import { buildPlayerPath } from "../../utils/bigPictureDetail.ts";
import CatalogRow from "../Home/CatalogRow.tsx";
import SportsMatchCard from "./SportsMatchCard.tsx";
import { withSampledSportsMatchColors, type SampledSportsMatchColors } from "../../utils/sportsMatchCards.ts";

/** Independent query/cache: archive discovery never holds up live events. */
export default function SportsReplaysRow({ onFocusItem, onTeamColorSample }: {
  onFocusItem?: (item: MediaItem) => void;
  onTeamColorSample?: (itemId: string, side: "home" | "away", color: string) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const prefs = useSportsPreferences();
  const query = useInfiniteQuery({
    // La firma del plan va en la clave: al cambiar lo elegido (deportes o
    // seguidos) la fila se reconstruye de raiz en lugar de re-filtrar a medias.
    queryKey: ["sports-replays", getSportsReplaysBaseUrl(), sportsReplayPlanSignature(prefs)],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchSportsReplayPlanPage(pageParam, signal),
    getNextPageParam: page => page.nextPage ?? undefined,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchInterval: state => state.state.data?.pages[0]?.pending ? 5000 : getLiveSportsConfig().refreshSeconds * 1000,
  });
  const items = useMemo(() => [...new Map(query.data?.pages.flatMap(page => page.items).map(item => [item.id, item])).values()], [query.data]);
  const row = useMemo<CatalogRowData>(() => ({
    addonId: "nuvio-sports", addonName: "Sports", catalogId: "sports-replays", type: "sports-replay", name: "Repeticiones", items,
  }), [items]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const openingRef = useRef(false);
  const generationRef = useRef(0);
  const sampledColorsRef = useRef(new Map<string, SampledSportsMatchColors>());
  useEffect(() => () => { generationRef.current++; }, []);

  const recordTeamColorSample = useCallback((itemId: string, side: "home" | "away", color: string) => {
    const previous = sampledColorsRef.current.get(itemId) ?? {};
    if (previous[side] !== color) sampledColorsRef.current.set(itemId, { ...previous, [side]: color });
    onTeamColorSample?.(itemId, side, color);
  }, [onTeamColorSample]);

  const play = useCallback(async (item: MediaItem) => {
    if (openingRef.current) return;
    const replay = items.find(candidate => candidate.id === item.id);
    if (!replay) return;
    const generation = generationRef.current;
    openingRef.current = true;
    setResolving(replay.name);
    setPlaybackError(null);
    try {
      const streams = replay.streams?.length ? replay.streams : await resolveSportsReplayStreams(replay);
      if (generation !== generationRef.current) return;
      primeSportsReplayPlayback({
        ...replay,
        sportsMatch: withSampledSportsMatchColors(replay.sportsMatch, sampledColorsRef.current.get(replay.id)),
      }, streams);
      navigate(buildPlayerPath(`type=sports-replay&id=${encodeURIComponent(replay.id)}`, location.pathname));
    } catch (cause) {
      if (generation === generationRef.current) setPlaybackError(cause instanceof Error ? cause.message : "No se pudo abrir esta repetición.");
    } finally {
      openingRef.current = false;
      if (generation === generationRef.current) setResolving(null);
    }
  }, [items, location.pathname, navigate]);

  const pending = query.isPending || Boolean(query.data?.pages[0]?.pending);
  const error = playbackError || query.error?.message;
  return (
    <section className="bp-sports-home__replays" aria-labelledby="sports-replays-title" aria-busy={query.isFetching || Boolean(resolving)}>
      <h2 id="sports-replays-title" className="bp-sports-home__replays-title home-row-title">Repeticiones</h2>
      {items.length > 0 && (
        <CatalogRow row={row} posterLayout="horizontal" itemGap={26} hideHeader persistHomeScroll={false} disableHeaderNavigation showViewMore={false} onOpenItem={play} onFocusItem={onFocusItem}
          renderCard={item => <SportsMatchCard item={item} onOpenItem={play} onTeamColorSample={recordTeamColorSample} />} />
      )}
      {pending && <p className="bp-sports-home__status" role="status">Cargando repeticiones…</p>}
      {!pending && !query.error && items.length === 0 && <p className="bp-sports-home__status" role="status">No hay repeticiones con fuentes disponibles ahora mismo.</p>}
      {resolving && <p className="bp-sports-home__status" role="status">Buscando fuentes para {resolving}…</p>}
      {error && <p className="bp-sports-home__status" role="alert">{error}</p>}
      <div className="bp-sports-home__replays-tools" data-spatial-grid>
        {items.length > 0 && <p aria-live="polite">{items.length} repeticiones cargadas</p>}
        {(query.hasNextPage || query.error) && (
          <button type="button" className="bp-sports__cta bp-sports__cta--ghost" disabled={query.isFetching}
            aria-label={query.error ? "Reintentar carga de repeticiones" : "Cargar más repeticiones"}
            onClick={() => {
              if (query.error) {
                void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch());
                return;
              }
              void query.fetchNextPage();
            }}>
            {query.isFetchingNextPage ? "Cargando…" : query.error ? "Reintentar" : "Cargar más"}
          </button>
        )}
        <button type="button" className="bp-sports__cta bp-sports__cta--ghost" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>Actualizar repeticiones</button>
      </div>
    </section>
  );
}
