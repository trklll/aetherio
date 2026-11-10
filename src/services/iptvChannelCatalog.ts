import type { IptvChannel } from "./iptvChannels";
import { resolveIptvChannelStream } from "./iptvChannels";
import { parseXmltv, type XmltvGuide } from "./iptvSports";
import { fetchIptvText, IPTV_SOURCE_VERIFICATION_TTL_MS, publicIptvUrl, probeIptvSource } from "./iptvSportsHttp";
import type { LiveSource } from "../types/liveSports";

const GUIDE_CONCURRENCY = 2;
const VERIFICATION_CONCURRENCY = 8;
const FAILURE_CONFIRMATIONS = 2;

export interface ChannelVerificationProgress {
  completed: number;
  total: number;
  online: number;
  offline: number;
}

export interface ChannelVerificationResult {
  channels: IptvChannel[];
  failedChannels: IptvChannel[];
}

export interface VerifyIptvChannelsOptions {
  concurrency?: number;
  force?: boolean;
  resolveStream?: (channel: IptvChannel) => Promise<IptvChannel>;
  probe?: (source: LiveSource) => Promise<boolean>;
  onProgress?: (progress: ChannelVerificationProgress) => void;
}

interface GuideProgress {
  guides: XmltvGuide[];
  completed: number;
  total: number;
}

interface LoadAndVerifyOptions {
  force?: boolean;
  fetchGuide?: (url: string) => Promise<string>;
  parseGuide?: (text: string) => XmltvGuide;
  verifyChannels?: typeof verifyIptvChannels;
  onGuideProgress?: (progress: GuideProgress) => void;
  onVerificationProgress?: (progress: ChannelVerificationProgress) => void;
}

const verifiedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();

function verificationKey(channel: IptvChannel) {
  return `${channel.id}\u0000${channel.streamUrl}\u0000${channel.playlistUrl ?? ""}`;
}

function liveSource(channel: IptvChannel, resolved: IptvChannel): LiveSource {
  return {
    id: `${channel.sourceId}:${channel.id}`,
    label: channel.sourceName,
    url: resolved.streamUrl,
    quality: resolved.quality,
    language: resolved.language,
    providerId: channel.sourceId,
    origin: "iptv",
    channelName: channel.name,
  };
}

async function verifyOne(
  channel: IptvChannel,
  options: Required<Pick<VerifyIptvChannelsOptions, "resolveStream" | "probe">>,
  force: boolean,
): Promise<boolean> {
  const key = verificationKey(channel);
  const successAt = verifiedAt.get(key);
  if (!force && successAt !== undefined && Date.now() - successAt < IPTV_SOURCE_VERIFICATION_TTL_MS) return true;

  const pending = !force ? inFlight.get(key) : undefined;
  if (pending) return pending;

  const task = (async () => {
    for (let attempt = 0; attempt < FAILURE_CONFIRMATIONS; attempt += 1) {
      try {
        const resolved = await options.resolveStream(channel);
        if (await options.probe(liveSource(channel, resolved))) {
          verifiedAt.set(key, Date.now());
          return true;
        }
      } catch {
        // Transient HTTP errors get a second, independent chance before hiding.
      }
    }
    verifiedAt.delete(key);
    return false;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}

/** Checks every catalog entry; only confirmed failures are returned for temporary hiding. */
export async function verifyIptvChannels(
  channels: IptvChannel[],
  options: VerifyIptvChannelsOptions = {},
): Promise<ChannelVerificationResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? VERIFICATION_CONCURRENCY));
  const total = channels.length;
  const results = new Array<boolean>(total).fill(false);
  let cursor = 0;
  let completed = 0;
  let online = 0;
  let offline = 0;
  const dependencies = {
    resolveStream: options.resolveStream ?? resolveIptvChannelStream,
    probe: options.probe ?? probeIptvSource,
  };

  options.onProgress?.({ completed, total, online, offline });
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (cursor < total) {
      const index = cursor++;
      const works = await verifyOne(channels[index], dependencies, Boolean(options.force));
      results[index] = works;
      completed += 1;
      if (works) online += 1;
      else offline += 1;
      options.onProgress?.({ completed, total, online, offline });
    }
  }));

  return {
    channels: channels.filter((_, index) => results[index]),
    failedChannels: channels.filter((_, index) => !results[index]),
  };
}

/** Downloads all unique available XMLTV guides before beginning stream verification. */
export async function loadAndVerifyIptvChannels(
  channels: IptvChannel[],
  guideUrls: string[],
  options: LoadAndVerifyOptions = {},
): Promise<ChannelVerificationResult & { guides: XmltvGuide[] }> {
  const urls = [...new Set(guideUrls.map(url => publicIptvUrl(url)?.href).filter((url): url is string => Boolean(url)))];
  const fetchGuide = options.fetchGuide ?? fetchIptvText;
  const parseGuide = options.parseGuide ?? parseXmltv;
  const guides: XmltvGuide[] = [];
  let nextIndex = 0;
  let completed = 0;
  const reportGuideProgress = () => options.onGuideProgress?.({ guides: [...guides], completed, total: urls.length });
  reportGuideProgress();

  await Promise.all(Array.from({ length: Math.min(GUIDE_CONCURRENCY, urls.length) }, async () => {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex++];
      try {
        guides.push(parseGuide(await fetchGuide(url)));
      } catch {
        // A missing guide never changes whether a stream is retained.
      } finally {
        completed += 1;
        reportGuideProgress();
      }
    }
  }));

  const result = await (options.verifyChannels ?? verifyIptvChannels)(channels, {
    force: options.force,
    onProgress: options.onVerificationProgress,
  });
  return { ...result, guides };
}

/** Used when a caller needs to invalidate stale positive checks explicitly. */
export function clearIptvChannelVerificationCache(): void {
  verifiedAt.clear();
}
