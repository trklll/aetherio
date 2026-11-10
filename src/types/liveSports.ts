import type { MediaStream } from "./stream.ts";

export type LiveEventStatus = "live" | "upcoming" | "ended";

/** Maximum schedule-only grace period for an event whose provider has not updated its status. */
export const SCHEDULED_LIVE_WINDOW_MS = 5 * 60 * 60_000;

/** A fixture with a confirmed future kickoff cannot be live, whatever a provider flag says. */
export function resolveLiveEventStatus(status: LiveEventStatus, startsAt?: string, now = Date.now()): LiveEventStatus {
  if (status === "ended") return status;
  const start = Date.parse(startsAt ?? "");
  if (!Number.isFinite(start)) return status;
  if (start > now) return "upcoming";
  if (status === "upcoming" && now - start <= SCHEDULED_LIVE_WINDOW_MS) return "live";
  return status;
}

export type LiveSport =
  | "futbol"
  | "baloncesto"
  | "tenis"
  | "boxeo"
  | "mma"
  | "formula1"
  | "motogp"
  | "ciclismo"
  | "golf"
  | "rugby"
  | "hockey"
  | "beisbol"
  | "nfl"
  | "nba"
  | "nhl"
  | "otro";

/**
 * Una fuente jugable de directo. `url` puede ser HLS (`.m3u8`), DASH (`.mpd`)
 * o un mp4 progressive. mpv y Media3 resuelven los tres de forma nativa, asi
 * que el reproductor no necesita ningun componente nuevo para esto.
 */
export interface LiveSource {
  id: string;
  label: string;
  url: string;
  /** "1080p", "720p", "auto"... solo informativo. */
  quality?: string;
  language?: string;
  /** Stable provider identity, independent of its display label. */
  providerId?: string;
  /** Cabeceras HTTP necesarias (Referer/Origin/User-Agent) para que el host no corte. */
  headers?: Record<string, string>;
  referrer?: string;
  userAgent?: string;
  isDefault?: boolean;
  /** Provenance stays distinct from the addon's display name. */
  origin?: "iptv";
  channelName?: string;
  verifiedAt?: number;
  /** A match association expires when its XMLTV programme ends. */
  validUntil?: string;
}

export interface LiveChannelProgramme {
  channelId: string;
  title: string;
  subtitle?: string;
  description?: string;
  categories: string[];
  startsAt: string;
  endsAt: string;
  live: boolean;
  repeat: boolean;
}

export interface LiveTeam {
  id?: string;
  name: string;
  shortName?: string;
  logo?: string;
  color?: string;
  score?: number;
}

export interface LiveEvent {
  id: string;
  title: string;
  subtitle?: string;
  sport: LiveSport | string;
  league: string;
  /**
   * Otras cadenas que PODRIAN ser la competicion, en orden de confianza.
   *
   * Muchos addons no dan la competicion en un campo limpio: la esconden en el
   * segundo genero, en la descripcion o en el `category`. Como el proveedor no
   * sabe que competiciones existen en el catalogo, no decide: las ofrece aqui y
   * es `resolveCompetitionId` quien las valida. Si la liga es generica y un
   * candidato identifica el genero, se prefiere el candidato mas especifico.
   */
  leagueCandidates?: string[];
  /** Agrupa filas cuando la league no basta (p. ej. varios partidos del mismo dia). */
  category?: string;
  status: LiveEventStatus;
  /** ISO 8601. En eventos "live" se usa para el minuto de juego. */
  startsAt: string;
  /** Providers that publish a real kickoff can opt out of the legacy clock heuristic. */
  startsAtPrecision?: "exact" | "day" | "synthesized" | "unknown";
  home?: LiveTeam;
  away?: LiveTeam;
  venue?: string;
  round?: string;
  /** Fondo 16:9 para la tarjeta. */
  poster?: string;
  /** Logo de la competicion. */
  logo?: string;
  /** Minuto de juego cuando la fuente lo informa. */
  minute?: number;
  period?: string;
  sources: LiveSource[];
  isFeatured?: boolean;
}

/** Canal lineal siempre en vivo (tipo FAST o canal abierto). */
export interface LiveChannel {
  id: string;
  name: string;
  category: string;
  logo?: string;
  poster?: string;
  /**
   * Que emite realmente el canal. Necesario porque casi todos los free-to-air
   * en español son generalistas que solo dan fútbol en ventanas concretas: sin
   * esto la tarjeta promete un canal deportivo y no lo es.
   */
  note?: string;
  sources: LiveSource[];
  tvgId?: string;
  tvgName?: string;
  language?: string;
  country?: string;
  sports?: string[];
  currentProgramme?: LiveChannelProgramme;
  nextProgramme?: LiveChannelProgramme;
}

export interface LiveSnapshot {
  events: LiveEvent[];
  /** All discovered event candidates, including scheduled fixtures with no resolved source yet. */
  scheduledEvents?: LiveEvent[];
  /**
   * Agenda de lo que viene, sin `sources`: todavia no hay stream que abrir. Se
   * ordena por hora de inicio y se pinta en la zona horaria del cliente.
   */
  upcoming: LiveEvent[];
  channels: LiveChannel[];
  /** Epoch ms de la ultima respuesta correcta. */
  fetchedAt: number;
  /** Imported IPTV data may not be reused by another local profile. */
  iptvProfileKey?: string;
}

