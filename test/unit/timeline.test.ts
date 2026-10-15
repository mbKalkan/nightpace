import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  buildTimeline,
  modelFamily,
  RANGE_SPANS,
  weightedTokens,
  type TimelineRequest,
} from '../../src/extension/model/timeline';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import type { TokenCounts } from '../../src/extension/transcripts/events';

const MIN = 60_000;
const HOUR = 60 * MIN;
// A whole half hour, so the 24-hour range starts exactly a day earlier.
const now = Date.UTC(2026, 9, 15, 12, 0);

const tokens = (overrides: Partial<TokenCounts> = {}): TokenCounts => ({
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
  thinking: 0,
  ...overrides,
});

const request = (
  sessionId: string,
  minutesAgo: number,
  overrides: Partial<TimelineRequest> = {},
): TimelineRequest => ({
  sessionId,
  time: now - minutesAgo * MIN,
  end: now - minutesAgo * MIN + 20_000,
  model: 'claude-opus-5-5',
  sidechain: false,
  tokens: tokens({ input: 100 }),
  ...overrides,
});

const snapshot = (minutesAgo: number, fiveHour: number, weekly: number): QuotaSnapshot => ({
  time: now - minutesAgo * MIN,
  available: true,
  fiveHour: { percent: fiveHour, resetsAt: now + HOUR },
  weekly: { percent: weekly, resetsAt: now + 48 * HOUR },
  models: [],
});

describe('weightedTokens', () => {
  it('weighs tokens the way API prices do', () => {
    expect(
      weightedTokens(
        tokens({ input: 10, cacheRead: 1000, cacheWrite5m: 100, cacheWrite1h: 100, output: 20 }),
      ),
    ).toBe(10 + 100 + 125 + 200 + 100);
  });
});

describe('modelFamily', () => {
  it('groups models by family', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('claude-fable-5-1')).toBe('fable');
    expect(modelFamily('claude-sonnet-5-5')).toBe('sonnet');
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(modelFamily('some-other-model')).toBe('other');
  });
});

describe('bucketFor', () => {
  it('keeps every range and zoom within about 60 columns', () => {
    expect(bucketFor(RANGE_SPANS['24h'])).toBe(30 * MIN);
    expect(bucketFor(RANGE_SPANS['7d'])).toBe(3 * HOUR);
    expect(bucketFor(RANGE_SPANS['30d'])).toBe(12 * HOUR);
    expect(bucketFor(4 * HOUR)).toBe(5 * MIN);
    expect(bucketFor(30 * MIN)).toBe(MIN);
  });
});

describe('buildTimeline', () => {
  it('splits the last 24 hours into half-hour buckets by model', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [
        request('a', 10),
        request('a', 12, { model: 'claude-sonnet-5-5', tokens: tokens({ output: 10 }) }),
        request('b', 45),
        // Older than the range: left out.
        request('c', 25 * 60),
      ],
      snapshots: [],
    });
    expect(data.from).toBe(now - 24 * HOUR);
    expect(data.to).toBe(now);
    expect(data.bucketMs).toBe(30 * MIN);
    expect(data.extent).toEqual({ from: data.from, to: now });
    expect(data.buckets).toHaveLength(48);
    expect(data.buckets[47]).toMatchObject({
      byModel: { opus: 100, sonnet: 50 },
      requests: 2,
      maxSessions: 1,
    });
    expect(data.buckets[46]).toMatchObject({ byModel: { opus: 100 }, requests: 1 });
    expect(data.models).toEqual(['opus', 'sonnet']);
  });

  it('counts the sessions working at once, leaving subagents to their session', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [
        request('a', 20),
        request('a', 18),
        request('b', 19),
        request('a', 19, { sidechain: true, sessionId: 'a' }),
      ],
      snapshots: [],
    });
    expect(Math.max(...data.sessions.map((step) => step.count))).toBe(2);
    expect(data.sessions[0]).toEqual({ time: data.from, count: 0 });
    expect(data.buckets[47].maxSessions).toBe(2);
  });

  it('keeps the quota readings in range and the last one before it', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [],
      snapshots: [snapshot(30 * 60, 1, 1), snapshot(26 * 60, 2, 2), snapshot(60, 30, 40)],
    });
    expect(data.quota.map((point) => point.fiveHour)).toEqual([2, 30]);
    expect(data.quota[1]).toMatchObject({ weekly: 40, fiveHourReset: now + HOUR });
    expect(data.recordingSince).toBe(now - 30 * 60 * MIN);
  });

  it('leaves out readings from accounts without plan limits', () => {
    const data = buildTimeline({
      range: '7d',
      now,
      requests: [],
      snapshots: [{ time: now - HOUR, available: false, models: [] }],
    });
    expect(data.quota).toEqual([]);
    expect(data.recordingSince).toBeUndefined();
    expect(data.buckets.every((bucket) => bucket.requests === 0)).toBe(true);
  });

  it('zooms into a window with finer buckets that line up with the range', () => {
    const data = buildTimeline({
      range: '7d',
      now,
      zoom: { from: now - 5 * HOUR - 7 * MIN, to: now - HOUR + 3 * MIN },
      requests: [request('a', 2 * 60), request('a', 2 * 60 - 2), request('b', 10 * 60)],
      snapshots: [],
    });
    expect(data.extent).toEqual({ from: now - 7 * 24 * HOUR, to: now });
    expect(data.bucketMs).toBe(5 * MIN);
    expect(data.from).toBe(now - 5 * HOUR - 10 * MIN);
    expect(data.to).toBe(now - HOUR + 5 * MIN);
    expect(data.buckets).toHaveLength(51);
    expect(data.buckets.reduce((sum, bucket) => sum + bucket.requests, 0)).toBe(2);
    expect(data.sessions[0]).toEqual({ time: data.from, count: 0 });
  });

  it('keeps a zoom within the range and no shorter than half an hour', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      zoom: { from: now - MIN, to: now + 2 * MIN },
      requests: [],
      snapshots: [],
    });
    expect(data.to).toBe(now);
    expect(data.from).toBe(now - 30 * MIN);
    expect(data.bucketMs).toBe(MIN);
  });

  it('keeps the quota reading just after a zoomed window, so the line reaches its edge', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      zoom: { from: now - 6 * HOUR, to: now - 3 * HOUR },
      requests: [],
      snapshots: [
        snapshot(8 * 60, 1, 1),
        snapshot(5 * 60, 2, 2),
        snapshot(2 * 60, 3, 3),
        snapshot(60, 4, 4),
      ],
    });
    expect(data.quota.map((point) => point.fiveHour)).toEqual([1, 2, 3]);
  });
});
