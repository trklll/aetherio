import { describe, expect, it } from "vitest";
import type { IptvChannel } from "../../services/iptvChannels";
import { buildProgrammeIndex, channelProgrammes, filterLiveChannels, programmeWindow, uniqueChannels } from "./liveChannelModel";

const channel: IptvChannel = { id: "one", name: "Deportes Perú", streamUrl: "https://stream.example/live.m3u8", sourceId: "test", sourceName: "Lista", countryCode: "PE", tvgId: "sport.pe" };
const now = Date.parse("2026-11-09T18:15:00Z");
const programme = { channelId: "sport.pe", title: "Partido en directo", startsAt: "2026-11-09T18:00:00Z", endsAt: "2026-11-09T19:00:00Z", categories: [] };

describe("real channel guide", () => {
  it("combines accent-insensitive search, region and source filters", () => {
    expect(filterLiveChannels([channel], "peru", "PERÚ", "Lista")).toEqual([channel]);
    expect(filterLiveChannels([channel], "all", "", "Otra lista")).toEqual([]);
    expect(filterLiveChannels([channel], "spanish", "", "all")).toEqual([]);
    expect(filterLiveChannels([{ ...channel, language: "spa" }], "spanish", "", "all")).toHaveLength(1);
  });
  it("deduplicates the same feed, not distinct alternative sources", () => {
    expect(uniqueChannels([channel, { ...channel, id: "duplicate" }, { ...channel, id: "alternative", streamUrl: "https://other.example/live.m3u8" }])).toHaveLength(2);
  });
  it("matches XMLTV by exact regional identity and never invents missing programmes", () => {
    const index = buildProgrammeIndex([{ channels: new Map(), programmes: [programme] }]);
    expect(channelProgrammes(channel, index)).toEqual([programme]);
    expect(channelProgrammes({ ...channel, tvgId: "sport.es" }, index)).toEqual([]);
  });
  it("allows display-name matching only when unambiguous and no channel ID exists", () => {
    const noId = { ...channel, tvgId: undefined };
    const index = buildProgrammeIndex([{ channels: new Map([["sport.pe", [channel.name]]]), programmes: [programme] }]);
    expect(channelProgrammes(noId, index)).toEqual([programme]);
    const ambiguous = buildProgrammeIndex([{ channels: new Map([["sport.pe", [channel.name]], ["sport.es", [channel.name]]]), programmes: [programme] }]);
    expect(channelProgrammes(noId, ambiguous)).toEqual([]);
  });
  it("clips programme positions to the visible time window", () => {
    expect(programmeWindow(programme, now, now + 2 * 3_600_000)).toEqual({ left: 0, width: 37.5 });
    expect(programmeWindow(programme, now + 3_600_000, now + 2 * 3_600_000)).toBeNull();
  });
});
