import type { LiveEvent } from "../types/liveSports.ts";
import { cleanMetaName, type StremioMeta } from "../types/stremioSports.ts";

/**
 * CNCVerse Bridge: un add-on de Stremio que expone ~70 extensiones CloudStream
 * (Cloudstream) detras de un unico endpoint, mas 5 catalogos de deportes en
 * directo. Se integra como una fuente mas, activada por URL: el usuario pega
 * la URL de SU instancia en Ajustes y el add-on aparece aqui.
 *
 * El modulo no importa ni el store ni el registro de deportes para que ambos
 * puedan consumirlo sin ciclo de importacion.
 */

export const CNCVERSE_BRIDGE_ID = "com.cncverse.stremiobridge.aetherio";
export const CNCVERSE_BRIDGE_LOGO =
  "https://raw.githubusercontent.com/NivinCNC/CNCVerse-Bridge/refs/heads/main/logo.png";
export const CNCVERSE_BRIDGE_URL_KEY = "aetherio-cncverse-bridge-url";

/** Catalogos `tv` con eventos en directo. Todos comparten el mismo `base`. */
export const CNCVERSE_LIVE_CATALOGS = [
  "cnc_SKTechLiveEvents_tv",
  "cnc_SportzXLiveEvents_tv",
  "cnc_PlayFyLiveEvents_tv",
  "cnc_PlayZTVLiveEvents_tv",
  "cnc_StreamedSports_tv",
] as const;

const CNCVERSE_BRIDGE_ID_PREFIX = "cnc:";

/* ------------------------------------------------------------------ *
 * URL de la instancia
 * ------------------------------------------------------------------ */

