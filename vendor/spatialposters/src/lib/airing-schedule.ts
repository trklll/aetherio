/**
 * Badge "Cada <dia>" para series en emision.
 *
 * Portado del hook `useAiringSchedule` de Aetherio. La diferencia es donde corre:
 * alla se calculaba en el cliente y se superponia encima del poster ya renderizado
 * (dos capas, y el segundo badge tapaba al primero). Acá se calcula antes del
 * render y se compone en el mismo PNG, asi que es nativo y no hay solape.
 *
 * Solo se aplica a series. Una pelicula no tiene dia de emision.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Domingo primero: es como los lista un calendario y como los muestra Aetherio. */
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const

/**
 * Dias de la semana por idioma.
 *
 * No sale de las traducciones: el badge se compone como texto plano dentro del
 * SVG y las claves `badge.*` de i18n no contemplan listas de dias. Si se
 * guardaran en el diccionario, habria que resolver la clave en `poster-badge.ts`
 * en vez de acá, que es donde ya se conoce el idioma.
 */
const WEEKDAYS_BY_LANG: Record<string, readonly string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  it: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
  pt: ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"],
  he: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"],
  ja: ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"],
  ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
}

interface EpisodeDate {
  air_date?: string | null
  season_number?: number
}

export interface AiringInput {
  mediaType: "movie" | "tv"
  /** `status` de TMDB, ya TRADUCIDO por el locale de la request. */
  tvStatus?: string | null
  inProduction?: boolean
  lastAirDate?: string | null
  /** Episodios de la temporada en curso, para inferir el dia recurrente. */
  seasonEpisodes?: EpisodeDate[]
  nextEpisode?: EpisodeDate | null
  lang?: string
}

/**
 * Devuelve el texto del badge, o null si la serie no esta en emision o el
 * patron no se puede describir honestamente.
 *
 * Devolver null (y no un texto generico) es deliberado en los casos dudosos: es
 * mejor que no haya badge a que la app afirme un dia de emision que no es
 * cierto.
 */
export function getAiringScheduleLabel(input: AiringInput): string | null {
  if (input.mediaType !== "tv") return null

  const nextAirDate = normalizeDate(input.nextEpisode?.air_date)
  if (!nextAirDate) return null
  if (!isCurrentlyAiring(input.tvStatus, input.inProduction, input.lastAirDate, nextAirDate)) return null

  const weekdays = inferRecurringWeekdays(
    input.seasonEpisodes ?? [],
    input.lastAirDate,
    nextAirDate,
    input.lang,
  )
  if (!weekdays.length) return null

  if (weekdays.length === 1) return `Cada ${weekdays[0]}`
  if (weekdays.length === 2) return `Cada ${weekdays[0]} y ${weekdays[1]}`
  // 3 o mas seria una franja diaria, no un dia de la semana. Aca no hay nada
  // que decir: "Cada dia, de lunes a jueves" no describe nada util.
  return null
}

/**
 * True si la serie sigue emitiendo: hay un proximo capitulo fechado cerca de
 * ahora y el ultimo fue reciente.
 *
 * Las dos condiciones hacen falta. `in_production` sigue en true semanas despues
 * de la final, asi que sin la ventana del ultimo episodio apareceria "Cada
 * domingo" en series ya terminadas.
 */
function isCurrentlyAiring(
  tvStatus: string | null | undefined,
  inProduction: boolean | undefined,
  lastAirDate: string | null | undefined,
  nextAirDate: string,
): boolean {
  if (!inProduction && !RETURNING_STATUSES.has(foldStatus(tvStatus))) return false

  const nextTime = dateValue(nextAirDate)
  if (nextTime === null) return false
  const now = Date.now()
  // Mas de 3 semanas hacia adelante significa que la fecha de TMDB esta vieja.
  if (nextTime < now - DAY_MS || nextTime > now + 21 * DAY_MS) return false

  const lastTime = dateValue(lastAirDate)
  return lastTime === null || lastTime >= now - 42 * DAY_MS
}

