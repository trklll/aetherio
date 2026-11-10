import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { resolveInsignia } from "../../data/sports/insignia";
import { getSportsPreferencesStorageKey, useSportsPreferences } from "../../data/sports/preferences";
import { mergeCanonicalEvents, resolveEvents } from "../../data/sports/identity";
import { useLiveEvents } from "../../hooks/useLiveEvents";
import { formatSportsTime } from "../../utils/sportsTime";
import { LOCAL_PROFILES_CHANGED_EVENT } from "../../utils/localProfiles";
import { GAMEPAD_ACTION_EVENT, type GamepadActionDetail } from "../../hooks/useGamepad";
import ShellDetailPreview from "../../components/layout/ShellDetailPreview";
import { isShellPreviewOpen, type ShellPreviewRequest } from "../../utils/shellPreview";
import { matchDetailFromFixtures, saveMatchPreview, sportsMatchPath, sportsMatchTitle, type SportsMatchDetail } from "./matchDetail";
import SportsMatchSurface from "./SportsMatchSurface";
import { buildFollowedFixtures, FOLLOWED_OVERVIEW_RETRY_MS, FOLLOWED_OVERVIEW_TIMEOUT_MS, groupFollowedFixtures, loadFollowedOverviews, type FixtureGroup, type FixtureSide, type FollowedFixture, type MatchPeriod } from "./followedFixtures";
import "./SportsMyTeamsPage.css";

const PERIODS = [{ id: "yesterday", label: "Ayer" }, { id: "today", label: "Hoy" }, { id: "upcoming", label: "Próximos" }] as const;

function Side({ side, followed, sport }: { side: FixtureSide; followed: boolean; sport: FollowedFixture["sport"] }) {
  const insignia = resolveInsignia({ entityId: side.entityId, name: side.name, explicitCrest: side.crest, size: 64, sport });
  const [failed, setFailed] = useState(false);
  const content = <>
    <span className="my-teams__crest" aria-hidden="true">{insignia.src && !failed
      ? <img src={insignia.src} alt="" width={64} height={64} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <span>{insignia.initials}</span>}</span>
    <span className="my-teams__team-label">
      <span className="my-teams__team-name">{side.name}</span>
      {followed && <Star className="my-teams__star" size={16} fill="currentColor" aria-label="Equipo que sigues" />}
    </span>
  </>;
  return <div className="my-teams__side">
    <span className="my-teams__team">{content}</span>
    {side.record && <span className="my-teams__record" title="Ganados - empatados - perdidos">{side.record}</span>}
  </div>;
}

function MatchGroup({ group, followed, onOpen }: { group: FixtureGroup; followed: ReadonlySet<string>; onOpen: (match: FollowedFixture, element: HTMLButtonElement, group: FixtureGroup) => void }) {
  return <section className="my-teams__date-group" aria-label={group.label}>
    <h2 className="my-teams__date">{group.label}</h2>
    <table className="my-teams__table" aria-label={`Partidos del ${group.label}`}>
      <thead className="my-teams__sr"><tr><th scope="col">Local</th><th scope="col">Competición y partido</th><th scope="col">Visitante</th></tr></thead>
      <tbody>{group.matches.map(match => <tr key={match.id}><td colSpan={3}>
        <button type="button" className="my-teams__fixture" aria-label={sportsMatchTitle(match)} data-match-id={match.id} onClick={event => onOpen(match, event.currentTarget, group)}>
        <Side side={match.home} sport={match.sport} followed={!!match.home.entityId && followed.has(match.home.entityId)} />
        <span className="my-teams__match">
          {match.competition && <span className="my-teams__competition">{match.competition}</span>}
          <strong>{match.cancelled ? "Cancelado" : match.score ?? (match.completed ? "—" : match.timeValid ? formatSportsTime(match.date) : "Por confirmar")}</strong>
          <span className="my-teams__match-status">{match.live ? "En directo" : match.completed ? "Finalizado" : match.cancelled ? "" : !match.timeValid ? "Horario" : "Hora de Perú"}</span>
        </span>
        <Side side={match.away} sport={match.sport} followed={!!match.away.entityId && followed.has(match.away.entityId)} />
        </button>
      </td></tr>)}</tbody>
    </table>
  </section>;
}

