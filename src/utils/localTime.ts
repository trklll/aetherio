/**
 * Hora local de quien esta usando la app.
 *
 * Los addons de deportes entregan la hora del partido en tres formatos distintos:
 * ISO 8601 con offset (Nuvio), texto en UTC sin offset ("26 Sep 2026 - 04:30 UTC",
 * Sports Streams) y el `releaseInfo` sin fecha. Internamente todo se guarda como
 * instante absoluto, asi que la conversion no se puede hacer al escribir sino al
 * pintar: un catalogo descargado en un PC en Bogota tiene que mostrar la hora de
 * Bogota, no la del servidor que sirvio el JSON.
 *
 * La zona no es configurable a proposito: se toma siempre de la del cliente que
 * esta accessing la app, sin ajuste manual ni persistencia. Un selector obligaria
 * al usuario a decidir algo que el sistema ya sabe, y cualquier eleccion guardada
 * se quedaria equivocada en cuanto el equipo cambie de huso o viaje.
 *
 * Aqui no se adivina el desplazamiento: se pide al motor de `Intl` la zona IANA
 * real del cliente. Un offset fijo (-05:00) daria la hora de verano equivocada dos
 * veces al ano.
 *
 * Nota de API: la zona va siempre en la opcion `timeZone`, nunca como primer
 * argumento. `new Intl.DateTimeFormat("America/Bogota", ...)` intenta interpretar
 * eso como un idioma y lanza "Incorrect locale information provided".
 */

let cachedZone: string | null = null;

/**
 * Zona horaria IANA del cliente, o null si el motor no la expone. Se cachea porque
 * no cambia durante la sesion, pero cada formateo vuelve a consultarla para no
 * depender del orden de carga de los modulos.
 */
export function localTimeZone(): string | null {
  if (cachedZone !== null) return cachedZone || null;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    cachedZone = zone || "";
    return cachedZone || null;
  } catch {
    cachedZone = "";
    return null;
  }
}

/**
 * Formatea con una zona concreta. Sin argumento usa siempre la del cliente, que es
 * el unico modo en que se usa en la app; el parametro existe para poder fijar la
 * zona en los tests sin ensuciar el modulo con estado global.
 */
function formatter(zone: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
}

/** Desplazamiento legible, tipo "UTC-5" o "UTC+2". */
export function localUtcOffsetLabel(at: Date = new Date(), zone: string | undefined = localTimeZone() ?? undefined): string {
  for (const name of ["shortOffset", "longOffset"] as const) {
    try {
      const parts = formatter(zone, { timeZoneName: name }).formatToParts(at);
      const label = parts.find(part => part.type === "timeZoneName")?.value;
      if (label) return label.replace(/^GMT/i, "UTC");
    } catch {
      // algunos motores no aceptan `shortOffset`; se prueba el nombre largo
    }
  }
  return "";
}

/** Nombre corto de la zona ("Bogota", "Madrid"), vacio si el motor no la expone. */
export function localZoneLabel(zone: string | undefined = localTimeZone() ?? undefined): string {
  const city = zone ? zone.split("/").pop()?.replace(/_/g, " ") ?? "" : "";
  return city || localUtcOffsetLabel(new Date(), zone);
}

function toDate(iso: string | number | Date | undefined | null): Date | null {
  if (iso === undefined || iso === null || iso === "") return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Partes de fecha ya convertidas a la zona indicada. */
function localParts(date: Date, zone: string | undefined): { year: string; month: string; day: string } {
  const parts = formatter(zone, { year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dayKey(date: Date, zone: string | undefined): string {
  const { year, month, day } = localParts(date, zone);
  return `${year}-${month}-${day}`;
}

/** "20:30" en la zona del cliente. */
export function formatLocalTime(iso: string | number | Date | undefined | null, zone?: string | null): string {
  const date = toDate(iso);
  if (!date) return "";
  const target = zone === undefined ? localTimeZone() ?? undefined : zone || undefined;
  try {
    return formatter(target, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  } catch {
    return "";
  }
}

const WEEKDAYS = ["dom", "lun", "mar", "mi\u00e9", "jue", "vie", "s\u00e1b"];
const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * "Hoy 20:30" / "Manana 18:00" / "sab 16:00" / "26 sep 16:00".
 *
 * Las etiquetas de dia se calculan contra la zona del cliente, no contra UTC: si son
 * las 23:30 del lunes en el cliente, "manana" es el martes tambien para el usuario,
 * aunque el instante absoluto siga siendo el mismo.
 */
export function formatLocalSchedule(iso: string | number | Date | undefined | null, zone?: string | null): string {
  const date = toDate(iso);
  if (!date) return "";
  const target = zone === undefined ? localTimeZone() ?? undefined : zone || undefined;

  let dayLabel: string;
  try {
    const now = new Date();
    const key = dayKey(date, target);

    if (key === dayKey(now, target)) {
      dayLabel = "Hoy";
    } else if (key === dayKey(new Date(now.getTime() + 86_400_000), target)) {
      dayLabel = "Ma\u00f1ana";
    } else {
      const weekday = formatter(target, { weekday: "short" }).format(date).toLowerCase();
      const name = WEEKDAYS.find(day => weekday.startsWith(day.slice(0, 2)));
      if (name && withinDays(date, 7)) {
        dayLabel = name.charAt(0).toUpperCase() + name.slice(1);
      } else {
        const { month, day } = localParts(date, target);
        dayLabel = `${Number(day)} ${MONTH_LABELS[Number(month) - 1]}`;
      }
    }
  } catch {
    return "";
  }

  const time = formatLocalTime(date, target);
  return time ? `${dayLabel} ${time}` : dayLabel;
}

function withinDays(date: Date, days: number): boolean {
  const delta = date.getTime() - Date.now();
  return delta > -6 * 3_600_000 && delta < days * 86_400_000;
}

/**
 * "hace 3 min", "en 2 h". No admite zona a proposito: la distancia en el tiempo
 * no depende del huso, y un parametro que se ignora invites a pensar que si.
 */
export function formatLocalRelative(iso: string | number | Date | undefined | null): string {
  const date = toDate(iso);
  if (!date) return "";
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  try {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (absolute < 60) return rtf.format(Math.round(deltaSeconds), "second");
    if (absolute < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
    if (absolute < 86_400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
    return rtf.format(Math.round(deltaSeconds / 86_400), "day");
  } catch {
    return "";
  }
}
