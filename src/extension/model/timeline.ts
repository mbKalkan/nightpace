// Everything the timeline panel draws for a time range, from the recorded quota snapshots and
// the requests read from Claude Code's transcripts.
import type {
  Amounts,
  LimitHit,
  ModelFamily,
  QuotaPoint,
  RangeKey,
  SessionSummary,
  Spend,
  TimelineData,
  TimeWindow,
  TokenBucket,
  TokenType,
} from '../../shared/protocol';
import {
  EFFORT_LEVELS,
  MODEL_FAMILIES,
  NO_EFFORT,
  TOKEN_TYPES,
  WEEKS_BACK,
} from '../../shared/protocol';
import { clampWindow } from '../../shared/window';
import type { QuotaSnapshot } from '../quota/snapshot';
import type { TokenCounts } from '../transcripts/events';
import { estimateQuota } from './estimate';
import { modelFamily } from './family';
import { paceOf } from './pace';
import { requestCost } from './pricing';
import { tokenDetails } from './tokenDetails';
import { weekDays } from './weekDays';
import {
  concurrency,
  sessionIntervals,
  type Interval,
  type Step,
  type TimedRequest,
} from './activity';

const MIN = 60_000;
const HOUR = 60 * MIN;

export const RANGE_SPANS: Record<RangeKey, number> = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
  week: 7 * 24 * HOUR,
};

const MAX_BUCKETS = 60;
// Each size divides the next ones it can meet within a range, so a zoomed window's buckets
// line up with the whole range's. Every size divides a week too: counted from the weekly
// quota's reset, seven day columns make one quota week.
const BUCKET_SIZES = [
  MIN,
  2 * MIN,
  5 * MIN,
  10 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];

/** The shortest bucket that keeps a span within about 60 columns. */
export function bucketFor(span: number): number {
  return BUCKET_SIZES.find((size) => span / size <= MAX_BUCKETS) ?? BUCKET_SIZES.at(-1)!;
}

export interface TimelineRequest extends TimedRequest {
  model: string;
  effort?: string;
  sidechain: boolean;
  project?: string;
  fast?: boolean;
  usOnly?: boolean;
  tokens: TokenCounts;
}

export { modelFamily };

/** A request's tokens by type; the thinking part of output is in `output`. */
export function tokensByType(tokens: TokenCounts): Record<TokenType, number> {
  return {
    input: tokens.input,
    cacheWrite: tokens.cacheWrite5m + tokens.cacheWrite1h,
    cacheRead: tokens.cacheRead,
    output: tokens.output,
  };
}

export function emptyAmounts(): Amounts {
  return { total: 0, byModel: {}, byEffort: {}, byType: {} };
}

/** Adds an amount split by type to `amounts`, under a request's model and effort level. */
function addTo(
  amounts: Amounts,
  family: ModelFamily,
  effort: string,
  byType: Record<TokenType, number>,
): void {
  let total = 0;
  for (const type of TOKEN_TYPES) {
    if (!byType[type]) continue;
    amounts.byType[type] = (amounts.byType[type] ?? 0) + byType[type];
    total += byType[type];
  }
  amounts.total += total;
  amounts.byModel[family] = (amounts.byModel[family] ?? 0) + total;
  amounts.byEffort[effort] = (amounts.byEffort[effort] ?? 0) + total;
}

/** A request's cost and tokens, each split by type; cost is undefined without a known price. */
function measured(request: TimelineRequest) {
  return { cost: requestCost(request), tokens: tokensByType(request.tokens) };
}

export interface TimelineInput {
  range: RangeKey;
  now: number;
  /** A part of the range to zoom into; the whole range without it. */
  zoom?: TimeWindow;
  /** In the `week` range, which quota week: 0 for this one, -1 for the one before. */
  week?: number;
  requests: Iterable<TimelineRequest>;
  snapshots: readonly QuotaSnapshot[];
  /** When limits ran out, as Claude Code logged it; none when left out. */
  limits?: readonly LimitHit[];
  /** Local midnight today, for today's spend; the host's own when left out. */
  startOfToday?: number;
  /**
   * How far local time is ahead of UTC now; the host's own when left out. Before any quota
   * reading, columns start on local hours and midnights instead of at the weekly reset.
   */
  utcOffset?: number;
}

const WEEK = 7 * 24 * HOUR;

/**
 * The time the columns are counted from: the weekly quota's reset as Claude Code last reported
 * it, to the minute (it comes with a second's jitter), or local midnight before any reading.
 */
export function columnAnchor(
  snapshots: readonly QuotaSnapshot[],
  utcOffset: number,
): { time: number; reset: boolean } {
  let latest: QuotaSnapshot | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.available && snapshot.weekly?.resetsAt !== undefined) {
      if (!latest || snapshot.time > latest.time) latest = snapshot;
    }
  }
  const reset = latest?.weekly?.resetsAt;
  return reset === undefined
    ? { time: -utcOffset, reset: false }
    : { time: Math.round(reset / MIN) * MIN, reset: true };
}

