import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPERIENCE_STORAGE_KEYS } from "../domain/experienceStorage";
import {
  createLocalProfile,
  deleteLocalProfile,
  setActiveProfile,
} from "./localProfiles";

function setupStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    writable: true,
  });
  Object.defineProperty(globalThis, "CustomEvent", {
    configurable: true,
    value: class { constructor(public type: string, public init?: unknown) {} },
  });
  return values;
}

describe("experience keys in local profile lifecycle", () => {
  let values: Map<string, string>;

  beforeEach(() => { values = setupStorage(); });

  it("adopts registered experience keys only when explicitly requested", async () => {
    const key = "aetherio-recommendation-feedback-v1";
    const secondKey = "aetherio-title-playback-selections-v1";
    values.set(key, JSON.stringify({ version: 1, records: ["keep"] }));
    values.set(secondKey, JSON.stringify({ version: 1, choices: [] }));

    const profile = await createLocalProfile({ name: "Ada" }, { adoptCurrentData: true });
    expect(values.get(`aetherio-profile:${profile.id}:${key}`)).toBe(values.get(key));
    expect(values.get(`aetherio-profile:${profile.id}:${secondKey}`)).toBe(values.get(secondKey));
  });

  it("deletes all registered experience data for the deleted profile and preserves unrelated keys", async () => {
    const profile = await createLocalProfile({ name: "Ada" });
    expect(setActiveProfile(profile.id)).toBe(true);
    for (const key of EXPERIENCE_STORAGE_KEYS) {
      values.set(`aetherio-profile:${profile.id}:${key}`, "profile-data");
    }
    values.set(`aetherio-profile:${profile.id}:unregistered-user-data`, "preserve-me");

    expect(deleteLocalProfile(profile.id)).toBe(true);
    for (const key of EXPERIENCE_STORAGE_KEYS) {
      expect(values.has(`aetherio-profile:${profile.id}:${key}`)).toBe(false);
    }
    expect(values.get(`aetherio-profile:${profile.id}:unregistered-user-data`)).toBe("preserve-me");
  });
});
