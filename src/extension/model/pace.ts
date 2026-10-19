// Where the plan's limits are heading. Anthropic doesn't say how much a limit holds, but the
// quota readings follow the API cost of the requests made since each window opened almost exactly
// (measured: R² 0.99 for both the 5-hour and the weekly limit), so one number per limit, the
// percent a dollar uses, measured from this machine's own readings, turns cost into quota. With
// what each kind of session costs an hour, that says when the week and the 5-hour window run out.
import {
  NO_EFFORT,
  PLANNED_SESSIONS,
  type Pace,
  type RatePoint,
  type SessionRate,
  type WeekForecast,
  type WindowForecast,
} from '../../shared/protocol';
import type { QuotaSnapshot, QuotaWindow } from '../quota/snapshot';
import { sessionIntervals } from './activity';
import { modelFamily } from './family';
import { requestCost } from './pricing';
import type { TimelineRequest } from './timeline';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIVE_HOURS = 5 * HOUR;
const WEEK = 7 * DAY;
/** Readings older than this measured a plan or prices that may have changed since. */
const CALIBRATION_SPAN = 28 * DAY;
/** The requests the measure needs: its oldest readings count the cost since their week opened. */
export const PACE_SPAN = CALIBRATION_SPAN + WEEK;
/** The work that session rates are measured over. */
const RATE_SPAN = 14 * DAY;
/** A kind of session worked for less than this has no rate of its own: too few hours to tell. */
const MIN_RATE_HOURS = 2;
const MAX_RATES = 4;
/**
 * Until then the figures are rough: readings are whole percents, so a measure needs several
 * 5-hour windows that went past 10%, and weekly readings over two days that went past 10%.
 */
const SETTLED_WINDOWS = 3;
const SETTLED_PERCENT = 10;
const SETTLED_WEEKLY_SPAN = 2 * DAY;
/** Usage only falls when a window resets: a fall of this much before then is a reset by hand. */
const RESET_BY_HAND_DROP = 2;
const RESET_JITTER = 2 * 60_000;

/** Cost of the requests made in (from, to], at API prices. */
type CostBetween = (from: number, to: number) => number;

export function paceOf(
  requests: readonly TimelineRequest[],
  snapshots: readonly QuotaSnapshot[],
  now: number,
  utcOffset = -new Date(now).getTimezoneOffset() * 60_000,
): Pace | undefined {
  const readings = snapshots.filter((snapshot) => snapshot.available && snapshot.time <= now);
  const latest = readings.at(-1);
  if (!latest?.weekly || !latest.fiveHour) return undefined;
  // A new plan has new limits: only its own readings measure them.
  const recent = readings.filter(
    (snapshot) => snapshot.plan === latest.plan && snapshot.time >= now - CALIBRATION_SPAN,
  );
  const costBetween = costIndex(requests);
  const fiveHour = measure(recent, (s) => s.fiveHour, FIVE_HOURS, costBetween);
  const weekly = measure(recent, (s) => s.weekly, WEEK, costBetween);
  if (!fiveHour || !weekly) return undefined;

  const rates = sessionRates(requests, now);
  const week = weekForecast(latest, latest.weekly, weekly.perDollar, rates, costBetween, now);
  // Before the first request the cost is unknown rather than nothing: a stretch of a window that
  // opened earlier would show far more percent for a dollar than it took.
  const since = requests.reduce((first, request) => Math.min(first, request.time), Infinity);
  const history = (
    pick: (snapshot: QuotaSnapshot) => QuotaWindow | undefined,
    span: number,
    step: (time: number) => number,
  ) =>
    rateHistory(
      recent.filter((snapshot) => (pick(snapshot)?.resetsAt ?? Infinity) - span >= since),
      pick,
      span,
      costBetween,
      step,
    );
  return {
    now,
    learning: !fiveHour.settled || !weekly.settled,
    fiveHourPerDollar: fiveHour.perDollar,
    weeklyPerDollar: weekly.perDollar,
    rates,
    history: {
      weekly: history(
        (s) => s.weekly,
        WEEK,
        (time) => Math.floor((time + utcOffset) / DAY),
      ),
      fiveHour: history(
        (s) => s.fiveHour,
        FIVE_HOURS,
        () => 0,
      ),
    },
    week,
    window: windowForecast({
      latest,
      fiveHour: latest.fiveHour,
      perDollar: fiveHour.perDollar,
      weeklyPerDollar: weekly.perDollar,
      weeklyUsed: week.used,
      rates,
      costBetween,
      now,
    }),
  };
}

/**
 * The percent a dollar used, stretch by stretch, to see it change: Anthropic can change the
 * limits, and use elsewhere (Claude on the web, another computer) shows up as more percent for
 * the same local cost. A stretch runs from the window's start, or the last stretch's end, to the
 * last reading of a step (a day for the week, the whole window for 5 hours), once it has used at
 * least 10%: readings are whole percents, so a shorter one would be mostly rounding.
 */
