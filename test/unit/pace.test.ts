import { describe, expect, it } from 'vitest';
import {
  costIndex,
  measure,
  paceOf,
  rateHistory,
  sessionRates,
  weekForecast,
  windowForecast,
  windowReadings,
} from '../../src/extension/model/pace';
import type { TimelineRequest } from '../../src/extension/model/timeline';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 15, 12, 0);

/** A request `minutesAgo` that costs `dollars` at Opus 5.5's output price of $20 a million. */
const request = (
  minutesAgo: number,
  dollars: number,
  overrides: Partial<TimelineRequest> = {},
): TimelineRequest => ({
  sessionId: 's1',
  time: now - minutesAgo * MIN,
  end: now - minutesAgo * MIN + 20_000,
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
  ...overrides,
});

const reading = (
  minutesAgo: number,
  fiveHour: number,
  fiveHourResets: number,
  weekly: number,
  weeklyResets: number,
  plan = 'max',
): QuotaSnapshot => ({
  time: now - minutesAgo * MIN,
  available: true,
  plan,
  fiveHour: { percent: fiveHour, resetsAt: fiveHourResets },
  weekly: { percent: weekly, resetsAt: weeklyResets },
  models: [],
});

describe('costIndex', () => {
  it('sums the cost of the requests made after `from` up to `to`', () => {
    const between = costIndex([request(30, 2), request(20, 3), request(10, 5)]);
    expect(between(now - 60 * MIN, now)).toBeCloseTo(10);
    expect(between(now - 30 * MIN, now)).toBeCloseTo(8);
    expect(between(now - 25 * MIN, now - 10 * MIN)).toBeCloseTo(8);
    expect(between(now, now - HOUR)).toBe(0);
  });
});

describe('windowReadings', () => {
  const weekly = (s: QuotaSnapshot) => s.weekly;
  const resets = now + 2 * DAY;

  it('opens each window a span before its reset', () => {
    const read = windowReadings([reading(60, 0, now, 10, resets)], weekly, 7 * DAY);
    expect(read[0].opened).toBe(resets - 7 * DAY);
  });

  it('starts the window again where usage fell before its reset: a reset by hand', () => {
    const read = windowReadings(
      [
        reading(120, 0, now, 98, resets),
        reading(115, 0, now, 100, resets),
        reading(110, 0, now, 1, resets),
        reading(105, 0, now, 3, resets),
        // The reset comes with a second's jitter.
        reading(100, 0, now, 4, resets + 1_000),
      ],
      weekly,
      7 * DAY,
    );
    expect(read.map((r) => r.opened)).toEqual([
      resets - 7 * DAY,
      resets - 7 * DAY,
      now - 115 * MIN,
      now - 115 * MIN,
      now - 115 * MIN,
    ]);
  });

  it('starts it again where a new reset came before the old one', () => {
    // A week from the new reset, which is after the reading before.
    const read = windowReadings(
      [reading(20, 0, now, 100, resets), reading(10, 0, now, 0, now + 7 * DAY - 15 * MIN)],
      weekly,
      7 * DAY,
    );
    expect(read[1].opened).toBe(now - 15 * MIN);
  });
});

