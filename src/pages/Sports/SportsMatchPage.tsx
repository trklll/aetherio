import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, LoaderCircle, Play, Radio, RotateCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { mergeCanonicalEvents, resolveEvents } from "../../data/sports/identity";
import { getSportsPreferencesStorageKey, useSportsPreferences } from "../../data/sports/preferences";
import { useLiveEvents } from "../../hooks/useLiveEvents";
import { primeLivePlaybackSession } from "../../services/liveSportsService";
import { sortLiveSources } from "../../services/liveSportsSourceRanking";
import { buildPlayerPath } from "../../utils/bigPictureDetail";
import { buildSportsMatchArtworkForEvent } from "../../utils/sportsMatchCards";
import type { LiveEvent, LiveSource } from "../../types/liveSports";
import { buildFollowedFixtures, loadFollowedOverviews } from "./followedFixtures";
import { matchDetailFromCanonicalEvent, matchDetailFromFixtures, readMatchPreview, sportsMatchPath, sportsMatchTitle } from "./matchDetail";
import type { SportsMatchDetail } from "./matchDetail";
import type { CanonicalEvent } from "../../data/sports/types";
import SportsMatchSurface from "./SportsMatchSurface";

function sourceProviderLabel(source: LiveSource) {
  if (source.origin === "iptv") return "IPTV";
  if (source.providerId === "sports-streams") return "Sports Streams · Highfly";
  return source.label;
}

