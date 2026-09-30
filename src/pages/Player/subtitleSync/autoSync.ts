import type { SubtitleSyncCue } from "./parser";

export type AutoSubtitleSyncMode = "unchanged" | "delay" | "retime";

export interface AutoSubtitleSyncAnchor {
  fromTimeMs: number;
  /** Multiplicador de tiempo del tramo. 1 = el tramo solo necesita un desplazamiento. */
  scale: number;
  offsetMs: number;
}

export interface AutoSubtitleSyncPlan {
  confident: boolean;
  mode: AutoSubtitleSyncMode;
  confidence: number;
  delayMs: number;
  scale: number;
  cues: SubtitleSyncCue[];
  anchors: AutoSubtitleSyncAnchor[];
  reason: string;
}

interface TimedPair {
  targetTimeMs: number;
  referenceTimeMs: number;
}

interface AlignmentCandidate {
  scale: number;
  offsetMs: number;
  score: number;
  matches: number;
  margin: number;
}

const MIN_SCORE = 0.78;
const MIN_MARGIN = 0.02;
const MATCH_TOLERANCE_MS = 1_200;
const OFFSET_SEARCH_STEP_MS = 250;
const MAX_OFFSET_MS = 60_000;
const STANDARD_SCALES = [
  1,
  25 / 23.976,
  23.976 / 25,
  25 / 24,
  24 / 25,
  24 / 23.976,
  23.976 / 24,
];

