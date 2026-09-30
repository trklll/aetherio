import { describe, expect, it } from "vitest";
import { buildDetailPath, buildEntityPath, buildEpisodePath, buildHomePath, buildPersonPath, buildPlayerBackPath, buildPlayerPath, detailDataMatchesRoute } from "./bigPictureDetail";

describe("buildEpisodePath", () => {
  it("keeps the normal episode route outside Big Picture", () => {
    expect(buildEpisodePath("type=series&id=tt123", "/detail/series/tt123"))
      .toBe("/episode?type=series&id=tt123");
  });

  it("keeps the Big Picture episode route inside Big Picture", () => {
    expect(buildEpisodePath("type=series&id=tt123", "/big-picture/detail/series/tt123"))
      .toBe("/big-picture/episode?type=series&id=tt123");
  });
});

describe("buildDetailPath", () => {
  it("keeps the detail return route inside Big Picture", () => {
    expect(buildDetailPath("series", "tt123", "fromStreams=1", "/big-picture/episode"))
      .toBe("/big-picture/detail/series/tt123?fromStreams=1");
  });
});

describe("detailDataMatchesRoute", () => {
  it("accepts a canonicalized type when the detail ID is unchanged", () => {
    expect(detailDataMatchesRoute({ id: "tmdb:149", type: "anime" }, "tmdb:149")).toBe(true);
  });

  it("rejects data from a different detail route", () => {
    expect(detailDataMatchesRoute({ id: "tmdb:149" }, "tmdb:241585")).toBe(false);
  });
});

describe("big picture never escapes to normal mode", () => {
  it("player stays inside Big Picture", () => {
    expect(buildPlayerPath("type=movie&id=tt123", "/big-picture/detail/movie/tt123"))
      .toBe("/big-picture/player?type=movie&id=tt123");
    expect(buildPlayerPath("type=movie&id=tt123", "/detail/movie/tt123"))
      .toBe("/player?type=movie&id=tt123");
  });

  it("person stays inside Big Picture", () => {
    expect(buildPersonPath(123, "/big-picture/search"))
      .toBe("/big-picture/person/123");
    expect(buildPersonPath(123, "/search"))
      .toBe("/person/123");
  });

  it("entity stays inside Big Picture", () => {
    expect(buildEntityPath("network", 1, "/big-picture/detail/series/x"))
      .toBe("/big-picture/entity/network/1");
    expect(buildEntityPath("network", 1, "/detail/series/x"))
      .toBe("/entity/network/1");
  });

  it("home fallback stays inside Big Picture", () => {
    expect(buildHomePath("/big-picture/detail/series/x")).toBe("/big-picture");
    expect(buildHomePath("/detail/series/x")).toBe("/home");
  });
});

describe("buildPlayerBackPath", () => {
  it("returns to the episode picker, never to the detail", () => {
    expect(buildPlayerBackPath("type=series&id=tt123&season=2&ep=5", "/player"))
      .toBe("/episode?type=series&id=tt123&season=2&ep=5&fromPlayer=1");
    expect(buildPlayerBackPath("type=series&id=tt123&season=2&ep=5", "/big-picture/player"))
      .toBe("/big-picture/episode?type=series&id=tt123&season=2&ep=5&fromPlayer=1");
  });

  it("marks the return as coming from the player so autoplay stays off", () => {
    const path = buildPlayerBackPath("type=movie&id=tt123", "/player");
    expect(new URLSearchParams(path?.split("?")[1] ?? "").get("fromPlayer")).toBe("1");
  });

  it("carries the search origin so the detail back path keeps working", () => {
    expect(buildPlayerBackPath("type=series&id=tt123&fromSearch=1&q=obsesion", "/player"))
      .toBe("/episode?type=series&id=tt123&fromSearch=1&q=obsesion&fromPlayer=1");
  });

  it("drops params the picker does not need", () => {
    expect(buildPlayerBackPath("type=movie&id=tt123&trailer=1&local=7", "/player"))
      .toBe("/episode?type=movie&id=tt123&fromPlayer=1");
  });

  it("returns null without a media identity to rebuild", () => {
    expect(buildPlayerBackPath("local=7", "/player")).toBeNull();
    expect(buildPlayerBackPath("", "/player")).toBeNull();
  });
});
