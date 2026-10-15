import { describe, expect, it } from 'vitest';
import {
  clampWindow,
  coversExtent,
  MIN_WINDOW_MS,
  scaleWindow,
  shiftWindow,
} from '../../src/shared/window';

const HOUR = 3_600_000;
const extent = { from: 0, to: 24 * HOUR };

describe('zoom windows', () => {
  it('zooms around a point that stays put', () => {
    expect(scaleWindow({ from: 0, to: 8 * HOUR }, 0.5, 2 * HOUR)).toEqual({
      from: HOUR,
      to: 5 * HOUR,
    });
  });

  it('keeps a window within the range, keeping its length', () => {
    expect(clampWindow(shiftWindow({ from: 20 * HOUR, to: 23 * HOUR }, 3 * HOUR), extent)).toEqual({
      from: 21 * HOUR,
      to: 24 * HOUR,
    });
    expect(clampWindow({ from: -HOUR, to: 30 * HOUR }, extent)).toEqual(extent);
  });

  it('does not zoom in past half an hour', () => {
    const window = clampWindow({ from: HOUR, to: HOUR + 1000 }, extent);
    expect(window.to - window.from).toBe(MIN_WINDOW_MS);
  });

  it('knows when the whole range shows', () => {
    expect(coversExtent(extent, extent)).toBe(true);
    expect(coversExtent({ from: HOUR, to: 24 * HOUR }, extent)).toBe(false);
  });
});
