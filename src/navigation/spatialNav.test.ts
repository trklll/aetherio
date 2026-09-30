import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DETAIL_EXIT_HERO_EVENT,
  exitDetailContentZone,
  findBestCandidate,
  resolveDesiredIndex,
  type SpatialRect,
} from "./spatialNav.ts";

function rect(left: number, top: number, width = 100, height = 100): SpatialRect {
  return { left, top, width, height };
}

describe("findBestCandidate (foco espacial estilo TV)", () => {
  it("derecha dentro de una fila va a la card vecina, no a la fila de abajo", () => {
    const current = rect(0, 0);
    const neighbor = rect(120, 0);
    const below = rect(0, 200);
    expect(findBestCandidate(current, "right", [neighbor, below])).toBe(neighbor);
  });

  it("izquierda en la primera card no tiene candidato (el motor abre el rail)", () => {
    const current = rect(0, 0);
    const neighbor = rect(120, 0);
    expect(findBestCandidate(current, "left", [neighbor])).toBeNull();
  });

  it("abajo desde el hero baja a la card bajo el haz", () => {
    const hero = rect(100, 0, 600, 300);
    const underBeam = rect(120, 350);
    const farRight = rect(900, 350);
    expect(findBestCandidate(hero, "down", [farRight, underBeam])).toBe(underBeam);
  });

  it("prefiere alineación del haz sobre cercanía diagonal", () => {
    const current = rect(0, 0);
    const aligned = rect(0, 300);
    const diagonalClose = rect(140, 160);
    expect(findBestCandidate(current, "down", [diagonalClose, aligned])).toBe(aligned);
  });

  it("ignora candidatos detrás de la dirección", () => {
    const current = rect(200, 200);
    const behind = rect(200, 0);
    expect(findBestCandidate(current, "down", [behind])).toBeNull();
  });

  it("arriba entre filas sube a la fila anterior", () => {
    const current = rect(150, 400);
    const above = rect(150, 200);
    const sameRow = rect(300, 400);
    expect(findBestCandidate(current, "up", [sameRow, above])).toBe(above);
  });
});

describe("resolveDesiredIndex (memoria por row)", () => {
  it("usa el índice recordado de la row destino", () => {
    expect(resolveDesiredIndex(5, 1, 20)).toBe(5);
  });

  it("sin recuerdo conserva la misma columna", () => {
    expect(resolveDesiredIndex(undefined, 4, 20)).toBe(4);
  });

  it("la row destino nunca visitada entra en su primera card", () => {
    expect(resolveDesiredIndex(undefined, 0, 20)).toBe(0);
  });

  it("vuelve al episodio 20 tras saltar a otra row", () => {
    // Episodios 1..20: el usuario se quedó en el 19 (índice 19) y luego bajó a
    // Especiales. Al volver, la row de Episodios devuelve su memoria.
    const remembered = 19;
    expect(resolveDesiredIndex(remembered, 0, 20)).toBe(19);
  });

  it("limita a la última card si la row destino es más corta", () => {
    expect(resolveDesiredIndex(12, 12, 6)).toBe(5);
    expect(resolveDesiredIndex(undefined, 9, 3)).toBe(2);
  });

  it("una row vacía no tiene dónde entrar", () => {
    expect(resolveDesiredIndex(7, 0, 0)).toBe(0);
  });

  it("descarta índices corruptos en vez de enfocar fuera de la row", () => {
    expect(resolveDesiredIndex(-4, 0, 20)).toBe(0);
    // Memoria no finita: mejor la primera card que un índice inventado.
    expect(resolveDesiredIndex(Number.NaN, 3, 20)).toBe(0);
    expect(resolveDesiredIndex(Number.POSITIVE_INFINITY, 0, 20)).toBe(0);
  });
});

describe("exitDetailContentZone (atrás desde la zona de contenido)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDetail(present: boolean) {
    const dispatch = vi.fn();
    vi.stubGlobal("document", { querySelector: () => (present ? {} : null) });
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    return dispatch;
  }

  it("pide el hero y consume el atrás si el Detail está en la zona de contenido", () => {
    const dispatch = stubDetail(true);

    expect(exitDetailContentZone()).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0][0] as CustomEvent).type).toBe(DETAIL_EXIT_HERO_EVENT);
  });

  it("si el Detail está en el hero deja pasar el atrás para colapsar o navegar", () => {
    const dispatch = stubDetail(false);

    expect(exitDetailContentZone()).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("sin DOM (SSR/pruebas) no dispara nada", () => {
    vi.stubGlobal("document", undefined);
    expect(exitDetailContentZone()).toBe(false);
  });
});
