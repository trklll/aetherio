import { describe, expect, it } from "vitest";
import { isTriggerEngaged } from "../../hooks/useGamepad.ts";
import {
  resolvePlayerGamepadAction,
  type PlayerGamepadContext,
} from "./playerGamepadMap.ts";

const DIRECT: PlayerGamepadContext = {
  directMode: true,
  transportLocked: false,
  canGoPrevEpisode: true,
  canGoNextEpisode: true,
  hasEpisodesPanel: true,
  hasSourcesPanel: true,
  skipAvailable: false,
  controlsMode: false,
  zone: "timeline",
};

describe("resolvePlayerGamepadAction (mando en Big Picture player)", () => {
  it("modo directo: A alterna, izquierda/derecha seek, arriba se ignora", () => {
    expect(resolvePlayerGamepadAction("confirm", DIRECT)).toEqual({ type: "toggle" });
    expect(resolvePlayerGamepadAction("dpad-left", DIRECT)).toEqual({ type: "seek", offset: -10 });
    expect(resolvePlayerGamepadAction("dpad-right", DIRECT)).toEqual({ type: "seek", offset: 10 });
    expect(resolvePlayerGamepadAction("dpad-up", DIRECT)).toEqual({ type: "ignore" });
  });

  it("gatillos hacen seek largo y bumpers controlan el volumen", () => {
    expect(resolvePlayerGamepadAction("lt", DIRECT)).toEqual({ type: "seek", offset: -30 });
    expect(resolvePlayerGamepadAction("rt", DIRECT)).toEqual({ type: "seek", offset: 30 });
    expect(resolvePlayerGamepadAction("lb", DIRECT)).toEqual({ type: "volume", delta: -0.05 });
    expect(resolvePlayerGamepadAction("rb", DIRECT)).toEqual({ type: "volume", delta: 0.05 });
  });

  it("X abre subtítulos e Y abre episodios/fuentes", () => {
    expect(resolvePlayerGamepadAction("x", DIRECT)).toEqual({ type: "open-subtitles" });
    expect(resolvePlayerGamepadAction("y", DIRECT)).toEqual({ type: "open-episodes-or-sources" });
    expect(
      resolvePlayerGamepadAction("y", { ...DIRECT, hasEpisodesPanel: false, hasSourcesPanel: false }),
    ).toBeNull();
  });

  it("con overlay abierto solo B cierra; cruceta y A vuelven a navegación espacial", () => {
    const overlay: PlayerGamepadContext = { ...DIRECT, directMode: false };
    expect(resolvePlayerGamepadAction("back", overlay)).toEqual({ type: "close-overlay" });
    expect(resolvePlayerGamepadAction("confirm", overlay)).toBeNull();
    expect(resolvePlayerGamepadAction("dpad-left", overlay)).toBeNull();
    expect(resolvePlayerGamepadAction("dpad-up", overlay)).toBeNull();
    expect(resolvePlayerGamepadAction("x", overlay)).toBeNull();
    expect(resolvePlayerGamepadAction("open-controls", overlay)).toBeNull();
  });

  it("con segmento visible, A omite intro/resumen/outro en vez de alternar", () => {
    const skip: PlayerGamepadContext = { ...DIRECT, skipAvailable: true };
    expect(resolvePlayerGamepadAction("confirm", skip)).toEqual({ type: "skip-segment" });
    expect(
      resolvePlayerGamepadAction("confirm", { ...skip, transportLocked: true }),
    ).toBeNull();
  });

  it("abajo abre la barra; bloqueado en lobby", () => {
    expect(resolvePlayerGamepadAction("open-controls", DIRECT)).toEqual({ type: "open-controls" });
    expect(
      resolvePlayerGamepadAction("open-controls", { ...DIRECT, transportLocked: true }),
    ).toBeNull();
  });

  it("en la row de botones: navegar con wrap, arriba al timeline, abajo sale", () => {
    const bar: PlayerGamepadContext = { ...DIRECT, controlsMode: true, zone: "buttons" };
    expect(resolvePlayerGamepadAction("dpad-left", bar)).toEqual({ type: "move-button", dir: "prev" });
    expect(resolvePlayerGamepadAction("dpad-right", bar)).toEqual({ type: "move-button", dir: "next" });
    expect(resolvePlayerGamepadAction("dpad-up", bar)).toEqual({ type: "zone-timeline" });
    expect(resolvePlayerGamepadAction("open-controls", bar)).toEqual({ type: "exit-controls" });
    expect(resolvePlayerGamepadAction("confirm", bar)).toBeNull();
    expect(resolvePlayerGamepadAction("back", bar)).toEqual({ type: "exit-controls" });
  });

  it("en el timeline: seek, A alterna y bajar va a los botones", () => {
    const timeline: PlayerGamepadContext = { ...DIRECT, controlsMode: true, zone: "timeline" };
    expect(resolvePlayerGamepadAction("dpad-left", timeline)).toEqual({ type: "seek", offset: -10 });
    expect(resolvePlayerGamepadAction("dpad-right", timeline)).toEqual({ type: "seek", offset: 10 });
    expect(resolvePlayerGamepadAction("confirm", timeline)).toEqual({ type: "toggle" });
    expect(resolvePlayerGamepadAction("open-controls", timeline)).toEqual({ type: "zone-buttons" });
    expect(resolvePlayerGamepadAction("dpad-up", timeline)).toBeNull();
    expect(resolvePlayerGamepadAction("dpad-down", timeline)).toBeNull();
    expect(resolvePlayerGamepadAction("back", timeline)).toEqual({ type: "exit-controls" });
  });

  it("en el timeline bloqueado no hay seek ni toggle", () => {
    const locked: PlayerGamepadContext = { ...DIRECT, controlsMode: true, zone: "timeline", transportLocked: true };
    expect(resolvePlayerGamepadAction("dpad-left", locked)).toBeNull();
    expect(resolvePlayerGamepadAction("confirm", locked)).toBeNull();
  });

  it("en la barra, X/Y/gatillos/bumpers siguen vivos", () => {
    const bar: PlayerGamepadContext = { ...DIRECT, controlsMode: true };
    expect(resolvePlayerGamepadAction("x", bar)).toEqual({ type: "open-subtitles" });
    expect(resolvePlayerGamepadAction("y", bar)).toEqual({ type: "open-episodes-or-sources" });
    expect(resolvePlayerGamepadAction("lt", bar)).toEqual({ type: "seek", offset: -30 });
    expect(resolvePlayerGamepadAction("rt", bar)).toEqual({ type: "seek", offset: 30 });
    expect(resolvePlayerGamepadAction("lb", bar)).toEqual({ type: "volume", delta: -0.05 });
    expect(resolvePlayerGamepadAction("rb", bar)).toEqual({ type: "volume", delta: 0.05 });
  });

  it("con segmento visible, A omite aunque la barra esté abierta", () => {
    const barSkip: PlayerGamepadContext = { ...DIRECT, controlsMode: true, skipAvailable: true };
    expect(resolvePlayerGamepadAction("confirm", barSkip)).toEqual({ type: "skip-segment" });
  });

  it("con menú abierto manda el cierre del overlay aunque la barra esté abierta", () => {
    const menu: PlayerGamepadContext = { ...DIRECT, directMode: false, controlsMode: true };
    expect(resolvePlayerGamepadAction("back", menu)).toEqual({ type: "close-overlay" });
    expect(resolvePlayerGamepadAction("dpad-left", menu)).toBeNull();
  });

  it("sin overlay, B no se reclama (sigue el volver global)", () => {
    expect(resolvePlayerGamepadAction("back", DIRECT)).toBeNull();
  });

  it("bloqueo de transporte: sin seek/play, pero bumpers (volumen) y X/Y vivos", () => {
    const locked: PlayerGamepadContext = { ...DIRECT, transportLocked: true };
    expect(resolvePlayerGamepadAction("confirm", locked)).toBeNull();
    expect(resolvePlayerGamepadAction("dpad-left", locked)).toBeNull();
    expect(resolvePlayerGamepadAction("lt", locked)).toBeNull();
    expect(resolvePlayerGamepadAction("open-controls", locked)).toBeNull();
    expect(resolvePlayerGamepadAction("lb", locked)).toEqual({ type: "volume", delta: -0.05 });
    expect(resolvePlayerGamepadAction("rb", locked)).toEqual({ type: "volume", delta: 0.05 });
    expect(resolvePlayerGamepadAction("x", locked)).toEqual({ type: "open-subtitles" });
    expect(resolvePlayerGamepadAction("y", locked)).toEqual({ type: "open-episodes-or-sources" });
  });
});

describe("isTriggerEngaged (LT/RT analógicos)", () => {
  it("pressed o valor > 0.5 engancha", () => {
    expect(isTriggerEngaged({ pressed: true, value: 1 })).toBe(true);
    expect(isTriggerEngaged({ pressed: false, value: 0.8 })).toBe(true);
    expect(isTriggerEngaged({ pressed: false, value: 0.2 })).toBe(false);
    expect(isTriggerEngaged(undefined)).toBe(false);
    expect(isTriggerEngaged(null)).toBe(false);
  });
});
