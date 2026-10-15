import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  buildTimeline,
  effortOrder,
  modelFamily,
  RANGE_SPANS,
  spendOf,
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
      tokens: { total: 110, byModel: { opus: 100, sonnet: 10 } },
      requests: 2,
      maxSessions: 1,
    });
    // Opus 5.5 input at $4, Sonnet 5.5 output at $10 per million tokens.
    expect(data.buckets[47].cost.byModel.opus).toBeCloseTo(0.0004, 10);
    expect(data.buckets[47].cost.byModel.sonnet).toBeCloseTo(0.0001, 10);
    expect(data.buckets[46]).toMatchObject({ tokens: { byModel: { opus: 100 } }, requests: 1 });
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

  it('sums each session within the window, subagents in their session, most tokens first', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [
        request('a', 50, { project: '/work/alpha', effort: 'xhigh' }),
        request('a', 48, { project: '/work/alpha', effort: 'xhigh', sidechain: true }),
        request('a', 46, { model: 'claude-fable-5-1', project: '/work/alpha', effort: 'high' }),
        request('b', 20, { tokens: tokens({ output: 1000 }) }),
        // Before the window: left out.
        request('a', 25 * 60, { project: '/work/alpha' }),
      ],
      snapshots: [],
    });
    expect(data.sessionList.map((session) => session.id)).toEqual(['b', 'a']);
    const [, a] = data.sessionList;
    expect(a).toMatchObject({
      folder: '/work/alpha',
      first: now - 50 * MIN,
      requests: 3,
      tokens: {
        total: 300,
        byModel: { opus: 200, fable: 100 },
        byEffort: { xhigh: 200, high: 100 },
      },
    });
    expect(a.cost.total).toBeCloseTo(0.0018, 10);
    // 50 to 46 minutes ago, through the last request's 20 seconds.
    expect(a.active).toBe(4 * MIN + 20_000);
    expect(data.sessionList[0].folder).toBeUndefined();
  });

  it('splits tokens by effort level too, least effort first and unnamed last', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [
        request('a', 10, { effort: 'xhigh' }),
        request('a', 11, { effort: 'low' }),
        request('a', 12),
      ],
      snapshots: [],
    });
    expect(data.efforts).toEqual(['low', 'xhigh', 'none']);
    expect(data.buckets[47].tokens.byEffort).toEqual({ xhigh: 100, low: 100, none: 100 });
  });

  it('splits by token type, cache writes of both lifetimes together', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [
        request('a', 10, {
          tokens: tokens({ input: 1, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 40, output: 5 }),
        }),
      ],
      snapshots: [],
    });
    expect(data.buckets[47].tokens.byType).toEqual({
      input: 1,
      cacheWrite: 5,
      cacheRead: 40,
      output: 5,
    });
    const cost = data.buckets[47].cost;
    expect(cost.byType.cacheRead).toBeCloseTo((40 * 4 * 0.05) / 1e6, 12);
    expect(cost.total).toBeCloseTo((1 * 4 + 2 * 5 + 3 * 8 + 40 * 0.2 + 5 * 20) / 1e6, 12);
  });

  it('leaves out the cost of models without a known price, not their tokens', () => {
    const data = buildTimeline({
      range: '24h',
      now,
      requests: [request('a', 10, { model: 'claude-opus-9' })],
      snapshots: [],
    });
    expect(data.buckets[47].tokens.total).toBe(100);
    expect(data.buckets[47].cost.total).toBe(0);
    expect(data.spend.unpriced).toBe(1);
  });
});

describe('spendOf', () => {
  const million = tokens({ output: 1_000_000 });
  const startOfToday = now - 12 * HOUR;

  it('adds up what requests would cost at API prices over fixed periods', () => {
    const spend = spendOf(
      [
        request('a', 60, { tokens: million }),
        request('a', 13 * 60, { tokens: million }),
        request('b', 3 * 24 * 60, { tokens: million }),
        request('c', 10 * 24 * 60, { tokens: million }),
        request('d', 31 * 24 * 60, { tokens: million }),
      ],
      now,
      startOfToday,
    );
    expect(spend).toEqual({
      today: 20,
      last7Days: 60,
      last30Days: 80,
      // Four days had requests within the 30.
      perActiveDay: 20,
      unpriced: 0,
    });
  });

  it('bills fast mode, US-only inference and web searches', () => {
    const fast = spendOf([request('a', 1, { tokens: million, fast: true })], now, startOfToday);
    expect(fast.today).toBe(40);
    const us = spendOf([request('a', 1, { tokens: million, usOnly: true })], now, startOfToday);
    expect(us.today).toBeCloseTo(22, 10);
    const searches = spendOf(
      [request('a', 1, { tokens: tokens({ webSearches: 3 }) })],
      now,
      startOfToday,
    );
    expect(searches.today).toBeCloseTo(0.03, 10);
  });
});

describe('effortOrder', () => {
  it('puts levels Claude Code adds later after the known ones', () => {
    expect(effortOrder(['none', 'max', 'turbo', 'medium', 'medium'])).toEqual([
      'medium',
      'max',
      'turbo',
      'none',
    ]);
  });
});