/**
 * Deduce los dias de emision mirando que dias se repiten los capitulos.
 *
 * El criterio es "2+ capitulos en el mismo dia de la semana". Un daily tiene
 * 7 dias distintos y por lo tanto 7 o 0 apariciones de cada uno, asi que el
 * filtro lo descarta solo: no hace falta una regla especial para el daily, sale
 * del conteo.
 */
function inferRecurringWeekdays(
  episodes: EpisodeDate[],
  lastAirDate: string | null | undefined,
  nextAirDate: string,
  lang?: string,
): string[] {
  const names = weekdayNames(lang)

  const dated = episodes
    .map((episode) => normalizeDate(episode.air_date))
    .filter((date): date is string => Boolean(date))
  // Sin la lista de episodios quedan los dos extremos; sirve para series que
  // TMDB todavia no detail de temporada.
  const fallback = [normalizeDate(lastAirDate), nextAirDate].filter(
    (date): date is string => Boolean(date),
  )
  const dates = dated.length ? dated : fallback

  const counts = new Map<number, number>()
  for (const date of dates) {
    const weekday = weekdayIndex(date)
    if (weekday === null) continue
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1)
  }

  const recurring = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([weekday]) => weekday)

  let selected: number[]
  if (recurring.length === 1 || recurring.length === 2) {
    selected = recurring
  } else if (recurring.length > 2) {
    // Daily o irregular: no se puede reducir a "cada X".
    return []
  } else {
    // Ningun dia se repite (pocos episodios, todos en dias distintos). Se
    // aceptan los dias cercanos al proximo, que es la unica senal que hay.
    const nextTime = dateValue(nextAirDate)
    const nearby = [
      ...new Set(
        dates
          .filter((date) => {
            const value = dateValue(date)
            return value !== null && nextTime !== null && Math.abs(value - nextTime) <= 8 * DAY_MS
          })
          .map(weekdayIndex)
          .filter((weekday): weekday is number => weekday !== null),
      ),
    ]
    if (nearby.length < 1 || nearby.length > 2) return []
    selected = nearby
  }

  return selected.sort((a, b) => mondayFirst(a) - mondayFirst(b)).map((weekday) => names[weekday])
}

/**
 * Status de TMDB que significan "sigue emitiendo".
 *
 * `status` llega YA TRADUCIDO por el locale de la request, asi que la misma
 * serie devuelve "Returning Series" con lang=en y "En emisión" con lang=es.
 * Comparar contra la cadena inglesa solamente hacia que el badge no apareciera
 * nunca justamente en español, que es el caso de uso de Aetherio. Por eso van
 * todas las variantes, sin acentos ni mayusculas.
 */
const RETURNING_STATUSES = new Set([
  "returning series",
  "returning",
  "en emision",
  "en curso",
  "proxima temporada",
  "in produzione",
  "en produccion",
  "wird fortgesetzt",
  "en cours",
])

function foldStatus(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/** Idioma desconocido -> español, que es el default de Aetherio. */
function weekdayNames(lang?: string): readonly string[] {
  return WEEKDAYS_BY_LANG[(lang || "es").slice(0, 2).toLowerCase()] ?? WEEKDAYS
}

function normalizeDate(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/**
 * Se parsea a mediodia UTC a proposito. Con `new Date("2024-01-07")` el motor
 * lo interpreta en hora local, y un usuario en UTC-6 veria el domingo como
 * lunes y el badge diria el dia equivocado.
 */
function dateValue(value: string | null | undefined): number | null {
  const date = normalizeDate(value)
  if (!date) return null
  const time = Date.parse(`${date}T12:00:00Z`)
  return Number.isFinite(time) ? time : null
}

function weekdayIndex(value: string): number | null {
  const time = dateValue(value)
  return time === null ? null : new Date(time).getUTCDay()
}

/** 0=domingo a 6=sabado -> indice de lunes a domingo. */
function mondayFirst(weekday: number): number {
  return weekday === 0 ? 6 : weekday - 1
}