/** Normaliza a `https://host/...` sin `/manifest.json` ni barra final. */
export function normalizeCncVerseBridgeUrl(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const candidate = raw.replace(/\/manifest\.json$/i, "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(candidate)) return "";
  try {
    // Rechaza lo que no sea una URL con host: evita que un texto suelto acabe
    // becomeindo un base que se concatenaria con `/stream/...`.
    const url = new URL(candidate);
    return url.host ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

export function readCncVerseBridgeUrl(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return normalizeCncVerseBridgeUrl(localStorage.getItem(CNCVERSE_BRIDGE_URL_KEY));
  } catch {
    return "";
  }
}

export function writeCncVerseBridgeUrl(value: string | null | undefined): string {
  const normalized = normalizeCncVerseBridgeUrl(value);
  if (typeof localStorage === "undefined") return normalized;
  try {
    if (normalized) localStorage.setItem(CNCVERSE_BRIDGE_URL_KEY, normalized);
    else localStorage.removeItem(CNCVERSE_BRIDGE_URL_KEY);
  } catch {
    // Sin localStorage la URL solo vive en memoria.
  }
  return normalized;
}

/* ------------------------------------------------------------------ *
 * Etiqueta de proveedor en streams de VOD
 * ------------------------------------------------------------------ */

/**
 * Duplicadas: la misma extension que Aetherio ya trae por otra via. Se
 * devuelve el nombre con el que Aetherio ya etiqueta esa fuente para que el
 * stream se sume al chip existente en vez de abrir uno nuevo. Medido sobre
 * Dune 2, el add-on propio de Aetherio gana 54 streams contra 16, responde en
 * ~360 ms contra ~640 ms y expone `Content-Length`; la variante del bridge
 * solo anade espejos alternativos de los MISMOS ficheros, asi que sirve de
 * reserva y no de fuente principal.
 */
const CNCVERSE_DUPLICATE_PROVIDERS: Record<string, string> = {
  hdhub4u: "HdHub",
  hdhub: "HdHub",
  fourkhdhub: "4KHDHub",
  "4khdhub": "4KHDHub",
  moviesdrive: "MoviesDrive",
  moviesmod: "MoviesMod",
  streamflix: "StreamFlix",
  streamflix20: "StreamFlix",
  allmovieland: "AllMovieLand",
  moviebox: "MovieBox",
  movieboxin: "MovieBox",
  castle: "Castle",
  castletv: "Castle",
  animeav1: "AnimeAV1",
  yts: "YTS",
  ytsmx: "YTS",
  cuevana: "Cuevana UBD",
};

/** Nombre legible cuando la etiqueta no es una duplicada. */
const CNCVERSE_PROVIDER_LABELS: Record<string, string> = {
  // Los tres que mas pesan en peliculas, medidos sobre Dune 2: Cinefreak 36,
  // Movies4u 25, MultiMovies 3. Ninguno esta en los repos de Aetherio.
  cinefreak: "Cinefreak",
  movies4u: "Movies4u",
  multimovies: "MultiMovies",
  movielinkbd: "MovieLinkBD",
  pelispedia: "Pelispedia",
  pikashow: "Pikashow",
  vegamovies: "VegaMovies",
  hindmoviez: "Hindmoviez",
  hdmovie2: "Hdmovie2",
  moviezwap: "Moviezwap",
  fibwatch: "FibWatch",
  kisskh: "Kisskh",
  goojara: "Goojara",
  banglaplex: "Banglaplex",
  pencurimovie: "Pencurimovie",
  pelisplus4k: "Pelisplus4K",
};

/** Etiquetas que no son un proveedor sino el extractor generico del bridge. */
const CNCVERSE_RESOLVER_KEYS = new Set(["cncverse", "cncversemobile", "cncversecloudstream"]);

/** Etiqueta neutra: cuando el stream no permite saber que extension lo resolvio. */
export const CNCVERSE_FALLBACK_LABEL = "CNC Verse";

/**
 * Nombres con los que Aetherio presenta las extensiones del bridge.
 *
 * El addon no publica un logo por extension (su `logo.png` es el del puente y
 * `logos.json` no existe), y los sitios no sirven favicon accesible: de trece
 * extensiones probadas solo tres devuelven uno y dos de esas son PNG de dos
 * bytes. En vez de rascar logos de terceros, los chips de estas fuentes usan el
 * logo del puente: no es el logo del sitio, pero si dice de donde viene el
 * stream, que es lo que hace falta para distinguirlos.
 */
const CNCVERSE_CANONICAL_LABELS = new Set([
  ...Object.values(CNCVERSE_PROVIDER_LABELS),
  ...Object.values(CNCVERSE_DUPLICATE_PROVIDERS),
  CNCVERSE_FALLBACK_LABEL,
]);

export function isCncVerseProviderLabel(label: string): boolean {
  return CNCVERSE_CANONICAL_LABELS.has(label.trim());
}

function providerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normaliza la etiqueta que el bridge pone en la segunda linea de `name`
 * ("VegaMovies - 480p", "PikashowProvider - 1080p") al nombre con el que
 * Aetherio presenta esa fuente.
 */
/** Quita el sufijo de clase de Cloudstream que el bridge anade a la etiqueta. */
function stripProviderSuffix(label: string): string {
  // Va en medio y no solo al final: "MovieBoxProviderIN" es MovieBox + IN.
  // Ninguno de los sitios se llama realmente "...Provider...", asi que quitarlo
  // en cualquier posicion es seguro y evita tener que listar cada variante.
  return label.replace(/provider/gi, "").trim();
}

export function normalizeCncVerseProviderLabel(rawLabel: string): string {
  const cleaned = stripProviderSuffix(rawLabel.replace(/\s*-\s*[^-\n]*$/, ""));
  const key = providerKey(cleaned);
  if (!key) return CNCVERSE_FALLBACK_LABEL;
  if (CNCVERSE_DUPLICATE_PROVIDERS[key]) return CNCVERSE_DUPLICATE_PROVIDERS[key];
  if (CNCVERSE_PROVIDER_LABELS[key]) return CNCVERSE_PROVIDER_LABELS[key];
  if (CNCVERSE_RESOLVER_KEYS.has(key)) return CNCVERSE_FALLBACK_LABEL;
  return cleaned;
}

/**
 * Extrae la etiqueta de proveedor del `name` de un stream del bridge.
 *
 * Devuelve `null` cuando la segunda linea no es un proveedor (el bridge
 * escribe a veces solo la calidad, p. ej. "360p (Hindi)"), para que esos
 * streams caigan en la etiqueta neutra en vez de crear un chip basura.
 */
export function parseCncVerseProviderLabel(streamName: string | null | undefined): string | null {
  if (!streamName) return null;
  const line = streamName.split("\n")[1]?.trim();
  if (!line) return null;
  const cleaned = stripProviderSuffix(line.replace(/\s*-\s*[^-\n]*$/, ""));
  if (!cleaned) return null;
  // Una calidad, un tamano o un nombre de fichero no son un proveedor.
  if (/\d{3,4}\s*p\b/i.test(cleaned)) return null;
  if (/\d+\s*(?:gb|mb|tb)\b/i.test(cleaned)) return null;
  if (!/^[A-Za-z][A-Za-z0-9 .+'&()-]{1,28}$/.test(cleaned)) return null;
  return normalizeCncVerseProviderLabel(cleaned);
}

/** Etiqueta de proveedor ya normalizada, con reserva para los casos sin dato. */
export function cncVerseProviderLabel(streamName: string | null | undefined): string {
  return parseCncVerseProviderLabel(streamName) ?? CNCVERSE_FALLBACK_LABEL;
}

/* ------------------------------------------------------------------ *
 * Metadatos de deportes
 * ------------------------------------------------------------------ */

export interface CncVerseFormat {
  title?: string;
  logo?: string;
}

export interface CncVerseTeam {
  name?: string;
}

export interface CncVerseEventInfo {
  teamA?: string;
  teamB?: string;
  teamAFlag?: string;
  teamBFlag?: string;
  eventCat?: string;
  /** Competicion ("One Day International"), NO el partido. */
  eventName?: string;
  eventLogo?: string;
  isHot?: string | number;
  eventType?: string | null;
  startTime?: string;
  endTime?: string;
}

/**
 * El bridge no tiene un unico esquema: cada catalogo serializa el evento a su
 * manera dentro del id. Measured en los cinco catalogos de directos:
 *
 * - SKTech / SportzX / PlayZTV: `{ eventId, title, eventInfo: { eventCat,
 *   eventName, startTime, endTime, isHot } }`. Aqui `title` es el partido
 *   ("India vs West Indies") y `eventInfo.eventName` la COMPETICION ("One Day
 *   International"): es facil leerlos al reves.
 * - PlayFy: sin `eventId`, con `channelId`, y el deporte en `category` en vez
 *   de `eventInfo.eventCat`.
 * - StreamedSports: sin `eventInfo` en absoluto. Usa `id` (slug), `date` en
 *   milisegundos, `category` y `teams.home/away`.
 *
 * Los tres se normalizan aqui al mismo `LiveEvent`.
 */
export interface CncVersePayload {
  eventId?: string | number;
  channelId?: string | number;
  id?: string;
  title?: string;
  category?: string;
  /** Epoch en ms (solo StreamedSports). */
  date?: number;
  popular?: boolean;
  teams?: { home?: CncVerseTeam; away?: CncVerseTeam };
  eventInfo?: CncVerseEventInfo;
  formats?: CncVerseFormat[];
  sources?: unknown[];
}

/**
 * Base64 a texto UTF-8, tolerante con el alfabeto "de URL".
 *
 * El bridge no siempre codifica en base64 estandar: parte de sus eventos
 * (64 de 283 medidos en los catalogos de directos) usan el alfabeto seguro para
 * URLs, con `-` y `_` en lugar de `+` y `/`. `atob` rechaza eso en silencio
 * devolviendo excepcion, y el evento se perdia entero. Se traduce al alfabeto
 * estandar y se repone el relleno antes de decodificar.
 */
function decodeBase64Utf8(value: string): string | null {
  try {
    const standard = value
      .replace(/[\s\r\n]+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/=+$/, "");
    const padding = (4 - (standard.length % 4)) % 4;
    const binary = atob(standard + "=".repeat(padding));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Cada meta del bridge lleva el evento entero en el id: `cnc:<base64>`. Lo que
 * sale de ahi NO es JSON puro, sino `"<nombre-del-catalogo>::<json>"` (por
 * ejemplo `"SportzXLiveEvents::{\"eventId\":50008,...}"`), asi que hay que quitar
 * ese prefijo antes de parsear. Decodificarlo da el nombre real del evento, el
 * deporte y las horas de inicio y fin, que el `name` visible
 * (`"🏏 IND vs WI"`) y `genres` (siempre vacio) no dan. Sin esto la pagina de
 * Deportes tendria que adivinarlos con regex.
 */
export function decodeCncVerseEventId(id: string | null | undefined): CncVersePayload | null {
  if (!id) return null;
  const raw = id.startsWith(CNCVERSE_BRIDGE_ID_PREFIX) ? id.slice(CNCVERSE_BRIDGE_ID_PREFIX.length) : id;
  if (!raw || raw.length < 8) return null;
  const decoded = decodeBase64Utf8(raw);
  if (!decoded) return null;
  // Se recorta hasta la primera llave: depende del nombre del catalogo, asi que
  // separarlos por "::" obligaria a conocer la lista de prefijos.
  const start = decoded.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(decoded.slice(start)) as CncVersePayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * El bridge escribe las horas como `"2026/09/30 08:30:00 +0000"`, con barras y
 * un espacio antes del desfase. Ni `Date.parse` ni un `replace` de espacios lo
 * aceptan de forma fiable, asi que se descompone y se rearma como ISO. Sin esto
 * el evento caia a "ahora mismo" y un partido acabado se pintaba como directo.
 */
export function parseCncVerseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|Z)?$/,
  );
  if (match) {
    const [, year, month, day, hour, minute, second = "00", offset] = match;
    const zone = !offset || offset === "Z"
      ? "Z"
      : offset.includes(":") ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
      + `T${hour.padStart(2, "0")}:${minute}:${second}${zone}`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const parsed = Date.parse(trimmed.replace(/\//g, "-"));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function splitVersus(value: string): [string, string] | null {
  const parts = value.split(/\s+(?:v\.?|vs\.?)\s+/i);
  if (parts.length < 2) return null;
  const home = parts[0]?.trim();
  const away = parts.slice(1).join(" ").trim();
  return home && away ? [home, away] : null;
}

/**
 * Deportes reales, en el nombre con el que los presenta Aetherio. El bridge
 * mete el genero del catalogo en `eventCat`, y ahi conviven deportes
 * ("Cricket", "Boxing", "MotoGP") con sus propias variantes de escritura.
 */
const CNCVERSE_SPORTS: Record<string, string> = {
  cricket: "Cricket",
  football: "Football",
  soccer: "Football",
  boxing: "Boxing",
  baseball: "Baseball",
  basketball: "Basketball",
  hockey: "Hockey",
  rugby: "Rugby",
  darts: "Darts",
  golf: "Golf",
  tennis: "Tennis",
  wrestling: "WWE",
  mma: "MMA",
  ufc: "UFC",
  fight: "Fight",
  other: "Other",
  // American football llega de tres formas distintas segun el catalogo.
  nfl: "American Football",
  "american football": "American Football",
  "american-football": "American Football",
  // Y el motorsport tambien: MotoGP es su propia disciplina y asi se presenta.
  motogp: "MotoGP",
  motorsport: "Motorsport",
  "motor sports": "Motorsport",
  "motor-sports": "Motorsport",
  f1: "Formula 1",
  "formula 1": "Formula 1",
  wwe: "WWE",
};

/**
 * Valores que NO son un deporte sino una competicion. El bridge los entrega en
 * el mismo campo que los deportes (son los `extra.genre` de sus catalogos), asi
 * que sin esto "AFCON" saldria como si fuera un deporte y la pagina de Deportes
 * lo agruparia en un grupo que no existe. Aqui van con el deporte que implican.
 */
const CNCVERSE_COMPETITIONS: Record<string, string> = {
  afcon: "Football",
  "africa cup of nations": "Football",
  "africa cup of nations qual.": "Football",
  "uefa nations": "Football",
  "uefa nations league": "Football",
  "laliga 2": "Football",
  "asian games": "Deportes",
  "one day international": "Cricket",
  "international friendly games": "Football",
  "aefc": "Football",
  "afl": "Australian Football",
  "nba": "Basketball",
};

function normalizeCncVerseSport(raw: string | undefined): { sport: string; competition: string } {
  const value = (raw ?? "").trim();
  if (!value) return { sport: "", competition: "" };
  const key = value.toLowerCase();
  const sport = CNCVERSE_SPORTS[key];
  if (sport) return { sport, competition: "" };
  const implied = CNCVERSE_COMPETITIONS[key];
  if (implied) return { sport: implied, competition: value };
  return { sport: "Deportes", competition: value };
}

/** Instante de inicio, venga como texto con barras o como epoch en ms. */
function startsAtIso(payload: CncVersePayload, now: number): string {
  const fromText = parseCncVerseDate(payload.eventInfo?.startTime);
  if (fromText) return fromText;
  if (typeof payload.date === "number" && Number.isFinite(payload.date)) {
    // Los de epoch llegan en milisegundos; el corte de 1e11 distingue ambos
    // casos sin depender de la magnitud del dato.
    const ms = payload.date > 1e11 ? payload.date : payload.date * 1000;
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date(now).toISOString();
}

/**
 * Mapea un meta de deportes del bridge a un `LiveEvent`.
 *
 * El estado sale del reloj y no de la etiqueta: `isHot` es la señal del addon,
 * pero un partido con inicio en pasado y fin en futuro tambien esta
 * ocurriendo, y uno con `endTime` (o `date`) ya pasado debe quedar como
 * finalizado para que la pagina no ofrezca un partido acabado.
 */
export function cncVerseMetaToEvent(meta: StremioMeta, now = Date.now()): LiveEvent | null {
  if (!meta.id) return null;
  const payload = decodeCncVerseEventId(meta.id) ?? {};
  const info = payload.eventInfo;

  // `title` es el partido en los tres esquemas. `eventInfo.eventName` NO lo es:
  // es la competicion ("One Day International", "Asian Games"), asi que leerlo
  // como titulo llenaba la pagina entera de "One Day International". Y `meta.name`
  // llega abreviado y con emoji delante ("🏏 IND vs WI"), de ahi que se limpie
  // antes de partinglo en dos equipos.
  const title = cleanMetaName(payload.title ?? meta.name, "");
  if (!title) return null;

  const teams = splitVersus(title)
    ?? (info?.teamA && info?.teamB ? [info.teamA, info.teamB] as [string, string] : null)
    ?? (payload.teams?.home?.name && payload.teams?.away?.name
      ? [payload.teams.home.name, payload.teams.away.name] as [string, string]
      : null);

  const startsAt = startsAtIso(payload, now);
  const endsAt = parseCncVerseDate(info?.endTime);
  const startMs = Date.parse(startsAt);
  const endMs = endsAt ? Date.parse(endsAt) : Number.NaN;
  const isHot = String(info?.isHot ?? "") === "1";

  let status: LiveEvent["status"] = "upcoming";
  if (isHot) status = "live";
  else if (Number.isFinite(endMs) && endMs <= now) status = "ended";
  else if (!Number.isFinite(startMs) || startMs <= now) status = "live";

  // El deporte no viene limpio: el bridge pone el genero del catalogo, que
  // mezcla deportes con competicion. Se separa en deporte + competicion para
  // que la pagina de Deportes agrupe por algo real.
  const { sport: rawSport, competition: rawCompetition } = normalizeCncVerseSport(info?.eventCat ?? payload.category);
  // Los catalogos de SofaScore (SKTech, SportzX, PlayFy) anaden la competicion
  // aparte, dentro de `eventInfo.eventName`.
  const sofaCompetition = (info?.eventName ?? "").trim();
  const sport = rawSport || "Deportes";
  const competition = rawCompetition || (sofaCompetition && sofaCompetition !== title ? sofaCompetition : "");
  const league = competition || sport;

  return {
    id: `cncverse:${meta.id}`,
    title: teams ? `${teams[0]} vs ${teams[1]}` : title,
    sport,
    league,
    status,
    startsAt,
    home: teams ? { name: teams[0] } : undefined,
    away: teams ? { name: teams[1] } : undefined,
    poster: meta.poster ?? meta.background,
    logo: meta.logo ?? info?.eventLogo,
    period: status === "live" ? "En directo" : undefined,
    isFeatured: payload.popular === true,
    sources: [],
  };
}

/**
 * Clave de deduplicacion entre catalogos.
 *
 * Se apoya en el identificador que cada catalogo da al evento mas la hora de
 * inicio, que es lo unico que separa dos partidos del mismo tipo. Medido sobre
 * los cinco catalogos: el solape real es pequeño (SKTech y PlayFy comparten 6,
 * PlayFy y PlayZTV 12) y la mayoria de los eventos son de un solo catalogo, asi
 * que la fusion no es la fuente de su valor, sino la cobertura que aporta. Aun
 * asi hace falta, para que un partido que coincide no salga dos veces.
 *
 * Cada esquema trae un identificador distinto, asi que se prueban en orden:
 * `eventId` (SKTech/SportzX/PlayZTV), `channelId` (PlayFy) e `id` (el slug de
 * StreamedSports). Sin ninguno se cae al id del meta, que es unico porque lleva
 * dentro el payload entero.
 */
export function cncVerseEventKey(meta: StremioMeta): string {
  const payload = decodeCncVerseEventId(meta.id);
  const startTime = payload?.eventInfo?.startTime ?? (typeof payload?.date === "number" ? String(payload.date) : "");
  const identity = payload?.eventId ?? payload?.channelId ?? payload?.id;
  if (identity == null) return `id:${meta.id}`;
  return `ev:${identity}@${startTime}`;
}
