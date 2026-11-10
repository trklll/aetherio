import { afterEach, describe, expect, it, vi } from "vitest";
import { getModeTransitionPhase, transitionToMode } from "./bigPictureTransition";
import { enterSportsMode, exitSportsMode, isSportsLocation, toggleSportsMode } from "./sportsMode";

vi.mock("./bigPictureTransition", () => ({
  getModeTransitionPhase: vi.fn(() => "idle"),
  transitionToMode: vi.fn((_direction: string, navigate: () => void) => navigate()),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(getModeTransitionPhase).mockReturnValue("idle");
});

describe("Aetherio Sports como app interna", () => {
  it("distingue sus rutas sin capturar nombres parecidos", () => {
    expect(isSportsLocation("/big-picture/sports")).toBe(true);
    expect(isSportsLocation("/big-picture/sports/team/club:man-utd")).toBe(true);
    expect(isSportsLocation("/big-picture/sports/settings")).toBe(true);
    expect(isSportsLocation("/big-picture/sports-other")).toBe(false);
    expect(isSportsLocation("/home")).toBe(false);
    expect(isSportsLocation("/big-picture/player", "?type=live&id=match")).toBe(true);
    expect(isSportsLocation("/big-picture/player", "?type=sports-replay&id=match")).toBe(true);
    expect(isSportsLocation("/big-picture/player", "?type=movie&id=title")).toBe(false);
  });

  it.each(["/home", "/library"])("entra desde %s y vuelve al modo normal", pathname => {
    const navigate = vi.fn();
    enterSportsMode(navigate, pathname);
    expect(navigate).toHaveBeenLastCalledWith("/big-picture/sports");
    expect(transitionToMode).toHaveBeenLastCalledWith("sports", expect.any(Function));
    exitSportsMode(navigate);
    expect(navigate).toHaveBeenLastCalledWith("/home");
    expect(transitionToMode).toHaveBeenLastCalledWith("exit", expect.any(Function));
  });

  it("entra desde TV y regresa a Aetherio TV", () => {
    const navigate = vi.fn();
    toggleSportsMode(navigate, "/big-picture/library");
    toggleSportsMode(navigate, "/big-picture/sports/team/club:man-utd");
    expect(navigate).toHaveBeenLastCalledWith("/big-picture");
    expect(transitionToMode).toHaveBeenLastCalledWith("enter", expect.any(Function));
  });

  it("no reentra ni cambia el origen mientras se cubre la pantalla", () => {
    const navigate = vi.fn();
    enterSportsMode(navigate, "/home");
    vi.mocked(getModeTransitionPhase).mockReturnValue("cover");
    enterSportsMode(navigate, "/big-picture");
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.mocked(getModeTransitionPhase).mockReturnValue("idle");
    exitSportsMode(navigate);
    expect(navigate).toHaveBeenLastCalledWith("/home");
  });

  it("no reentra desde su propia app", () => {
    const navigate = vi.fn();
    enterSportsMode(navigate, "/big-picture/sports");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("salir durante un partido conserva el modo de origen", () => {
    const navigate = vi.fn();
    enterSportsMode(navigate, "/home");
    toggleSportsMode(navigate, "/big-picture/player", "?type=live&id=match");
    expect(navigate).toHaveBeenLastCalledWith("/home");
  });

  it("conserva la disponibilidad solo en desarrollo", () => {
    vi.stubEnv("DEV", false);
    const navigate = vi.fn();
    toggleSportsMode(navigate, "/home");
    toggleSportsMode(navigate, "/big-picture/sports");
    enterSportsMode(navigate, "/home");
    expect(navigate).not.toHaveBeenCalled();
  });
});