function SportsMatchSourcePicker({ event, match, loading, refreshing, onBack, onRefresh, onSelect, sectionRef }: {
  event?: CanonicalEvent;
  match?: SportsMatchDetail["match"];
  loading: boolean;
  refreshing: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSelect: (event: LiveEvent, source: LiveSource) => void;
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const sources = sortLiveSources(event?.sources ?? [])
    .filter(source => !source.validUntil || Date.parse(source.validUntil) > Date.now());
  const title = match ? sportsMatchTitle(match) : event?.title ?? "Enfrentamiento";
  const competition = match?.competition ?? event?.raw.league;

  return <section ref={sectionRef} className="sports-match__source-page" aria-label="Elegir fuente para el partido" tabIndex={-1}>
    <button className="sports-match__sources-back" type="button" onClick={onBack}>
      <ArrowLeft size={19} aria-hidden="true" /> Volver al enfrentamiento
    </button>
    <header className="sports-match__sources-header">
      {competition && <p>{competition}</p>}
      <h1>{title}</h1>
      <span>Elige una fuente para ver el partido</span>
    </header>
    {sources.length ? <div className="sports-match__source-list" aria-label={`${sources.length} fuentes disponibles`}>
      {sources.map(source => <button key={source.id} type="button" className="sports-match__source-option"
        aria-label={`Seleccionar ${source.channelName || source.label}, ${sourceProviderLabel(source)}`}
        onClick={() => { if (event) onSelect(event.raw, source); }}>
        <span className="sports-match__source-icon"><Radio size={21} aria-hidden="true" /></span>
        <span className="sports-match__source-copy">
          <strong>{source.channelName || source.label}</strong>
          <small>{[sourceProviderLabel(source), source.quality, source.language].filter(Boolean).join(" · ")}</small>
        </span>
        <Play size={18} fill="currentColor" aria-hidden="true" />
      </button>)}
    </div> : <div className="sports-match__sources-empty" role="status">
      {loading || refreshing ? <><LoaderCircle size={20} className="sports-match__source-spinner" aria-hidden="true" /> Buscando fuentes disponibles…</>
        : <>Todavía no hay fuentes disponibles para este partido.</>}
      {!refreshing && <button type="button" onClick={onRefresh}><RotateCw size={16} aria-hidden="true" /> Actualizar fuentes</button>}
    </div>}
  </section>;
}

function EventOnlyMatch({ event, onPlay }: { event: CanonicalEvent; onPlay: () => void }) {
  return <section className="sports-match__event-only">
    <p className="sports-match__date">{event.raw.league}</p>
    <h1>{event.title}</h1>
    <p>{event.status === "live" ? "En directo" : event.startsAt ? new Date(event.startsAt).toLocaleString("es-PE", { dateStyle: "long", timeStyle: "short" }) : "Horario por confirmar"}</p>
    {event.status !== "ended" && <button className="sports-match__play liquid-glass" type="button" data-hero-primary onClick={onPlay}>
      <Play size={24} fill="currentColor" aria-hidden="true" /> Ver partido
    </button>}
  </section>;
}

export default function SportsMatchPage({ onShellPreviewLoading, onShellPreviewReady, shellActive = true, shellAnimated = false, shellExternalFlag = false }: {
  onShellPreviewLoading?: () => void; onShellPreviewReady?: () => void; shellActive?: boolean; shellAnimated?: boolean; shellExternalFlag?: boolean;
}) {
  const { matchId = "" } = useParams();
  const navigate = useNavigate();
  const prefs = useSportsPreferences();
  const profileKey = getSportsPreferencesStorageKey();
  const idsKey = JSON.stringify([...new Set([...prefs.followedClubs, ...prefs.followedNationalTeams])]);
  const ids = useMemo<string[]>(() => JSON.parse(idsKey), [idsKey]);
  const followed = useMemo(() => new Set(ids), [ids]);
  const seed = useMemo(() => readMatchPreview(profileKey, matchId), [profileKey, matchId]);
  const { events: scheduledEvents, upcomingGroups, loading, refreshing, refresh } = useLiveEvents(true);
  const events = useMemo(() => mergeCanonicalEvents([
    ...resolveEvents(scheduledEvents, "live"),
    ...resolveEvents(upcomingGroups.flatMap(group => group.events), "agenda"),
  ]), [scheduledEvents, upcomingGroups]);
  const event = events.find(candidate => candidate.id === matchId) ?? seed?.detail.match.event;
  const query = useQuery({ queryKey: ["sports-match-detail", profileKey, idsKey, matchId],
    initialData: seed?.detail, initialDataUpdatedAt: seed?.savedAt, staleTime: 60_000, refetchInterval: 60_000, retry: false,
    queryFn: async ({ signal }) => {
      const result = await loadFollowedOverviews(ids, signal);
      return matchDetailFromFixtures(buildFollowedFixtures(result.entries, events, ids), result.entries, matchId) ?? null;
    } });
  const baseDetail = query.data ?? seed?.detail;
  const liveDetail = event ? matchDetailFromCanonicalEvent(event) : undefined;
  const detail = liveDetail && baseDetail
    ? { ...baseDetail, match: { ...liveDetail.match, home: { ...liveDetail.match.home, record: baseDetail.match.home.record }, away: { ...liveDetail.match.away, record: baseDetail.match.away.record } } }
    : liveDetail ?? baseDetail;
  const [showSources, setShowSources] = useState(false);
  const sourcePickerRef = useRef<HTMLElement | null>(null);
  const selectedEvent = event ?? detail?.match.event;
  const match = detail?.match;
  const isLive = match?.live || selectedEvent?.status === "live";
  const kickoff = match?.date ? Date.parse(match.date) : Number.NaN;
  const isHistorical = !!match && (match.completed || selectedEvent?.status === "ended"
    || (Number.isFinite(kickoff) && kickoff < Date.now() && !isLive));
  const canShowSources = !!selectedEvent && !isHistorical && !match?.cancelled;

  useEffect(() => {
    setShowSources(false);
  }, [matchId]);
  useEffect(() => {
    if (query.isPending) onShellPreviewLoading?.(); else onShellPreviewReady?.();
  }, [query.isPending, onShellPreviewLoading, onShellPreviewReady]);
  useEffect(() => {
    if (!shellActive || query.isPending || onShellPreviewReady) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-hero-primary]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [shellActive, query.isPending, onShellPreviewReady]);
  useEffect(() => {
    if (!showSources) return;
    const frame = requestAnimationFrame(() => {
      sourcePickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      sourcePickerRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [showSources]);

  const openSources = () => {
    if (canShowSources) setShowSources(true);
  };
  const selectSource = (liveEvent: LiveEvent, source: LiveSource) => {
    primeLivePlaybackSession(liveEvent, source.id, event ? buildSportsMatchArtworkForEvent(event) : undefined);
    navigate(buildPlayerPath(`type=live&id=${encodeURIComponent(liveEvent.id)}`, sportsMatchPath(matchId)));
  };

  return <main className="sports-match" data-sports-match aria-label={detail ? sportsMatchTitle(detail.match) : event?.title ?? "Enfrentamiento"}
    style={shellExternalFlag ? { background: "transparent" } : undefined}>
    {detail ? <>
      {showSources ? <>
        <SportsMatchSurface key={`${profileKey}:${matchId}`} detail={detail} followed={followed} backdropOnly showFlag={!shellExternalFlag} />
        <SportsMatchSourcePicker event={selectedEvent} match={match} loading={loading} refreshing={refreshing}
          onBack={() => setShowSources(false)} onRefresh={refresh} onSelect={selectSource} sectionRef={sourcePickerRef} />
      </> : <SportsMatchSurface key={`${profileKey}:${matchId}`} detail={detail} followed={followed} animated={shellActive || shellAnimated}
        showFlag={!shellExternalFlag} playable={canShowSources} showPlay={!isHistorical} allowSourceSelection onPlay={openSources} />}
    </> : event ? <>
      {showSources ? <SportsMatchSourcePicker event={event} loading={loading} refreshing={refreshing}
        onBack={() => setShowSources(false)} onRefresh={refresh} onSelect={selectSource} sectionRef={sourcePickerRef} />
        : <EventOnlyMatch event={event} onPlay={openSources} />}
    </> : <div className="sports-match__state" role="status"><h1>{query.isPending || loading ? "Cargando enfrentamiento…" : query.isError ? "No se pudo cargar el enfrentamiento" : "Enfrentamiento no disponible"}</h1>
      {query.isError && <button type="button" onClick={() => { void query.refetch(); }}>Reintentar</button>}
      <button type="button" onClick={() => navigate("/big-picture/sports/teams")}>Volver a Mis equipos</button>
    </div>}
  </main>;
}
