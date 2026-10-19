// The weekly limit a day at a time over one quota week. Days are counted from the reset, so seven
// of them make the week. A day used what the weekly quota rose by within it: from the readings,
// carried to the day's ends with the cost of the requests between at the measured rate, and
// before the week's first reading from the estimate the timeline draws.
import type { LimitHit, Pace, TimeWindow, WeekDay, WeekDays } from '../../shared/protocol';
import type { QuotaSnapshot } from '../quota/snapshot';
import { estimateQuota } from './estimate';
import { costIndex } from './pace';
import type { TimelineRequest } from './timeline';

const DAY = 86_400_000;
/**
 * A reading this long before a day's end, with requests made since, only estimates it: polling
 * is hourly when idle, so a longer silence means Nightpace wasn't running.
 */
const READING_GAP = 75 * 60_000;
/** Usage only falls when a window resets: a fall of this much is a reset by hand. */
const RESET_BY_HAND_DROP = 2;

export interface WeekDaysInput {
  week: TimeWindow;
  now: number;
  requests: readonly TimelineRequest[];
  snapshots: readonly QuotaSnapshot[];
  limits: readonly LimitHit[];
  pace: Pace;
  /** A weekly reset Claude Code reported: the earlier ones fall a week apart from it. */
  weeklyReset: number;
}

interface Value {
  time: number;
  value: number;
  estimated: boolean;
}

export function weekDays({
  week,
  now,
  requests,
  snapshots,
  limits,
  pace,
  weeklyReset,
}: WeekDaysInput): WeekDays {
  const cost = costIndex(requests);
  const perDollar = pace.weeklyPerDollar;
  const readings: Value[] = snapshots
    .filter(
      (snapshot) =>
        snapshot.available &&
        snapshot.weekly !== undefined &&
        snapshot.time >= week.from &&
        snapshot.time < week.to &&
        snapshot.time <= now,
    )
    .map((snapshot) => ({
      time: snapshot.time,
      value: snapshot.weekly!.percent,
      estimated: false,
    }));
  const first = readings[0]?.time ?? Math.min(now, week.to);
  const estimate: Value[] =
    first > week.from
      ? estimateQuota({
          requests,
          weeklyReset,
          fiveHourPerDollar: pace.fiveHourPerDollar,
          weeklyPerDollar: perDollar,
          from: week.from,
          to: first,
          hits: limits,
        }).map((point) => ({ time: point.time, value: point.weekly ?? 0, estimated: true }))
      : [];
  const known = [...estimate, ...readings];

  /**
   * The weekly quota at `time`, or `before` it where an estimate drops there (a week reset by
   * hand, or the next week's reset at the week's end); none before the estimate starts.
   */
  const at = (time: number, before = false): Value | undefined => {
    if (time <= week.from) return { time, value: 0, estimated: false };
    const reading = lastAt(readings, time);
    if (reading) {
      const since = cost(reading.time, time);
      return {
        time,
        value: Math.min(100, reading.value + since * perDollar),
        estimated: since > 0 && time - reading.time > READING_GAP,
      };
    }
    const point = lastAt(estimate, time, before);
    return point && { ...point, time };
  };

  // Only this week has days ahead, each with its share of what is left.
  const current = now >= week.from && now < week.to;
  const days: WeekDay[] = [];
  for (let from = week.from; from < week.to; from += DAY) {
    const to = from + DAY;
    const end = Math.min(to, now);
    const day: WeekDay = { from, to, estimated: false, cost: cost(from, end) };
    if (current && to > now) {
      day.canTake = (pace.week.budget * (to - Math.max(from, now))) / DAY;
    }
    const start = from < now ? at(from) : undefined;
    const finish = start && at(end, true);
    if (start && finish) {
      const inside = known.filter((point) => point.time > from && point.time < end);
      day.used = rise([start, ...inside, finish]);
      day.estimated = start.estimated || finish.estimated;
    }
    days.push(day);
  }
  return { week, days };
}

/**
 * How far the quota rose along `values`. Where a week was reset by hand it starts again: what it
 * reached after the reset counts, not the fall.
 */
function rise(values: readonly Value[]): number {
  let total = 0;
  for (let i = 1; i < values.length; i++) {
    const [before, after] = [values[i - 1], values[i]];
    const restart =
      before.estimated && after.estimated
        ? after.time === before.time && after.value === 0 && before.value > 0
        : !before.estimated && !after.estimated && after.value <= before.value - RESET_BY_HAND_DROP;
    total += restart ? after.value : after.value - before.value;
  }
  return Math.max(0, total);
}

/**
 * The last of values sorted by time at or before `time`; `before`, the first of those at `time`
 * where there are several, the value it dropped from.
 */
function lastAt(values: readonly Value[], time: number, before = false): Value | undefined {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  while (before && low > 1 && values[low - 2].time === time) low--;
  return low > 0 ? values[low - 1] : undefined;
}
