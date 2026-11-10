import type { SelectOption } from "./types";
import type { MediaStream } from "../../types/stream";

/** Menu rows for live Sports streams, excluding IPTV matches past their guide window. */
export function buildSportsSourceOptions(streams: readonly MediaStream[], now = Date.now()): SelectOption[] {
  return streams
    .filter(stream => {
      const expiresAt = stream.behaviorHints?.liveSourceExpiresAt;
      return typeof expiresAt !== "string" || Date.parse(expiresAt) > now;
    })
    .map(stream => {
      const label = [stream.sourceName, stream.addonName, stream.name]
        .find(value => typeof value === "string" && value.trim())
        ?.trim() ?? "Fuente";
      const channelName = stream.behaviorHints?.channelName;
      const details = [
        typeof channelName === "string" && channelName.trim()
          ? channelName.trim()
          : stream.name?.trim() !== label ? stream.name?.trim() : undefined,
        readBehaviorText(stream, "quality"),
        readBehaviorText(stream, "language"),
      ].filter((value): value is string => Boolean(value));

      return {
        value: stream.id,
        label,
        description: [...new Set(details)].join(" · ") || undefined,
      };
    });
}

export function shouldShowSportsSourceMenu(sportsLiveMode: boolean, options: readonly SelectOption[]): boolean {
  return sportsLiveMode && new Set(options.map(option => option.value).filter(Boolean)).size > 1;
}

function readBehaviorText(stream: MediaStream, key: string): string | undefined {
  const value = stream.behaviorHints?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
