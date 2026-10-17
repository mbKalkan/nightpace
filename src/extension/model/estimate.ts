// The quota before Nightpace recorded it, worked out from the requests' API cost at the rates
// measured since: an estimate, drawn and labeled as one.
import type { QuotaPoint } from '../../shared/protocol';
import { costIndex } from './pace';
import type { TimelineRequest } from './timeline';

const MIN = 60_000;
const HOUR = 60 * MIN;
const FIVE_HOURS = 5 * HOUR;
const WEEK = 7 * 24 * HOUR;
/** Claude Code opens a 5-hour window at the first request after the last one closed, to 10 minutes. */
const WINDOW_GRAIN = 10 * MIN;
/** About this many points across the window shown, besides the resets. */
const POINTS = 600;

export interface EstimateInput {
  requests: readonly TimelineRequest[];
  /** A weekly reset Claude Code reported: the earlier ones fall a week apart from it. */
  weeklyReset: number;
  fiveHourPerDollar: number;
  weeklyPerDollar: number;
  /** Where to estimate: the window shown, up to the first recorded reading. */
  from: number;
  to: number;
}

export function estimateQuota(input: EstimateInput): QuotaPoint[] {
  const { requests, weeklyReset, fiveHourPerDollar, weeklyPerDollar, from, to } = input;
  const times = requests.map((request) => request.time).sort((a, b) => a - b);
  if (times.length === 0) return [];
  const weekStart = (time: number) => weeklyReset + Math.floor((time - weeklyReset) / WEEK) * WEEK;
  // Before the first request the cost is unknown rather than nothing: the estimate starts with
  // the first week that opened after it.
  const firstWeek = weekStart(times[0]) === times[0] ? times[0] : weekStart(times[0]) + WEEK;
  const start = Math.max(from, firstWeek);
  if (start >= to) return [];

  const windows: Array<{ start: number; end: number }> = [];
  for (const time of times) {
    if (time > to) break;
    const last = windows.at(-1);
    if (last && time < last.end) continue;
    const opened = Math.floor(time / WINDOW_GRAIN) * WINDOW_GRAIN;
    windows.push({ start: opened, end: opened + FIVE_HOURS });
  }

  const costBetween = costIndex(requests);
  // `before`: the value just before `time`, where a window ending at `time` still counts.
  const fiveHour = (time: number, before: boolean) => {
    const window = windows.find((w) =>
      before ? w.start < time && time <= w.end : w.start <= time && time < w.end,
    );
    return window ? fiveHourPerDollar * costBetween(window.start - 1, time) : 0;
  };
  const weekly = (time: number, before: boolean) =>
    weeklyPerDollar * costBetween(weekStart(before ? time - 1 : time), time);

  const step = Math.max(5 * MIN, Math.ceil((to - start) / POINTS / (5 * MIN)) * 5 * MIN);
  const marks = new Set<number>();
  for (let time = start; time < to; time += step) marks.add(time);
  marks.add(to);
  for (const window of windows) {
    if (window.start > start && window.start < to) marks.add(window.start);
    if (window.end > start && window.end < to) marks.add(window.end);
  }
  for (let reset = weekStart(start) + WEEK; reset < to; reset += WEEK) marks.add(reset);

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
