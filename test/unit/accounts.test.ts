import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Accounts } from '../../src/extension/model/accounts';
import {
  accountKey,
  parseConfigAccount,
  parseInitializeAccount,
  type AccountId,
} from '../../src/extension/quota/account';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import {
  claudeSources,
  expandHome,
  normalizeDir,
  signedInAccount,
  sourceEnv,
} from '../../src/extension/quota/sources';
import { QuotaStore } from '../../src/extension/store/quotaStore';
import { decodeRequest, encodeRequest, RequestStore } from '../../src/extension/store/requestStore';
import { TimelineSource } from '../../src/extension/timelineSource';
import type { RequestUsage } from '../../src/extension/transcripts/usageLog';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 15, 12);

const folder = mkdtempSync(join(tmpdir(), 'nightpace-accounts-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
let made = 0;
const fresh = () => join(folder, String(++made));

const PERSONAL: AccountId = { email: 'me@example.com', organization: 'Personal' };
const WORK: AccountId = { email: 'me@work.example', organization: 'Acme' };
// Each account's week resets at its own time of the week.
const PERSONAL_RESET = Date.UTC(2026, 9, 21, 16);
const WORK_RESET = Date.UTC(2026, 9, 19, 9);

const reading = (
  time: number,
  account?: AccountId,
  extra: Partial<QuotaSnapshot> = {},
): QuotaSnapshot => ({
  time,
  available: true,
  plan: 'max',
  ...(account && { account }),
  fiveHour: { percent: 10, resetsAt: time + 3 * HOUR },
  weekly: {
    percent: 20,
    resetsAt: account?.email === WORK.email ? WORK_RESET : PERSONAL_RESET,
  },
  models: [],
  ...extra,
});

const request = (requestId: string, time: number, configDir?: string): RequestUsage => ({
  requestId,
  sessionId: `s-${requestId}`,
  time,
  end: time + 10_000,
  model: 'claude-opus-5-5',
  effort: 'high',
  sidechain: false,
  final: true,
  ...(configDir !== undefined && { configDir }),
  tokens: { input: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 100, thinking: 0 },
});

describe('account ids', () => {
  it('come from the initialize reply and the config file alike', () => {
    expect(
      parseInitializeAccount({
        account: { email: 'me@example.com', organization: 'Personal', subscriptionType: 'Max' },
      }),
    ).toEqual(PERSONAL);
    expect(
      parseConfigAccount({
        oauthAccount: { emailAddress: 'me@example.com', organizationName: 'Personal' },
        projects: {},
      }),
    ).toEqual(PERSONAL);
  });

  it('are missing when no one is signed in, or with an API key', () => {
    expect(parseInitializeAccount({ account: { apiProvider: 'bedrock' } })).toBeUndefined();
    expect(parseInitializeAccount({ commands: [] })).toBeUndefined();
    expect(parseConfigAccount({ projects: {} })).toBeUndefined();
    expect(parseConfigAccount('not json')).toBeUndefined();
  });

  it('match whatever the case of the email, and tell organizations apart', () => {
    expect(accountKey({ email: 'Me@Example.com', organization: 'Personal' })).toBe(
      accountKey(PERSONAL),
    );
    expect(accountKey({ email: 'me@example.com', organization: 'Acme' })).not.toBe(
      accountKey(PERSONAL),
    );
  });
});

describe('Accounts', () => {
  const personal = accountKey(PERSONAL);
  const work = accountKey(WORK);

  it('knows none before a reading names one', () => {
    const accounts = new Accounts([reading(NOW - DAY), reading(NOW)]);
    expect(accounts.list).toEqual([]);
    expect(accounts.legacy).toBeUndefined();
    expect(accounts.at(undefined, NOW)).toBeUndefined();
  });

  it('gives readings from before accounts were told apart to the account that went on', () => {
    const old = reading(NOW - 3 * DAY);
    const accounts = new Accounts([
      old,
      reading(NOW - 2 * DAY),
      // After the update, the other account happened to answer first.
      reading(NOW - DAY, WORK, { configDir: '/work' }),
      reading(NOW - DAY + MIN, PERSONAL),
    ]);
    expect(accounts.legacy).toBe(personal);
    expect(accounts.ofSnapshot(old)).toBe(personal);
    expect(accounts.list.map((account) => [account.key, account.first])).toEqual([
      [personal, NOW - 3 * DAY],
      [work, NOW - DAY],
    ]);
  });

  it('gives them to the first account seen when none goes on from them', () => {
    const accounts = new Accounts([
      reading(NOW - 2 * DAY, undefined, { weekly: { percent: 1, resetsAt: NOW + 5 * HOUR } }),
      reading(NOW - DAY, WORK),
      reading(NOW, PERSONAL),
    ]);
    expect(accounts.legacy).toBe(work);
  });

  it('follows a switch of account in the same folder', () => {
    const accounts = new Accounts([
      reading(NOW - 10 * HOUR, PERSONAL),
      reading(NOW - 5 * HOUR, PERSONAL),
      reading(NOW - 4 * HOUR, WORK),
      reading(NOW - HOUR, WORK),
      reading(NOW, PERSONAL),
    ]);
    expect(accounts.at(undefined, NOW - 12 * HOUR)).toBe(personal);
    expect(accounts.at(undefined, NOW - 4.5 * HOUR)).toBe(personal);
    expect(accounts.at(undefined, NOW - 4 * HOUR)).toBe(work);
    expect(accounts.at(undefined, NOW - 30 * MIN)).toBe(work);
    expect(accounts.at(undefined, NOW + HOUR)).toBe(personal);
  });

  it('knows when each account was signed in here, as its requests are', () => {
    const accounts = new Accounts([
      reading(NOW - 10 * HOUR, PERSONAL),
      reading(NOW - 5 * HOUR, PERSONAL),
      reading(NOW - 4 * HOUR, WORK),
      reading(NOW - HOUR, WORK),
      reading(NOW, PERSONAL),
    ]);
    const mine = accounts.signedIn(personal);
    // From before its first reading, whose account its requests then are.
    expect(mine(NOW - 20 * HOUR, NOW - 5 * HOUR)).toBe(true);
    // Not across the work account's turn, and again from its first reading back.
    expect(mine(NOW - 5 * HOUR, NOW)).toBe(false);
    expect(mine(NOW, NOW + DAY)).toBe(true);
    const theirs = accounts.signedIn(work);
    expect(theirs(NOW - 4 * HOUR, NOW - HOUR)).toBe(true);
    expect(theirs(NOW - 5 * HOUR, NOW - HOUR)).toBe(false);
    expect(theirs(NOW - HOUR, NOW + HOUR)).toBe(false);
  });

  it('keeps an account signed in while another folder of its own goes on', () => {
    const accounts = new Accounts([
      reading(NOW - 10 * HOUR, PERSONAL),
      reading(NOW - 8 * HOUR, PERSONAL, { configDir: '/other' }),
      reading(NOW - 5 * HOUR, WORK),
      reading(NOW - 2 * HOUR, PERSONAL, { configDir: '/other' }),
      reading(NOW, PERSONAL),
    ]);
    expect(accounts.signedIn(personal)(NOW - 10 * HOUR, NOW)).toBe(true);
    expect(accounts.signedIn(work)(NOW - 6 * HOUR, NOW - 4 * HOUR)).toBe(false);
  });

  it("keeps each folder's requests with its own account", () => {
    const accounts = new Accounts([
      reading(NOW - 10 * DAY),
      reading(NOW - DAY, PERSONAL),
      reading(NOW - HOUR, WORK, { configDir: '/work' }),
    ]);
    expect(accounts.at(undefined, NOW - 20 * DAY)).toBe(personal);
    expect(accounts.at(undefined, NOW)).toBe(personal);
    // Before the folder's first reading: its transcripts from before Nightpace followed it.
    expect(accounts.at('/work', NOW - 20 * DAY)).toBe(work);
    expect(accounts.at('/work', NOW)).toBe(work);
    // A folder that never answered is no account's: charging it to one would be a guess.
    expect(accounts.at('/elsewhere', NOW)).toBeUndefined();
  });

  it("gives a reading without an account among named ones to its folder's account then", () => {
    const old = reading(NOW - 10 * DAY);
    // Claude Code didn't name the account, or another window still runs an older Nightpace.
    const unnamed = reading(NOW - 2 * HOUR);
    const unnamedWork = reading(NOW - HOUR, undefined, { configDir: '/work' });
    const accounts = new Accounts([
      old,
      reading(NOW - 5 * HOUR, PERSONAL),
      reading(NOW - 4 * HOUR, WORK),
      unnamed,
      unnamedWork,
      reading(NOW, PERSONAL),
    ]);
    expect(accounts.ofSnapshot(old)).toBe(personal);
    expect(accounts.ofSnapshot(unnamed)).toBe(work);
    expect(accounts.at(undefined, NOW - 90 * MIN)).toBe(work);
    // A folder with no named reading yet isn't the older readings' account.
    expect(accounts.ofSnapshot(unnamedWork)).toBeUndefined();
    expect(accounts.at('/work', NOW)).toBeUndefined();
  });

  it('shows the account asked for, else the one signed in, else the one read last', () => {
    const accounts = new Accounts([reading(NOW - HOUR, PERSONAL), reading(NOW, WORK)]);
    expect(accounts.pick(personal, work)).toBe(personal);
    expect(accounts.pick('["gone@example.com",""]', personal)).toBe(personal);
    expect(accounts.pick(undefined, undefined)).toBe(work);
    expect(accounts.options(work)).toEqual([
      {
        key: personal,
        email: PERSONAL.email,
        organization: 'Personal',
        plan: 'max',
        current: false,
      },
      { key: work, email: WORK.email, organization: 'Acme', plan: 'max', current: true },
    ]);
  });
});

describe('config folders', () => {
  const home = join(folder, 'home');

  it('follow the current folder first, then the default one, then the others, once each', () => {
    const work = join(home, '.claude-work');
    const sources = claudeSources({
      home,
      current: work,
      others: [work.toUpperCase(), join(home, '.claude'), join(home, '.claude-old')],
      platform: 'win32',
    });
    expect(sources.map((source) => [source.configDir, source.current])).toEqual([
      [normalizeDir(work, 'win32'), true],
      [undefined, false],
      [normalizeDir(join(home, '.claude-old'), 'win32'), false],
    ]);
    expect(sources[1]).toMatchObject({
      projects: join(home, '.claude', 'projects'),
      configFile: join(home, '.claude.json'),
    });
    expect(sources[2].configFile).toBe(join(home, '.claude-old', '.claude.json'));
  });

  it('open a folder and start Claude Code with it as written, whatever the case', () => {
    // Claude Code may key its sign-in by the exact text; 0.5.0 kept transcript offsets by it.
    const written = join(home, 'Claude-Work');
    const [current] = claudeSources({ home, current: written, platform: 'win32' });
    expect(current).toMatchObject({
      dir: written,
      configDir: normalizeDir(written, 'win32'),
      projects: join(written, 'projects'),
      configFile: join(written, '.claude.json'),
    });
    expect(sourceEnv(current, {}).CLAUDE_CONFIG_DIR).toBe(written);
  });

  it('follow only the default folder when Claude Code uses it', () => {
    expect(claudeSources({ home })).toEqual([
      {
        projects: join(home, '.claude', 'projects'),
        configFile: join(home, '.claude.json'),
        current: true,
      },
    ]);
  });

  it("start Claude Code with the folder's own CLAUDE_CONFIG_DIR", () => {
    const [current, fallback] = claudeSources({ home, current: join(home, '.claude-work') });
    const base = { PATH: 'bin', CLAUDE_CONFIG_DIR: 'old' };
    const extra = { HTTPS_PROXY: 'proxy' };
    expect(sourceEnv(current, base, extra)).toEqual({
      PATH: 'bin',
      HTTPS_PROXY: 'proxy',
      CLAUDE_CONFIG_DIR: join(home, '.claude-work'),
    });
    expect(sourceEnv(fallback, base, extra)).toEqual({ PATH: 'bin' });
  });

  it('expand a home folder written with ~', () => {
    expect(expandHome('~/.claude-work', home)).toBe(join(home, '.claude-work'));
    expect(expandHome('/abs/.claude', home)).toBe('/abs/.claude');
  });

  it('name the account signed in, read again only when the config file changes', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, '.claude.json');
    const signedIn = signedInAccount(file);
    expect(await signedIn()).toBeUndefined();

    const write = (account: AccountId | undefined, mtime: number) => {
      writeFileSync(
        file,
        JSON.stringify({
          ...(account && {
            oauthAccount: { emailAddress: account.email, organizationName: account.organization },
          }),
        }),
      );
      utimesSync(file, mtime / 1000, mtime / 1000);
    };
    write(PERSONAL, NOW);
    expect(await signedIn()).toBe(accountKey(PERSONAL));
    write(WORK, NOW + MIN);
    expect(await signedIn()).toBe(accountKey(WORK));
    write(undefined, NOW + 2 * MIN);
    expect(await signedIn()).toBeUndefined();
    // Caught mid-write: the last answer stands.
    write(PERSONAL, NOW + 3 * MIN);
    await signedIn();
    writeFileSync(file, '{"oauthAccount": {"emailAd');
    utimesSync(file, (NOW + 4 * MIN) / 1000, (NOW + 4 * MIN) / 1000);
    expect(await signedIn()).toBe(accountKey(PERSONAL));
  });
});