describe('measure', () => {
  it('finds the percent a dollar uses from readings that follow the cost', () => {
    // A 5-hour window opened two hours ago: $1 every 10 minutes, and 0.4% a dollar.
    const resets = now + 3 * HOUR;
    const requests = Array.from({ length: 12 }, (_, i) => request(115 - i * 10, 1));
    const readings = [100, 70, 40, 10].map((ago) => {
      const spent = requests.filter((r) => r.time <= now - ago * MIN).length;
      return reading(ago, spent * 0.4, resets, 1, now + DAY);
    });
    const result = measure(readings, (s) => s.fiveHour, 5 * HOUR, costIndex(requests))!;
    expect(result.perDollar).toBeCloseTo(0.4);
    // One window, under 10%: too little to trust.
    expect(result.settled).toBe(false);
  });

  it('is settled once three 5-hour windows went past 10%', () => {
    const requests: TimelineRequest[] = [];
    const readings: QuotaSnapshot[] = [];
    for (let w = 0; w < 3; w++) {
      const opened = now - (3 - w) * 6 * HOUR;
      for (let i = 0; i < 30; i++) {
        requests.push(request((now - opened) / MIN - i * 5 - 1, 1));
      }
      readings.push(reading((now - opened) / MIN - 160, 12, opened + 5 * HOUR, 5, now + DAY));
    }
    const result = measure(readings, (s) => s.fiveHour, 5 * HOUR, costIndex(requests))!;
    expect(result.settled).toBe(true);
  });

  it('measures a week reset by hand from where it was reset', () => {
    // At 0.5% a dollar: $40 two days ago, then $1 every 10 minutes for 3 hours, and the week
    // reset by hand after the reading 150 minutes ago.
    const requests = [
      ...Array.from({ length: 40 }, (_, i) => request(2 * 24 * 60 + i, 1)),
      ...Array.from({ length: 18 }, (_, i) => request(175 - i * 10, 1)),
    ];
    const spent = (from: number, to: number) =>
      requests.filter((r) => r.time > now - from * MIN && r.time <= now - to * MIN).length;
    const weekResets = now + 4 * DAY;
    const readings = [
      reading(150, 0, now + HOUR, spent(3 * 24 * 60, 150) * 0.5, weekResets),
      reading(100, 0, now + HOUR, spent(150, 100) * 0.5, weekResets),
      reading(5, 0, now + HOUR, spent(150, 5) * 0.5, weekResets),
    ];
    const result = measure(readings, (s) => s.weekly, 7 * DAY, costIndex(requests))!;
    expect(result.perDollar).toBeCloseTo(0.5);
  });

  it('measures nothing without cost', () => {
    const readings = [reading(10, 5, now + HOUR, 5, now + DAY)];
    expect(measure(readings, (s) => s.fiveHour, 5 * HOUR, costIndex([]))).toBeUndefined();
  });
});

describe('sessionRates', () => {
  it("gives each kind of session its cost per hour of work, from sessions' main kind", () => {
    const requests = [
      // Three hours of xhigh at $30 an hour: a request every 4 minutes.
      ...Array.from({ length: 46 }, (_, i) => request(600 - i * 4, 2)),
      // Two hours of high at $15 an hour, in another session.
      ...Array.from({ length: 31 }, (_, i) =>
        request(300 - i * 4, 1, { sessionId: 's2', effort: 'high' }),
      ),
      // Too short to measure.
      request(20, 5, { sessionId: 's3', effort: 'low' }),
    ];
    const rates = sessionRates(requests, now);
    expect(rates.map((rate) => `${rate.family}/${rate.effort}`)).toEqual([
      'opus/xhigh',
      'opus/high',
    ]);
    expect(rates[0].costPerHour).toBeCloseTo(30.7, 0);
    expect(rates[1].costPerHour).toBeCloseTo(15.5, 0);
  });
});

describe('weekForecast', () => {
  const latest = reading(0, 0, now + HOUR, 40, now + 3 * DAY);
  const rates = [{ family: 'opus' as const, effort: 'xhigh', costPerHour: 20, hours: 50 }];

  it('says when the week runs out at the pace of the last 7 days', () => {
    // $70 a day for a week at 0.1% a dollar: 7% a day; 40% + 7% × 3 days = 61%: it lasts.
    const requests = Array.from({ length: 7 }, (_, i) => request(i * 24 * 60 + 60, 70));
    const week = weekForecast(latest, latest.weekly!, 0.1, rates, costIndex(requests), now);
    expect(week.pace).toBeCloseTo(7);
    expect(week.runsOut).toBeUndefined();
    expect(week.atReset).toBeCloseTo(61);
    // 60% left over 3 days: 20% a day, which is 10 hours of a $20 session at 0.1% a dollar.
    expect(week.budget).toBeCloseTo(20);
    expect(week.budgetHours[0]).toBeCloseTo(10);
  });

  it('runs out before the reset at a faster pace', () => {
    const requests = Array.from({ length: 7 }, (_, i) => request(i * 24 * 60 + 60, 300));
    const week = weekForecast(latest, latest.weekly!, 0.1, rates, costIndex(requests), now);
    // 30% a day: the 60% left lasts two days.
    expect(week.runsOut).toBeCloseTo(now + 2 * DAY, -4);
    expect(week.atReset).toBeGreaterThan(100);
  });

  it('starts a week that reset since the last reading from the requests since the reset', () => {
    const old = reading(3 * 60, 0, now - 4 * HOUR, 90, now - 2 * HOUR);
    const requests = [request(60, 50)];
    const week = weekForecast(old, old.weekly!, 0.1, rates, costIndex(requests), now);
    expect(week.resetsAt).toBe(now - 2 * HOUR + 7 * DAY);
    expect(week.used).toBeCloseTo(5);
  });
});

