import { describe, expect, it, vi } from "vitest";
import type { IptvChannel } from "./iptvChannels";
import type { XmltvGuide } from "./iptvSports";
import {
  loadAndVerifyIptvChannels,
  verifyIptvChannels,
} from "./iptvChannelCatalog";

function channel(id: string): IptvChannel {
  return { id, name: id, streamUrl: `https://${id}.example/live.m3u8`, sourceId: "test", sourceName: "Prueba" };
}

describe("IPTV channel catalog verification", () => {
  it("downloads each available guide before verifying and keeps channels without guide metadata", async () => {
    const events: string[] = [];
    const guide = { channels: new Map(), programmes: [] } as unknown as XmltvGuide;
    const verifyChannels = vi.fn(async (channels: IptvChannel[]) => {
      events.push("verify");
      expect(channels).toHaveLength(2);
      return { channels, failedChannels: [] as IptvChannel[] };
    });

    const result = await loadAndVerifyIptvChannels([channel("with-guide"), channel("without-guide")], [
      "https://guide.example/one.xml",
      "https://guide.example/one.xml",
      "https://guide.example/unavailable.xml",
    ], {
      fetchGuide: async url => {
        events.push(url);
        if (url.endsWith("unavailable.xml")) throw new Error("offline");
        return "guide";
      },
      parseGuide: () => guide,
      verifyChannels,
    });

    expect(events.at(-1)).toBe("verify");
    expect(events.filter(event => event !== "verify")).toEqual([
      "https://guide.example/one.xml",
      "https://guide.example/unavailable.xml",
    ]);
    expect(verifyChannels).toHaveBeenCalledTimes(1);
    expect(result.guides).toEqual([guide]);
    expect(result.channels).toHaveLength(2);
    expect(result.failedChannels).toEqual([]);
  });

  it("checks every distinct channel with bounded concurrency and only returns confirmed working signals", async () => {
    let active = 0;
    let maximumActive = 0;
    const probe = vi.fn(async ({ url }: { url: string }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return !url.includes("offline");
    });
    const progress: Array<[number, number]> = [];

    const result = await verifyIptvChannels(
      [channel("one"), channel("offline"), channel("three")],
      {
        concurrency: 2,
        force: true,
        resolveStream: async item => item,
        probe,
        onProgress: ({ completed, total }) => progress.push([completed, total]),
      },
    );

    expect(probe).toHaveBeenCalledTimes(4);
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(result.channels.map(item => item.id)).toEqual(["one", "three"]);
    expect(result.failedChannels.map(item => item.id)).toEqual(["offline"]);
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it("does not cache failures, so a refresh can restore a temporarily hidden channel", async () => {
    const item = channel("retry-me");
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const options = { resolveStream: async (value: IptvChannel) => value, probe };

    const first = await verifyIptvChannels([item], { ...options, force: true });
    const refreshed = await verifyIptvChannels([item], options);

    expect(first.channels).toEqual([]);
    expect(refreshed.channels).toEqual([item]);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("reuses recent successes but force refresh performs the check again", async () => {
    const item = channel("cached-success");
    const probe = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const options = { resolveStream: async (value: IptvChannel) => value, probe };

    expect((await verifyIptvChannels([item], { ...options, force: true })).channels).toEqual([item]);
    expect((await verifyIptvChannels([item], options)).channels).toEqual([item]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect((await verifyIptvChannels([item], { ...options, force: true })).channels).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(3);
  });
});