/** `time` rounded down to a whole number of `size` after `anchor`. */
function floorFrom(time: number, size: number, anchor: number): number {
  return anchor + Math.floor((time - anchor) / size) * size;
}

function ceilFrom(time: number, size: number, anchor: number): number {
  return anchor + Math.ceil((time - anchor) / size) * size;
}

/** The whole of a range: buckets line up with whole bucket lengths, so it doesn't shift every minute. */
export function rangeExtent(range: RangeKey, now: number, anchor: number): TimeWindow {
  const span = RANGE_SPANS[range];
  return { from: floorFrom(now - span, bucketFor(span), anchor), to: now };
}

/**
 * The quota weeks that can be shown: this one, from its reset, and the ones before it back to the
 * first request, at most `WEEKS_BACK`.
 */
export function quotaWeeks(
  now: number,
  anchor: number,
  firstRequest: number,
): { current: TimeWindow; oldest: number } {
  // At the reset itself, the week that ends then: the new one has no time yet.
  const from = floorFrom(now - 1, WEEK, anchor);
  const back = Number.isFinite(firstRequest) ? Math.ceil((from - firstRequest) / WEEK) : 0;
  return {
    current: { from, to: from + WEEK },
    oldest: -Math.min(WEEKS_BACK, Math.max(0, back)),
  };
}

export function buildTimeline({
  range,
  now,
  zoom,
  week = 0,
  requests,
  snapshots,
  limits = [],
  startOfToday = new Date(now).setHours(0, 0, 0, 0),
  utcOffset = -new Date(now).getTimezoneOffset() * MIN,
}: TimelineInput): TimelineData {
  const all = [...requests];
  const anchor = columnAnchor(snapshots, utcOffset);
  const weeks = quotaWeeks(
    now,
    anchor.time,
    all.reduce((first, request) => Math.min(first, request.time), Infinity),
  );
  // Outside the week range, the week in focus is this one.
  const offset = range === 'week' ? Math.min(0, Math.max(Math.round(week), weeks.oldest)) : 0;
  const quotaWeek = {
    from: weeks.current.from + offset * WEEK,
    to: weeks.current.to + offset * WEEK,
  };
  const extent =
    range === 'week'
      ? { from: quotaWeek.from, to: Math.min(quotaWeek.to, now) }
      : rangeExtent(range, now, anchor.time);
  const shown = zoom ? clampWindow(zoom, extent) : extent;
  // The whole of this week takes its columns from the whole week, as a week before it does.
  const bucketMs = bucketFor(range === 'week' && !zoom ? WEEK : shown.to - shown.from);
  const from = floorFrom(shown.from, bucketMs, anchor.time);
  const to = Math.min(ceilFrom(shown.to, bucketMs, anchor.time), extent.to);
  const weeklyResets: number[] = [];
  if (anchor.reset) {
    for (let time = floorFrom(from, WEEK, anchor.time); time <= to; time += WEEK) {
      if (time >= from) weeklyResets.push(time);
    }
  }
  const count = Math.ceil((to - from) / bucketMs);
  const buckets: TokenBucket[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * bucketMs,
    cost: emptyAmounts(),
    tokens: emptyAmounts(),
    requests: 0,
    maxSessions: 0,
  }));

  const used = new Set<ModelFamily>();
  const efforts = new Set<string>();
  for (const request of all) {
    if (request.time < from || request.time >= to) continue;
    const bucket = buckets[Math.floor((request.time - from) / bucketMs)];
    const family = modelFamily(request.model);
    const effort = request.effort ?? NO_EFFORT;
    const { cost, tokens } = measured(request);
    if (cost) addTo(bucket.cost, family, effort, cost);
    addTo(bucket.tokens, family, effort, tokens);
    bucket.requests++;
    used.add(family);
    efforts.add(effort);
  }

  // Subagents work for their session: they don't count as sessions of their own.
  const intervals = sessionIntervals(all.filter((request) => !request.sidechain));
  const steps = concurrency(intervals.values());
  const sessions = clipSteps(steps, from, to);
  for (let i = 0; i < sessions.length; i++) {
    const start = sessions[i].time;
    const end = sessions[i + 1]?.time ?? to;
    const first = Math.floor((start - from) / bucketMs);
    const last = Math.min(Math.ceil((end - from) / bucketMs) - 1, buckets.length - 1);
    for (let b = Math.max(first, 0); b <= last; b++) {
      buckets[b].maxSessions = Math.max(buckets[b].maxSessions, sessions[i].count);
    }
  }

  const pace = paceOf(all, snapshots, now, utcOffset);
  const recordingSince = snapshots.find((snapshot) => snapshot.available)?.time;
  return {
    range,
    extent,
    from,
    to,
    bucketMs,
    quota: quotaPoints(snapshots, from, to),
    quotaEstimate:
      pace && anchor.reset && recordingSince !== undefined && recordingSince > from
        ? estimateQuota({
            requests: all,
            weeklyReset: anchor.time,
            fiveHourPerDollar: pace.fiveHourPerDollar,
            weeklyPerDollar: pace.weeklyPerDollar,
            from,
            to: Math.min(to, recordingSince),
            hits: limits,
          })
        : undefined,
    limitHits: limits.filter((hit) => hit.time >= from && hit.time <= to),
    weeklyResets,
    sessions,
    buckets,
    models: MODEL_FAMILIES.filter((family) => used.has(family)),
    efforts: effortOrder(efforts),
    sessionList: summarizeSessions(all, intervals, from, to),
    tokenDetails: tokenDetails(all, from, to),
    spend: spendOf(all, now, startOfToday),
    pace,
    recordingSince,
    week: { ...quotaWeek, offset, oldest: weeks.oldest },
    ...(pace &&
      anchor.reset && {
        weekDays: weekDays({
          week: quotaWeek,
          now,
          requests: all,
          snapshots,
          limits,
          pace,
          weeklyReset: anchor.time,
        }),
      }),
  };
}