function normalizeCues(cues: SubtitleSyncCue[]): SubtitleSyncCue[] {
  return cues
    .filter(cue => Number.isFinite(cue.startTimeMs) && Number.isFinite(cue.endTimeMs) && cue.endTimeMs > cue.startTimeMs)
    .map(cue => ({ ...cue, text: cue.text.trim() }))
    .filter(cue => cue.text.length > 0)
    .sort((left, right) => left.startTimeMs - right.startTimeMs);
}

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nearestIndex(items: number[], value: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function countScaledMatches(
  source: number[],
  referenceStarts: number[],
  scale: number,
  offsetMs: number,
  toleranceMs: number,
): number {
  if (!source.length || !referenceStarts.length) return 0;
  let matches = 0;
  for (const start of source) {
    const value = start * scale + offsetMs;
    const index = nearestIndex(referenceStarts, value);
    if (
      (index < referenceStarts.length && Math.abs(referenceStarts[index] - value) <= toleranceMs)
      || (index > 0 && Math.abs(referenceStarts[index - 1] - value) <= toleranceMs)
    ) matches += 1;
  }
  return matches;
}

function scoreFromMatches(matches: number, sourceCount: number, referenceCount: number) {
  if (!sourceCount || !referenceCount) return 0;
  const precision = matches / sourceCount;
  const recall = matches / referenceCount;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

// `referenceStarts` se calcula una sola vez por referencia: `alignmentScore` se
// llama cientos de veces por busqueda y remapear el VTT entero en cada llamada
// dominaba el tiempo de la operacion.
function alignmentScoreAgainst(
  target: SubtitleSyncCue[],
  referenceStarts: number[],
  scale: number,
  offsetMs: number,
): { score: number; matches: number } {
  if (!target.length || !referenceStarts.length) return { score: 0, matches: 0 };
  const targetStarts = target.map(cue => cue.startTimeMs);
  const matches = countScaledMatches(targetStarts, referenceStarts, scale, offsetMs, MATCH_TOLERANCE_MS);
  return { score: scoreFromMatches(matches, targetStarts.length, referenceStarts.length), matches };
}

function alignmentScore(
  target: SubtitleSyncCue[],
  reference: SubtitleSyncCue[],
  scale: number,
  offsetMs: number,
): { score: number; matches: number } {
  return alignmentScoreAgainst(target, reference.map(cue => cue.startTimeMs), scale, offsetMs);
}

// El cluster denso se busca con dos punteros: el barrido anterior era O(n^2) y
// degeneraba justo en el caso habitual, cuando todos los valores caen dentro de
// la tolerancia (subtitulos con un retraso uniforme).
function clusterValues(values: number[], toleranceMs: number): { value: number; count: number } {
  if (!values.length) return { value: 0, count: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const tolerance = Math.max(0, toleranceMs);
  let bestStart = 0;
  let bestEnd = 0;
  let end = 0;
  let total = 0;
  for (let start = 0; start < sorted.length; start += 1) {
    while (end < sorted.length && sorted[end] - sorted[start] <= tolerance) {
      total += sorted[end];
      end += 1;
    }
    if (end - start > bestEnd - bestStart || (end - start === bestEnd - bestStart && total > 0)) {
      bestStart = start;
      bestEnd = end;
    }
    total -= sorted[start];
  }
  const cluster = sorted.slice(bestStart, bestEnd);
  return {
    value: cluster.reduce((sum, current) => sum + current, 0) / cluster.length,
    count: cluster.length,
  };
}

function buildTimedPairs(target: SubtitleSyncCue[], reference: SubtitleSyncCue[]): TimedPair[] {
  const referenceByText = new Map<string, number[]>();
  const targetByText = new Map<string, number[]>();
  reference.forEach(cue => {
    const key = normalizeText(cue.text);
    if (key.length < 3) return;
    const values = referenceByText.get(key) ?? [];
    values.push(cue.startTimeMs);
    referenceByText.set(key, values);
  });
  target.forEach(cue => {
    const key = normalizeText(cue.text);
    if (key.length < 3) return;
    const values = targetByText.get(key) ?? [];
    values.push(cue.startTimeMs);
    targetByText.set(key, values);
  });

  const pairs: TimedPair[] = [];
  targetByText.forEach((targetTimes, key) => {
    const referenceTimes = referenceByText.get(key);
    if (!referenceTimes?.length || !targetTimes.length) return;
    targetTimes.sort((left, right) => left - right);
    referenceTimes.sort((left, right) => left - right);
    const pairCount = Math.min(targetTimes.length, referenceTimes.length);
    for (let index = 0; index < pairCount; index += 1) {
      const referenceIndex = targetTimes.length === 1
        ? 0
        : Math.round((index * (referenceTimes.length - 1)) / (targetTimes.length - 1));
      pairs.push({
        targetTimeMs: targetTimes[index],
        referenceTimeMs: referenceTimes[referenceIndex],
      });
    }
  });
  return pairs.sort((left, right) => left.targetTimeMs - right.targetTimeMs);
}

function estimateActivityOffset(
  target: SubtitleSyncCue[],
  referenceStarts: number[],
  lowerOffsetMs = -MAX_OFFSET_MS,
  upperOffsetMs = MAX_OFFSET_MS,
): { offsetMs: number; score: number; matches: number } {
  const targetStarts = target.map(cue => cue.startTimeMs);
  let best = { offsetMs: 0, score: 0, matches: 0 };
  for (let offsetMs = lowerOffsetMs; offsetMs <= upperOffsetMs; offsetMs += OFFSET_SEARCH_STEP_MS) {
    const matches = countScaledMatches(targetStarts, referenceStarts, 1, offsetMs, MATCH_TOLERANCE_MS);
    const score = matches / Math.max(1, targetStarts.length);
    if (score > best.score || (score === best.score && Math.abs(offsetMs) < Math.abs(best.offsetMs))) {
      best = { offsetMs, score, matches };
    }
  }
  return best;
}

function estimateSlope(pairs: TimedPair[]): number {
  // La pendiente es global: basta una muestra representativa de los pares en vez
  // de todas las combinaciones posibles (O(n^2) sobre una pelicula completa).
  const stride = Math.max(1, Math.ceil(pairs.length / 240));
  const sample = stride === 1 ? pairs : pairs.filter((_, index) => index % stride === 0);
  const slopes: number[] = [];
  for (let left = 0; left < sample.length; left += 1) {
    for (let right = left + 1; right < sample.length; right += 1) {
      const targetDelta = sample[right].targetTimeMs - sample[left].targetTimeMs;
      const referenceDelta = sample[right].referenceTimeMs - sample[left].referenceTimeMs;
      if (Math.abs(targetDelta) < 120_000 || Math.abs(referenceDelta) < 120_000) continue;
      const slope = referenceDelta / targetDelta;
      if (Number.isFinite(slope) && slope >= 0.94 && slope <= 1.06) slopes.push(slope);
    }
  }
  if (!slopes.length) return 1;
  const cluster = clusterValues(slopes.map(value => Math.round(value * 10_000)), 20);
  return cluster.value / 10_000;
}

function alignmentMargin(
  target: SubtitleSyncCue[],
  referenceStarts: number[],
  scale: number,
  offsetMs: number,
): number {
  let alternative = 0;
  for (let deltaMs = -10_000; deltaMs <= 10_000; deltaMs += OFFSET_SEARCH_STEP_MS) {
    if (Math.abs(deltaMs) <= 1_500) continue;
    const score = alignmentScoreAgainst(target, referenceStarts, scale, offsetMs + deltaMs).score;
    alternative = Math.max(alternative, score);
  }
  return Math.max(0, alignmentScoreAgainst(target, referenceStarts, scale, offsetMs).score - alternative);
}

function estimateCandidate(
  target: SubtitleSyncCue[],
  referenceStarts: number[],
  pairs: TimedPair[],
  initialOffsetMs: number,
): AlignmentCandidate {
  const observedScale = estimateSlope(pairs);
  const candidates = Array.from(new Set([
    ...STANDARD_SCALES,
    observedScale,
    1 / observedScale,
  ].map(value => Number(value.toFixed(6)))));

  let best: AlignmentCandidate = {
    scale: 1,
    offsetMs: initialOffsetMs,
    score: 0,
    matches: 0,
    margin: 0,
  };
  let bestPairError = Number.POSITIVE_INFINITY;

  for (const scale of candidates) {
    if (scale < 0.9 || scale > 1.11) continue;
    const pairOffsets = pairs.map(pair => pair.referenceTimeMs - pair.targetTimeMs * scale);
    const clustered = pairOffsets.length >= 3
      ? clusterValues(pairOffsets, MATCH_TOLERANCE_MS)
      : { value: initialOffsetMs, count: 0 };
    const center = clustered.count >= 3 ? clustered.value : initialOffsetMs;
    for (let deltaMs = -4_000; deltaMs <= 4_000; deltaMs += OFFSET_SEARCH_STEP_MS) {
      const offsetMs = center + deltaMs;
      const evaluated = alignmentScoreAgainst(target, referenceStarts, scale, offsetMs);
      const pairError = pairs.reduce((total, pair) => total + Math.abs(pair.referenceTimeMs - (pair.targetTimeMs * scale + offsetMs)), 0);
      if (evaluated.score > best.score + 1e-9 || (Math.abs(evaluated.score - best.score) <= 1e-9 && pairError < bestPairError)) {
        best = {
          scale,
          offsetMs,
          score: evaluated.score,
          matches: evaluated.matches,
          margin: 0,
        };
        bestPairError = pairError;
      }
    }
  }
  best.offsetMs = Math.round(best.offsetMs);
  best.margin = alignmentMargin(target, referenceStarts, best.scale, best.offsetMs);
  return best;
}

function referenceForSegment(
  reference: SubtitleSyncCue[],
  startTimeMs: number,
  endTimeMs: number,
): SubtitleSyncCue[] {
  const marginMs = 5_000;
  return reference.filter(cue => cue.startTimeMs >= startTimeMs - marginMs && cue.startTimeMs < endTimeMs + marginMs);
}

// Un tramo con escala != 1 vive en otra ventana de la linea de tiempo de
// referencia, asi que el rango se busca despues de aplicar escala y offset.
function segmentReference(
  reference: SubtitleSyncCue[],
  anchor: AutoSubtitleSyncAnchor,
  startTimeMs: number,
  endTimeMs: number,
): SubtitleSyncCue[] {
  if (anchor.scale === 1) return referenceForSegment(reference, startTimeMs, endTimeMs);
  const marginMs = 5_000;
  const lower = startTimeMs * anchor.scale + anchor.offsetMs - marginMs;
  const upper = endTimeMs === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : endTimeMs * anchor.scale + anchor.offsetMs + marginMs;
  return reference.filter(cue => cue.startTimeMs >= lower && cue.startTimeMs < upper);
}

function estimateSegment(
  target: SubtitleSyncCue[],
  reference: SubtitleSyncCue[],
  pairs: TimedPair[],
  startTimeMs: number,
  endTimeMs: number,
): { offsetMs: number; score: number; matches: number } | null {
  const targetSegment = target.filter(cue => cue.startTimeMs >= startTimeMs && cue.startTimeMs < endTimeMs);
  const pairsSegment = pairs.filter(pair => pair.targetTimeMs >= startTimeMs && pair.targetTimeMs < endTimeMs);
  if (targetSegment.length < 4 || pairsSegment.length < 4) return null;
  const offsets = pairsSegment.map(pair => pair.referenceTimeMs - pair.targetTimeMs);
  const cluster = clusterValues(offsets, MATCH_TOLERANCE_MS);
  const referenceSegment = referenceForSegment(reference, startTimeMs, endTimeMs);
  const evaluated = alignmentScore(targetSegment, referenceSegment, 1, cluster.value);
  if (evaluated.score < 0.72 || evaluated.matches < 4) return null;
  return { offsetMs: Math.round(cluster.value), score: evaluated.score, matches: evaluated.matches };
}

function detectOffsetChange(pairs: TimedPair[]): number {
  if (pairs.length < 8) return -1;
  const offsets = pairs.map(pair => pair.referenceTimeMs - pair.targetTimeMs);
  let bestSplit = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let split = 4; split <= pairs.length - 4; split += 1) {
    const left = clusterValues(offsets.slice(0, split), 600);
    const right = clusterValues(offsets.slice(split), 600);
    const leftSpread = Math.max(...offsets.slice(0, split)) - Math.min(...offsets.slice(0, split));
    const rightSpread = Math.max(...offsets.slice(split)) - Math.min(...offsets.slice(split));
    const separation = Math.abs(left.value - right.value);
    if (leftSpread > 600 || rightSpread > 600 || separation < 1_500) continue;
    const score = Math.min(left.count, right.count) * 10_000 + separation;
    if (score > bestScore) {
      bestScore = score;
      bestSplit = split;
    }
  }
  return bestSplit;
}

function buildAnchors(
  target: SubtitleSyncCue[],
  reference: SubtitleSyncCue[],
  pairs: TimedPair[],
): AutoSubtitleSyncAnchor[] {
  const sortedPairs = [...pairs].sort((left, right) => left.targetTimeMs - right.targetTimeMs);
  const anchors: AutoSubtitleSyncAnchor[] = [];
  const visit = (start: number, end: number, depth: number): boolean => {
    const range = sortedPairs.slice(start, end);
    if (range.length < 4) return false;
    const split = depth < 3 ? detectOffsetChange(range) : -1;
    if (split > 0) {
      return visit(start, start + split, depth + 1) && visit(start + split, end, depth + 1);
    }
    const startTimeMs = range[0].targetTimeMs;
    const endTimeMs = end < sortedPairs.length ? sortedPairs[end].targetTimeMs : Number.POSITIVE_INFINITY;
    const segment = estimateSegment(target, reference, sortedPairs, startTimeMs, endTimeMs);
    if (!segment) return false;
    anchors.push({ fromTimeMs: Math.round(startTimeMs), scale: 1, offsetMs: segment.offsetMs });
    return true;
  };
  return visit(0, sortedPairs.length, 0) ? anchors : [];
}

// Un archivo puede venir con un tramo a media o un tercio de velocidad (conversiones
// 2x/3x, extracciones automaticas). En esos tramos no basta un desplazamiento:
// hace falta buscar la mejor division del archivo en tramos, cada uno con su escala
// y su offset. Se resuelve con una programacion dinamica sobre los pares ya
// emparejados: el coste de un tramo es su error medio, y cada corte o escala
// distinta de 1 paga una penalizacion para no partir el archivo sin motivo.
const BANDED_SCALES = [1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3];
const BANDED_MIN_SEGMENT_PAIRS = 4;
const BANDED_MAX_SEGMENTS = 8;
const BANDED_MAX_SAMPLE_PAIRS = 120;
const BANDED_SEGMENT_PENALTY_MS = 400;
const BANDED_SCALE_PENALTY_MS = 1_500;
const BANDED_MIN_IMPROVEMENT_MS = 750;

interface BandedSegment {
  fromTimeMs: number;
  scale: number;
  offsetMs: number;
  meanResidualMs: number;
}

function fitBandedSegment(segment: TimedPair[]): BandedSegment | null {
  if (segment.length < BANDED_MIN_SEGMENT_PAIRS) return null;
  let best = { scale: 1, offsetMs: 0, meanResidualMs: Number.POSITIVE_INFINITY };
  const measure = (scale: number, offsetMs: number) => {
    let residual = 0;
    for (const pair of segment) {
      residual += Math.abs(pair.referenceTimeMs - (pair.targetTimeMs * scale + offsetMs));
    }
    return residual / segment.length;
  };
  const consider = (scale: number, offsetMs: number) => {
    const meanResidualMs = measure(scale, offsetMs);
    const better = meanResidualMs < best.meanResidualMs - 1e-9
      // A igualdad de error gana la escala 1: es la correccion menos invasiva.
      || (Math.abs(meanResidualMs - best.meanResidualMs) <= 1e-9 && scale === 1 && best.scale !== 1);
    if (better) best = { scale, offsetMs, meanResidualMs };
  };

  for (const rawScale of BANDED_SCALES) {
    const scale = Number(rawScale.toFixed(6));
    const offsets = segment.map(pair => pair.referenceTimeMs - pair.targetTimeMs * scale);
    const cluster = clusterValues(offsets, MATCH_TOLERANCE_MS);
    const center = cluster.count >= Math.min(3, segment.length) ? cluster.value : offsets[0];
    consider(scale, center);
    if (scale === 1 || best.scale === scale) {
      for (let deltaMs = -1_000; deltaMs <= 1_000; deltaMs += 500) {
        if (deltaMs === 0) continue;
        consider(scale, center + deltaMs);
      }
    }
  }

  if (!Number.isFinite(best.meanResidualMs)) return null;
  return {
    fromTimeMs: Math.round(segment[0].targetTimeMs),
    scale: best.scale,
    offsetMs: Math.round(best.offsetMs),
    meanResidualMs: best.meanResidualMs,
  };
}

function buildBandedAnchors(
  pairs: TimedPair[],
): { anchors: AutoSubtitleSyncAnchor[]; meanResidualMs: number } | null {
  const sortedPairs = [...pairs].sort((left, right) => left.targetTimeMs - right.targetTimeMs);
  if (sortedPairs.length < BANDED_MIN_SEGMENT_PAIRS * 2) return null;
  // Con subtitulos muy largos se muestrea: la division se decide sobre la forma
  // general, no sobre cada linea.
  const stride = Math.max(1, Math.ceil(sortedPairs.length / BANDED_MAX_SAMPLE_PAIRS));
  const sample = sortedPairs.filter((_, index) => index % stride === 0);
  const count = sample.length;
  if (count < BANDED_MIN_SEGMENT_PAIRS * 2) return null;

  const cost = new Array<number>(count + 1).fill(Number.POSITIVE_INFINITY);
  const from = new Array<number>(count + 1).fill(-1);
  const chosen = new Array<BandedSegment | null>(count + 1).fill(null);
  cost[0] = 0;

  for (let start = 0; start < count; start += 1) {
    if (!Number.isFinite(cost[start])) continue;
    for (let end = start + BANDED_MIN_SEGMENT_PAIRS; end <= count; end += 1) {
      const segment = fitBandedSegment(sample.slice(start, end));
      if (!segment) continue;
      const penalty = segment.meanResidualMs
        + (segment.scale === 1 ? 0 : BANDED_SCALE_PENALTY_MS)
        + BANDED_SEGMENT_PENALTY_MS;
      const total = cost[start] + penalty;
      if (total < cost[end] - 1e-9) {
        cost[end] = total;
        from[end] = start;
        chosen[end] = segment;
      }
    }
  }
  if (!Number.isFinite(cost[count])) return null;

  const segments: BandedSegment[] = [];
  let cursor = count;
  while (cursor > 0 && from[cursor] >= 0) {
    const segment = chosen[cursor];
    if (segment) segments.push(segment);
    cursor = from[cursor];
  }
  segments.reverse();
  if (segments.length < 2 || segments.length > BANDED_MAX_SEGMENTS) return null;
  // Si ningun tramo necesita escala, la division por offsets por segmentos ya
  // resuelve el caso con menos cambios sobre el archivo original.
  if (!segments.some(segment => segment.scale !== 1)) return null;

  const meanResidualMs = segments.reduce((total, segment) => total + segment.meanResidualMs, 0) / segments.length;
  return {
    anchors: segments.map(segment => ({
      fromTimeMs: segment.fromTimeMs,
      scale: segment.scale,
      offsetMs: segment.offsetMs,
    })),
    meanResidualMs,
  };
}

function meanAnchorResidual(anchors: AutoSubtitleSyncAnchor[], pairs: TimedPair[]): number {
  if (!anchors.length || !pairs.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const pair of pairs) {
    let anchor = anchors[0];
    for (const candidate of anchors) {
      if (pair.targetTimeMs >= candidate.fromTimeMs) anchor = candidate;
      else break;
    }
    total += Math.abs(pair.referenceTimeMs - (pair.targetTimeMs * anchor.scale + anchor.offsetMs));
  }
  return total / pairs.length;
}

function transformWithAnchors(cues: SubtitleSyncCue[], anchors: AutoSubtitleSyncAnchor[]): SubtitleSyncCue[] {
  return repairCues(cues.map(cue => {
    let anchor = anchors[0];
    for (const candidate of anchors) {
      if (cue.startTimeMs >= candidate.fromTimeMs) anchor = candidate;
      else break;
    }
    const startTimeMs = Math.max(0, Math.round(cue.startTimeMs * anchor.scale + anchor.offsetMs));
    return {
      ...cue,
      startTimeMs,
      endTimeMs: startTimeMs + (cue.endTimeMs - cue.startTimeMs),
    };
  }));
}

function transformWithScale(
  cues: SubtitleSyncCue[],
  scale: number,
  offsetMs: number,
): SubtitleSyncCue[] {
  return repairCues(cues.map(cue => {
    const duration = cue.endTimeMs - cue.startTimeMs;
    const startTimeMs = Math.max(0, Math.round(cue.startTimeMs * scale + offsetMs));
    return { ...cue, startTimeMs, endTimeMs: startTimeMs + duration };
  }));
}

function repairCues(cues: SubtitleSyncCue[]): SubtitleSyncCue[] {
  const sorted = cues.map(cue => ({ ...cue })).sort((left, right) => left.startTimeMs - right.startTimeMs);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const duration = current.endTimeMs - current.startTimeMs;
    if (current.startTimeMs >= previous.endTimeMs) continue;
    const nextStart = previous.endTimeMs;
    current.startTimeMs = nextStart;
    current.endTimeMs = nextStart + Math.max(1, duration);
  }
  return sorted;
}

function confidenceFor(candidate: AlignmentCandidate, targetCount: number): number {
  const coverage = Math.min(1, candidate.matches / Math.max(1, Math.min(20, targetCount)));
  const margin = Math.min(1, candidate.margin / 0.08);
  return Math.max(0, Math.min(1, candidate.score * 0.65 + coverage * 0.2 + margin * 0.15));
}

function unchanged(target: SubtitleSyncCue[], reason: string): AutoSubtitleSyncPlan {
  return {
    confident: false,
    mode: "unchanged",
    confidence: 0,
    delayMs: 0,
    scale: 1,
    cues: target,
    anchors: [],
    reason,
  };
}

function analyzeReference(
  target: SubtitleSyncCue[],
  reference: SubtitleSyncCue[],
  allowBanded: boolean,
): { candidate: AlignmentCandidate; anchors: AutoSubtitleSyncAnchor[]; confidence: number; reference: SubtitleSyncCue[] } | null {
  const pairs = buildTimedPairs(target, reference);
  const referenceStarts = reference.map(cue => cue.startTimeMs);
  const activity = estimateActivityOffset(target, referenceStarts);
  const initialOffsetMs = pairs.length >= 3
    ? clusterValues(pairs.map(pair => pair.referenceTimeMs - pair.targetTimeMs), MATCH_TOLERANCE_MS).value
    : activity.offsetMs;
  let candidate = estimateCandidate(target, referenceStarts, pairs, initialOffsetMs);
  let anchors: AutoSubtitleSyncAnchor[] = [];

  if (pairs.length >= Math.min(12, target.length)) {
    const offsetAnchors = buildAnchors(target, reference, pairs);
    anchors = offsetAnchors;
    // La DP banded es cara: solo se ejecuta sobre la referencia que ya gano el
    // ranking, no sobre todas.
    const banded = allowBanded ? buildBandedAnchors(pairs) : null;
    if (banded) {
      // Solo se prefiere la division banded si bate de forma clara al ajuste por
      // offsets; si empatan, gana la ruta que toca menos el archivo.
      const baseline = offsetAnchors.length >= 2
        ? meanAnchorResidual(offsetAnchors, pairs)
        : Number.POSITIVE_INFINITY;
      if (banded.meanResidualMs <= baseline - BANDED_MIN_IMPROVEMENT_MS) {
        anchors = banded.anchors;
      }
    }
    const offsetSpread = anchors.length >= 2
      ? Math.max(...anchors.map(anchor => anchor.offsetMs)) - Math.min(...anchors.map(anchor => anchor.offsetMs))
      : 0;
    const needsScale = anchors.some(anchor => anchor.scale !== 1);
    if (offsetSpread >= 1_500 || needsScale) {
      const segmentScores: number[] = [];
      let segmentMatches = 0;
      for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        const startTimeMs = anchor.fromTimeMs;
        const endTimeMs = anchors[index + 1]?.fromTimeMs ?? Number.POSITIVE_INFINITY;
        const targetSegment = target.filter(cue => cue.startTimeMs >= startTimeMs && cue.startTimeMs < endTimeMs);
        const referenceSegment = segmentReference(reference, anchor, startTimeMs, endTimeMs);
        const evaluated = alignmentScore(targetSegment, referenceSegment, anchor.scale, anchor.offsetMs);
        segmentScores.push(evaluated.score);
        segmentMatches += evaluated.matches;
      }
      const piecewiseScore = segmentScores.length ? Math.min(...segmentScores) : 0;
      if (piecewiseScore >= MIN_SCORE) {
        candidate = {
          ...candidate,
          scale: 1,
          score: piecewiseScore,
          matches: segmentMatches,
          margin: Math.max(candidate.margin, 0.04),
        };
      }
    }
  }

  if (anchors.length < 2 && pairs.length >= Math.min(12, target.length)) {
    const residuals = pairs.map(pair => Math.abs(pair.referenceTimeMs - (pair.targetTimeMs * candidate.scale + candidate.offsetMs)));
    const exact = residuals.filter(value => value <= 600).length;
    if (exact / Math.max(1, residuals.length) >= 0.8) {
      candidate = { ...candidate, margin: Math.max(candidate.margin, 0.04) };
    }
  }

  const confidence = confidenceFor(candidate, target.length);
  return { candidate, anchors, confidence, reference };
}

