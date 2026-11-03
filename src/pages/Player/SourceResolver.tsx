import { useEffect, useMemo, useRef } from "react";
import { useStreams } from "../../hooks/useStreams.ts";
import { useScrapedStreams } from "../../hooks/useScrapedStreams.ts";
import type { MediaStream, StreamQuery } from "../../types/stream";
import { isPlayableMediaStream } from "../../utils/playableMedia.ts";
import { sortStreamsForPlayback } from "../../utils/streamPlaybackRanking.ts";
import { readCachedLiveSnapshot } from "../../services/liveSportsService.ts";
import { attachIptvSources, iptvChannelEvent } from "../../services/iptvSports.ts";
import { liveEventToMediaStreams } from "../../types/liveSports.ts";

interface SourceResolverProps {
  query: StreamQuery;
  searchName: string;
  currentStream?: MediaStream;
  onResolved: (streams: MediaStream[]) => void;
}

/**
 * Resuelve las fuentes alternativas del medio actual bajo demanda.
 *
 * Antes el panel de "Fuentes" dependia de una instantanea de `sessionStorage`
 * que solo escribia la pagina de Episodio al pulsar reproducir. Si se entraba al
 * reproductor por otro camino (medio local, un trailer, Party) o la instantanea
 * era de otro titulo, el panel no aparecia aunque la reproduccion funcionara.
 *
 * Este componente solo se monta al abrir el panel y sin lista previa, asi que no
 * cuesta nada en el arranque: `useStreams` y `useScrapedStreams` ya cachean sus
 * resultados, de modo que normalmente responde de inmediato.
 */
export default function SourceResolver(props: SourceResolverProps) {
  // Live identities are not VOD IDs: never ask movie scrapers for a match/channel.
  return props.query.type === "live" ? <LiveSourcesResolver {...props} /> : <VodSourcesResolver {...props} />;
}

function LiveSourcesResolver({ query, currentStream, onResolved }: SourceResolverProps) {
  const resolve = useRef(onResolved);
  resolve.current = onResolved;
  useEffect(() => {
    const snapshot = readCachedLiveSnapshot();
    const event = snapshot?.events.find(event => event.id === query.id)
      ?? snapshot?.channels.map(iptvChannelEvent).find(channel => channel.id === query.id);
    const sources = event ? liveEventToMediaStreams(attachIptvSources([event], snapshot?.channels ?? [])[0]) : [];
    const expiry = currentStream?.behaviorHints?.liveSourceExpiresAt;
    if (currentStream && !(typeof expiry === "string" && Date.parse(expiry) <= Date.now()) && !sources.some(source => source.id === currentStream.id)) sources.push(currentStream);
    resolve.current(sources);
  }, [query.id, currentStream]);
  return null;
}

function VodSourcesResolver({ query, searchName, onResolved }: SourceResolverProps) {
  const { streams, loading } = useStreams(query);
  const { streams: scrapedStreams, loading: scrapedLoading } = useScrapedStreams(query, searchName);
  const doneRef = useRef(false);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  const merged = useMemo(
    () => sortStreamsForPlayback([...streams, ...scrapedStreams].filter(isPlayableMediaStream)),
    [streams, scrapedStreams],
  );

  useEffect(() => {
    if (doneRef.current) return;
    // `useScrapedStreams` arranca con loading=false antes de empezar a raspar:
    // entregar en ese frame fijaria la lista a medio construir y no volveria a
    // actualizarse. Se espera a que ambos hayan terminado.
    if (loading || scrapedLoading) return;
    if (!merged.length && (streams.length || scrapedStreams.length)) return;
    doneRef.current = true;
    onResolvedRef.current(merged);
  }, [loading, scrapedLoading, merged, streams.length, scrapedStreams.length]);

  return null;
}