export interface LiveSportsConfig {
  /** Proveedores activos, en orden de prioridad. */
  enabledProviders: string[];
  /** Segundos entre refrescos del listado. */
  refreshSeconds: number;
  /** Ocultar eventos ya terminados. */
  hideEnded: boolean;
  /** One-time activation of the native FMHY providers; explicit disables survive reloads. */
  nativeProvidersVersion?: number;
  iptvProvidersVersion?: number;
  sportsStreamsProvidersVersion?: number;
  cncVerseTvIptvProvidersVersion?: number;
}

/**
 * Partidos en directo y canales IPTV deportivos verificados.
 *
 * `canales-fta` queda registrado pero fuera de los defaults a proposito: son
 * canales generalistas siempre activos (La 1, Teledeporte, ETB...), no una fuente
 * de canales deportivos. CNCVerse TV se registra por separado y solo entrega sus
 * canales del catalogo IPTV de deportes.
 */
export const DEFAULT_LIVE_SPORTS_CONFIG: LiveSportsConfig = {
  enabledProviders: ["sports-streams", "nuvio-sports", "stremverse", "fmhy-native", "local", "iptv-sports", "cncverse-tv-iptv"],
  refreshSeconds: 60,
  hideEnded: true,
  nativeProvidersVersion: 1,
  iptvProvidersVersion: 1,
  sportsStreamsProvidersVersion: 1,
  cncVerseTvIptvProvidersVersion: 1,
};

/**
 * Un directo se representa como un `MediaStream` normal con
 * `behaviorHints.live = true`. Asi el reproductor reutiliza la tuberia completa
 * (orden de fuentes, seleccion de pista/audio, subtitulos, party, controles) y
 * solo hay que diferenciar el modo live en los puntos que asumen VOD.
 *
 * `behaviorHints` se construye como lista blanca: solo se copia lo que se decide
 * aqui. Es deliberado — si se reenviasen los `behaviorHints` del addon, su
 * `notWebReady: true` (que significa "un navegador no puede reproducir esto")
 * llegaria al reproductor y `playableMedia.ts` rechazaria la fuente, dejando el
 * evento sin una sola alternativa en la lista.
 */
export function liveSourceToMediaStream(event: LiveEvent, source: LiveSource): MediaStream {
  const headers: Record<string, unknown> = { ...(source.headers ?? {}) };
  if (source.referrer && !headers.Referer) headers.Referer = source.referrer;
  if (source.userAgent && !headers["User-Agent"]) headers["User-Agent"] = source.userAgent;

  return {
    id: source.id,
    addonId: source.origin === "iptv" ? "iptv-sports" : source.providerId === "sports-streams" ? "community.sports.fly" : `live:${event.id}`,
    addonName: source.origin === "iptv" ? "IPTV" : source.providerId === "sports-streams" ? "Sports Streams · Highfly" : source.label,
    name: source.label,
    title: source.origin === "iptv" ? source.label : event.title,
    description: [event.league, event.venue].filter(Boolean).join(" · "),
    url: source.url,
    behaviorHints: {
      live: true,
      liveEventId: event.id,
      liveStatus: event.status,
      liveLeague: event.league,
      liveSport: event.sport,
      sourceType: source.origin === "iptv" ? "iptv" : "addon",
      ...(source.providerId ? { sourceProviderId: source.providerId } : {}),
      ...(source.channelName ? { channelName: source.channelName } : {}),
      ...(source.validUntil ? { liveSourceExpiresAt: source.validUntil } : {}),
      quality: source.quality ?? "",
      language: source.language ?? "",
      ...(Object.keys(headers).length ? { headers } : {}),
    },
  };
}

export function liveEventToMediaStreams(event: LiveEvent): MediaStream[] {
  return event.sources.map(source => liveSourceToMediaStream(event, source));
}

export function isLiveMediaStream(stream: MediaStream | null | undefined): boolean {
  return stream?.behaviorHints?.live === true;
}

/** Etiqueta compacta del estado, para la tarjeta. */
export function liveStatusLabel(event: LiveEvent, now = Date.now()): string {
  if (event.status === "live") return "En directo";
  if (event.status === "ended") return "Finalizado";
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) return "Proximo";
  const diff = start - now;
  if (diff <= 0) return "En directo";
  if (diff < 3_600_000) return `En ${Math.max(1, Math.round(diff / 60_000))} min`;
  if (diff < 86_400_000) return `En ${Math.round(diff / 3_600_000)} h`;
  return new Date(start).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function liveEventSortKey(event: LiveEvent): number {
  if (event.status === "live") return event.isFeatured ? 0 : 1;
  if (event.status === "upcoming") {
    const start = Date.parse(event.startsAt);
    return Number.isFinite(start) ? 2 + start / 1e13 : 9;
  }
  return 10;
}

/** Compara "Barca - Real" con "barça - real madrid" sin depender de acentos. */
export function normalizeLiveTeamKey(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