describe('records from before accounts were told apart', () => {
  it('read as they were, and records of another folder keep it', () => {
    const legacy = request('req_old', NOW);
    const line = encodeRequest(legacy);
    expect(JSON.parse(line)).toHaveLength(14);
    expect(decodeRequest(line)).toEqual(legacy);

    const other = request('req_work', NOW, '/work');
    const otherLine = encodeRequest(other);
    expect(JSON.parse(otherLine)).toHaveLength(16);
    expect(decodeRequest(otherLine)).toEqual(other);
    const searched = { ...other, tokens: { ...other.tokens, webSearches: 2 } };
    expect(decodeRequest(encodeRequest(searched))).toEqual(searched);
  });
});

describe('QuotaStore with several config folders', () => {
  it('keeps a poll record per folder, the default one where it always was', async () => {
    const storage = fresh();
    const store = new QuotaStore(storage);
    await store.recordPoll({ time: 1, signedIn: 'a' });
    await store.recordPoll({ time: 2, signedIn: 'b' }, '/work');
    expect(await store.lastPoll()).toEqual({ time: 1, signedIn: 'a' });
    expect(await store.lastPoll('/work')).toEqual({ time: 2, signedIn: 'b' });
    expect(await store.lastPoll('/other')).toBeUndefined();
  });

  it('reads a reading whose account it cannot read, without the account', async () => {
    const storage = fresh();
    const store = new QuotaStore(storage);
    await store.append(reading(NOW, PERSONAL));
    mkdirSync(storage, { recursive: true });
    writeFileSync(
      join(storage, 'quota.jsonl'),
      JSON.stringify({ ...reading(NOW + MIN), account: {} }) + '\n',
      { flag: 'a' },
    );
    const snapshots = await store.snapshots();
    expect(snapshots.map((snapshot) => snapshot.account)).toEqual([PERSONAL, undefined]);
    expect(new Accounts(snapshots).list).toHaveLength(1);
  });

  it('remembers the folders Claude Code used, and forgets everything when cleared', async () => {
    const storage = fresh();
    const store = new QuotaStore(storage);
    await store.rememberConfigDir('/work');
    await store.rememberConfigDir('/work');
    await store.rememberConfigDir('/other');
    expect(await store.configDirs()).toEqual(['/work', '/other']);
    await store.recordPoll({ time: 2 }, '/work');
    await store.clear();
    expect(await store.configDirs()).toEqual([]);
    expect(await store.lastPoll('/work')).toBeUndefined();
  });
});

