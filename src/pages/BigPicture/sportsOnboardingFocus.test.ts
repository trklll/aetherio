import { describe, expect, it } from "vitest";
import { findOnboardingNeighbor, type OnboardingFocusItem } from "./sportsOnboardingFocus.ts";

const item = (id: string, group: string, left: number, top: number, width = 100): OnboardingFocusItem => ({ id, group, left, top, width });
const items = [
  item("back", "actions", 400, 0), item("continue", "actions", 520, 0),
  item("filter", "filters", 0, 70),
  item("a", "options", 0, 140), item("b", "options", 120, 140),
  item("c", "options", 0, 220), item("d", "options", 120, 220),
  item("e", "options", 0, 300),
];
const get = (id: string) => items.find(value => value.id === id)!;
const next = (id: string, direction: "left" | "right" | "up" | "down", x?: number) =>
  findOnboardingNeighbor(items, get(id), direction, x)?.id;

describe("sports controller visual-row navigation", () => {
  it("moves horizontally only within the current visual row", () => {
    expect(next("a", "right")).toBe("b");
    expect(next("b", "left")).toBe("a");
  });
  it("does not wrap or jump diagonally at either horizontal edge", () => {
    expect(next("b", "right")).toBeUndefined();
    expect(next("a", "left")).toBeUndefined();
    expect(next("filter", "right")).toBeUndefined();
  });
  it("keeps the column instead of skipping the remaining rows in a group", () => {
    expect(next("a", "down")).toBe("c");
    expect(next("b", "down")).toBe("d");
    expect(next("d", "up")).toBe("b");
  });
  it("handles an incomplete last row and restores the preferred column", () => {
    expect(next("d", "down", 170)).toBe("e");
    expect(next("e", "up", 170)).toBe("d");
  });
  it("enters adjacent groups only after reaching their vertical edges", () => {
    expect(next("filter", "down")).toBe("a");
    expect(next("b", "up")).toBe("filter");
    expect(next("filter", "up")).toBe("back");
    expect(next("e", "down")).toBeUndefined();
  });
  it("tolerates subpixel alignment differences", () => {
    const fractional = items.map(value => value.id === "b" ? { ...value, top: value.top + 1.25 } : value);
    expect(findOnboardingNeighbor(fractional, fractional[3], "right")?.id).toBe("b");
  });
  it("is unaffected by scrolling the whole content group", () => {
    const scrolled = items.map(value => value.group === "options" ? { ...value, top: value.top - 400 } : value);
    expect(findOnboardingNeighbor(scrolled, scrolled[4], "down")?.id).toBe("d");
    expect(findOnboardingNeighbor(scrolled, scrolled[3], "up")?.id).toBe("filter");
  });
  it("allows a single option and empty groups without trapping or looping", () => {
    expect(findOnboardingNeighbor([], get("a"), "down")).toBeUndefined();
    expect(findOnboardingNeighbor([get("a")], get("a"), "up")).toBeUndefined();
    expect(findOnboardingNeighbor([get("filter"), get("a")], get("a"), "up")?.id).toBe("filter");
  });
});
