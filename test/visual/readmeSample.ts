// A made-up week of Claude Code use for the README's screenshots: busier weekdays, a quiet
// weekend, one to four sessions at a time, and quota readings that follow the tokens (the 5-hour
// window opens with the first request after the last one ran out; the weekly limit resets once).
import { buildTimeline, type TimelineRequest } from '../../src/extension/model/timeline';
import { requestCost } from '../../src/extension/model/pricing';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import type { RangeKey, TimelineData, TimeWindow } from '../../src/shared/protocol';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Thursday 15 October 2026, 17:40 UTC. */
export const README_NOW = Date.UTC(2026, 9, 15, 17, 40);
const WEEKLY_RESET = Date.UTC(2026, 9, 9, 9, 0);
const PROJECTS = ['/work/atlas', '/work/beacon-api', '/work/website', '/home/dev/notes'];
const EFFORTS = ['xhigh', 'xhigh', 'high', 'medium'] as const;

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** Work blocks of each day, from 8 days ago to today: [start hour (UTC), hours, sessions]. */
const DAYS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[13, 3, 2]],
  [
    [6.5, 2.5, 2],
    [10, 3, 4],
    [14.5, 2, 1],
  ],
  [
    [7, 3, 3],
    [11, 2.5, 2],
    [15, 3, 3],
  ],
  [[9, 2, 1]],
  [],
  [
    [7, 2.5, 2],
    [10.5, 3, 3],
    [15, 2.5, 2],
  ],
  [
    [6.5, 3, 3],
    [11, 3, 4],
    [15.5, 1.5, 1],
  ],
  [
    [7, 2.5, 2],
    [10.5, 2, 3],
    [13.5, 3, 2],
  ],
  [
    [6.5, 3, 3],
    [10.5, 3, 2],
    [14.5, 3, 3],
  ],
];

export function readmeRequests(): TimelineRequest[] {
  const next = random(11);
  const requests: TimelineRequest[] = [];
  const firstDay = Date.UTC(2026, 9, 15) - (DAYS.length - 1) * DAY;
  DAYS.forEach((blocks, dayIndex) => {
    blocks.forEach(([startHour, hours, sessions], blockIndex) => {
      for (let s = 0; s < sessions; s++) {
        const sessionId = `d${dayIndex}-b${blockIndex}-s${s}`;
        const effort = EFFORTS[(s + dayIndex + blockIndex) % EFFORTS.length];
        const project = PROJECTS[(s + blockIndex + dayIndex) % PROJECTS.length];
        let time = firstDay + dayIndex * DAY + startHour * HOUR + s * (5 + next() * 15) * MIN;
        const end = time + hours * HOUR - s * (10 + next() * 25) * MIN;
        // Higher effort thinks longer and writes more, so it costs more per request.
        const scale = effort === 'xhigh' ? 1.4 : effort === 'high' ? 1 : 0.7;
        while (time < end && time < README_NOW) {
          const roll = next();
          const model =
            roll < 0.78
              ? 'claude-opus-5-5'
              : roll < 0.94
                ? 'claude-fable-5-1'
                : 'claude-sonnet-5-5';
          // Subagents write the cache for 5 minutes, the main conversation for an hour.
          const sidechain = next() < 0.08;
          const cacheWrite = Math.round((800 + next() * 4000) * scale);
          const cacheRead = Math.round((40_000 + next() * 120_000) * scale);
          const output = Math.round((100 + next() * 900) * scale);
          requests.push({
            sessionId,
            time,
            end: time + 15_000,
            model,
            effort,
            project,
            sidechain,
            tokens: {
              input: 3,
              cacheWrite5m: sidechain ? cacheWrite : 0,
              cacheWrite1h: sidechain ? 0 : cacheWrite,
              cacheRead,
              output,
              thinking: Math.round(output * 0.4),
            },
          });
          time += (10 + next() * 45) * 1000;
        }
      }
    });
  });
  return requests;
}

/**
 * Quota readings every 5 minutes while sessions work and hourly otherwise, as Nightpace records
 * them, worked out from the requests so the lines rise with the columns.
 */
export function readmeSnapshots(requests: TimelineRequest[]): QuotaSnapshot[] {
  const sorted = [...requests].sort((a, b) => a.time - b.time);
  const weights = sorted.map((request) => requestCost(request)?.total ?? 0);

  // 5-hour windows: each opens with the first request after the previous one ended.
  const windows: { start: number; total: number }[] = [];
  sorted.forEach((request, i) => {
    const current = windows.at(-1);
    if (!current || request.time >= current.start + 5 * HOUR) {
      windows.push({ start: request.time, total: weights[i] });
    } else current.total += weights[i];
  });
  const fiveHourLimit = Math.max(...windows.map((window) => window.total)) / 0.96;
  const weekTotal = weights.reduce(
    (sum, weight, i) => (sorted[i].time >= WEEKLY_RESET ? sum + weight : sum),
    0,
  );
  const weeklyLimit = weekTotal / 0.62;
  const weeklyBeforeReset = 71;

  const snapshots: QuotaSnapshot[] = [];
  let index = 0;
  let fiveHourUsed = 0;
  let weekUsed = 0;
  let usedBeforeReset = 0;
  let windowIndex = -1;
  let time = README_NOW - 8 * DAY;
  while (time <= README_NOW - 2 * MIN) {
    while (index < sorted.length && sorted[index].time <= time) {
      const request = sorted[index];
      while (windowIndex + 1 < windows.length && windows[windowIndex + 1].start <= request.time) {
        windowIndex++;
        fiveHourUsed = 0;
      }
      fiveHourUsed += weights[index];
      if (request.time >= WEEKLY_RESET) weekUsed += weights[index];
      else usedBeforeReset += weights[index];
      index++;
    }
    const window = windows[windowIndex];
    const open = window !== undefined && time < window.start + 5 * HOUR;
    const weekly =
      time < WEEKLY_RESET
        ? weeklyBeforeReset + (usedBeforeReset / weeklyLimit) * 100
        : (weekUsed / weeklyLimit) * 100;
    snapshots.push({
      time,
      available: true,
      plan: 'max',
      fiveHour: open
        ? {
            percent: Math.round((fiveHourUsed / fiveHourLimit) * 100),
            resetsAt: window.start + 5 * HOUR,
          }
        : { percent: 0 },
      weekly: {
        percent: Math.round(weekly),
        resetsAt: time < WEEKLY_RESET ? WEEKLY_RESET : WEEKLY_RESET + 7 * DAY,
      },
      models: [],
    });
    const working = index > 0 && time - sorted[index - 1].time < 10 * MIN;
    const nextRequest = sorted[index]?.time ?? Infinity;
    time = working ? time + 5 * MIN : Math.min(time + HOUR, nextRequest + 5 * MIN);
  }
  return snapshots;
}

export function readmeTimeline(range: RangeKey, zoom?: TimeWindow): TimelineData {
  const requests = readmeRequests();
  return buildTimeline({
    range,
    now: README_NOW,
    zoom,
    requests,
    snapshots: readmeSnapshots(requests),
    // The README's screenshots are taken in UTC, whatever the machine's zone.
    utcOffset: 0,
    startOfToday: Math.floor(README_NOW / 86_400_000) * 86_400_000,
  });
}
