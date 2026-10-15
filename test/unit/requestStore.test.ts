import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { QuotaStore } from '../../src/extension/store/quotaStore';
import {
  decodeRequest,
  encodeRequest,
  monthOf,
  RequestStore,
} from '../../src/extension/store/requestStore';
import { TimelineSource } from '../../src/extension/timelineSource';
import type { RequestUsage } from '../../src/extension/transcripts/usageLog';

// Synthetic transcripts from scripts/gen-fixtures.mjs, all from 12 October 2026.
const FIXTURES = 'test/fixtures/claude/projects';
const NOW = Date.UTC(2026, 9, 15, 12);

const folder = mkdtempSync(join(tmpdir(), 'nightpace-requests-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

let made = 0;
const fresh = () => join(folder, String(++made));

const request = (overrides: Partial<RequestUsage> = {}): RequestUsage => ({
  requestId: 'req_1',
  sessionId: 's1',
  time: Date.UTC(2026, 9, 12, 9),
  end: Date.UTC(2026, 9, 12, 9, 0, 12),
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  sidechain: false,
  final: true,
  project: '/work/alpha',
  tokens: {
    input: 3,
    cacheWrite5m: 0,
    cacheWrite1h: 300,
    cacheRead: 6000,
    output: 400,
    thinking: 120,
  },
  ...overrides,
});

async function readAll(store: RequestStore, since = 0): Promise<RequestUsage[]> {
  const requests: RequestUsage[] = [];
  await store.readNew(since, (r) => requests.push(r));
  return requests;
}

describe('request records', () => {
  it('keep every field a request has', () => {
    for (const original of [
      request(),
      request({ effort: undefined, project: undefined, sidechain: true, final: false }),
      request({
        fast: true,
        usOnly: true,
        tokens: { ...request().tokens, webSearches: 2 },
      }),
    ]) {
      expect(decodeRequest(encodeRequest(original))).toEqual(original);
    }
  });

  it('skip lines that cannot be read', () => {
    expect(decodeRequest('["req_1","s1",17')).toBeUndefined();
    expect(decodeRequest('{"requestId":"req_1"}')).toBeUndefined();
  });

  it('are filed by the UTC month their request started in', () => {
    expect(monthOf(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10');
    expect(monthOf(Date.UTC(2026, 10, 1))).toBe('2026-11');
  });
});

describe('RequestStore', () => {
  it('reads what was appended since it last read, by any window', async () => {
    const path = fresh();
    const mine = new RequestStore(path);
    const other = new RequestStore(path);
    await mine.append([request(), request({ requestId: 'req_2', time: Date.UTC(2026, 8, 30) })]);
    expect((await readAll(other)).map((r) => r.requestId)).toEqual(['req_2', 'req_1']);

    await mine.append([request({ requestId: 'req_3' })]);
    expect((await readAll(other)).map((r) => r.requestId)).toEqual(['req_3']);
    expect(await readAll(other)).toEqual([]);
  });

  it('leaves out months before the ones asked for', async () => {
    const store = new RequestStore(fresh());
    await store.append([request(), request({ requestId: 'req_old', time: Date.UTC(2026, 6, 2) })]);
    expect((await readAll(store, Date.UTC(2026, 8, 14))).map((r) => r.requestId)).toEqual([
      'req_1',
    ]);
  });

  it('skips a line cut short and reads it once it is complete', async () => {
    const path = fresh();
    const store = new RequestStore(path);
    await store.append([request()]);
    const file = join(path, 'requests', '2026-10.jsonl');
    const line = encodeRequest(request({ requestId: 'req_2' }));
    appendFileSync(file, line.slice(0, 20));
    expect(await readAll(store)).toHaveLength(1);
    appendFileSync(file, line.slice(20) + '\n');
    expect((await readAll(store)).map((r) => r.requestId)).toEqual(['req_2']);
  });

  it('keeps the furthest offset any window reached', async () => {
    const path = fresh();
    const one = new RequestStore(path);
    const two = new RequestStore(path);
    await one.saveOffsets(
      new Map([
        ['a.jsonl', 500],
        ['b.jsonl', 10],
      ]),
    );
    await two.saveOffsets(
      new Map([
        ['a.jsonl', 200],
        ['c.jsonl', 7],
      ]),
    );
    expect(await one.offsets()).toEqual(
      new Map([
        ['a.jsonl', 500],
        ['b.jsonl', 10],
        ['c.jsonl', 7],
      ]),
    );
  });

  it('drops records of another layout so they are read again', async () => {
    const path = fresh();
    const store = new RequestStore(path);
    await store.append([request()]);
    await store.saveOffsets(new Map([['a.jsonl', 500]]));
    writeFileSync(join(path, 'requests', 'scan.json'), '{"version":0,"offsets":{"a.jsonl":500}}');
    const later = new RequestStore(path);
    expect(await later.offsets()).toEqual(new Map());
    expect(await readAll(later)).toEqual([]);
  });

  it('deletes everything it kept', async () => {
    const store = new RequestStore(fresh());
    await store.append([request()]);
    await store.saveOffsets(new Map([['a.jsonl', 5]]));
    await store.clear();
    expect(await readAll(store)).toEqual([]);
    expect(await store.offsets()).toEqual(new Map());
  });
});

describe('TimelineSource with a request store', () => {
  const total = (source: TimelineSource) =>
    source
      .timeline('7d', undefined, NOW)
      .then((data) => data.buckets.reduce((sum, bucket) => sum + bucket.requests, 0));

  it('keeps requests after Claude Code deletes their transcripts', async () => {
    const storage = fresh();
    const transcripts = join(storage, 'transcripts');
    cpSync(FIXTURES, transcripts, { recursive: true });
    const source = () =>
      new TimelineSource(() => [transcripts], new QuotaStore(storage), new RequestStore(storage));

    expect(await total(source())).toBe(4);
    rmSync(transcripts, { recursive: true });
    expect(await total(source())).toBe(4);
  });

  it('does not read a transcript again that another window already read', async () => {
    const storage = fresh();
    const transcripts = join(storage, 'transcripts');
    cpSync(FIXTURES, transcripts, { recursive: true });
    const one = new TimelineSource(
      () => [transcripts],
      new QuotaStore(storage),
      new RequestStore(storage),
    );
    expect(await total(one)).toBe(4);
    const lines = () =>
      readFileSync(join(storage, 'requests', '2026-10.jsonl'), 'utf8').split('\n');
    const written = lines().length;

    const two = new TimelineSource(
      () => [transcripts],
      new QuotaStore(storage),
      new RequestStore(storage),
    );
    expect(await total(two)).toBe(4);
    expect(lines().length).toBe(written);
  });

  it('starts over from the transcripts after a reset', async () => {
    const storage = fresh();
    const transcripts = join(storage, 'transcripts');
    cpSync(FIXTURES, transcripts, { recursive: true });
    const source = new TimelineSource(
      () => [transcripts],
      new QuotaStore(storage),
      new RequestStore(storage),
    );
    expect(await total(source)).toBe(4);
    await source.reset();
    expect(await total(source)).toBe(4);
  });
});
