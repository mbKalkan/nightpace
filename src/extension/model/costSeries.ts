// The requests' API cost over time. Pricing and sorting every request is the slow part, and the
// pace, the estimate and each quota week of days ask it of the same requests, so a list of
// requests is priced once. The lists are read-only, so what was worked out stays true.
import { requestCost } from './pricing';
import type { TimelineRequest } from './timeline';

export interface CostSeries {
  /** When each request was made, earliest first. */
  times: number[];
  /** The cost of the first `i` requests at API prices: `sums[0]` is 0. */
  sums: number[];
}

const priced = new WeakMap<readonly TimelineRequest[], CostSeries>();

export function costSeries(requests: readonly TimelineRequest[]): CostSeries {
  const known = priced.get(requests);
  if (known) return known;
  const sorted = requests
    .map((request) => ({ time: request.time, cost: requestCost(request)?.total ?? 0 }))
    .sort((a, b) => a.time - b.time);
  const times = sorted.map((request) => request.time);
  const sums = [0];
  for (const request of sorted) sums.push(sums[sums.length - 1] + request.cost);
  const series = { times, sums };
  priced.set(requests, series);
  return series;
}

/** How many of `times`, earliest first, are at or before `time`. */
export function countUpTo(times: readonly number[], time: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}
