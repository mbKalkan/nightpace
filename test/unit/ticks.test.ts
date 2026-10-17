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
});
