import { useEffect, useState, type CSSProperties, type SyntheticEvent } from "react";
import { Clock3, Play, Star } from "lucide-react";
import { resolveInsignia } from "../../data/sports/insignia";
import type { SportsMatchSide } from "../../types/sportsMatch";
import { buildSportsMatchArtwork } from "../../utils/sportsMatchCards";
import { sampleCrestImage } from "../../utils/crestColor";
import { formatSportsTime, SPORTS_TIME_ZONE } from "../../utils/sportsTime";
import type { FixtureSide, FollowedFixture } from "./followedFixtures";
import type { SportsMatchDetail } from "./matchDetail";
import { formatSportsMatchCountdown, sportsMatchTitle } from "./matchDetail";
import SportsFlag from "./SportsFlag";
import "./SportsMatchPage.css";

function MatchTeam({ side, artwork, followed, onColor }: { side: FixtureSide; artwork: SportsMatchSide; followed: boolean; onColor: (value: string) => void }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = [artwork.crest, artwork.fallbackCrest].find(value => value && !failed.includes(value));
  const sample = (event: SyntheticEvent<HTMLImageElement>) => {
    const sampled = sampleCrestImage(event.currentTarget);
    if (sampled) onColor(sampled.color);
  };
  return <div className="sports-match__team">
    <span className="sports-match__crest" aria-hidden="true">{source ? <img src={source} alt="" width={144} height={144} decoding="async" onLoad={sample} onError={() => setFailed(previous => [...previous, source])} /> : <span>{artwork.initials}</span>}</span>
    <div className="sports-match__team-name"><span>{side.name}</span>{followed && <Star size={16} fill="currentColor" aria-label="Equipo que sigues" />}</div>
    {side.record && <p className="sports-match__record" title="Ganados - empatados - perdidos">{side.record}</p>}
  </div>;
}

function CrestColorProbe({ artwork, onColor }: { artwork: SportsMatchSide; onColor: (value: string) => void }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = [artwork.crest, artwork.fallbackCrest].find(value => value && !failed.includes(value));
  if (!source) return null;
  return <img src={source} alt="" width={1} height={1} decoding="async" onLoad={event => {
    const sampled = sampleCrestImage(event.currentTarget);
    if (sampled) onColor(sampled.color);
  }} onError={() => setFailed(previous => [...previous, source])} />;
}

function StandingCrest({ id, name, match }: { id: string; name: string; match: FollowedFixture }) {
  const [failed, setFailed] = useState<string[]>([]);
  const side = [match.home, match.away].find(side => side.providerId === id);
  const insignia = resolveInsignia({ entityId: side?.entityId, name, explicitCrest: side?.crest, size: 64, sport: match.sport });
  const source = [insignia.src, `https://images.fotmob.com/image_resources/logo/teamlogo/${encodeURIComponent(id)}.png`].find(value => value && !failed.includes(value));
  return <span className="sports-match__standing-crest" aria-hidden="true">{source ? <img src={source} alt="" width={28} height={28} loading="lazy" onError={() => setFailed(previous => [...previous, source])} /> : insignia.initials}</span>;
}

