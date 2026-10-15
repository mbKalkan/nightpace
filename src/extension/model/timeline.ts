// Everything the timeline panel draws for a time range, from the recorded quota snapshots and
// the requests read from Claude Code's transcripts.
import type {
  ModelFamily,
  QuotaPoint,
  RangeKey,
  SessionSummary,
  TimelineData,
  TimeWindow,
  TokenBucket,
} from '../../shared/protocol';
import { MODEL_FAMILIES } from '../../shared/protocol';
import { clampWindow } from '../../shared/window';
import type { QuotaSnapshot } from '../quota/snapshot';
import type { TokenCounts } from '../transcripts/events';
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
};

const MAX_BUCKETS = 60;
// Each size divides the next ones it can meet within a range, so a zoomed window's buckets
// line up with the whole range's.
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
  tokens: TokenCounts;
}

export function modelFamily(model: string): ModelFamily {
  const id = model.toLowerCase();
  return MODEL_FAMILIES.find((family) => family !== 'other' && id.includes(family)) ?? 'other';
}

/**
 * Tokens weighted the way Anthropic's API prices weigh them against input: cache reads at a
 * tenth, cache writes at 1.25× (5 minutes) or 2× (1 hour), output at 5×. Most raw tokens are
 * cheap cache reads, so a plain sum says little about what a request cost.
 */
export function weightedTokens(tokens: TokenCounts): number {
  return (
    tokens.input +
    tokens.cacheRead * 0.1 +
    tokens.cacheWrite5m * 1.25 +
    tokens.cacheWrite1h * 2 +
    tokens.output * 5
  );
}

export interface TimelineInput {
  range: RangeKey;
  now: number;
  /** A part of the range to zoom into; the whole range without it. */
  zoom?: TimeWindow;
  requests: Iterable<TimelineRequest>;
  snapshots: readonly QuotaSnapshot[];
}

/** The whole of a range: buckets line up with whole bucket lengths, so it doesn't shift every minute. */
export function rangeExtent(range: RangeKey, now: number): TimeWindow {
  const span = RANGE_SPANS[range];
  const bucket = bucketFor(span);
  return { from: Math.floor((now - span) / bucket) * bucket, to: now };
}

export function buildTimeline({
  range,
  now,
  zoom,
  requests,
  snapshots,
}: TimelineInput): TimelineData {
  const extent = rangeExtent(range, now);
  const shown = zoom ? clampWindow(zoom, extent) : extent;
  const bucketMs = bucketFor(shown.to - shown.from);
  const from = Math.floor(shown.from / bucketMs) * bucketMs;
  const to = Math.min(Math.ceil(shown.to / bucketMs) * bucketMs, extent.to);
  const count = Math.ceil((to - from) / bucketMs);
  const buckets: TokenBucket[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * bucketMs,
    byModel: {},
    requests: 0,
    maxSessions: 0,
  }));

  const all = [...requests];
  const used = new Set<ModelFamily>();
  for (const request of all) {
    if (request.time < from || request.time >= to) continue;
    const bucket = buckets[Math.floor((request.time - from) / bucketMs)];
    const family = modelFamily(request.model);
    bucket.byModel[family] = (bucket.byModel[family] ?? 0) + weightedTokens(request.tokens);
    bucket.requests++;
    used.add(family);
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

  return {
    range,
    extent,
    from,
    to,
    bucketMs,
    quota: quotaPoints(snapshots, from, to),
    sessions,
    buckets,
    models: MODEL_FAMILIES.filter((family) => used.has(family)),
    sessionList: summarizeSessions(all, intervals, from, to),
    recordingSince: snapshots.find((snapshot) => snapshot.available)?.time,
  };
}

/** What each session did within [from, to), most tokens first. */
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
        tokens: 0,
        byModel: {},
        byEffort: {},
      };
      byId.set(request.sessionId, session);
    }
    session.folder ??= request.project;
    const tokens = weightedTokens(request.tokens);
    const family = modelFamily(request.model);
    session.first = Math.min(session.first, request.time);
    session.last = Math.max(session.last, Math.min(request.end, to));
    session.requests++;
    session.tokens += tokens;
    session.byModel[family] = (session.byModel[family] ?? 0) + tokens;
    if (request.effort) {
      session.byEffort[request.effort] = (session.byEffort[request.effort] ?? 0) + tokens;
    }
  }
  for (const session of byId.values()) {
    for (const interval of intervals.get(session.id) ?? []) {
      session.active += Math.max(0, Math.min(interval.end, to) - Math.max(interval.start, from));
    }
  }
  return [...byId.values()].sort((a, b) => b.tokens - a.tokens);
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
