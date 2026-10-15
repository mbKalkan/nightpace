// A made-up but realistic stretch of Claude Code use, for the panel's browser tests: waves of up to
// three sessions, mostly Opus with some Fable and Sonnet, and the quota climbing through a reset.
import { buildTimeline, type TimelineRequest } from '../../src/extension/model/timeline';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import type { RangeKey, TimelineData } from '../../src/shared/protocol';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 15 October 2026, 17:40 UTC. */
export const SAMPLE_NOW = Date.UTC(2026, 9, 15, 17, 40);

/** A small deterministic generator, so every run draws the same picture. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export function sampleRequests(days = 8): TimelineRequest[] {
  const next = random(7);
  const requests: TimelineRequest[] = [];
  for (let day = days - 1; day >= 0; day--) {
    const dayStart = SAMPLE_NOW - day * 24 * HOUR - 10 * HOUR;
    // Three work blocks a day, each with a different number of sessions.
    for (const [startHour, hours, sessions] of [
      [0, 3, 2],
      [4, 2.5, 3],
      [7.5, 2, 1],
    ] as const) {
      for (let s = 0; s < sessions; s++) {
        const sessionId = `d${day}-b${startHour}-s${s}`;
        let time = dayStart + startHour * HOUR + s * 7 * MIN;
        const end = time + hours * HOUR - s * 20 * MIN;
        while (time < end) {
          const roll = next();
          const model =
            roll < 0.8 ? 'claude-opus-5-5' : roll < 0.93 ? 'claude-fable-5-1' : 'claude-sonnet-5-5';
          requests.push({
            sessionId,
            time,
            end: time + 15_000,
            model,
            sidechain: next() < 0.08,
            tokens: {
              input: 3,
              cacheWrite5m: 0,
              cacheWrite1h: Math.round(800 + next() * 4000),
              cacheRead: Math.round(40_000 + next() * 120_000),
              output: Math.round(100 + next() * 900),
              thinking: 0,
            },
          });
          time += (8 + next() * 40) * 1000;
        }
      }
    }
  }
  return requests.filter((request) => request.time < SAMPLE_NOW);
}

/** Quota readings every 5 minutes for the last 9 hours, with the 5-hour window resetting once. */
export function sampleSnapshots(): QuotaSnapshot[] {
  const snapshots: QuotaSnapshot[] = [];
  const firstReset = SAMPLE_NOW - 3 * HOUR;
  for (let time = SAMPLE_NOW - 9 * HOUR; time <= SAMPLE_NOW - 2 * MIN; time += 5 * MIN) {
    const beforeReset = time < firstReset;
    const windowStart = beforeReset ? firstReset - 5 * HOUR : firstReset;
    const fiveHour = Math.min(
      100,
      Math.max(0, Math.round(((time - windowStart) / (5 * HOUR)) * (beforeReset ? 92 : 70))),
    );
    snapshots.push({
      time,
      available: true,
      plan: 'max',
      fiveHour: { percent: fiveHour, resetsAt: beforeReset ? firstReset : firstReset + 5 * HOUR },
      weekly: {
        percent: Math.round(31 + ((time - (SAMPLE_NOW - 9 * HOUR)) / HOUR) * 1.6),
        resetsAt: SAMPLE_NOW + 50 * HOUR,
      },
      models: [],
    });
  }
  return snapshots;
}

export function sampleTimeline(range: RangeKey = '24h', withQuota = true): TimelineData {
  return buildTimeline({
    range,
    now: SAMPLE_NOW,
    requests: sampleRequests(),
    snapshots: withQuota ? sampleSnapshots() : [],
  });
}
