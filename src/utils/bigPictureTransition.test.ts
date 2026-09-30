import { describe, expect, it, vi } from "vitest";
import aetherioLogo from "../assets/aetheriologo.png";
import aetherioTvLogo from "../../aetheriotvlogo.png";
import {
  getModeBrandLogo,
  getModeTransitionPhase,
  showBigPictureBrand,
  transitionToMode,
} from "./bigPictureTransition.ts";

describe("bigPictureTransition sin DOM", () => {
  it("navega de inmediato y queda idle", () => {
    const navigateFn = vi.fn();
    transitionToMode("enter", navigateFn);
    expect(navigateFn).toHaveBeenCalledTimes(1);
    expect(getModeTransitionPhase()).toBe("idle");
  });

  it("usa Aetherio TV al entrar y Aetherio normal al salir", () => {
    expect(getModeBrandLogo("enter")).toBe(aetherioTvLogo);
    expect(getModeBrandLogo("exit")).toBe(aetherioLogo);
  });

  it("completa la pantalla de marca inmediatamente sin DOM", () => {
    const onComplete = vi.fn();
    showBigPictureBrand(onComplete);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getModeTransitionPhase()).toBe("idle");
  });
});
