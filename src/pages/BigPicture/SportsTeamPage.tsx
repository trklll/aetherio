import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, UserRound } from "lucide-react";
import { SPORTS_COUNTRY_BY_ID, SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog";
import { resolveInsignia, initialsOf } from "../../data/sports/insignia";
import { TEAM_HONOURS } from "../../data/sports/teamHonours";
import { loadTeamOverview, type TeamOverview, type TeamPlayer, type TeamFixture } from "../../services/sportsTeamOverview";
import { LOCAL_PROFILES_CHANGED_EVENT } from "../../utils/localProfiles";
import { useLiveEvents } from "../../hooks/useLiveEvents";
import { resolveEvents, canonicalEventIsPlayable } from "../../data/sports/identity";
import { primeLivePlaybackSession } from "../../services/liveSportsService";
import { buildPlayerPath } from "../../utils/bigPictureDetail";
import "./SportsTeamPage.css";

const SECTIONS = ["Clasificación", "Alineación", "Plantilla", "Partidos", "Títulos"] as const;
type Section = typeof SECTIONS[number];
function dateLabel(value?: string, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Fecha por confirmar";
  return new Date(value).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}
function PlayerPhoto({ player }: { player: TeamPlayer }) {
  const [failed, setFailed] = useState(false);
  return <span className="team-page__photo">{player.photo && !failed ? <img src={player.photo} alt="" width={64} height={64} loading="lazy" onError={() => setFailed(true)} /> : <UserRound size={28} aria-hidden="true" />}</span>;
}
function Fixtures({ fixtures }: { fixtures: TeamFixture[] }) {
  return fixtures.length ? <ul className="team-page__fixtures">{fixtures.map(match => <li key={match.id}>
    <span>{dateLabel(match.date, match.timeValid)}<small>{match.completed ? "Finalizado" : match.live ? "En directo" : match.timeValid ? "Próximamente" : "Horario por confirmar"}</small></span>
    <strong>{match.home && match.away ? `${match.home} — ${match.away}` : match.name}</strong><b>{match.score ?? "—"}</b>
  </li>)}</ul> : <p className="team-page__empty">No hay partidos publicados para esta competición.</p>;
}

export default function SportsTeamPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const entity = SPORTS_ENTITY_BY_ID.get(teamId ?? "");
  const [data, setData] = useState<TeamOverview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState<Section>("Clasificación");
  const backRef = useRef<HTMLButtonElement>(null);
  const { liveEvents } = useLiveEvents(!!entity);
  const liveMatches = useMemo(() => resolveEvents(liveEvents, "live").filter(event => canonicalEventIsPlayable(event) && event.status === "live" && event.participants.some(participant => participant.entityId === entity?.id)), [liveEvents, entity]);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(false); setData(undefined);
    if (!entity) { setLoading(false); return; }
    void loadTeamOverview(entity).then(value => { if (current) setData(value); }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [entity, attempt]);
  useEffect(() => { setSection("Clasificación"); backRef.current?.focus({ preventScroll: true }); }, [teamId]);
  useEffect(() => {
    const close = () => navigate("/big-picture/sports", { replace: true });
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
    return () => window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
  }, [navigate]);
  if (!entity || !["club", "national-team"].includes(entity.kind)) return <main className="team-page"><button onClick={() => navigate("/big-picture/sports")}>Volver a Deportes</button><h1>Equipo no encontrado</h1></main>;
  const crest = resolveInsignia({ entityId: entity.id, name: entity.name, size: 128 }).src;
  const competition = SPORTS_ENTITY_BY_ID.get(entity.competitionId ?? "");
  const honours = TEAM_HONOURS[entity.id];
  const ownStanding = data?.standings.flatMap(group => group.rows).find(row => row.id === data.teamId);
  const upcoming = data?.fixtures.filter(match => !match.completed) ?? [];
  const results = data?.fixtures.filter(match => match.completed).reverse() ?? [];
  return <main className="team-page" aria-label={`Equipo ${entity.name}`}>
    <div className="team-page__tools" data-spatial-grid>
      <button ref={backRef} onClick={() => navigate("/big-picture/sports")}><ArrowLeft size={22} />Volver a Deportes</button>
      <button aria-label="Reintentar datos" disabled={loading} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={20} /><span>Reintentar datos</span></button>
    </div>
    <header className="team-page__header">
      <div className="team-page__crest">{crest ? <img key={crest} src={crest} alt="" width={128} height={128} onError={event => { event.currentTarget.hidden = true; }} /> : <span>{initialsOf(entity.name)}</span>}</div>
      <div><h1>{entity.name}</h1><p>{[SPORTS_COUNTRY_BY_ID.get(entity.countryId ?? "")?.name, competition?.name].filter(Boolean).join(" · ")}</p><p>{data?.season ?? "Información del equipo"}</p></div>
      {ownStanding && <dl className="team-page__record"><div><dt>Puesto</dt><dd>{ownStanding.rank ? `${ownStanding.rank}º` : "—"}</dd></div><div><dt>Puntos</dt><dd>{ownStanding.points ?? "—"}</dd></div><div><dt>Jugados</dt><dd>{ownStanding.played ?? "—"}</dd></div></dl>}
    </header>
    {!!liveMatches.length && <div className="team-page__live" data-spatial-grid>{liveMatches.map(event => <button key={event.id} onClick={() => { primeLivePlaybackSession(event.raw); navigate(buildPlayerPath(`type=live&id=${encodeURIComponent(event.raw.id)}`, "/big-picture/sports")); }}>Ver en directo · {event.title}</button>)}</div>}
    <nav className="team-page__nav" aria-label="Información del equipo" data-spatial-grid>{SECTIONS.map(name => <button key={name} aria-current={section === name ? "page" : undefined} onClick={() => setSection(name)}>{name}</button>)}</nav>
    <section className="team-page__content" aria-labelledby="team-section-title" aria-busy={loading}>
      <h2 id="team-section-title">{section}</h2>
      {loading && section !== "Títulos" ? <p className="team-page__empty" role="status">Consultando datos del equipo en ESPN…</p> : section === "Títulos" ? <>
        {honours ? <><p className="team-page__note">Primer equipo masculino · Registro verificado el {dateLabel(honours.checkedAt)}. No se actualiza automáticamente.</p><div className="team-page__table-scroll" tabIndex={0} role="region" aria-label="Palmarés"><table><thead><tr><th>Competición</th><th>Títulos</th><th>Temporadas</th></tr></thead><tbody>{honours.competitions.map(trophy => <tr key={trophy.name}><th scope="row">{trophy.name}</th><td><strong>{trophy.count}</strong></td><td className="team-page__seasons">{trophy.seasons}</td></tr>)}</tbody></table></div><p className="team-page__note">Fuente: {honours.source}</p></> : <p className="team-page__empty">Palmarés pendiente de verificación para este equipo. ESPN no proporciona un historial de títulos; no se muestra un total sin una fuente comprobada.</p>}
      </> : error ? <p className="team-page__empty" role="alert">No pudimos conectar con ESPN. Comprueba la conexión y pulsa «Reintentar datos».</p> : !data?.supported ? <p className="team-page__empty">No hay cobertura verificada en ESPN para este equipo. Tus favoritos y las emisiones siguen disponibles.</p> : <>
        {!!data.unavailable.length && <p className="team-page__note" role="status">No se pudieron cargar: {data.unavailable.join(", ")}. Puedes reintentar sin salir del equipo.</p>}
        {section === "Clasificación" && (data.standings.length ? data.standings.map((group, index) => <div key={`${group.name}-${index}`} className="team-page__group"><h3>{group.name}</h3><p className="team-page__note">{group.season}</p><div className="team-page__table-scroll" tabIndex={0} role="region" aria-label={`Tabla ${group.name}`}><table><thead><tr>{["Pos.", "Equipo", "PJ", "G", "E", "P", "GF", "GC", "DG", "Pts"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{group.rows.map(row => <tr key={row.id} className={row.id === data.teamId ? "team-page__own" : undefined} aria-current={row.id === data.teamId ? "true" : undefined}><td>{row.rank ?? "—"}</td><th scope="row">{row.name}{row.id === data.teamId && <span className="team-page__sr"> · Tu equipo</span>}</th>{[row.played, row.wins, row.draws, row.losses, row.goalsFor, row.goalsAgainst, row.difference, row.points].map((value, i) => <td key={i}>{value ?? "—"}</td>)}</tr>)}</tbody></table></div></div>) : <p className="team-page__empty">La fuente no ha publicado una clasificación para esta competición.</p>)}
        {section === "Alineación" && (data.lineup ? <><p className="team-page__note">{data.lineup.match?.live ? "Alineación del partido en directo" : "Última alineación publicada"} · {dateLabel(data.lineup.match?.date)} · {data.lineup.match?.name}</p>{data.lineup.formation && <h3>Sistema {data.lineup.formation}</h3>}<ol className="team-page__players">{data.lineup.players.map(player => <li key={player.id}><PlayerPhoto player={data.squad.find(member => member.id === player.id) ?? player} /><span><strong>{player.name}</strong><small>Dorsal {player.jersey ?? "—"} · {player.position ?? "Posición no informada"}</small></span></li>)}</ol><p className="team-page__note">Esta alineación no confirma los titulares del próximo partido.</p></> : <p className="team-page__empty">No hay una alineación publicada para el último partido disponible.</p>)}
        {section === "Plantilla" && (data.squad.length ? <div className="team-page__table-scroll" tabIndex={0} role="region" aria-label="Plantilla del equipo"><table><thead><tr><th>Jugador</th><th>Dorsal</th><th>Posición</th><th>Edad</th><th>País</th><th>Goles</th></tr></thead><tbody>{data.squad.map(player => <tr key={player.id}><th scope="row"><span className="team-page__player-name"><PlayerPhoto player={player} />{player.name}</span></th><td>{player.jersey ?? "—"}</td><td>{player.position ?? "—"}</td><td>{player.age ?? "—"}</td><td>{player.country ?? "—"}</td><td>{player.goals ?? "—"}</td></tr>)}</tbody></table></div> : <p className="team-page__empty">No hay una plantilla publicada para esta temporada.</p>)}
        {section === "Partidos" && <><h3>Próximos partidos</h3><Fixtures fixtures={upcoming} /><h3>Resultados</h3><Fixtures fixtures={results} /></>}
      </>}
    </section>
    {data?.supported && <footer className="team-page__note">Datos: ESPN (API no oficial) · Consultados {dateLabel(new Date(data.fetchedAt).toISOString(), true)}. La cobertura depende del club y la competición.</footer>}
  </main>;
}
