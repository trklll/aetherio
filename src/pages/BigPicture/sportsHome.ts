import { eventMatchesPreferences } from "../../data/sports/board.ts";
import { SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog.ts";
import { mergeCanonicalEvents } from "../../data/sports/identity.ts";
import { hasAnyFollow } from "../../data/sports/preferences.ts";
import type { CanonicalEvent, SportsPreferences } from "../../data/sports/types.ts";
import type { CatalogRowData, MediaItem } from "../../types/ui.ts";
import { formatSportsSchedule } from "../../utils/sportsTime.ts";
import { sportsFallbackArtwork } from "../../data/sports/artwork.ts";
import { buildSportsMatchArtworkForEvent } from "../../utils/sportsMatchCards.ts";
import { resolveLiveEventStatus } from "../../types/liveSports.ts";

function sportsMediaItem(event: CanonicalEvent): MediaItem {
  const competition = SPORTS_ENTITY_BY_ID.get(event.competitionId ?? event.organizationId ?? "")?.name;
  const schedule = event.startsAt && event.timePrecision === "exact" ? formatSportsSchedule(event.startsAt) : undefined;
  const fallback = sportsFallbackArtwork(event);
  return {
    id: event.id,
    type: "live",
    name: event.title,
    poster: event.poster || fallback,
    background: event.poster || fallback,
    originalPoster: fallback,
    sportsMatch: buildSportsMatchArtworkForEvent(event),
    // An addon's logo is usually the broadcaster, not the event's title art.
    genres: [event.status === "live" ? "En directo" : "Próximamente", ...(competition ? [competition] : [])],
    runtime: schedule,
    description: event.status === "live"
      ? `${competition ? `${competition}. ` : ""}${event.sources.length
        ? `${event.sources.length} ${event.sources.length === 1 ? "fuente disponible" : "fuentes disponibles"} para ver este evento en directo.`
        : "Partido programado para ahora. Entra para consultar las fuentes disponibles."}`
      : `${competition ? `${competition}. ` : ""}${event.sources.length
        ? `${event.sources.length} ${event.sources.length === 1 ? "fuente disponible" : "fuentes disponibles"} para este evento.`
        : "La emisión estará disponible cuando el proveedor publique una fuente."}`,
  };
}

/**
 * ¿La home filtra por lo elegido? Dos capas, cada una solo cuando el usuario
 * aportó algo en el asistente: los deportes elegidos acotan qué disciplinas
 * entran, y lo seguido (competición, club, selección, organización o
 * peleador) acota dentro de ellas. Quien saltó el asistente y no eligió
 * nada ve todos los eventos: no se inventa una personalización que no
 * existe, como el resto del tablero.
 */
export function hasSportsPersonalizationFilters(prefs: SportsPreferences): boolean {
  return prefs.sports.length > 0 || hasAnyFollow(prefs);
}

function eventInPersonalization(event: CanonicalEvent, prefs: SportsPreferences): boolean {
  if (prefs.sports.length && !prefs.sports.includes(event.sport)) return false;
  if (hasAnyFollow(prefs) && !eventMatchesPreferences(event, prefs)) return false;
  return true;
}

/** The home uses the same media contract as Home, without fictional VOD metadata. */
export function buildSportsHome(events: readonly CanonicalEvent[], prefs: SportsPreferences, now = Date.now()) {
  const visible = mergeCanonicalEvents(events.filter(event => event.status !== "ended"), now).map(event => {
    const status = resolveLiveEventStatus(event.status, event.startsAt, now);
    return status === event.status ? event : { ...event, status };
  });
  // Big Picture match cards require two actual opponents. Competition-only
  // provider rows (e.g. "Premier League" with no fixture) are not events and
  // must never become a fake single-team card labeled only "Fútbol".
  const isMatch = (event: CanonicalEvent) => event.sport !== "futbol" || Boolean(event.home?.name && event.away?.name);
  const live = visible.filter(event => event.status === "live" && isMatch(event) && eventInPersonalization(event, prefs))
    .sort((a, b) => (Date.parse(a.startsAt ?? "") || Infinity) - (Date.parse(b.startsAt ?? "") || Infinity));
  const upcoming = visible
    .filter(event => event.status === "upcoming" && isMatch(event) && (!event.startsAt || Date.parse(event.startsAt) > now) && eventInPersonalization(event, prefs))
    .sort((a, b) => (Date.parse(a.startsAt ?? "") || Infinity) - (Date.parse(b.startsAt ?? "") || Infinity));
  const rows: CatalogRowData[] = [];
  const append = (catalogId: string, name: string, items: CanonicalEvent[]) => {
    if (!items.length) return;
    rows.push({ addonId: "aetherio-sports", addonName: "Sports", catalogId, type: "live", name, items: items.map(sportsMediaItem) });
  };
  append("sports-now", "Ahora mismo", live);
  append("sports-upcoming", "Próximamente", upcoming);
  return {
    rows,
    heroItems: [...live, ...upcoming].map(sportsMediaItem),
    eventsById: new Map(visible.map(event => [event.id, event])),
  };
}