export function buildAutoSubtitleSyncPlan(
  targetInput: SubtitleSyncCue[],
  referencesInput: SubtitleSyncCue[][],
): AutoSubtitleSyncPlan {
  const target = normalizeCues(targetInput);
  const references = referencesInput.map(normalizeCues).filter(reference => reference.length >= 3);
  const minimumMatches = Math.min(12, target.length);
  if (target.length < 6 || !references.length) return unchanged(target, "No hay suficientes referencias locales.");

  const analyses = references
    .map(reference => analyzeReference(target, reference, false))
    .filter((analysis): analysis is NonNullable<typeof analysis> => Boolean(analysis))
    .sort((left, right) => right.confidence - left.confidence);
  const best = analyses[0];
  if (!best) return unchanged(target, "No se pudo comparar una referencia fiable.");

  const independent = analyses.filter(analysis => analysis.confidence >= 0.7).slice(0, 6);
  if (independent.length >= 3) {
    const medians = independent.map(analysis => analysis.candidate.offsetMs).sort((left, right) => left - right);
    const median = medians[Math.floor(medians.length / 2)];
    const agreeing = independent.filter(analysis => Math.abs(analysis.candidate.offsetMs - median) <= 2_000);
    if (agreeing.length < Math.max(2, Math.ceil(independent.length / 2))) {
      return unchanged(target, "Las referencias locales no coinciden entre si.");
    }
  }

  // Segunda pasada sobre la mejor referencia, ya con la division banded activada.
  const { candidate, anchors, confidence } = analyzeReference(target, best.reference, true) ?? best;
  const enoughMatches = candidate.matches >= minimumMatches;
  const confident = candidate.score >= MIN_SCORE
    && candidate.margin >= MIN_MARGIN
    && enoughMatches
    && confidence >= 0.72;
  if (!confident) return unchanged(target, "La confianza fue insuficiente; se conserva el timing original.");

  const piecewise = anchors.length >= 2 && (
    Math.max(...anchors.map(anchor => anchor.offsetMs)) - Math.min(...anchors.map(anchor => anchor.offsetMs)) >= 1_500
    || anchors.some(anchor => anchor.scale !== 1)
  );
  if (piecewise) {
    return {
      confident: true,
      mode: "retime",
      confidence,
      delayMs: anchors[0]?.offsetMs ?? 0,
      scale: 1,
      cues: transformWithAnchors(target, anchors),
      anchors,
      reason: "Sincronizado con offsets por segmentos.",
    };
  }

  if (Math.abs(candidate.scale - 1) >= 0.002) {
    return {
      confident: true,
      mode: "retime",
      confidence,
      delayMs: candidate.offsetMs,
      scale: candidate.scale,
      cues: transformWithScale(target, candidate.scale, candidate.offsetMs),
      anchors: [],
      reason: "Sincronizado con correction de framerate.",
    };
  }

  const delayMs = candidate.offsetMs;
  if (Math.abs(delayMs) <= 500) return unchanged(target, "El subtítulo ya estaba sincronizado.");
  return {
    confident: true,
    mode: "delay",
    confidence,
    delayMs,
    scale: 1,
    cues: target,
    anchors: [],
    reason: "Sincronizado con un retraso uniforme.",
  };
}
