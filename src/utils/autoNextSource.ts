import type { MediaStream } from "../types/stream.ts";

export interface AutoNextSourceHint {
  addonId?: string;
  addonName?: string;
  name?: string;
  title?: string;
  bingeGroup?: string;
}

export function pickBestMatchingSource(streams: MediaStream[], hint: AutoNextSourceHint) {
  const normalize = (value?: string) => (value ?? "").trim().toLowerCase();
  const bingeGroup = normalize(hint.bingeGroup);
  const sameGroup = bingeGroup
    ? streams.filter(stream => normalize(stream.behaviorHints?.bingeGroup) === bingeGroup)
    : streams;
  const candidates = sameGroup.length ? sameGroup : streams;
  const scored = candidates
    .map(stream => ({ stream, score: sourceScore(stream, hint) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score > 0 ? best.stream : null;
}

export function sourceScore(stream: MediaStream, hint: AutoNextSourceHint) {
  const normalize = (value?: string) => (value ?? "").trim().toLowerCase();
  const addonId = normalize(hint.addonId);
  const addonName = normalize(hint.addonName);
  const name = normalize(hint.name);
  const title = normalize(hint.title);
  const bingeGroup = normalize(hint.bingeGroup);
  let score = 0;

  if (bingeGroup && normalize(stream.behaviorHints?.bingeGroup) === bingeGroup) score += 12;
  if (addonId && normalize(stream.addonId) === addonId) score += 8;
  if (addonName && normalize(stream.addonName) === addonName) score += 4;
  if (name && normalize(stream.name) === name) score += 3;
  if (title) {
    const streamTitle = normalize(stream.title);
    const streamDescription = normalize(stream.description);
    if (streamTitle && streamTitle === title) score += 3;
    if (streamDescription && streamDescription.includes(title)) score += 1;
  }

  return score;
}
