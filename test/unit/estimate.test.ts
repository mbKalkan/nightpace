import { describe, expect, it } from 'vitest';
import { estimateQuota } from '../../src/extension/model/estimate';
import type { TimelineRequest } from '../../src/extension/model/timeline';
import type { Pace, TimelineData } from '../../src/shared/protocol';
import { quotaAt, weeklyForecast } from '../../src/webview/chart/timelineChart';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A weekly reset, a Wednesday evening. */
const reset = Date.UTC(2026, 9, 14, 20, 0);

/** A request at `time` that costs `dollars` at Opus 5.5's output price of $20 a million. */
const request = (time: number, dollars = 1): TimelineRequest => ({
  sessionId: 's1',
  time,
  end: time + 20_000,
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  sidechain: false,
  tokens: {
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: dollars * 50_000,
    thinking: 0,
  },
});

describe('estimateQuota', () => {
  const weekOpened = reset - 7 * DAY;
  const morning = weekOpened + 14 * HOUR; // Thursday 10:00
  const requests = [
    // Before the week: the first request, which the week before can't be measured from.
    request(weekOpened - DAY),
    // A window opens at 10:00 with the first request, at 10:03, and closes at 15:00.
    ...Array.from({ length: 6 }, (_, i) => request(morning + (3 + i * 10) * MIN)),
    // The next opens with the first request after that, to the 10 minutes: 16:00.
    request(morning + 6 * HOUR + 7 * MIN),
    request(reset - 10 * HOUR, 4),
  ];
  const points = estimateQuota({
    requests,
    weeklyReset: reset,
    fiveHourPerDollar: 2,
    weeklyPerDollar: 0.5,
    from: weekOpened - 20 * HOUR,
    to: reset + 4 * HOUR,
  });
  const at = (time: number) => quotaAt(points, time)!;

  it('starts with the first week that opened after the first request', () => {
    expect(points[0].time).toBe(weekOpened);
    expect(points[points.length - 1].time).toBe(reset + 4 * HOUR);
  });

  it('works out 5-hour windows from the requests and the week from its reset', () => {
    expect(at(morning + 2 * HOUR)).toMatchObject({ fiveHour: 12, weekly: 3 });
    // The window closed at 15:00: the value just before, then nothing.
    const closing = points.filter((point) => point.time === morning + 5 * HOUR);
    expect(closing.map((point) => point.fiveHour)).toEqual([12, 0]);
    expect(at(morning + 6 * HOUR + 20 * MIN)).toMatchObject({ fiveHour: 2, weekly: 3.5 });
  });

  it('drops the week to nothing at its reset', () => {
    const atReset = points.filter((point) => point.time === reset);
    expect(atReset.map((point) => point.weekly)).toEqual([5.5, 0]);
  });

  it('reaches 100% where Claude Code logged that a limit ran out', () => {
    const hit = morning + 53 * MIN;
    const logged = estimateQuota({
      requests,
      weeklyReset: reset,
      fiveHourPerDollar: 10,
      weeklyPerDollar: 0.5,
      from: weekOpened - 20 * HOUR,
      to: reset + 4 * HOUR,
      hits: [{ time: hit, limit: 'fiveHour' }],
    });
    // $6 by the hit: 60% at the measured rate, so the window is scaled to 100% there.
    expect(quotaAt(logged, hit)!.fiveHour).toBe(100);
    expect(quotaAt(logged, morning + 40 * MIN)!.fiveHour).toBeCloseTo(66.7, 1);
    // The next window is measured as before.
    expect(quotaAt(logged, morning + 6 * HOUR + 20 * MIN)!.fiveHour).toBe(10);
  });

  it('starts a week again from zero where it ran out and work went on: a reset by hand', () => {
    // $10 an hour for 12 hours at 1% a dollar: 100% at the tenth hour, 120% by the twelfth.
    const busy = Array.from({ length: 12 }, (_, i) => request(morning + (i + 1) * HOUR, 10));
    const week = (extra: TimelineRequest[]) =>
      estimateQuota({
        requests: [request(weekOpened - DAY), ...extra],
        weeklyReset: reset,
        fiveHourPerDollar: 0.1,
        weeklyPerDollar: 1,
        from: weekOpened,
        to: reset,
      });
    const out = morning + 10 * HOUR;
    const points = week(busy);
    expect(points.filter((p) => p.time === out).map((p) => p.weekly)).toEqual([100, 0]);
    expect(quotaAt(points, morning + 12 * HOUR)!.weekly).toBe(20);
    // A little past 100% is the estimate's own error: it stays at 100% until the reset.
    const little = week([...busy.slice(0, 10), request(morning + 11 * HOUR, 5)]);
    expect(quotaAt(little, morning + 12 * HOUR)!.weekly).toBe(100);
    expect(little.filter((p) => p.time === out)).toHaveLength(1);
  });

  it('estimates nothing without requests, or before the first full week', () => {
    const none = { weeklyReset: reset, fiveHourPerDollar: 2, weeklyPerDollar: 0.5 };
    expect(estimateQuota({ ...none, requests: [], from: 0, to: reset })).toEqual([]);
    expect(
      estimateQuota({ ...none, requests, from: weekOpened - 20 * HOUR, to: weekOpened }),
    ).toEqual([]);
  });
});

describe('weeklyForecast', () => {
  const now = reset - 3 * DAY;
  const pace = (week: Partial<Pace['week']>): Pace =>
    ({
      now,
      week: {
        used: 40,
        resetsAt: reset,
        pace: 10,
        atReset: 70,
        budget: 20,
        budgetHours: [],
        ...week,
      },
    }) as unknown as Pace;
  const data = (week: Partial<Pace['week']>, from = now - 7 * DAY): TimelineData =>
    ({
      from,
      to: now,
      extent: { from: now - 7 * DAY, to: now },
      quota: [{ time: now - 10 * MIN, weekly: 39, weeklyReset: reset }],
      pace: pace(week),
    }) as unknown as TimelineData;

  it('heads from the last reading to the reset at the pace of the last 7 days', () => {
    // Twelve days shown: the axis runs four days on, past the reset in three.
    expect(weeklyForecast(data({}, now - 12 * DAY))).toEqual({
      end: now + 4 * DAY,
      points: [
        [now - 10 * MIN, 39],
        [now, 40],
        [reset, 70],
      ],
    });
  });

  it('runs a third of the window shown past now, and stops at 100%', () => {
    const day = weeklyForecast(data({}, now - DAY))!;
    expect(day.end).toBe(now + 8 * HOUR);
    expect(day.points.at(-1)![0]).toBe(now + 8 * HOUR);
    expect(day.points.at(-1)![1]).toBeCloseTo(40 + 10 / 3);
    const runsOut = weeklyForecast(data({ pace: 30, runsOut: now + 2 * DAY }, now - 12 * DAY))!;
    expect(runsOut.points.slice(-2)).toEqual([
      [now + 2 * DAY, 100],
      [reset, 100],
    ]);
  });

  it('is left out of a window in the past', () => {
    expect(weeklyForecast({ ...data({}), to: now - DAY })).toBeUndefined();
  });
});