describe('TimelineSource with several accounts', () => {
  const requestsOf = async (source: TimelineSource, asked?: string, current?: string) => {
    const data = await source.timeline('7d', undefined, NOW, 0, { asked, current });
    return {
      data,
      requests: data.buckets.reduce((sum, bucket) => sum + bucket.requests, 0),
      readings: data.quota.length,
    };
  };

  async function seed(storage: string): Promise<TimelineSource> {
    const quota = new QuotaStore(storage);
    // Recorded before the update: no account named.
    for (const time of [NOW - 3 * DAY, NOW - 2 * DAY]) await quota.append(reading(time));
    await quota.append(reading(NOW - DAY, PERSONAL));
    await quota.append(reading(NOW - 2 * HOUR, WORK, { configDir: '/work' }));
    const requests = new RequestStore(storage);
    await requests.append([
      request('req_1', NOW - 3 * DAY + HOUR),
      request('req_2', NOW - 2 * DAY + HOUR),
      request('req_3', NOW - 3 * HOUR),
      request('req_4', NOW - 3 * HOUR, '/work'),
      request('req_5', NOW - HOUR, '/work'),
    ]);
    return new TimelineSource(() => [], quota, requests);
  }

  it('shows the account signed in, with the readings and requests from before the update', async () => {
    const source = await seed(fresh());
    const { data, requests, readings } = await requestsOf(source, undefined, accountKey(PERSONAL));
    expect(data.account).toBe(accountKey(PERSONAL));
    expect(data.accounts?.map((account) => [account.email, account.current])).toEqual([
      [PERSONAL.email, true],
      [WORK.email, false],
    ]);
    expect(requests).toBe(3);
    expect(readings).toBe(3);
    expect(data.recordingSince).toBe(NOW - 3 * DAY);
  });

  it("shows another account's own usage when asked", async () => {
    const source = await seed(fresh());
    const { data, requests, readings } = await requestsOf(
      source,
      accountKey(WORK),
      accountKey(PERSONAL),
    );
    expect(data.account).toBe(accountKey(WORK));
    expect(requests).toBe(2);
    expect(readings).toBe(1);
  });

  it("measures an account's pace without what it used while another had the folder", async () => {
    // A 5-hour window that opened 4 hours ago: 2% a request here, then the work account has the
    // folder for an hour while the personal one uses 34% elsewhere.
    const storage = fresh();
    const quota = new QuotaStore(storage);
    const personalReading = (ago: number, fiveHour: number, weekly: number) =>
      reading(NOW - ago, PERSONAL, {
        fiveHour: { percent: fiveHour, resetsAt: NOW + HOUR },
        weekly: { percent: weekly, resetsAt: PERSONAL_RESET },
      });
    await quota.append(personalReading(200 * MIN, 6, 3));
    await quota.append(reading(NOW - 3 * HOUR, WORK));
    await quota.append(personalReading(2 * HOUR, 40, 37));
    await quota.append(personalReading(30 * MIN, 52, 43));
    const requests = new RequestStore(storage);
    const at = (ago: number[]) =>
      ago.map((minutes) => request(`req_${minutes}`, NOW - minutes * MIN));
    await requests.append([...at([360, 230, 220, 210]), ...at([110, 100, 90, 80, 70, 60])]);
    const source = new TimelineSource(() => [], quota, requests);
    const data = await source.timeline('24h', undefined, NOW, 0, { current: accountKey(PERSONAL) });
    expect(data.pace?.history.fiveHour.map(({ from, to }) => [from, to])).toEqual([
      [NOW - 2 * HOUR, NOW - 30 * MIN],
    ]);
  });

  it('shows everything, with no accounts to choose from, while there is one', async () => {
    const storage = fresh();
    const quota = new QuotaStore(storage);
    await quota.append(reading(NOW - 2 * DAY));
    await quota.append(reading(NOW - DAY, PERSONAL));
    const requests = new RequestStore(storage);
    await requests.append([request('req_1', NOW - 2 * DAY), request('req_2', NOW - HOUR, '/x')]);
    const {
      data,
      requests: count,
      readings,
    } = await requestsOf(new TimelineSource(() => [], quota, requests));
    expect(data.accounts).toBeUndefined();
    expect(data.account).toBeUndefined();
    expect(count).toBe(2);
    expect(readings).toBe(2);
  });
});
