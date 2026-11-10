import { GUIDE_END, GUIDE_START, programmePosition, type GuideChannel, type GuideProgramme } from "./channelDemo";

/** Vertical movement follows broadcast time, not programme index or cell centre. */
export function adjacentChannelProgramme(
  channels: readonly GuideChannel[], channelId: string, time: number, direction: -1 | 1,
): { channel: GuideChannel; programme: GuideProgramme } | null {
  const index = channels.findIndex(channel => channel.id === channelId);
  if (index < 0) return null;
  const channel = channels[index + direction];
  if (!channel) return null;
  const programmes = channel.programmes.filter(programme => programmePosition(programme));
  const anchor = Math.max(GUIDE_START, Math.min(GUIDE_END - 1, time));
  const programme = programmes.find(item => item.start <= anchor && item.end > anchor)
    ?? programmes.reduce<GuideProgramme | undefined>((nearest, item) => {
      const distance = (show: GuideProgramme) => Math.max(show.start - anchor, anchor - show.end, 0);
      return !nearest || distance(item) < distance(nearest) ? item : nearest;
    }, undefined);
  return programme ? { channel, programme } : null;
}
