// The quota before Nightpace recorded it, worked out from the requests' API cost at the rates
// measured since: an estimate, drawn and labeled as one. Where Claude Code logged that a limit
// ran out, the estimate is 100% there. A week that reached 100% and went on working was reset by
// hand (Claude offers that once the weekly limit runs out), so it starts again from zero.
import type { LimitHit, QuotaPoint } from '../../shared/protocol';
import { requestCost } from './pricing';
import type { TimelineRequest } from './timeline';

const MIN = 60_000;
const HOUR = 60 * MIN;
const FIVE_HOURS = 5 * HOUR;
const WEEK = 7 * 24 * HOUR;
/** Claude Code opens a 5-hour window at the first request after the last one closed, to 10 minutes. */
const WINDOW_GRAIN = 10 * MIN;
/** About this many points across the window shown, besides the resets. */
const POINTS = 600;
/** How far a logged hit may bend an estimate: further, and the rate or the log is off, not the limit. */
const MAX_FACTOR = 3;
/**
 * Work after an estimate reached 100% that says the week was reset by hand: a little more is the
 * estimate's own error, at a limit that held.
 */
const RESET_EVIDENCE = 10;

export interface EstimateInput {
  requests: readonly TimelineRequest[];
  /** A weekly reset Claude Code reported: the earlier ones fall a week apart from it. */
  weeklyReset: number;
  fiveHourPerDollar: number;
  weeklyPerDollar: number;
  /** Where to estimate: the window shown, up to the first recorded reading. */
  from: number;
  to: number;
  /** When limits ran out, as Claude Code logged it. */
  hits?: readonly LimitHit[];
}

/** A stretch of a limit's window, from when it opened or was reset, with its scale. */
interface Stretch {
  start: number;
  end: number;
  /** What the cost-based estimate is multiplied by, to reach 100% at a logged hit. */
  factor: number;
}

export function estimateQuota(input: EstimateInput): QuotaPoint[] {
  const { weeklyReset, fiveHourPerDollar, weeklyPerDollar, from, to, hits = [] } = input;
  const sorted = input.requests
    .map((request) => ({ time: request.time, cost: requestCost(request)?.total ?? 0 }))
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return [];
  const times = sorted.map((request) => request.time);
  const sums = [0];
  for (const request of sorted) sums.push(sums[sums.length - 1] + request.cost);
  /** How many requests were made at or before `time`. */
  const upTo = (time: number) => {
    let low = 0;
    let high = times.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (times[middle] <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const costBetween = (a: number, b: number) => (b > a ? sums[upTo(b)] - sums[upTo(a)] : 0);
  /** When the cost after `start` first reaches `amount`, if it does by `until`. */
  const reaches = (start: number, amount: number, until: number) => {
    const base = sums[upTo(start)];
    let low = upTo(start) + 1;
    let high = upTo(until);
    if (high < low || sums[high] - base < amount) return undefined;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sums[middle] - base >= amount) high = middle;
      else low = middle + 1;
    }
    return times[low - 1];
  };
  const scale = (hit: LimitHit | undefined, start: number, perDollar: number) => {
    const raw = hit ? perDollar * costBetween(start - 1, hit.time) : 0;
    return raw > 0 ? Math.min(Math.max(100 / raw, 1 / MAX_FACTOR), MAX_FACTOR) : 1;
  };

  const weekStart = (time: number) => weeklyReset + Math.floor((time - weeklyReset) / WEEK) * WEEK;
  // Before the first request the cost is unknown rather than nothing: the estimate starts with
  // the first week that opened after it.
  const firstWeek = weekStart(times[0]) === times[0] ? times[0] : weekStart(times[0]) + WEEK;
  const start = Math.max(from, firstWeek);
  if (start >= to) return [];

  const windows: Stretch[] = [];
  for (const time of times) {
    if (time > to) break;
    const last = windows.at(-1);
    if (last && time < last.end) continue;
    const opened = Math.floor(time / WINDOW_GRAIN) * WINDOW_GRAIN;
    windows.push({ start: opened, end: opened + FIVE_HOURS, factor: 1 });
  }
  for (const window of windows) {
    const hit = hits.find(
      (h) => h.limit === 'fiveHour' && h.time > window.start && h.time <= window.end,
    );
    window.factor = scale(hit, window.start, fiveHourPerDollar);
  }

  // Each week from its reset, in stretches cut where it ran out and work went on.
  const weeks: Stretch[] = [];
  for (let week = weekStart(start); week < to; week += WEEK) {
    const end = week + WEEK;
    const last = Math.min(end, to);
    let opened = week;
    for (;;) {
      const hit = hits.find((h) => h.limit === 'weekly' && h.time > opened && h.time < end);
      const factor = scale(hit, opened, weeklyPerDollar);
      const out = hit?.time ?? reaches(opened, 100 / weeklyPerDollar, last);
      // Only work after it ran out says the week was reset; without, it waits for its reset.
      const after = out === undefined ? 0 : weeklyPerDollar * costBetween(out, last);
      if (out === undefined || after === 0 || (!hit && after < RESET_EVIDENCE)) {
        weeks.push({ start: opened, end, factor });
        break;
      }
      weeks.push({ start: opened, end: out, factor });
      opened = out;
    }
  }

  // `before`: the value just before `time`, where a stretch ending at `time` still counts.
  const within = (stretches: readonly Stretch[], time: number, before: boolean) =>
    stretches.find((s) =>
      before ? s.start < time && time <= s.end : s.start <= time && time < s.end,
    );
  const fiveHour = (time: number, before: boolean) => {
    const window = within(windows, time, before);
    return window
      ? Math.min(100, fiveHourPerDollar * window.factor * costBetween(window.start - 1, time))
      : 0;
  };
  const weekly = (time: number, before: boolean) => {
    const stretch = within(weeks, time, before);
    return stretch
      ? Math.min(100, weeklyPerDollar * stretch.factor * costBetween(stretch.start, time))
      : 0;
  };

  const step = Math.max(5 * MIN, Math.ceil((to - start) / POINTS / (5 * MIN)) * 5 * MIN);
  const marks = new Set<number>();
  for (let time = start; time < to; time += step) marks.add(time);
  marks.add(to);
  for (const stretch of [...windows, ...weeks]) {
    if (stretch.start > start && stretch.start < to) marks.add(stretch.start);
    if (stretch.end > start && stretch.end < to) marks.add(stretch.end);
  }
  for (const hit of hits) if (hit.time > start && hit.time < to) marks.add(hit.time);

  const points: QuotaPoint[] = [];
  const round = (value: number) => Math.round(value * 10) / 10;
  for (const time of [...marks].sort((a, b) => a - b)) {
    const at = { time, fiveHour: round(fiveHour(time, false)), weekly: round(weekly(time, false)) };
    // At a reset the line drops straight down: the value just before it, then the one after.
    if (time > start) {
      const before = {
        time,
        fiveHour: round(fiveHour(time, true)),
        weekly: round(weekly(time, true)),
      };
      if (before.fiveHour !== at.fiveHour || before.weekly !== at.weekly) points.push(before);
    }
    points.push(at);
  }
  return points;
}
