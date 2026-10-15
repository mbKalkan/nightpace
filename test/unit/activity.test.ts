import { describe, expect, it } from 'vitest';
import {
  concurrency,
  IDLE_GAP_MS,
  sessionIntervals,
  timeAtCount,
} from '../../src/extension/model/activity';

const MIN = 60_000;
const request = (sessionId: string, minute: number, minutes = 0.5) => ({
  sessionId,
  time: minute * MIN,
  end: (minute + minutes) * MIN,
});

describe('sessionIntervals', () => {
  it('joins requests less than the idle gap apart into one interval', () => {
    const intervals = sessionIntervals([
      request('a', 0),
      request('a', 2),
      request('a', 6),
      // Twelve minutes after the last one ended: idle in between.
      request('a', 18.5),
    ]);
    expect(intervals.get('a')).toEqual([
      { start: 0, end: 6.5 * MIN },
      { start: 18.5 * MIN, end: 19 * MIN },
    ]);
  });

  it('measures the gap from the end of a request, in any order', () => {
    const intervals = sessionIntervals([request('a', 10, 1), request('a', 0, 5)]);
    expect(intervals.get('a')).toEqual([{ start: 0, end: 11 * MIN }]);
  });

  it('keeps sessions apart', () => {
    const intervals = sessionIntervals([request('a', 0), request('b', 1)]);
    expect([...intervals.keys()]).toEqual(['a', 'b']);
  });

  it('uses a five-minute idle gap unless told otherwise', () => {
    expect(IDLE_GAP_MS).toBe(5 * MIN);
    expect(sessionIntervals([request('a', 0), request('a', 2)], MIN).get('a')).toHaveLength(2);
  });
});

describe('concurrency', () => {
  it('counts the sessions active at each moment', () => {
    const steps = concurrency([
      [{ start: 0, end: 10 }],
      [{ start: 5, end: 15 }],
      [
        { start: 6, end: 8 },
        { start: 20, end: 30 },
      ],
    ]);
    expect(steps).toEqual([
      { time: 0, count: 1 },
      { time: 5, count: 2 },
      { time: 6, count: 3 },
      { time: 8, count: 2 },
      { time: 10, count: 1 },
      { time: 15, count: 0 },
      { time: 20, count: 1 },
      { time: 30, count: 0 },
    ]);
  });

  it('does not count a session that starts as another ends as overlapping', () => {
    const steps = concurrency([[{ start: 0, end: 10 }], [{ start: 10, end: 20 }]]);
    expect(steps).toEqual([
      { time: 0, count: 1 },
      { time: 20, count: 0 },
    ]);
  });

  it('ignores empty intervals', () => {
    expect(concurrency([[{ start: 5, end: 5 }]])).toEqual([]);
  });
});

describe('timeAtCount', () => {
  const steps = [
    { time: 10, count: 1 },
    { time: 20, count: 2 },
    { time: 25, count: 0 },
  ];

  it('adds up the time spent at each count within a range', () => {
    expect(Object.fromEntries(timeAtCount(steps, 0, 40))).toEqual({ 0: 25, 1: 10, 2: 5 });
  });

  it('cuts the steps at the edges of the range', () => {
    expect(Object.fromEntries(timeAtCount(steps, 15, 22))).toEqual({ 1: 5, 2: 2 });
  });
});
