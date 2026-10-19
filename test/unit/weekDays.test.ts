import { describe, expect, it } from 'vitest';
import type { TimelineRequest } from '../../src/extension/model/timeline';
import { weekDays } from '../../src/extension/model/weekDays';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import type { Pace } from '../../src/shared/protocol';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A weekly reset; the week runs a week from it. */
const reset = Date.UTC(2026, 9, 12, 9);
const week = { from: reset, to: reset + 7 * DAY };
/** Halfway through the fourth day. */
const now = reset + 3.5 * DAY;
/** 0.1% of the week a dollar; 20% a day left for the week to last. */
const pace = { weeklyPerDollar: 0.1, fiveHourPerDollar: 1, week: { budget: 20 } } as Pace;

/** A request at `time` that costs `dollars` at Opus 5.5's output price of $20 a million. */
const request = (time: number, dollars: number): TimelineRequest => ({
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

const reading = (time: number, weekly: number): QuotaSnapshot => ({
  time,
  available: true,
  plan: 'max',
  fiveHour: { percent: 0, resetsAt: time + HOUR },
  weekly: { percent: weekly, resetsAt: week.to },
  models: [],
});

const days = (requests: TimelineRequest[], snapshots: QuotaSnapshot[], at = now, shown = week) =>
  weekDays({
    weeks: [shown],
    now: at,
    requests,
    snapshots,
    limits: [],
    pace,
    weeklyReset: reset,
  });

describe('weekDays', () => {
  it('takes what each day used from the readings, and what each day ahead can take', () => {
    const result = days(
      [
        request(reset + 2 * HOUR, 50),
        request(reset + DAY + 3 * HOUR, 100),
        request(reset + 2 * DAY + 5 * HOUR, 30),
        request(reset + 3 * DAY + HOUR, 20),
      ],
      [
        reading(reset + 2 * HOUR + MIN, 5),
        reading(reset + DAY + 3 * HOUR + MIN, 15),
        reading(reset + 2 * DAY + 5 * HOUR + MIN, 18),
        reading(reset + 3 * DAY + HOUR + MIN, 20),
      ],
    );
    expect(result.map((day) => day.from)).toEqual(
      Array.from({ length: 7 }, (_, i) => reset + i * DAY),
    );
    expect(result.map((day) => day.used)).toEqual([5, 10, 3, 2, undefined, undefined, undefined]);
    expect(result.every((day) => !day.estimated)).toBe(true);
    expect(result.map((day) => day.cost)).toEqual([50, 100, 30, 20, 0, 0, 0]);
    // Today has half its day left: half of a day's share.
    expect(result.map((day) => day.canTake)).toEqual([
      undefined,
      undefined,
      undefined,
      10,
      20,
      20,
      20,
    ]);
  });

  it('carries a reading to the end of its day with the cost since, as an estimate', () => {
    const [first] = days(
      [request(reset + 10 * HOUR, 40)],
      [reading(reset + HOUR, 2), reading(reset + DAY + HOUR, 6)],
    );
    // Nightpace wasn't running when the $40 was spent: 2% + $40 × 0.1%.
    expect(first.used).toBeCloseTo(6);
    expect(first.estimated).toBe(true);
  });

  it('works out the days before the week was first read from API cost', () => {
    const result = days(
      [
        // The week before has a request: this week is the first full one, and can be estimated.
        request(reset - DAY, 10),
        request(reset + 2 * HOUR, 50),
        request(reset + DAY + 3 * HOUR, 100),
      ],
      [reading(reset + 2 * DAY + HOUR, 15)],
    );
    expect(result[0].used).toBeCloseTo(5);
    expect(result[1].used).toBeCloseTo(10);
    expect(result[0].estimated && result[1].estimated).toBe(true);
    // The third starts from the estimate and ends at a reading.
    expect(result[2].used).toBeCloseTo(0);
    expect(result[2].estimated).toBe(true);
  });

  it('counts what a week reset by hand used again, not its fall', () => {
    const [, second] = days(
      [],
      [
        reading(reset + 20 * HOUR, 90),
        reading(reset + DAY + HOUR, 95),
        reading(reset + DAY + 2 * HOUR, 100),
        reading(reset + DAY + 5 * HOUR, 3),
        reading(reset + DAY + 8 * HOUR, 8),
      ],
    );
    expect(second.used).toBe(5 + 5 + 3 + 5);
  });

  it('ends a week gone by with what its last day used, before the next reset', () => {
    const before = { from: week.from - 7 * DAY, to: week.from };
    const result = days(
      [request(before.from - DAY, 10), request(before.from + 6 * DAY + 12 * HOUR, 30)],
      [],
      now,
      before,
    );
    expect(result[6].used).toBeCloseTo(3);
    expect(result.every((day) => day.canTake === undefined)).toBe(true);
  });

  it('runs the days of several weeks one after the other', () => {
    const before = { from: week.from - 7 * DAY, to: week.from };
    const result = weekDays({
      weeks: [before, week],
      now,
      requests: [],
      snapshots: [],
      limits: [],
      pace,
      weeklyReset: reset,
    });
    expect(result.map((day) => day.from)).toEqual(
      Array.from({ length: 14 }, (_, i) => before.from + i * DAY),
    );
  });

  it('says nothing of days it has no way to know', () => {
    // The first request is within the week and nothing was read: no estimate either.
    const result = days([request(reset + 2 * HOUR, 50)], []);
    expect(result.slice(0, 4).map((day) => day.used)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(result[0].cost).toBe(50);
  });
});