describe('windowForecast', () => {
  const rates = [{ family: 'opus' as const, effort: 'xhigh', costPerHour: 25, hours: 50 }];

  it('says how long the window lasts with one to five sessions at once', () => {
    // 50% left, 1% a dollar: $50, two hours of one session; the window resets in 3 hours.
    const latest = reading(0, 50, now + 3 * HOUR, 10, now + 3 * DAY);
    const window = windowForecast({
      latest,
      fiveHour: latest.fiveHour!,
      perDollar: 1,
      weeklyPerDollar: 0.01,
      weeklyUsed: 10,
      rates,
      costBetween: costIndex([]),
      now,
    });
    expect(window.used).toBe(50);
    expect(window.resetsAt).toBe(now + 3 * HOUR);
    expect(window.lasts[0][0]).toBeCloseTo(2 * HOUR);
    expect(window.lasts[0][1]).toBeCloseTo(HOUR);
    expect(window.lasts[0]).toHaveLength(5);
  });

  it('lasts when the window resets first, and opens a full window when none is open', () => {
    const latest = reading(30, 80, now - HOUR, 10, now + 3 * DAY);
    const window = windowForecast({
      latest,
      fiveHour: latest.fiveHour!,
      perDollar: 0.4,
      weeklyPerDollar: 0.01,
      weeklyUsed: 10,
      rates,
      costBetween: costIndex([]),
      now,
    });
    expect(window.used).toBe(0);
    expect(window.resetsAt).toBeUndefined();
    // 10% an hour a session: one lasts the five hours, five use it up in two.
    expect(window.lasts[0][0]).toBeNull();
    expect(window.lasts[0][4]).toBeCloseTo(2 * HOUR);
  });

  it('looks on into the next window when this one resets first', () => {
    // 50% used, resetting in half an hour; 25% an hour a session.
    const latest = reading(0, 50, now + 30 * MIN, 10, now + 3 * DAY);
    const window = windowForecast({
      latest,
      fiveHour: latest.fiveHour!,
      perDollar: 1,
      weeklyPerDollar: 0.01,
      weeklyUsed: 10,
      rates,
      costBetween: costIndex([]),
      now,
    });
    // One session outlasts this window; the next, from 0%, runs out after four hours.
    expect(window.lasts[0][0]).toBeCloseTo(4.5 * HOUR);
    expect(window.lasts[0][1]).toBeCloseTo(2.5 * HOUR);
    // Five use up the 50% left before the reset.
    expect(window.lasts[0][4]).toBeCloseTo(0.4 * HOUR);
  });

  it('runs out with the week when the week has less left', () => {
    const latest = reading(0, 0, now + 5 * HOUR, 99, now + 3 * DAY);
    const window = windowForecast({
      latest,
      fiveHour: latest.fiveHour!,
      perDollar: 0.1,
      weeklyPerDollar: 0.04,
      weeklyUsed: 99,
      rates,
      costBetween: costIndex([]),
      now,
    });
    // 1% of the week left at 1% an hour.
    expect(window.lasts[0][0]).toBeCloseTo(HOUR);
  });
});

describe('rateHistory', () => {
  it('measures each 5-hour window on its own, to see the limit change', () => {
    // $1 every 10 minutes in both: 0.4% a dollar in the first window and 0.5% in the second.
    const first = Array.from({ length: 30 }, (_, i) => request(595 - i * 10, 1));
    const second = Array.from({ length: 24 }, (_, i) => request(235 - i * 10, 1));
    const readings = [
      reading(450, 6, now - 5 * HOUR, 1, now + DAY),
      reading(302, 12, now - 5 * HOUR, 2, now + DAY),
      reading(3, 12, now + HOUR, 3, now + DAY),
    ];
    const points = rateHistory(
      readings,
      (s) => s.fiveHour,
      5 * HOUR,
      costIndex([...first, ...second]),
      () => 0,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ from: now - 10 * HOUR, to: now - 302 * MIN });
    expect(points[0].perDollar).toBeCloseTo(0.4);
    expect(points[1]).toMatchObject({ from: now - 4 * HOUR, to: now - 3 * MIN });
    expect(points[1].perDollar).toBeCloseTo(0.5);
  });

  it('takes the week a day at a time, once a stretch has used 10%', () => {
    const requests = [3.5, 2.5, 1.5, 1.2].map((days) => request(days * 24 * 60, 10));
    const resets = now + 3 * DAY;
    const readings = [3, 2, 1.3, 1.1].map((days, i) =>
      reading(days * 24 * 60, 0, now + HOUR, [4, 12, 16, 22][i], resets),
    );
    const points = rateHistory(
      readings,
      (s) => s.weekly,
      7 * DAY,
      costIndex(requests),
      (time) => Math.floor(time / DAY),
    );
    // 4% on the first day is too little; the last two readings fall on one day.
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ from: now - 4 * DAY, to: now - 2 * DAY });
    expect(points[0].perDollar).toBeCloseTo(12 / 20);
    expect(points[1]).toMatchObject({ from: now - 2 * DAY, to: now - 1.1 * DAY });
    expect(points[1].perDollar).toBeCloseTo(10 / 20);
  });

  it('starts again where the account comes back, without the use while it was away', () => {
    const away = awayAndBack();
    const points = rateHistory(
      away.readings,
      (s) => s.weekly,
      7 * DAY,
      costIndex(away.requests),
      (time) => Math.floor(time / DAY),
      away.signedIn,
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ from: now - DAY, to: now - 0.5 * DAY });
    expect(points[0].perDollar).toBeCloseTo(0.6);
  });
});

