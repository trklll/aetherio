import { describe, expect, it } from "vitest";
import { buildSportsChannels } from "./sportsChannels.ts";
import type { LiveChannel } from "../../types/liveSports.ts";

const channels: LiveChannel[] = [
  { id: "football", name: "Fútbol TV", sports: ["futbol"], category: "Deportes", sources: [{ id: "a", label: "IPTV", url: "https://cdn.example.com/a.m3u8" }] },
  { id: "mma", name: "MMA TV", sports: ["mma"], category: "Deportes", sources: [{ id: "b", label: "IPTV", url: "https://cdn.example.com/b.m3u8" }] },
  { id: "empty", name: "Sin fuentes", sports: ["futbol"], category: "Deportes", sources: [] },
];

describe("sports channels row", () => {
  it("filters by selected sport and keeps linear channel identities separate from match cards", () => {
    const home = buildSportsChannels(channels, ["futbol"]);
    expect(home.row?.items.map(item => item.name)).toEqual(["Fútbol TV"]);
    expect(home.row?.items[0].genres).toContain("Canal deportivo");
    expect(home.byId.get(home.row!.items[0].id)?.id).toBe("iptv-channel:football");
    expect(home.row?.items[0].description).toContain("Sin programación");
    expect(home.row?.items[0].originalPoster).toMatch(/^data:image/);
  });
  it("does not invent an empty row, and an unpersonalized profile can browse all channels", () => {
    expect(buildSportsChannels([], []).row).toBeNull();
    expect(buildSportsChannels(channels, []).row?.items).toHaveLength(2);
  });
  it("shows Spanish-language channels first and keeps the rest available in their original order", () => {
    const mixed: LiveChannel[] = [
      { id: "english", name: "Arena Sport 1", tvgId: "ArenaSport1.rs@HD", language: "English", sports: ["futbol"], category: "Deportes", sources: [{ id: "en", label: "IPTV", url: "https://cdn.example.com/en.m3u8" }] },
      { id: "spanish-explicit", name: "beIN SPORTS XTRA en Espanol", language: "Spanish", sports: ["futbol"], category: "Deportes", sources: [{ id: "es1", label: "IPTV", url: "https://cdn.example.com/es1.m3u8" }] },
      { id: "spanish-region", name: "Teledeporte", tvgId: "TDP.TV@SD", sports: ["futbol"], category: "Deportes", sources: [{ id: "es2", label: "IPTV", url: "https://cdn.example.com/es2.m3u8" }] },
      { id: "unknown", name: "Sports Channel", sports: ["futbol"], category: "Deportes", sources: [{ id: "unknown", label: "IPTV", url: "https://cdn.example.com/unknown.m3u8" }] },
    ];
    expect(buildSportsChannels(mixed, ["futbol"]).items.map(item => item.id)).toEqual([
      "iptv-channel:spanish-explicit", "iptv-channel:spanish-region", "iptv-channel:english", "iptv-channel:unknown",
    ]);
  });
});
