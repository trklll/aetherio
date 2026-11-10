import { describe, expect, it } from "vitest";
import { DEMO_CHANNELS, DEMO_NOW } from "./channelDemo";
import { adjacentChannelProgramme } from "./channelNavigation";

describe("navegación temporal de la guía TV", () => {
  it("mantiene la hora al cambiar a un canal de duraciones distintas", () => {
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "la2", 780, 1)?.programme.title).toBe("Cocina abierta");
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "antena3", 780, -1)?.programme.title).toBe("Bosques del mundo");
  });
  it("no envuelve los extremos ni inventa canales", () => {
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "la1", DEMO_NOW, -1)).toBeNull();
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "teledeporte", DEMO_NOW, 1)).toBeNull();
    expect(adjacentChannelProgramme([], "la2", DEMO_NOW, 1)).toBeNull();
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "missing", DEMO_NOW, 1)).toBeNull();
  });
  it("limita la hora a la programación disponible", () => {
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "la2", 0, -1)?.programme.title).toBe("La mañana");
    expect(adjacentChannelProgramme(DEMO_CHANNELS, "la2", 2000, -1)?.programme.title).toBe("Aquí la Tierra");
  });
  it("resuelve huecos por proximidad y admite canales sin programación", () => {
    const empty = { ...DEMO_CHANNELS[0], programmes: [] };
    expect(adjacentChannelProgramme([DEMO_CHANNELS[1], empty], "la2", DEMO_NOW, 1)).toBeNull();
    const gap = { ...DEMO_CHANNELS[0], programmes: [DEMO_CHANNELS[0].programmes[0], DEMO_CHANNELS[0].programmes[4]] };
    expect(adjacentChannelProgramme([DEMO_CHANNELS[1], gap], "la2", 800, 1)?.programme.title).toBe("La mañana");
    expect(adjacentChannelProgramme([DEMO_CHANNELS[1], gap], "la2", 900, 1)?.programme.title).toBe("Aquí la Tierra");
  });
});
