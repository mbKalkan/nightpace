// Everything the timeline panel draws for a time range, from the recorded quota snapshots and
// the requests read from Claude Code's transcripts.
import type {
  ModelFamily,
  QuotaPoint,
  RangeKey,
  TimelineData,
  TokenBucket,
} from '../../shared/protocol';
import { MODEL_FAMILIES } from '../../shared/protocol';
import type { QuotaSnapshot } from '../quota/snapshot';
import type { TokenCounts } from '../transcripts/events';
import { concurrency, sessionIntervals, type Step, type TimedRequest } from './activity';

const HOUR = 3_600_000;

export const RANGE_SPANS: Record<RangeKey, { span: number; bucket: number }> = {
  '24h': { span: 24 * HOUR, bucket: HOUR / 2 },
  '7d': { span: 7 * 24 * HOUR, bucket: 3 * HOUR },
  '30d': { span: 30 * 24 * HOUR, bucket: 12 * HOUR },
};

export interface TimelineRequest extends TimedRequest {
  model: string;
  sidechain: boolean;
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
  requests: Iterable<TimelineRequest>;
  snapshots: readonly QuotaSnapshot[];
}

export function buildTimeline({ range, now, requests, snapshots }: TimelineInput): TimelineData {
  const { span, bucket: bucketMs } = RANGE_SPANS[range];
  // Buckets line up with whole bucket lengths, so the chart doesn't shift every minute.
  const to = now;
  const from = Math.floor((now - span) / bucketMs) * bucketMs;
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
  const steps = concurrency(sessionIntervals(all.filter((request) => !request.sidechain)).values());
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
    from,
    to,
    bucketMs,
    quota: quotaPoints(snapshots, from, to),
    sessions,
    buckets,
    models: MODEL_FAMILIES.filter((family) => used.has(family)),
    recordingSince: snapshots.find((snapshot) => snapshot.available)?.time,
  };
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

function quotaPoints(snapshots: readonly QuotaSnapshot[], from: number, to: number): QuotaPoint[] {
  const sorted = snapshots
    .filter((snapshot) => snapshot.available && snapshot.time < to)
    .sort((a, b) => a.time - b.time);
  const firstInside = sorted.findIndex((snapshot) => snapshot.time >= from);
  const start = firstInside < 0 ? Math.max(sorted.length - 1, 0) : Math.max(firstInside - 1, 0);
  return sorted.slice(start).map((snapshot) => ({
    time: snapshot.time,
    fiveHour: snapshot.fiveHour?.percent,
    fiveHourReset: snapshot.fiveHour?.resetsAt,
    weekly: snapshot.weekly?.percent,
    weeklyReset: snapshot.weekly?.resetsAt,
  }));
}
