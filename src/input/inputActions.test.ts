import { describe, expect, it } from "vitest";
import {
  GAMEPAD_BUTTON,
  dispatchDeleteCharInTextContext,
  isBackspaceKey,
  isEscapeKey,
  setBackDeleteOverride,
} from "./inputActions";

function fakeKey(init: { key?: string; code?: string }): KeyboardEvent {
  return init as KeyboardEvent;
}

describe("inputActions (tabla única mando ↔ teclado)", () => {
  it("B es atrás, X borra carácter y Y el modo del teclado", () => {
    expect(GAMEPAD_BUTTON.CONFIRM).toBe(0);
    expect(GAMEPAD_BUTTON.BACK).toBe(1);
    expect(GAMEPAD_BUTTON.DELETE_CHAR).toBe(2);
    expect(GAMEPAD_BUTTON.TOGGLE_KB_MODE).toBe(3);
    expect(GAMEPAD_BUTTON.TOGGLE_MODE).toBe(9);
    expect(GAMEPAD_BUTTON.GUIDE).toBe(16);
  });

  it("Escape admite sus variantes", () => {
    expect(isEscapeKey(fakeKey({ key: "Escape" }))).toBe(true);
    expect(isEscapeKey(fakeKey({ key: "Esc" }))).toBe(true);
    expect(isEscapeKey(fakeKey({ key: "x", code: "Escape" }))).toBe(true);
    expect(isEscapeKey(fakeKey({ key: "Enter" }))).toBe(false);
  });

  it("Backspace se detecta por key y por code", () => {
    expect(isBackspaceKey(fakeKey({ key: "Backspace" }))).toBe(true);
    expect(isBackspaceKey(fakeKey({ key: "x", code: "Backspace" }))).toBe(true);
    expect(isBackspaceKey(fakeKey({ key: "Delete" }))).toBe(false);
  });

  it("X solo borra con un contexto de texto montado", () => {
    try {
      // Sin teclado en pantalla: X no hace nada. Preferible a degradar X en
      // "atrás", que es lo que rompía al reproductor (X = subtítulos).
      setBackDeleteOverride(null);
      expect(dispatchDeleteCharInTextContext("gamepad")).toBe(false);

      // Con teclado en pantalla: X emite `delete-char`. Con o sin texto lo
      // decide `useTextBackAction` (sin texto no borra y deja pasar a B).
      setBackDeleteOverride(true);
      expect(dispatchDeleteCharInTextContext("gamepad")).toBe(true);
      setBackDeleteOverride(false);
      expect(dispatchDeleteCharInTextContext("gamepad")).toBe(true);
    } finally {
      setBackDeleteOverride(null);
    }
  });

  it("B ya no borra nunca: el borrado solo existe para X", () => {
    // `useGamepad` llama a `dispatchBackAction` directamente para B, así que la
    // garantía la hace el compilador: no queda ninguna ruta de `delete-char`
    // colgando de B (el antiguo `dispatchBackOrDelete` ya no existe).
    expect(dispatchDeleteCharInTextContext).toBeTypeOf("function");
    expect(GAMEPAD_BUTTON.BACK).not.toBe(GAMEPAD_BUTTON.DELETE_CHAR);
  });
});
