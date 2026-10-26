import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { QuotaRecorder, type RecorderDeps } from '../../src/extension/quota/recorder';
import {
  ACTIVE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  RETRY_INTERVALS_MS,
  shouldPoll,
} from '../../src/extension/quota/schedule';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import { QuotaStore } from '../../src/extension/store/quotaStore';

const MIN = 60_000;
const folder = mkdtempSync(join(tmpdir(), 'nightpace-recorder-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
let stores = 0;
const newStore = () => new QuotaStore(join(folder, String(++stores)));

const snapshot = (time: number, percent = 10): QuotaSnapshot => ({
  time,
  available: true,
  fiveHour: { percent, resetsAt: time + 60 * MIN },
  models: [],
});

describe('shouldPoll', () => {
  const now = 1000 * MIN;

  it('asks at once the first time', () => {
    expect(shouldPoll({ now })).toBe(true);
  });

  it('asks every five minutes while Claude Code is working', () => {
    const lastPoll = now - ACTIVE_INTERVAL_MS;
    expect(shouldPoll({ now, lastPoll, lastActivity: now - MIN })).toBe(true);
    expect(shouldPoll({ now: now - 1, lastPoll, lastActivity: now - MIN })).toBe(false);
  });

  it('asks once more after work stops, then hourly', () => {
    // Work stopped two minutes before the last poll: what it used may not have shown yet.
    const lastPoll = now - ACTIVE_INTERVAL_MS;
    expect(shouldPoll({ now, lastPoll, lastActivity: lastPoll - 2 * MIN })).toBe(true);
    expect(shouldPoll({ now, lastPoll, lastActivity: lastPoll - 10 * MIN })).toBe(false);
    expect(shouldPoll({ now, lastPoll: now - IDLE_INTERVAL_MS })).toBe(true);
  });

  it('waits longer after each failure in a row, up to a quarter of an hour', () => {
    const lastActivity = now;
    const after = (minutes: number, failures?: number) =>
      shouldPoll({ now, lastPoll: now - minutes * MIN, lastFailed: true, failures, lastActivity });
    expect([after(1, 1), after(2, 1)]).toEqual([false, true]);
    expect([after(4, 2), after(5, 2)]).toEqual([false, true]);
    expect([after(10, 3), after(15, 3), after(15, 7)]).toEqual([false, true, true]);
    // Recorded before failures were counted.
    expect([after(10), after(15)]).toEqual([false, true]);
  });
});

/** A recorder on a real store, with a clock and Claude Code under the test's control. */
function recorder(
  store: QuotaStore,
  options: {
    query?: () => Promise<QuotaSnapshot>;
    signedIn?: () => string | undefined;
    needsSignIn?: boolean;
  } = {},
) {
  let now = 1000 * MIN;
  const shown: QuotaSnapshot[] = [];
  const logs: string[] = [];
  let queries = 0;
  const deps: RecorderDeps = {
    query: async () => {
      queries++;
      return options.query ? options.query() : snapshot(now, queries * 10);
    },
    lastActivity: async () => now - MIN,
    ...(options.signedIn && { signedIn: async () => options.signedIn?.() }),
    needsSignIn: options.needsSignIn,
    lastPoll: () => store.lastPoll(),
    recordPoll: (record) => store.recordPoll(record),
    append: (s) => store.append(s),
    onSnapshot: (s) => shown.push(s),
    log: (message) => logs.push(message),
    now: () => now,
  };
  return {
    recorder: new QuotaRecorder(deps),
    shown,
    logs,
    queries: () => queries,
    advance: (ms: number) => (now += ms),
  };
}

describe('QuotaRecorder', () => {
  it('records a snapshot when one is due, and shows it', async () => {
    const store = newStore();
    const r = recorder(store);
    const first = await r.recorder.tick();
    expect(first).toMatchObject({ fiveHour: { percent: 10 } });
    expect(await r.recorder.tick()).toBeUndefined();
    r.advance(ACTIVE_INTERVAL_MS);
    await r.recorder.tick();
    expect(r.queries()).toBe(2);
    expect((await store.snapshots()).map((s) => s.fiveHour?.percent)).toEqual([10, 20]);
    expect(r.shown.map((s) => s.fiveHour?.percent)).toEqual([10, 20]);
  });

  it("doesn't ask when another window just did, and shows that window's snapshot", async () => {
    const store = newStore();
    const one = recorder(store);
    const two = recorder(store);
    await one.recorder.tick();
    await two.recorder.tick();
    expect(one.queries() + two.queries()).toBe(1);
    expect(two.shown).toEqual(one.shown);
  });

  it('logs a failure and waits before trying again', async () => {
    const store = newStore();
    const r = recorder(store, {
      query: () => Promise.reject(new Error('Claude Code is not installed')),
    });
    expect(await r.recorder.tick()).toBeUndefined();
    expect(r.logs).toEqual([expect.stringMatching(/not installed/)]);
    r.advance(MIN);
    await r.recorder.tick();
    expect(r.queries()).toBe(1);
    r.advance(RETRY_INTERVALS_MS[0] - MIN);
    await r.recorder.tick();
    expect(r.queries()).toBe(2);
    expect(await store.lastPoll()).toMatchObject({ failed: true, failures: 2 });
    // The second failure in a row waits longer.
    r.advance(RETRY_INTERVALS_MS[0]);
    await r.recorder.tick();
    expect(r.queries()).toBe(2);
    r.advance(RETRY_INTERVALS_MS[1] - RETRY_INTERVALS_MS[0]);
    await r.recorder.tick();
    expect(r.queries()).toBe(3);
    expect(await store.snapshots()).toEqual([]);
  });

  it('asks again within a minute when Claude Code is signed in to another account', async () => {
    const store = newStore();
    let account = 'personal';
    const r = recorder(store, { signedIn: () => account });
    await r.recorder.tick();
    r.advance(MIN);
    await r.recorder.tick();
    expect(r.queries()).toBe(1);
    account = 'work';
    await r.recorder.tick();
    expect(r.queries()).toBe(2);
    expect(await store.lastPoll()).toMatchObject({ signedIn: 'work' });
    // Once asked, the same account waits for the usual interval.
    r.advance(MIN);
    await r.recorder.tick();
    expect(r.queries()).toBe(2);
  });

  it('asks at once after an update, when the last poll did not note the account', async () => {
    const store = newStore();
    await store.recordPoll({ time: 1000 * MIN - MIN, snapshot: snapshot(1) });
    const r = recorder(store, { signedIn: () => 'personal' });
    await r.recorder.tick();
    expect(r.queries()).toBe(1);
  });

  it("leaves a folder alone while it isn't signed in to an account", async () => {
    const store = newStore();
    const config: { account?: string } = {};
    const r = recorder(store, { signedIn: () => config.account, needsSignIn: true });
    await r.recorder.tick();
    expect(r.queries()).toBe(0);
    expect(await store.lastPoll()).toBeUndefined();
    config.account = 'work';
    await r.recorder.tick();
    expect(r.queries()).toBe(1);
  });

  it('keeps showing the last snapshot through a failure', async () => {
    const store = newStore();
    let fail = false;
    const r = recorder(store, {
      query: async () => {
        if (fail) throw new Error('offline');
        return snapshot(5);
      },
    });
    await r.recorder.tick();
    fail = true;
    r.advance(ACTIVE_INTERVAL_MS);
    await r.recorder.tick();
    expect((await store.lastPoll())?.snapshot).toEqual(snapshot(5));
  });
});

describe('QuotaStore', () => {
  it('reads back what it recorded, skipping a line cut short', async () => {
    const store = newStore();
    await store.append(snapshot(1));
    await store.append(snapshot(2));
    writeFileSync(join(folder, String(stores), 'quota.jsonl'), '{"time":', { flag: 'a' });
    expect((await store.snapshots()).map((s) => s.time)).toEqual([1, 2]);
  });

  it('deletes everything it recorded', async () => {
    const store = newStore();
    await store.append(snapshot(1));
    await store.recordPoll({ time: 1 });
    await store.clear();
    expect(await store.snapshots()).toEqual([]);
    expect(await store.lastPoll()).toBeUndefined();
  });

  it('has nothing before the first snapshot', async () => {
    const store = newStore();
    expect(await store.snapshots()).toEqual([]);
    expect(await store.lastPoll()).toBeUndefined();
  });
});