export default function SportsMatchSurface({ detail, followed, animated = false, previewOnly = false, backdropOnly = false, showFlag = true, stableBackingWidth, stableBackingHeight, playable = false, showPlay = true, allowSourceSelection = false, onPlay }: {
  detail: SportsMatchDetail; followed: ReadonlySet<string>; animated?: boolean; previewOnly?: boolean; backdropOnly?: boolean; showFlag?: boolean; stableBackingWidth?: number; stableBackingHeight?: number; playable?: boolean; showPlay?: boolean; allowSourceSelection?: boolean; onPlay?: () => void;
}) {
  const { match, standings } = detail;
  const art = buildSportsMatchArtwork({ title: sportsMatchTitle(match), sport: match.sport, competitionName: match.competition, home: match.home, away: match.away });
  const [colors, setColors] = useState<{ home?: string; away?: string }>({});
  const setTeamColor = (side: "home" | "away", color: string) => setColors(previous => previous[side] === color ? previous : { ...previous, [side]: color });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const homeColor = colors.home ?? art.home!.color;
  const awayColor = colors.away ?? art.away!.color;
  const validDate = match.date && Number.isFinite(Date.parse(match.date));
  const date = validDate ? new Date(match.date!).toLocaleDateString("es-PE", { timeZone: SPORTS_TIME_ZONE, weekday: "long", day: "numeric", month: "long" }) : "Fecha por confirmar";
  const live = match.live || match.event?.status === "live";
  const ended = match.completed || match.event?.status === "ended";
  const countdown = live || ended || !match.timeValid ? undefined : formatSportsMatchCountdown(match.date, now);
  const kickoffPassed = !!validDate && Date.parse(match.date!) <= now && !live;
  const renderPlay = showPlay && !ended && (allowSourceSelection || !kickoffPassed);
  const playDisabled = !allowSourceSelection && (!playable || !!countdown);
  return <div className="sports-match__surface" style={{ "--match-home-color": homeColor, "--match-away-color": awayColor } as CSSProperties}>
    {showFlag && <SportsFlag home={homeColor} away={awayColor} animated={animated} stableBackingWidth={stableBackingWidth} stableBackingHeight={stableBackingHeight} />}
    {backdropOnly && <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
      <CrestColorProbe artwork={art.home!} onColor={color => setTeamColor("home", color)} />
      <CrestColorProbe artwork={art.away!} onColor={color => setTeamColor("away", color)} />
    </div>}
    {!backdropOnly && <div className="sports-match__content">
      <p className="sports-match__date">{date}</p>
      <header className="sports-match__hero">
        <h1 className="sports-match__competition">{match.competition ?? "Enfrentamiento"}</h1>
        <div className="sports-match__opponents">
          <MatchTeam key={`home:${match.id}`} side={match.home} artwork={art.home!} followed={followed.has(match.home.entityId ?? "")} onColor={color => setTeamColor("home", color)} />
          <div className="sports-match__score"><strong>{match.cancelled ? "Cancelado" : match.score ?? (match.completed ? "—" : match.timeValid ? formatSportsTime(match.date) : "Por confirmar")}</strong><span>{live ? "En directo" : match.completed ? "Finalizado" : match.cancelled ? "" : match.timeValid ? "Hora de Perú" : "Horario"}</span></div>
          <MatchTeam key={`away:${match.id}`} side={match.away} artwork={art.away!} followed={followed.has(match.away.entityId ?? "")} onColor={color => setTeamColor("away", color)} />
        </div>
        {renderPlay && <button className="sports-match__play liquid-glass" type="button" data-hero-primary aria-disabled={playDisabled} onClick={() => { if (!playDisabled) onPlay?.(); }} tabIndex={previewOnly ? -1 : undefined}>
          {!allowSourceSelection && countdown ? <Clock3 size={22} aria-hidden="true" /> : <Play size={24} fill="currentColor" aria-hidden="true" />}{allowSourceSelection ? "Ver partido" : countdown ?? "Ver partido"}
        </button>}
      </header>
      <section className="sports-match__odds liquid-glass" aria-labelledby={previewOnly ? undefined : "match-odds-title"}>
        <h2 id={previewOnly ? undefined : "match-odds-title"}>Cuotas de apuestas</h2><p>No disponibles por ahora</p>
      </section>
      {!previewOnly && <section className="sports-match__standings liquid-glass" aria-labelledby="match-standings-title">
        <h2 id={previewOnly ? undefined : "match-standings-title"}>Posiciones</h2>
        {standings?.rows.length ? <div className="sports-match__table-scroll" tabIndex={previewOnly ? -1 : 0} role="region" aria-label={`Clasificación de ${standings.name}`}>
          <table><thead><tr><th scope="col"><span className="sports-match__sr">Posición</span></th><th scope="col">Equipo</th>{["PJ", "G", "E", "P", "DG", "PTS"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{standings.rows.map((row, index) => {
              const participant = [match.home, match.away].find(side => side.providerId === row.id || side.name === row.name);
              return <tr key={row.id} className={participant ? "is-participant" : undefined}><td>{row.rank ?? index + 1}</td><th scope="row"><span className="sports-match__standing-name"><StandingCrest id={row.id} name={row.name} match={match} /><span>{row.name}</span>{participant?.entityId && followed.has(participant.entityId) && <Star size={13} fill="currentColor" aria-label="Equipo que sigues" />}</span></th>{[row.played, row.wins, row.draws, row.losses, row.difference, row.points].map((value, index) => <td key={index}>{value ?? "—"}</td>)}</tr>;
            })}</tbody></table>
        </div> : <p className="sports-match__no-table">No hay una clasificación publicada para este enfrentamiento.</p>}
      </section>}
    </div>}
  </div>;
}
