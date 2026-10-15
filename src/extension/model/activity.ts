// When each Claude Code session was working, and how many worked at once.

export interface Interval {
  start: number;
  end: number;
}

/** What activity needs of a request: whose it was and when it ran. */
export interface TimedRequest {
  sessionId: string;
  time: number;
  end: number;
}

/**
 * Within a turn, a session's requests follow each other seconds apart while Claude runs tools;
 * between turns it waits for its user. Measured on real transcripts, 98% of the gaps between a
 * session's requests are under five minutes, and the rest are idle time.
 */
export const IDLE_GAP_MS = 5 * 60_000;

/**
 * Each session's active intervals, sorted: from a request's start to its end, joined to the
 * next request when the gap between them is at most `idleGap`.
 */
export function sessionIntervals(
  requests: Iterable<TimedRequest>,
  idleGap = IDLE_GAP_MS,
): Map<string, Interval[]> {
  const bySession = new Map<string, Interval[]>();
  for (const { sessionId, time, end } of requests) {
    const list = bySession.get(sessionId) ?? [];
    list.push({ start: time, end: Math.max(time, end) });
    bySession.set(sessionId, list);
  }
  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => a.start - b.start);
    const merged: Interval[] = [];
    for (const interval of list) {
      const last = merged.at(-1);
      if (last && interval.start - last.end <= idleGap) {
        last.end = Math.max(last.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }
    bySession.set(sessionId, merged);
  }
  return bySession;
}

/** From `time` on, `count` sessions were active, until the next step. */
export interface Step {
  time: number;
  count: number;
}

/** How many sessions were active over time, as the steps where the count changes. */
export function concurrency(intervals: Iterable<Interval[]>): Step[] {
  const edges: Array<[time: number, change: number]> = [];
  for (const list of intervals) {
    for (const { start, end } of list) {
      if (end > start) edges.push([start, 1], [end, -1]);
    }
  }
  // At the same moment, ends come before starts, so back-to-back sessions don't overlap.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const steps: Step[] = [];
  let count = 0;
  for (const [time, change] of edges) {
    count += change;
    const last = steps.at(-1);
    if (last?.time === time) last.count = count;
    else if (last?.count !== count) steps.push({ time, count });
  }
  // Changes that cancelled out at one moment leave a step equal to the one before it.
  return steps.filter((step, i) => i === 0 || step.count !== steps[i - 1].count);
}

/** The time spent at each session count within [from, to), in milliseconds. */
export function timeAtCount(steps: readonly Step[], from: number, to: number): Map<number, number> {
  const totals = new Map<number, number>();
  let count = 0;
  let at = from;
  for (const step of steps) {
    if (step.time >= to) break;
    if (step.time > at) {
      totals.set(count, (totals.get(count) ?? 0) + step.time - at);
      at = step.time;
    }
    count = step.count;
  }
  if (to > at) totals.set(count, (totals.get(count) ?? 0) + to - at);
  return totals;
}