export function rateHistory(
  readings: readonly QuotaSnapshot[],
  pick: (snapshot: QuotaSnapshot) => QuotaWindow | undefined,
  span: number,
  costBetween: CostBetween,
  step: (time: number) => number,
): RatePoint[] {
  const read = windowReadings(readings, pick, span);
  const points: RatePoint[] = [];
  let anchor: { opened: number; time: number; percent: number } | undefined;
  read.forEach((reading, i) => {
    // A window starts from nothing used.
    if (anchor?.opened !== reading.opened) {
      anchor = { opened: reading.opened, time: reading.opened, percent: 0 };
    }
    const next = read[i + 1];
    if (next && next.opened === reading.opened && step(next.time) === step(reading.time)) return;
    const used = reading.percent - anchor.percent;
    if (used < SETTLED_PERCENT) return;
    const cost = costBetween(anchor.time, reading.time);
    if (cost > 0) points.push({ from: anchor.time, to: reading.time, perDollar: used / cost });
    anchor = { opened: reading.opened, time: reading.time, percent: reading.percent };
  });
  return points;
}

/** A reading of one limit, with when its window opened. */
export interface WindowReading {
  time: number;
  percent: number;
  /** The reset Claude Code reported, to the minute. */
  reset: number;
  /** Its reset less the window's length, or the reading before a reset by hand. */
  opened: number;
}

/**
 * The readings of one limit, each with when its window opened. Claude offers to reset the weekly
 * limit by hand once it runs out: usage then falls before the reset it was heading for, or a new
 * reset comes before the old one, and the window starts again from the reading before.
 */
export function windowReadings(
  readings: readonly QuotaSnapshot[],
  pick: (snapshot: QuotaSnapshot) => QuotaWindow | undefined,
  span: number,
): WindowReading[] {
  const read: WindowReading[] = [];
  let previous: WindowReading | undefined;
  for (const snapshot of readings) {
    const window = pick(snapshot);
    if (window?.resetsAt === undefined) continue;
    const reset = toMinute(window.resetsAt);
    let opened = reset - span;
    // Only while the window before had yet to reset can this one have been reset by hand.
    if (previous && previous.reset > snapshot.time) {
      // The reported reset jitters by a second or so: a new one is minutes away.
      if (Math.abs(reset - previous.reset) > RESET_JITTER) opened = Math.max(opened, previous.time);
      else if (window.percent <= previous.percent - RESET_BY_HAND_DROP) opened = previous.time;
      else opened = previous.opened;
    }
    previous = { time: snapshot.time, percent: window.percent, reset, opened };
    read.push(previous);
  }
  return read;
}

/** Prefix sums of cost over the requests in time order, for any stretch at once. */
export function costIndex(requests: readonly TimelineRequest[]): CostBetween {
  const sorted = requests
    .map((request) => ({ time: request.time, cost: requestCost(request)?.total ?? 0 }))
    .sort((a, b) => a.time - b.time);
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
  return (from, to) => (to > from ? sums[upTo(to)] - sums[upTo(from)] : 0);
}

interface Measure {
  perDollar: number;
  settled: boolean;
}

/**
 * The percent a dollar uses: each reading against the cost of the requests since its window
 * opened, fitted through zero (no requests, no use).
 */
export function measure(
  readings: readonly QuotaSnapshot[],
  pick: (snapshot: QuotaSnapshot) => QuotaWindow | undefined,
  span: number,
  costBetween: CostBetween,
): Measure | undefined {
  let xy = 0;
  let xx = 0;
  const windowPeaks = new Map<number, number>();
  let first: number | undefined;
  let last = 0;
  for (const reading of windowReadings(readings, pick, span)) {
    const cost = costBetween(reading.opened, reading.time);
    if (cost <= 0) continue;
    xy += cost * reading.percent;
    xx += cost * cost;
    windowPeaks.set(
      reading.opened,
      Math.max(windowPeaks.get(reading.opened) ?? 0, reading.percent),
    );
    first ??= reading.time;
    last = reading.time;
  }
  if (xx === 0 || xy === 0) return undefined;
  const peaks = [...windowPeaks.values()];
  const settled =
    span === WEEK
      ? last - first! >= SETTLED_WEEKLY_SPAN && Math.max(...peaks) >= SETTLED_PERCENT
      : peaks.filter((peak) => peak >= SETTLED_PERCENT).length >= SETTLED_WINDOWS;
  return { perDollar: xy / xx, settled };
}

/**
 * What a session of each model and effort costs an hour of work, over the last 14 days: a
 * session's hours go to the model and effort that most of its cost went to.
 */
