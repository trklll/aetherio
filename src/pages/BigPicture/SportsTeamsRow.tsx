import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SPORTS_CONTINENT_BY_ID, SPORTS_COUNTRY_BY_ID, SPORTS_ENTITY_BY_ID, sportsDisciplineLabel } from "../../data/sports/catalog.ts";
import { initialsOf, resolveInsignia } from "../../data/sports/insignia.ts";
import { getSportsPreferences, patchSportsPreferences, useSportsPreferences } from "../../data/sports/preferences.ts";
import type { CanonicalEvent, SportsEntity } from "../../data/sports/types.ts";
import type { CatalogRowData, MediaItem } from "../../types/ui.ts";
import { formatSportsSchedule } from "../../utils/sportsTime.ts";
import { LOCAL_PROFILES_CHANGED_EVENT } from "../../utils/localProfiles.ts";
import CatalogRow from "../Home/CatalogRow.tsx";
import SportsDialog from "./SportsDialog.tsx";
import { buildSportsCompetitions } from "./sportsCompetitions.ts";
import { buildSportsTeams, type SportsTeamCard } from "./sportsTeams.ts";
import "./SportsTeamsRow.css";

const ADD_TEAM_ITEM_ID = "aetherio-sports:add-followed-teams";
const ADD_COMPETITION_ITEM_ID = "aetherio-sports:add-followed-competitions";

function SportsEntityInsignia({ entity }: { entity: SportsEntity }) {
  const { src } = resolveInsignia({ entityId: entity.id, name: entity.name, size: 128 });
  const [failed, setFailed] = useState(false);
  return <span className="sports-team-card__crest" aria-hidden="true">
    {src && !failed ? <img src={src} alt="" width={128} height={128} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      : <span className="sports-team-card__initials">{initialsOf(entity.name)}</span>}
  </span>;
}

function teamSchedule(card: SportsTeamCard, loading: boolean): string {
  const event = card.events[0];
  if (!event) return loading ? "Consultando agenda…" : "Sin próximos partidos en la agenda";
  if (event.status === "live") return "En directo";
  return event.startsAt && event.timePrecision === "exact"
    ? `Próximo partido · ${formatSportsSchedule(event.startsAt)}` : "Próximo partido · Horario por confirmar";
}

const TEAM_OPTIONS = [...SPORTS_ENTITY_BY_ID.values()]
  .filter(entity => (entity.kind === "club" || entity.kind === "national-team") && entity.active !== false)
  .sort((a, b) => a.name.localeCompare(b.name, "es"));
const COMPETITION_OPTIONS = [...SPORTS_ENTITY_BY_ID.values()]
  .filter(entity => entity.kind === "competition" && entity.active !== false)
  .sort((a, b) => sportsDisciplineLabel(a.sport).localeCompare(sportsDisciplineLabel(b.sport), "es") || a.name.localeCompare(b.name, "es"));
const searchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
const competitionContext = (entity: SportsEntity) => [sportsDisciplineLabel(entity.sport),
  SPORTS_COUNTRY_BY_ID.get(entity.countryId ?? "")?.name ?? SPORTS_CONTINENT_BY_ID.get(entity.continentId ?? "")?.name].filter(Boolean).join(" · ");

