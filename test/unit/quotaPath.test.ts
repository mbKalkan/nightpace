import { describe, expect, it } from 'vitest';
import { quotaPath } from '../../src/webview/chart/timelineChart';
import type { QuotaPoint } from '../../src/shared/protocol';

const MIN = 60_000;
const HOUR = 60 * MIN;
// Minutes across, percent up: the path reads in the units of the test.
const x = (time: number) => time / MIN;
const y = (value: number) => value;
const at = (minutes: number, point: Omit<QuotaPoint, 'time'>): QuotaPoint => ({
  time: minutes * MIN,
  ...point,
});

const weekly = (points: QuotaPoint[]) =>
  quotaPath(points, 'weekly', 'weeklyReset', 7 * 24 * HOUR, x, y);
const fiveHour = (points: QuotaPoint[]) =>
  quotaPath(points, 'fiveHour', 'fiveHourReset', 5 * HOUR, x, y);

describe('quotaPath', () => {
  it('joins readings a few minutes apart', () => {
    expect(weekly([at(0, { weekly: 10 }), at(5, { weekly: 11 })])).toEqual({
      observed: 'M0,10L5,11',
      unrecorded: '',
    });
  });

  it('carries a share that is the same on both sides of a silence across it', () => {
    // Off for four hours, then for ten: nothing used, so nothing changed.
    const path = weekly([
      at(0, { weekly: 13 }),
      at(240, { weekly: 13 }),
      at(280, { weekly: 13 }),
      at(880, { weekly: 13 }),
    ]);
    expect(path).toEqual({ observed: 'M0,13L240,13L280,13L880,13', unrecorded: '' });
  });

  it('leaves a silence the share rose in unrecorded: when it rose is unknown', () => {
    expect(weekly([at(0, { weekly: 13 }), at(240, { weekly: 16 })])).toEqual({
      observed: 'M0,13M240,16',
      unrecorded: 'M0,13L240,16',
    });
  });

  it('drops to zero at a reset in a silence, and stays there if nothing opened a window', () => {
    const path = fiveHour([
      at(0, { fiveHour: 31, fiveHourReset: 30 * MIN }),
      at(240, { fiveHour: 0 }),
    ]);
    expect(path).toEqual({ observed: 'M0,31L30,31V0L240,0', unrecorded: '' });
  });

  it('keeps a window that opened in a silence empty until it opened', () => {
    // The next reading's window resets five hours after it opened, at minute 581.
    const path = fiveHour([
      at(0, { fiveHour: 3, fiveHourReset: 270 * MIN }),
      at(600, { fiveHour: 2, fiveHourReset: 881 * MIN }),
    ]);
    expect(path).toEqual({ observed: 'M0,3L270,3V0L581,0L600,2', unrecorded: '' });
  });

  it('leaves a silence longer than a window unrecorded, as one may have come and gone', () => {
    expect(fiveHour([at(0, { fiveHour: 0 }), at(400, { fiveHour: 0 })])).toEqual({
      observed: 'M0,0M400,0',
      unrecorded: 'M0,0L400,0',
    });
  });
});