export function sessionRates(requests: readonly TimelineRequest[], now: number): SessionRate[] {
  const recent = requests.filter(
    (request) => request.time >= now - RATE_SPAN && request.time <= now,
  );
  const kinds = new Map<string, Map<string, number>>();
  const costs = new Map<string, number>();
  for (const request of recent) {
    const cost = requestCost(request)?.total ?? 0;
    const kind = `${modelFamily(request.model)}/${request.effort ?? NO_EFFORT}`;
    const byKind = kinds.get(request.sessionId) ?? new Map<string, number>();
    byKind.set(kind, (byKind.get(kind) ?? 0) + cost);
    kinds.set(request.sessionId, byKind);
    costs.set(request.sessionId, (costs.get(request.sessionId) ?? 0) + cost);
  }
  const totals = new Map<string, { hours: number; cost: number }>();
  // Subagents work for their session: its hours are the main conversation's.
  const intervals = sessionIntervals(recent.filter((request) => !request.sidechain));
  for (const [sessionId, list] of intervals) {
    const byKind = kinds.get(sessionId);
    if (!byKind) continue;
    const kind = [...byKind].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const hours = list.reduce((sum, interval) => sum + interval.end - interval.start, 0) / HOUR;
    const total = totals.get(kind) ?? { hours: 0, cost: 0 };
    total.hours += hours;
    total.cost += costs.get(sessionId) ?? 0;
    totals.set(kind, total);
  }
  return [...totals]
    .filter(([, total]) => total.hours >= MIN_RATE_HOURS && total.cost > 0)
    .sort((a, b) => b[1].hours - a[1].hours)
    .slice(0, MAX_RATES)
    .map(([kind, total]) => {
      const [family, effort] = kind.split('/');
      return {
        family: family as SessionRate['family'],
        effort,
        costPerHour: total.cost / total.hours,
        hours: total.hours,
      };
    });
}

/** The reset at or after `now`, stepping a window that has reset since it was read. */
function nextReset(resetsAt: number, span: number, now: number): number {
  return resetsAt > now ? resetsAt : resetsAt + Math.ceil((now - resetsAt) / span) * span;
}

/** Resets come with a second's jitter, like 22:59:59.9 for 23:00. */
function toMinute(time: number): number {
  return Math.round(time / 60_000) * 60_000;
}

export function weekForecast(
  latest: QuotaSnapshot,
  weekly: QuotaWindow,
  perDollar: number,
  rates: readonly SessionRate[],
  costBetween: CostBetween,
  now: number,
): WeekForecast {
  const reset = weekly.resetsAt ?? latest.time + WEEK;
  const resetsAt = toMinute(nextReset(reset, WEEK, now));
  // A week that reset since the reading starts again from the requests since the reset.
  const since = reset > now ? latest.time : resetsAt - WEEK;
  const used = (reset > now ? weekly.percent : 0) + costBetween(since, now) * perDollar;
  const pace = (costBetween(now - WEEK, now) / 7) * perDollar;
  const daysLeft = (resetsAt - now) / DAY;
  const atReset = used + pace * daysLeft;
  const left = Math.max(0, 100 - used);
  const budget = daysLeft > 0 ? left / daysLeft : 0;
  return {
    used,
    resetsAt,
    pace,
    runsOut: atReset >= 100 && pace > 0 ? now + (left / pace) * DAY : undefined,
    atReset,
    budget,
    budgetHours: rates.map((rate) => budget / (rate.costPerHour * perDollar)),
  };
}

interface WindowInput {
  latest: QuotaSnapshot;
  fiveHour: QuotaWindow;
  perDollar: number;
  weeklyPerDollar: number;
  /** Percent of the weekly limit used now: the window can't outlast the week. */
  weeklyUsed: number;
  rates: readonly SessionRate[];
  costBetween: CostBetween;
  now: number;
}

export function windowForecast({
  latest,
  fiveHour,
  perDollar,
  weeklyPerDollar,
  weeklyUsed,
  rates,
  costBetween,
  now,
}: WindowInput): WindowForecast {
  const open = fiveHour.resetsAt !== undefined && fiveHour.resetsAt > now;
  const used = open ? fiveHour.percent + costBetween(latest.time, now) * perDollar : 0;
  // A window that isn't open opens with the next request and runs its full five hours.
  const horizon = open ? fiveHour.resetsAt! - now : FIVE_HOURS;
  const windowLeft = Math.max(0, 100 - used);
  const weekLeft = Math.max(0, 100 - weeklyUsed);
  const lasts = rates.map((rate) =>
    Array.from({ length: PLANNED_SESSIONS }, (_, i) => {
      const perHour = (i + 1) * rate.costPerHour;
      const hours = Math.min(
        windowLeft / (perHour * perDollar),
        weekLeft / (perHour * weeklyPerDollar),
      );
      return hours * HOUR >= horizon ? null : hours * HOUR;
    }),
  );
  return { used, resetsAt: open ? toMinute(fiveHour.resetsAt!) : undefined, lasts };
}
