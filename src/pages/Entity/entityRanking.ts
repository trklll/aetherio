export interface EntityPopularityCandidate {
  id: number | string;
  popularity?: number | null;
  voteCount?: number | null;
  voteAverage?: number | null;
  sourceIndex: number;
}

export interface EntityPopularityRow<T extends EntityPopularityCandidate> {
  title: string;
  items: T[];
}

interface RankedCandidate<T extends EntityPopularityCandidate> {
  item: T;
  score: number;
}

interface RowSummary<T extends EntityPopularityCandidate> {
  row: EntityPopularityRow<T>;
  rankedItems: RankedCandidate<T>[];
  score: number;
  popularityTotal: number;
  voteTotal: number;
  sourceIndex: number;
}

function metric(value: number | null | undefined) {
  return Number.isFinite(value) && value! > 0 ? value! : 0;
}

function logMetric(value: number | null | undefined) {
  return Math.log1p(metric(value));
}

function percentile(value: number, distribution: number[]) {
  if (distribution.length <= 1) return distribution.length ? 1 : 0;
  const sorted = [...distribution].sort((a, b) => a - b);
  let first = 0;
  while (first < sorted.length && sorted[first] < value) first += 1;
  let last = first;
  while (last < sorted.length && sorted[last] === value) last += 1;
  return ((first + last - 1) / 2) / (sorted.length - 1);
}

function weightedMean(values: number[]) {
  if (!values.length) return 0;
  let total = 0;
  let weightTotal = 0;
  values.forEach((value, index) => {
    const weight = 1 / Math.sqrt(index + 1);
    total += value * weight;
    weightTotal += weight;
  });
  return weightTotal ? total / weightTotal : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function compareCandidates<T extends EntityPopularityCandidate>(a: RankedCandidate<T>, b: RankedCandidate<T>) {
  return b.score - a.score
    || metric(b.item.popularity) - metric(a.item.popularity)
    || metric(b.item.voteCount) - metric(a.item.voteCount)
    || metric(b.item.voteAverage) - metric(a.item.voteAverage)
    || a.item.sourceIndex - b.item.sourceIndex;
}

export function fameScore(
  item: EntityPopularityCandidate,
  distributions: { popularity: number[]; voteCount: number[] },
) {
  const popularity = percentile(logMetric(item.popularity), distributions.popularity);
  const votes = percentile(logMetric(item.voteCount), distributions.voteCount);
  return popularity * 0.8 + votes * 0.2;
}

export function rankEntityRows<T extends EntityPopularityCandidate>(rows: EntityPopularityRow<T>[]) {
  const candidates = rows.flatMap(row => row.items);
  const distributions = {
    popularity: candidates.map(item => logMetric(item.popularity)),
    voteCount: candidates.map(item => logMetric(item.voteCount)),
  };

  const summaries: RowSummary<T>[] = rows.map((row, rowIndex) => {
    const rankedItems = row.items
      .map(item => ({ item, score: fameScore(item, distributions) }))
      .sort(compareCandidates);
    const sample = rankedItems.slice(0, 10).map(entry => entry.score);
    const head = weightedMean(sample.slice(0, 8));
    const typical = median(sample);
    const coverage = Math.min(rankedItems.length, 10) / 10;
    const score = (head * 0.7 + typical * 0.3) * (0.9 + coverage * 0.1);
    return {
      row,
      rankedItems,
      score,
      popularityTotal: rankedItems.slice(0, 10).reduce((sum, entry) => sum + metric(entry.item.popularity), 0),
      voteTotal: rankedItems.slice(0, 10).reduce((sum, entry) => sum + metric(entry.item.voteCount), 0),
      sourceIndex: rowIndex,
    };
  });

  summaries.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return b.popularityTotal - a.popularityTotal
      || b.voteTotal - a.voteTotal
      || a.sourceIndex - b.sourceIndex;
  });

  return summaries.map(summary => ({
    ...summary.row,
    items: summary.rankedItems.map(entry => entry.item),
  }));
}
