import { describe, expect, it } from 'vitest';
import { timeTicks } from '../../src/webview/chart/ticks';

const DAY = 86_400_000;

describe('timeTicks', () => {
  it('leaves out a tick that the start of a month brings too close to the last one', () => {
    const from = new Date(2026, 8, 16).getTime();
    const { times, step } = timeTicks(from, from + 36 * DAY, 6);
    expect(step).toBe(7 * DAY);
    const days = times.map((time) => new Date(time).getDate());
    // The 29th, then the 1st two days later: only the 29th stays.
    expect(days).toEqual([22, 29, 8, 15, 22]);
  });

  it('marks the 1st and the 15th over about three months', () => {
    const from = new Date(2026, 7, 5).getTime();
    const { times, step } = timeTicks(from, from + 90 * DAY, 6);
    expect(step).toBe(15 * DAY);
    expect(times.map((time) => new Date(time).toDateString())).toEqual(
      [
        new Date(2026, 7, 15),
        new Date(2026, 8, 1),
        new Date(2026, 8, 15),
        new Date(2026, 9, 1),
        new Date(2026, 9, 15),
        new Date(2026, 10, 1),
      ].map((date) => date.toDateString()),
    );
  });

  it('marks the start of each quarter over years', () => {
    const from = new Date(2025, 10, 20).getTime();
    const { times } = timeTicks(from, new Date(2027, 1, 1).getTime(), 6);
    expect(times.map((time) => [new Date(time).getFullYear(), new Date(time).getMonth()])).toEqual([
      [2026, 0],
      [2026, 3],
      [2026, 6],
      [2026, 9],
      [2027, 0],
    ]);
  });
});
