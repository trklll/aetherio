import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPlaybackSelection,
  usePlaybackSelection,
  type UsePlaybackSelectionResult,
} from "./usePlaybackSelection";
import { setActiveProfile } from "../utils/localProfiles";

const query = { type: "series", id: "tmdb:731", season: 1, episode: 1 };

function setupStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  });
  vi.stubGlobal("CustomEvent", class CustomEvent<T = unknown> {
    type: string;
    detail: T;
    constructor(type: string, init?: { detail?: T }) {
      this.type = type;
      this.detail = init?.detail as T;
    }
  });
  storage.setItem("aetherio-local-mode-v1", "1");
  storage.setItem("aetherio-local-profiles-v1", JSON.stringify([
    { id: "profile-a", name: "A", createdAt: 1, updatedAt: 1 },
    { id: "profile-b", name: "B", createdAt: 2, updatedAt: 2 },
  ]));
  storage.setItem("aetherio-active-profile-id", "profile-a");
  return storage;
}

function renderHook(queryValue: typeof query | null) {
  let result: UsePlaybackSelectionResult | undefined;
  function Probe() {
    result = usePlaybackSelection(queryValue);
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  if (!result) throw new Error("usePlaybackSelection no devolvió resultado");
  return result;
}

describe("usePlaybackSelection y persistencia por perfil", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    setupStorage();
  });

  it("expone preferencias semánticas de entrega y episodio, sin ids de pista", () => {
    const selection = renderHook(query);
    expect(selection.delivery).toBeNull();
    expect(selection.episode).toBeNull();

    const result = selection.saveAudioPreference({ value: "track:99", language: "spa", title: "Español - Latino" });
    expect(result.ok).toBe(true);
    expect(readPlaybackSelection(query)).toMatchObject({
      delivery: { audio: { language: "spa", title: "espanol latino" } },
      episode: { audio: { language: "spa", title: "espanol latino" } },
    });
    const raw = localStorage.getItem("aetherio-profile:profile-a:aetherio-title-playback-selections-v1") ?? "";
    expect(raw).not.toContain("track:99");
  });

  it("guarda subtítulos apagados en serie y episodio, y no revive idioma global", () => {
    const selection = renderHook(query);
    expect(selection.saveSubtitlePreference(null).ok).toBe(true);
    expect(readPlaybackSelection(query)).toMatchObject({
      delivery: { subtitle: { subtitleMode: "off" } },
      episode: { subtitle: { subtitleMode: "off" } },
    });
  });

  it("mantiene la preferencia de entrega entre episodios con ids de pista diferentes", () => {
    const selection = renderHook(query);
    selection.saveAudioPreference({ value: "track:4", language: "spa", title: "Español" });
    expect(readPlaybackSelection({ ...query, episode: 2 }).delivery?.audio?.language).toBe("spa");
    expect(readPlaybackSelection({ ...query, episode: 2 }).episode).toBeNull();
  });

  it("aísla los datos entre perfiles sin migrarlos", () => {
    renderHook(query).saveAudioPreference({ value: "track:2", language: "spa", title: "Español" });
    expect(setActiveProfile("profile-b")).toBe(true);
    expect(readPlaybackSelection(query)).toEqual({ delivery: null, episode: null });
    renderHook(query).saveSubtitlePreference(null);
    expect(setActiveProfile("profile-a")).toBe(true);
    expect(readPlaybackSelection(query).episode?.audio?.language).toBe("spa");
    expect(readPlaybackSelection(query).episode?.subtitle).toBeUndefined();
  });

  it("persiste ids numéricos como legacy sin asumir TMDB", () => {
    const result = renderHook({ ...query, id: "731" }).saveAudioPreference({
      value: "track:3",
      language: "eng",
      title: "English",
    });
    expect(result.ok).toBe(true);
    const raw = localStorage.getItem("aetherio-profile:profile-a:aetherio-title-playback-selections-v1") ?? "";
    expect(raw).toContain("legacy");
    expect(raw).not.toContain("tmdb");
  });
});
