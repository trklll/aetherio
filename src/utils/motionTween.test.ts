import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, tweenTo } from "./motion";

vi.mock("gsap", () => ({ gsap: { to: vi.fn() } }));

describe("reduced-motion tween lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not send an undefined clearProps value to the GSAP CSS plugin", () => {
    tweenTo({}, { opacity: 0 });
    const vars = vi.mocked(gsap.to).mock.calls[0][1];
    expect(vars).not.toHaveProperty("clearProps");
  });

  it("preserves a supplied clearProps value and the completion callback", () => {
    const onComplete = vi.fn();
    tweenTo({}, { opacity: 0, scale: 0.96, clearProps: "opacity", onComplete });
    expect(gsap.to).toHaveBeenCalledWith({}, expect.objectContaining({
      opacity: 0,
      clearProps: "opacity",
      onComplete,
    }));
    expect(vi.mocked(gsap.to).mock.calls[0][1]).not.toHaveProperty("scale");
  });
});