function FollowedEntitySelection({ kind, onClose }: { kind: "teams" | "competitions"; onClose: () => void }) {
  const isCompetition = kind === "competitions";
  const title = isCompetition ? "Competiciones que sigues" : "Mis equipos";
  const label = isCompetition ? "competiciones" : "equipos";
  const optionsSource = isCompetition ? COMPETITION_OPTIONS : TEAM_OPTIONS;
  const [selected, setSelected] = useState(() => {
    const prefs = getSportsPreferences();
    const selectedIds = isCompetition ? prefs.followedCompetitions : [...prefs.followedClubs, ...prefs.followedNationalTeams];
    return new Set(selectedIds.filter(id => {
      const entityKind = SPORTS_ENTITY_BY_ID.get(id)?.kind;
      return isCompetition ? entityKind === "competition" : entityKind === "club" || entityKind === "national-team";
    }));
  });
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const options = useMemo(() => {
    const needle = searchText(query.trim());
    return optionsSource.filter(entity => (!selectedOnly || selected.has(entity.id))
      && (!needle || searchText([entity.name, ...(entity.aliases ?? []), sportsDisciplineLabel(entity.sport),
        SPORTS_COUNTRY_BY_ID.get(entity.countryId ?? "")?.name ?? "", SPORTS_CONTINENT_BY_ID.get(entity.continentId ?? "")?.name ?? ""].join(" ")).includes(needle)));
  }, [optionsSource, query, selected, selectedOnly]);
  const save = () => {
    if (isCompetition) patchSportsPreferences({ followedCompetitions: [...selected] });
    else patchSportsPreferences({
        followedClubs: [...selected].filter(id => SPORTS_ENTITY_BY_ID.get(id)?.kind === "club"),
        followedNationalTeams: [...selected].filter(id => SPORTS_ENTITY_BY_ID.get(id)?.kind === "national-team"),
      });
    onClose();
  };
  return <SportsDialog title={title} onClose={onClose}>
    <p className="sports-dialog__hint">{isCompetition ? "Elige las competiciones que quieres seguir." : "Elige los clubes y selecciones que quieres seguir."}</p>
    <div className="sports-teams-selection__toolbar">
      <label>Buscar {label}<input type="search" value={query} placeholder={isCompetition ? "Nombre, deporte o país" : "Nombre del equipo o país"} onChange={event => { setQuery(event.target.value); setLimit(60); }} /></label>
      <button type="button" className="sports-dialog__button" aria-pressed={selectedOnly} onClick={() => { setSelectedOnly(value => !value); setLimit(60); }}>Solo {isCompetition ? "seleccionadas" : "seleccionados"} ({selected.size})</button>
    </div>
    <div className="sports-teams-selection__options" data-spatial-grid>
      {options.slice(0, limit).map(entity => <button key={entity.id} type="button" className="sports-teams-selection__option"
        aria-label={isCompetition ? `${entity.name}, ${competitionContext(entity)}` : entity.name}
        aria-pressed={selected.has(entity.id)} onClick={() => setSelected(previous => {
        const next = new Set(previous);
        if (next.has(entity.id)) next.delete(entity.id); else next.add(entity.id);
        return next;
      })}>
        <SportsEntityInsignia entity={entity} />
        <span className="sports-teams-selection__copy"><strong>{entity.name}</strong><small>{isCompetition
          ? competitionContext(entity)
          : entity.kind === "national-team" ? "Selección" : SPORTS_COUNTRY_BY_ID.get(entity.countryId ?? "")?.name}</small></span>
        {selected.has(entity.id) ? <Check size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
      </button>)}
    </div>
    {!options.length && <p className="sports-dialog__hint" role="status">{selectedOnly ? `No hay ${label} seleccionados que coincidan.` : `No se encontraron ${label}. Prueba con otro nombre o país.`}</p>}
    {options.length > limit && <button type="button" className="sports-dialog__button" onClick={() => setLimit(value => value + 60)}>Mostrar más {label}</button>}
    <footer className="sports-teams-selection__actions" data-spatial-grid>
      <p role="status">{selected.size} {selected.size === 1 ? `${isCompetition ? "competición" : "equipo"} seleccionada` : isCompetition ? "competiciones seleccionadas" : "equipos seleccionados"}</p>
      <button type="button" className="sports-dialog__button" onClick={onClose}>Cancelar</button>
      <button type="button" className="sports-dialog__button sports-dialog__button--primary" onClick={save}>Guardar</button>
    </footer>
  </SportsDialog>;
}

export function TeamSelection({ onClose }: { onClose: () => void }) {
  return <FollowedEntitySelection kind="teams" onClose={onClose} />;
}

export default function SportsTeamsRow({ events, loading }: {
  events: readonly CanonicalEvent[];
  loading: boolean;
  onOpenEvent: (event: CanonicalEvent) => void;
}) {
  const navigate = useNavigate();
  const prefs = useSportsPreferences();
  const teams = useMemo(() => buildSportsTeams(events, prefs), [events, prefs]);
  const teamById = useMemo(() => new Map(teams.map(team => [team.entity.id, team])), [teams]);
  const row = useMemo<CatalogRowData>(() => ({
    addonId: "aetherio-sports",
    addonName: "Sports",
    catalogId: "my-teams",
    type: "sports-team",
    name: "Mis equipos",
    presentation: "cinematic",
    items: [
      ...teams.map(team => ({ id: team.entity.id, type: "sports-team", name: team.entity.name })),
      { id: ADD_TEAM_ITEM_ID, type: "sports-team", name: "Añadir" },
    ],
  }), [teams]);
  const [selecting, setSelecting] = useState(false);
  const renderTeamCard = useCallback((item: MediaItem) => {
    const card = teamById.get(item.id);
    const isAddCard = item.id === ADD_TEAM_ITEM_ID;
    if (!card && !isAddCard) return null;
    const title = card?.entity.name ?? "Añadir";
    const metadata = card ? teamSchedule(card, loading) : "Elige los equipos que sigues";
    const metadataId = `sports-team-description-${item.id}`;
    return <article className="sports-match-card sports-team-card">
      <button type="button" className="sports-match-card__frame sports-team-card__frame" data-row-card
        aria-label={card?.entity.name ?? "Añadir equipos"}
        aria-describedby={metadataId}
        onClick={() => card ? navigate(`/big-picture/sports/team/${encodeURIComponent(card.entity.id)}`) : setSelecting(true)}>
        <span className="liquid-glass rounded-xl sports-team-card__material" aria-hidden="true" />
        {card ? <SportsEntityInsignia entity={card.entity} /> : <Plus size={56} strokeWidth={1.5} aria-hidden="true" />}
      </button>
      <div className="sports-match-card__caption">
        <div className="sports-match-card__copy">
          <p className="sports-team-card__title">{title}</p>
          <p id={metadataId} className="sports-team-card__metadata">{metadata}</p>
        </div>
      </div>
    </article>;
  }, [loading, teamById, navigate]);
  // Never let an open editor save the previous profile's teams into a new one.
  useEffect(() => {
    const close = () => { setSelecting(false); };
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
    return () => window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
  }, []);

  return <>
    <section id="sports-followed-teams" className="sports-teams-row" role="region" aria-label="Mis equipos" data-row-count={row.items.length}>
      <CatalogRow row={row} posterLayout="horizontal" titleOverride="Equipos que sigues" itemGap={26} maxItems={row.items.length}
        persistHomeScroll={false} disableHeaderNavigation showViewMore={false} renderCard={renderTeamCard} />
    </section>
    {selecting && <TeamSelection onClose={() => setSelecting(false)} />}
  </>;
}

export function SportsCompetitionsRow() {
  const prefs = useSportsPreferences();
  const competitions = useMemo(() => buildSportsCompetitions(prefs), [prefs]);
  const competitionById = useMemo(() => new Map(competitions.map(card => [card.entity.id, card.entity])), [competitions]);
  const row = useMemo<CatalogRowData>(() => ({
    addonId: "aetherio-sports",
    addonName: "Sports",
    catalogId: "my-competitions",
    type: "sports-competition",
    name: "Competiciones que sigues",
    presentation: "cinematic",
    items: [
      ...competitions.map(({ entity }) => ({ id: entity.id, type: "sports-competition", name: entity.name })),
      { id: ADD_COMPETITION_ITEM_ID, type: "sports-competition", name: "Añadir" },
    ],
  }), [competitions]);
  const [selecting, setSelecting] = useState(false);
  const renderCompetitionCard = useCallback((item: MediaItem) => {
    const entity = competitionById.get(item.id);
    const isAddCard = item.id === ADD_COMPETITION_ITEM_ID;
    if (!entity && !isAddCard) return null;
    const title = entity?.name ?? "Añadir";
    const metadata = entity ? competitionContext(entity) : "Elige las competiciones que sigues";
    const metadataId = `sports-competition-description-${item.id}`;
    return <article className="sports-match-card sports-team-card">
      <button type="button" className="sports-match-card__frame sports-team-card__frame" data-row-card
        data-sports-competition-id={entity?.id}
        aria-label={entity ? `${entity.name}, competición seguida` : "Añadir competiciones"}
        aria-describedby={metadataId}
        onClick={() => setSelecting(true)}>
        <span className="liquid-glass rounded-xl sports-team-card__material" aria-hidden="true" />
        {entity ? <SportsEntityInsignia entity={entity} /> : <Plus size={56} strokeWidth={1.5} aria-hidden="true" />}
      </button>
      <div className="sports-match-card__caption">
        <div className="sports-match-card__copy">
          <p className="sports-team-card__title">{title}</p>
          <p id={metadataId} className="sports-team-card__metadata">{metadata}</p>
        </div>
      </div>
    </article>;
  }, [competitionById]);
  useEffect(() => {
    const close = () => { setSelecting(false); };
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
    return () => window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
  }, []);

  return <>
    <section id="sports-followed-competitions" className="sports-teams-row" role="region" aria-label="Competiciones que sigues" data-row-count={row.items.length}>
      <CatalogRow row={row} posterLayout="horizontal" titleOverride="Competiciones que sigues" itemGap={26} maxItems={row.items.length}
        persistHomeScroll={false} disableHeaderNavigation showViewMore={false} renderCard={renderCompetitionCard} />
    </section>
    {selecting && <FollowedEntitySelection kind="competitions" onClose={() => setSelecting(false)} />}
  </>;
}
