import { describe, expect, it, vi } from "vitest";
import { isContextMenuTarget } from "./useLongPressAction";

describe("isContextMenuTarget", () => {
  it("detecta un evento originado en el portal del menú", () => {
    const closest = vi.fn((selector: string) =>
      selector === "[data-aetherio-context-menu]" ? {} as Element : null,
    );

    expect(isContextMenuTarget({ closest } as unknown as EventTarget)).toBe(true);
    expect(closest).toHaveBeenCalledWith("[data-aetherio-context-menu]");
  });

  it("no bloquea eventos de una card normal", () => {
    const closest = vi.fn(() => null);

    expect(isContextMenuTarget({ closest } as unknown as EventTarget)).toBe(false);
  });

  it("tolera targets nulos", () => {
    expect(isContextMenuTarget(null)).toBe(false);
  });
});
