import { describe, expect, it } from 'vitest';
import { quotaMoments } from '../../src/webview/chart/timelineChart';
import type { QuotaPoint, TimelineData } from '../../src/shared/protocol';

const MIN = 60_000;

const timeline = (parts: Partial<TimelineData>) =>
  ({
    from: 0,
    to: 100 * MIN,
    quota: [],
    limitHits: [],
    ...parts,
  }) as unknown as TimelineData;
const at = (minutes: number, point: Omit<QuotaPoint, 'time'>): QuotaPoint => ({
  time: minutes * MIN,
  ...point,
});

describe('quotaMoments', () => {
  it('takes each reading within the window, oldest first', () => {
    const moments = quotaMoments(
      timeline({
        quota: [
          at(-5, { fiveHour: 1 }),
          at(10, { fiveHour: 20, weekly: 5 }),
          at(15, { fiveHour: 25, weekly: 6 }),
          at(105, { fiveHour: 30 }),
        ],
      }),
    );
    expect(moments.map((moment) => [moment.time / MIN, moment.fiveHour])).toEqual([
      [10, 20],
      [15, 25],
    ]);
    expect(moments.every((moment) => !moment.estimated)).toBe(true);
  });

  it('takes the value an estimate drops from at a reset, and a reading over an estimate', () => {
    const moments = quotaMoments(
      timeline({
        quota: [at(60, { fiveHour: 3, weekly: 9 })],
        quotaEstimate: [
          at(20, { fiveHour: 80, weekly: 8 }),
          at(20, { fiveHour: 0, weekly: 8 }),
          at(60, { fiveHour: 2, weekly: 8.5 }),
        ],
      }),
    );
    expect(moments).toEqual([
      { time: 20 * MIN, fiveHour: 80, weekly: 8, estimated: true, limits: [] },
      { time: 60 * MIN, fiveHour: 3, weekly: 9, estimated: false, limits: [] },
    ]);
  });

  it('marks where a limit ran out, with the quota then', () => {
    const moments = quotaMoments(
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
    expect(moments).toEqual([
      { time: 10 * MIN, fiveHour: 100, weekly: 30, estimated: true, limits: ['fiveHour'] },
      { time: 30 * MIN, fiveHour: 97, weekly: 40, estimated: false, limits: [] },
      {
        time: 33 * MIN,
        fiveHour: 97,
        weekly: 40,
        estimated: false,
        limits: ['fiveHour', 'weekly'],
      },
    ]);
  });
});