export default function SportsMyTeamsPage() {
  const navigate = useNavigate();
  const prefs = useSportsPreferences();
  const profileKey = getSportsPreferencesStorageKey();
  const idsKey = JSON.stringify([...new Set([...prefs.followedClubs, ...prefs.followedNationalTeams])]);
  const ids = useMemo<string[]>(() => JSON.parse(idsKey), [idsKey]);
  const followed = useMemo(() => new Set(ids), [ids]);
  const [period, setPeriod] = useState<MatchPeriod>("today");
  const [preview, setPreview] = useState<{ profileKey: string; request: ShellPreviewRequest; details: SportsMatchDetail[] }>();
  const [now, setNow] = useState(Date.now);
  const [dateLimit, setDateLimit] = useState(14);
  const retryStartedAt = useRef(Date.now());
  const selectedTab = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const agenda = useQuery({ queryKey: ["sports-followed-fixtures", profileKey, idsKey], enabled: ids.length > 0,
    queryFn: ({ signal }) => loadFollowedOverviews(ids, signal), staleTime: 60_000,
    refetchInterval: query => query.state.data?.failed.length && Date.now() - retryStartedAt.current < FOLLOWED_OVERVIEW_TIMEOUT_MS
      ? FOLLOWED_OVERVIEW_RETRY_MS : false, retry: false });
  const { liveEvents, upcomingGroups, loading: liveLoading } = useLiveEvents(ids.length > 0);
  const events = useMemo(() => mergeCanonicalEvents([...resolveEvents(liveEvents, "live"), ...resolveEvents(upcomingGroups.flatMap(group => group.events), "agenda")]), [liveEvents, upcomingGroups]);
  const matches = useMemo(() => buildFollowedFixtures(agenda.data?.entries ?? [], events, ids), [agenda.data, events, ids]);
  const groups = groupFollowedFixtures(matches, period, now);
  const loading = ids.length > 0 && (agenda.isPending || liveLoading);

  useEffect(() => {
    retryStartedAt.current = Date.now();
  }, [profileKey, idsKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const closePreview = () => setPreview(undefined);
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, closePreview);
    return () => window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, closePreview);
  }, []);
  useEffect(() => {
    const onGamepadAction = (event: Event) => {
      if (isShellPreviewOpen()) return;
      const action = (event as CustomEvent<GamepadActionDetail>).detail;
      if (action.id !== "lb" && action.id !== "rb") return;
      event.preventDefault();
      event.stopPropagation();
      setPeriod(current => {
        const index = PERIODS.findIndex(tab => tab.id === current);
        const delta = action.id === "rb" ? 1 : -1;
        const next = (index + delta + PERIODS.length) % PERIODS.length;
        requestAnimationFrame(() => document.getElementById(`my-teams-tab-${PERIODS[next].id}`)?.focus({ preventScroll: true }));
        return PERIODS[next].id;
      });
      setDateLimit(14);
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, []);
  useEffect(() => {
    pageRef.current?.closest("[data-aetherio-scroll-shell]")?.scrollTo({ top: 0, behavior: "instant" });
    const timer = window.setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body || document.activeElement.closest(".bp-rail")) selectedTab.current?.focus({ preventScroll: true });
    }, 220);
    return () => window.clearTimeout(timer);
  }, []);

  const openMatch = (match: FollowedFixture, element: HTMLButtonElement, group: FixtureGroup) => {
    const details = group.matches.map(fixture => matchDetailFromFixtures([fixture], agenda.data?.entries ?? [], fixture.id)!).filter(Boolean);
    saveMatchPreview(profileKey, details);
    const items = group.matches.map(fixture => ({ detailPath: sportsMatchPath(fixture.id), title: sportsMatchTitle(fixture),
      cardElement: fixture.id === match.id ? element : pageRef.current?.querySelector<HTMLButtonElement>(`[data-match-id="${CSS.escape(fixture.id)}"]`) ?? null }));
    const initialIndex = group.matches.findIndex(fixture => fixture.id === match.id);
    setPreview({ profileKey, details, request: { ...items[initialIndex], items, initialIndex } });
  };

  return <main ref={pageRef} className="my-teams" aria-label="Mis equipos" data-sports-my-teams>
    <header className="my-teams__header">
      <h1>Mis equipos</h1>
    </header>
    <section className="my-teams__panel liquid-glass" aria-label="Enfrentamientos de tus equipos">
      <div className="my-teams__tabs" role="tablist" aria-label="Fecha de los partidos" data-spatial-grid data-spatial-navigation="local" onKeyDown={event => {
        const index = PERIODS.findIndex(tab => tab.id === period);
        const next = event.key === "ArrowRight" ? (index + 1) % PERIODS.length : event.key === "ArrowLeft" ? (index + PERIODS.length - 1) % PERIODS.length
          : event.key === "Home" ? 0 : event.key === "End" ? PERIODS.length - 1 : undefined;
        if (next !== undefined) {
          event.preventDefault(); event.stopPropagation();
          setPeriod(PERIODS[next].id); setDateLimit(14);
          event.currentTarget.querySelector<HTMLButtonElement>(`#my-teams-tab-${PERIODS[next].id}`)?.focus({ preventScroll: true });
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const target = event.key === "ArrowUp" ? null : pageRef.current?.querySelector<HTMLButtonElement>("#my-teams-matches button");
          if (target) { event.preventDefault(); event.stopPropagation(); target.focus(); }
        }
      }}>
        {PERIODS.map(tab => <button key={tab.id} ref={period === tab.id ? selectedTab : undefined} id={`my-teams-tab-${tab.id}`} type="button" role="tab"
          tabIndex={period === tab.id ? 0 : -1} aria-selected={period === tab.id} aria-controls="my-teams-matches" onClick={() => { setPeriod(tab.id); setDateLimit(14); }}>{tab.label}</button>)}
      </div>
      <div id="my-teams-matches" role="tabpanel" aria-labelledby={`my-teams-tab-${period}`} aria-busy={loading}>
        {ids.length === 0 ? <div className="my-teams__empty" role="status"><h2>Aún no sigues equipos</h2><p>Elige tus equipos para ver aquí sus enfrentamientos.</p></div>
          : <>
            {groups.slice(0, dateLimit).map(group => <MatchGroup key={`${profileKey}:${group.key}`} group={group} followed={followed} onOpen={openMatch} />)}
            {!groups.length && <div className="my-teams__empty" role="status"><h2>{loading || agenda.data?.failed.length ? "Cargando enfrentamientos…" : period === "yesterday" ? "Ningún evento ayer" : period === "today" ? "Ningún evento hoy" : "Sin próximos eventos publicados"}</h2></div>}
            {groups.length > dateLimit && <button className="my-teams__more" type="button" onClick={() => setDateLimit(value => value + 14)}>Mostrar más fechas</button>}
          </>}
      </div>
    </section>
    {!!agenda.data?.unsupported.length && <p className="my-teams__note">Agenda ampliada no disponible para: {agenda.data.unsupported.join(", ")}. Se muestran los eventos publicados en Deportes.</p>}
    {preview?.profileKey === profileKey && <ShellDetailPreview request={preview.request} onClose={() => setPreview(undefined)}
      onNavigate={path => { setPreview(undefined); navigate(path); }} renderBackdrop={(entry, animated, backingWidth, backingHeight) => {
        const detail = preview.details.find(detail => sportsMatchPath(detail.match.id) === entry.detailPath);
        return detail ? <SportsMatchSurface detail={detail} followed={followed} animated={animated} backdropOnly
          stableBackingWidth={animated ? backingWidth : undefined} stableBackingHeight={animated ? backingHeight : undefined} /> : null;
      }} />}
  </main>;
}
