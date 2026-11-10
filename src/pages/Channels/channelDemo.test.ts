import { describe, expect, it } from "vitest";
import { DEMO_CHANNELS, filterChannels, formatGuideTime, getProgrammeState, programmePosition } from "./channelDemo";

describe("guía de demostración", () => {
  it("filtra por categoría y nombre, sin distinguir tildes o mayúsculas", () => {
    expect(filterChannels(DEMO_CHANNELS, "Todos", "LA 1").map(channel => channel.id)).toEqual(["la1"]);
    expect(filterChannels(DEMO_CHANNELS, "Cine", "")).toHaveLength(1);
    expect(filterChannels(DEMO_CHANNELS, "Todos", "sexta")).toHaveLength(1);
    expect(filterChannels(DEMO_CHANNELS, "Todos", "inexistente")).toEqual([]);
    expect(filterChannels(DEMO_CHANNELS, "Cine", "La 1")).toEqual([]);
  });

  it("formatea la hora de los bloques con ceros iniciales", () => {
    expect(formatGuideTime(690)).toBe("11:30");
    expect(formatGuideTime(5)).toBe("00:05");
  });

  it("distingue emisiones anteriores, actuales y futuras en sus límites", () => {
    const programme = { start: 700, end: 750 };
    expect(getProgrammeState(programme, 699)).toBe("upcoming");
    expect(getProgrammeState(programme, 700)).toBe("current");
    expect(getProgrammeState(programme, 749)).toBe("current");
    expect(getProgrammeState(programme, 750)).toBe("past");
  });

  it("recorta los bloques a la ventana y omite los que quedan fuera", () => {
    expect(programmePosition({ start: 680, end: 720 }, 690, 990)).toEqual({ left: 0, duration: 30 });
    expect(programmePosition({ start: 960, end: 1020 }, 690, 990)).toEqual({ left: 270, duration: 30 });
    expect(programmePosition({ start: 690, end: 990 }, 690, 990)).toEqual({ left: 0, duration: 300 });
    expect(programmePosition({ start: 600, end: 690 }, 690, 990)).toBeNull();
    expect(programmePosition({ start: 990, end: 1080 }, 690, 990)).toBeNull();
  });
});
