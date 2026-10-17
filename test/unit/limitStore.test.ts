import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LimitStore, limitHit } from '../../src/extension/store/limitStore';
import { QuotaStore } from '../../src/extension/store/quotaStore';
import { RequestStore } from '../../src/extension/store/requestStore';
import { TimelineSource } from '../../src/extension/timelineSource';

const folder = mkdtempSync(join(tmpdir(), 'nightpace-limits-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('limitHit', () => {
  it('tells the 5-hour limit from the weekly ones and leaves out the rest', () => {
    const event = (limit: string) => ({ kind: 'limit' as const, sessionId: 's', time: 5, limit });
    expect(limitHit(event('five_hour'))).toEqual({ time: 5, limit: 'fiveHour' });
    expect(limitHit(event('seven_day'))).toEqual({ time: 5, limit: 'weekly' });
    expect(limitHit(event('seven_day_opus'))).toEqual({ time: 5, limit: 'weekly' });
    expect(limitHit(event('overage'))).toBeUndefined();
  });
});

describe('LimitStore', () => {
  it('keeps hits once each, oldest first, until cleared', async () => {
    const store = new LimitStore(join(folder, 'store'));
    expect(await store.hits()).toEqual([]);
    await store.append([{ time: 20, limit: 'weekly' }]);
    // Two windows may write the same hit.
    await store.append([
      { time: 10, limit: 'fiveHour' },
      { time: 20, limit: 'weekly' },
    ]);
    expect(await store.hits()).toEqual([
      { time: 10, limit: 'fiveHour' },
      { time: 20, limit: 'weekly' },
    ]);
    expect(await store.backfilled()).toBe(false);
    await store.markBackfilled();
    expect(await store.backfilled()).toBe(true);
    await store.clear();
    expect(await store.hits()).toEqual([]);
    expect(await store.backfilled()).toBe(false);
  });
});

describe('TimelineSource', () => {
  it('reads the transcripts once for the limits that ran out, then keeps new ones', async () => {
    const transcripts = join(folder, 'projects');
    mkdirSync(join(transcripts, 'p'), { recursive: true });
    const file = join(transcripts, 'p', 's.jsonl');
    const limitLine = (time: string, type: string) =>
      JSON.stringify({
        type: 'assistant',
        sessionId: 's',
        timestamp: time,
        error: 'rate_limit',
        isApiErrorMessage: true,
        apiErrorParams: { rate_limit_info: { rateLimitType: type, resetsAt: 1_800_000_000 } },
        message: { role: 'assistant', content: [] },
      }) + '\n';
    writeFileSync(file, limitLine('2026-03-02T09:00:00.000Z', 'five_hour'));
    const storage = join(folder, 'storage');
    const limits = new LimitStore(storage);
    const source = new TimelineSource(
      () => [transcripts],
      new QuotaStore(storage),
      new RequestStore(storage),
      limits,
    );
    await source.sync();
    await source.limitsFilled();
    expect(await limits.hits()).toEqual([
      { time: Date.parse('2026-03-02T09:00:00.000Z'), limit: 'fiveHour' },
    ]);
    // Read once: then the regular scan brings the new ones.
    appendFileSync(file, limitLine('2026-03-03T09:00:00.000Z', 'seven_day'));
    await source.sync();
    await source.limitsFilled();
    expect((await limits.hits()).map((hit) => hit.limit)).toEqual(['fiveHour', 'weekly']);
    const data = await source.timeline('30d', undefined, Date.parse('2026-03-04T00:00:00.000Z'));
    expect(data.limitHits).toHaveLength(2);
  });
});
