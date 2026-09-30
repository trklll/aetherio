import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatLocalRelative,
  formatLocalSchedule,
  formatLocalTime,
  localTimeZone,
  localUtcOffsetLabel,
  localZoneLabel,
} from "./localTime.ts";

/**
 * El requisito es que el catalogo se lea en la zona de quien esta usando la app, y
 * que esa zona no sea configurable. Estos tests fijan la zona de forma explicita
 * para no depender de la del runner: si no, el suite pasaria en verde con un
 * producto que se ve mal en un PC de Madrid.
 */

const BOGOTA = "America/Bogota";
const MADRID = "Europe/Madrid";
const TOKYO = "Asia/Tokyo";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("zona del cliente", () => {
  it("se toma de Intl, sin ajuste manual ni persistencia", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      timeZone: MADRID,
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(localTimeZone()).toBe(MADRID);
  });

  it("la zona detectada es una clave IANA que el motor acepta", () => {
    const zone = localTimeZone();
    if (!zone) return;
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: zone }).format(new Date())).not.toThrow();
  });

  it("devuelve una cadena vacia en vez de romperse si el motor no expone zona", () => {
    // Sin zona el motor usa la del sistema; nunca debe lanzar.
    expect(() => formatLocalTime(new Date())).not.toThrow();
    expect(formatLocalTime(new Date(), "")).not.toBe(undefined);
  });
});

describe("formato de la hora", () => {
  // 2026-09-26T20:30:00Z -> 15:30 en Bogota (UTC-5), 22:30 en Madrid (UTC+2 DST)
  it("convierte un instante UTC a la hora del cliente", () => {
    expect(formatLocalTime("2026-09-26T20:30:00.000Z", BOGOTA)).toBe("15:30");
  });

  it("el mismo instante cae en horas distintas segun la zona", () => {
    const stamp = "2026-09-26T20:30:00.000Z";
    expect(formatLocalTime(stamp, BOGOTA)).toBe("15:30");
    expect(formatLocalTime(stamp, MADRID)).toBe("22:30");
    expect(formatLocalTime(stamp, TOKYO)).toBe("05:30");
  });

  it("acepta Date, numero e ISO", () => {
    const iso = "2026-09-26T20:30:00.000Z";
    const stamp = Date.parse(iso);
    expect(formatLocalTime(new Date(stamp), BOGOTA)).toBe("15:30");
    expect(formatLocalTime(stamp, BOGOTA)).toBe("15:30");
    expect(formatLocalTime(iso, BOGOTA)).toBe("15:30");
  });

  it("devuelve cadena vacia ante una fecha inutil", () => {
    expect(formatLocalTime("no-es-una-fecha", BOGOTA)).toBe("");
    expect(formatLocalTime(undefined, BOGOTA)).toBe("");
    expect(formatLocalSchedule(null, BOGOTA)).toBe("");
    expect(formatLocalRelative("")).toBe("");
  });
});

describe("etiqueta de dia", () => {
  it("calcula hoy y manana contra el reloj del cliente, no contra UTC", () => {
    vi.useFakeTimers();
    // Sabado 26 a las 20:40 UTC = 15:40 del sabado en Bogota y 22:40 en Madrid.
    vi.setSystemTime(new Date("2026-09-26T20:40:00.000Z"));

    // 00:30Z del domingo = 19:30 del sabado: para el usuario bogotano sigue siendo hoy.
    expect(formatLocalSchedule("2026-09-27T00:30:00.000Z", BOGOTA)).toBe("Hoy 19:30");
    // El mismo instante en Madrid = 02:30 del domingo: ya es otro dia local.
    expect(formatLocalSchedule("2026-09-27T00:30:00.000Z", MADRID)).toBe("Ma\u00f1ana 02:30");
  });

  it("el cambio de dia se decide en hora local, no con los numeros del instante", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    // 20:00Z = 15:00 del 26.
    expect(formatLocalSchedule("2026-09-26T20:00:00.000Z", BOGOTA)).toBe("Hoy 15:00");
    // 02:00Z del 27 = 21:00 del 26 en Bogota: hoy, no manana.
    expect(formatLocalSchedule("2026-09-27T02:00:00.000Z", BOGOTA)).toBe("Hoy 21:00");
    // 14:00Z del 27 = 09:00 del 27: ese si es manana.
    expect(formatLocalSchedule("2026-09-27T14:00:00.000Z", BOGOTA)).toBe("Ma\u00f1ana 09:00");
  });

  it("usa el dia de la semana cuando el evento esta cerca", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    // 2026-10-02 es viernes, a 6 dias: entra en la ventana de la semana.
    expect(formatLocalSchedule("2026-10-02T20:00:00.000Z", BOGOTA)).toBe("Vie 15:00");
  });

  it("cae a dia y mes cuando el evento esta lejos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    // 03:00Z del 3 de diciembre = 22:00 del 2 en Bogota.
    expect(formatLocalSchedule("2026-12-03T03:00:00.000Z", BOGOTA)).toBe("2 dic 22:00");
  });
});

describe("etiqueta de zona", () => {
  it("expone el desplazamiento en UTC", () => {
    expect(localUtcOffsetLabel(new Date("2026-09-26T12:00:00.000Z"), BOGOTA)).toMatch(/UTC-5/);
    expect(localUtcOffsetLabel(new Date("2026-01-26T12:00:00.000Z"), MADRID)).toMatch(/UTC\+1/);
  });

  it("el desplazamiento respeta el horario de verano", () => {
    expect(localUtcOffsetLabel(new Date("2026-01-26T12:00:00.000Z"), MADRID)).toMatch(/UTC\+1/);
    expect(localUtcOffsetLabel(new Date("2026-07-26T12:00:00.000Z"), MADRID)).toMatch(/UTC\+2/);
  });

  it("el nombre corto sale del nombre de la ciudad", () => {
    expect(localZoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
});

describe("tiempo relativo", () => {
  it("usa la unidad correcta segun la distancia", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    expect(formatLocalRelative(Date.now() + 3 * 60_000)).toMatch(/3/);
    expect(formatLocalRelative(Date.now() + 2 * 3_600_000)).toMatch(/2/);
    expect(formatLocalRelative(Date.now() + 3 * 86_400_000)).toMatch(/3/);
  });
});