/**
 * At 0.6% a dollar, $10 used 6% of the week here; then the folder went to another account for two
 * days while this one used 30% elsewhere; back here, $20 more used 12%.
 */
function awayAndBack() {
  const resets = now + 3 * DAY;
  return {
    requests: [3.5, 0.8, 0.6].map((days) => request(days * 24 * 60, 10)),
    readings: [
      [3, 6],
      [1, 36],
      [0.5, 48],
    ].map(([days, percent]) => reading(days * 24 * 60, 0, now + HOUR, percent, resets)),
    signedIn: (from: number, to: number) => to <= now - 2.9 * DAY || from >= now - DAY,
  };
}

describe('the account away', () => {
  it('measures only the use since it came back', () => {
    const away = awayAndBack();
    const between = costIndex(away.requests);
    const weekly = (s: QuotaSnapshot) => s.weekly;
    expect(measure(away.readings, weekly, 7 * DAY, between, away.signedIn)!.perDollar).toBeCloseTo(
      0.6,
    );
    // Taken as signed in all along, the use elsewhere would look like a dearer dollar.
    expect(measure(away.readings, weekly, 7 * DAY, between)!.perDollar).toBeGreaterThan(1.5);
  });
});

describe('paceOf', () => {
  it('needs a reading with both limits', () => {
    expect(paceOf([request(10, 1)], [], now)).toBeUndefined();
    const apiKey: QuotaSnapshot = { time: now, available: false, models: [] };
    expect(paceOf([request(10, 1)], [apiKey], now)).toBeUndefined();
  });

  it("measures only the latest plan's readings", () => {
    // Within the 5-hour window, which opened three hours ago.
    const requests = Array.from({ length: 20 }, (_, i) => request(170 - i * 8, 1));
    const spent = (ago: number) => requests.filter((r) => r.time <= now - ago * MIN).length;
    const fiveResets = now + 2 * HOUR;
    const weekResets = now + 2 * DAY;
    const readings = [
      // An older plan with twice the use a dollar.
      reading(150, spent(150) * 0.8, fiveResets, spent(150) * 0.2, weekResets, 'pro'),
      ...[100, 50, 5].map((ago) =>
        reading(ago, spent(ago) * 0.4, fiveResets, spent(ago) * 0.1, weekResets),
      ),
    ];
    const pace = paceOf(requests, readings, now)!;
    expect(pace.fiveHourPerDollar).toBeCloseTo(0.4);
    expect(pace.weeklyPerDollar).toBeCloseTo(0.1);
    expect(pace.learning).toBe(true);
    expect(pace.now).toBe(now);
  });

  it('leaves out of the history a window that opened before the first request', () => {
    // The week opened 5 days ago, before any request it could be measured by; the 5-hour window
    // opened after the first one, made in an earlier window.
    const requests = Array.from({ length: 28 }, (_, i) => request(285 - i * 10, 1));
    const spent = (ago: number) => requests.filter((r) => r.time <= now - ago * MIN).length;
    const readings = [200, 100, 5].map((ago) =>
      reading(ago, spent(ago) * 0.4, now + 10 * MIN, 40 + spent(ago) * 0.1, now + 2 * DAY),
    );
    const pace = paceOf([request(400, 1), ...requests], readings, now, 0)!;
    expect(pace.history.weekly).toEqual([]);
    expect(pace.history.fiveHour).toHaveLength(1);
    expect(pace.history.fiveHour[0].perDollar).toBeCloseTo(0.4);
  });
});