/** Known levels least first, then any Claude Code adds later, then requests without one. */
export function effortOrder(efforts: Iterable<string>): string[] {
  const rank = (effort: string) => {
    if (effort === NO_EFFORT) return EFFORT_LEVELS.length + 1;
    const index = (EFFORT_LEVELS as readonly string[]).indexOf(effort);
    return index < 0 ? EFFORT_LEVELS.length : index;
  };
  return [...new Set(efforts)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const DAY = 24 * HOUR;

/** What the requests up to `now` would have cost at API prices, over fixed periods. */
export function spendOf(
  requests: readonly TimelineRequest[],
  now: number,
  startOfToday: number,
): Spend {
  const spend: Spend = { today: 0, last7Days: 0, last30Days: 0, perActiveDay: 0, unpriced: 0 };
  const days = new Set<number>();
  for (const request of requests) {
    if (request.time > now || request.time < now - 30 * DAY) continue;
    const cost = requestCost(request);
    if (!cost) {
      spend.unpriced++;
      continue;
    }
    spend.last30Days += cost.total;
    if (request.time >= now - 7 * DAY) spend.last7Days += cost.total;
    if (request.time >= startOfToday) spend.today += cost.total;
    days.add(Math.floor((request.time - startOfToday) / DAY));
  }
  spend.perActiveDay = days.size > 0 ? spend.last30Days / days.size : 0;
  return spend;
}

/** What each session did within [from, to), most cost first. */
export function summarizeSessions(
  requests: readonly TimelineRequest[],
  intervals: ReadonlyMap<string, readonly Interval[]>,
  from: number,
  to: number,
): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const request of requests) {
    if (request.time < from || request.time >= to) continue;
    let session = byId.get(request.sessionId);
    if (!session) {
      session = {
        id: request.sessionId,
        first: request.time,
        last: request.end,
        active: 0,
        requests: 0,
        cost: emptyAmounts(),
        tokens: emptyAmounts(),
      };
      byId.set(request.sessionId, session);
    }
    session.folder ??= request.project;
    const family = modelFamily(request.model);
    const effort = request.effort ?? NO_EFFORT;
    const { cost, tokens } = measured(request);
    session.first = Math.min(session.first, request.time);
    session.last = Math.max(session.last, Math.min(request.end, to));
    session.requests++;
    if (cost) addTo(session.cost, family, effort, cost);
    addTo(session.tokens, family, effort, tokens);
  }
  for (const session of byId.values()) {
    for (const interval of intervals.get(session.id) ?? []) {
      session.active += Math.max(0, Math.min(interval.end, to) - Math.max(interval.start, from));
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.cost.total - a.cost.total || b.tokens.total - a.tokens.total,
  );
}

/** The steps within [from, to), starting with the count at `from`. */
function clipSteps(steps: readonly Step[], from: number, to: number): Step[] {
  let count = 0;
  const clipped: Step[] = [];
  for (const step of steps) {
    if (step.time <= from) {
      count = step.count;
    } else if (step.time < to) {
      if (clipped.length === 0) clipped.push({ time: from, count });
      clipped.push(step);
    }
  }
  if (clipped.length === 0) clipped.push({ time: from, count });
  return clipped;
}

/** The observations within [from, to), with the last one before and the first one after. */
function quotaPoints(snapshots: readonly QuotaSnapshot[], from: number, to: number): QuotaPoint[] {
  const sorted = snapshots.filter((snapshot) => snapshot.available).sort((a, b) => a.time - b.time);
  const firstInside = sorted.findIndex((snapshot) => snapshot.time >= from);
  const start = firstInside < 0 ? Math.max(sorted.length - 1, 0) : Math.max(firstInside - 1, 0);
  const firstAfter = sorted.findIndex((snapshot) => snapshot.time >= to);
  const end = firstAfter < 0 ? sorted.length : firstAfter + 1;
  return sorted.slice(start, end).map((snapshot) => ({
    time: snapshot.time,
    fiveHour: snapshot.fiveHour?.percent,
    fiveHourReset: snapshot.fiveHour?.resetsAt,
    weekly: snapshot.weekly?.percent,
    weeklyReset: snapshot.weekly?.resetsAt,
  }));
}
