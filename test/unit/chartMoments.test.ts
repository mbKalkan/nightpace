import { describe, expect, it } from 'vitest';
import { chartMoments } from '../../src/webview/chart/timelineChart';
import type { QuotaPoint, TimelineData } from '../../src/shared/protocol';

const MIN = 60_000;

const timeline = (parts: Partial<TimelineData>) =>
  ({
    from: 0,
    to: 100 * MIN,
    quota: [],
    limitHits: [],
    sessions: [],
    ...parts,
  }) as unknown as TimelineData;
const at = (minutes: number, point: Omit<QuotaPoint, 'time'>): QuotaPoint => ({
  time: minutes * MIN,
  ...point,
});

describe('chartMoments', () => {
  it('takes each reading within the window, oldest first, with the sessions then', () => {
    const { quota } = chartMoments(
      timeline({
        quota: [
          at(-5, { fiveHour: 1 }),
          at(10, { fiveHour: 20, weekly: 5 }),
          at(15, { fiveHour: 25, weekly: 6 }),
          at(105, { fiveHour: 30 }),
        ],
        sessions: [
          { time: 0, count: 1 },
          { time: 12 * MIN, count: 2 },
        ],
      }),
    );
    expect(quota.map((moment) => [moment.time / MIN, moment.fiveHour, moment.sessions])).toEqual([
      [10, 20, 1],
      [15, 25, 2],
    ]);
    expect(quota.every((moment) => !moment.estimated)).toBe(true);
  });

  it('takes the value an estimate drops from at a reset, and a reading over an estimate', () => {
    const { quota } = chartMoments(
      timeline({
        quota: [at(60, { fiveHour: 3, weekly: 9 })],
        quotaEstimate: [
          at(20, { fiveHour: 80, weekly: 8 }),
          at(20, { fiveHour: 0, weekly: 8 }),
          at(60, { fiveHour: 2, weekly: 8.5 }),
        ],
      }),
    );
    expect(quota).toEqual([
      { time: 20 * MIN, fiveHour: 80, weekly: 8, estimated: true, limits: [], sessions: 0 },
      { time: 60 * MIN, fiveHour: 3, weekly: 9, estimated: false, limits: [], sessions: 0 },
    ]);
  });

  it('marks where a limit ran out, with the quota then', () => {
    const { quota } = chartMoments(
      timeline({
        quota: [at(30, { fiveHour: 97, weekly: 40 })],
        quotaEstimate: [at(10, { fiveHour: 100, weekly: 30 })],
        limitHits: [
          { time: 10 * MIN, limit: 'fiveHour' },
          { time: 33 * MIN, limit: 'fiveHour' },
          { time: 33 * MIN, limit: 'weekly' },
        ],
      }),
    );
    expect(
      quota.map(({ time, fiveHour, estimated, limits }) => [
        time / MIN,
        fiveHour,
        estimated,
        limits,
      ]),
    ).toEqual([
      [10, 100, true, ['fiveHour']],
      [30, 97, false, []],
      [33, 97, false, ['fiveHour', 'weekly']],
    ]);
  });

  it('takes each change in the sessions working at once, with the quota then', () => {
    const { sessions } = chartMoments(
      timeline({
        quota: [at(40, { fiveHour: 12, weekly: 30 })],
        quotaEstimate: [at(0, { fiveHour: 5, weekly: 28 })],
        sessions: [
          { time: -10 * MIN, count: 1 },
          { time: 20 * MIN, count: 3 },
          { time: 50 * MIN, count: 0 },
        ],
      }),
    );
    expect(sessions).toEqual([
      { time: 20 * MIN, fiveHour: 5, weekly: 28, estimated: true, limits: [], sessions: 3 },
      { time: 50 * MIN, fiveHour: 12, weekly: 30, estimated: false, limits: [], sessions: 0 },
    ]);
  });
});
