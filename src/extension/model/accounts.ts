// Which Claude account each quota reading and each request belongs to, worked out every time
// from the readings themselves: nothing recorded before accounts were told apart is rewritten.

import type { AccountOption } from '../../shared/protocol';
import { accountKey } from '../quota/account';
import type { QuotaSnapshot } from '../quota/snapshot';

const WEEK = 7 * 24 * 3_600_000;
/** Claude Code reports the same weekly reset a little differently from one reading to the next. */
const RESET_SLACK = 10 * 60_000;
/** Readings from before accounts were told apart count as readings of the default folder. */
const DEFAULT_DIR = '';

export interface AccountSummary {
  key: string;
  email: string;
  organization?: string;
  plan?: string;
  /** Its first and last readings. */
  first: number;
  last: number;
}

interface FolderLine {
  times: number[];
  keys: string[];
}

/**
 * The accounts in the readings, and who signed in where and when.
 *
 * - A reading names its account.
 * - Readings from before that belong to the first account seen afterwards whose weekly reset falls
 *   at the same time of the week (the same quota going on), or else to the first account seen.
 * - A reading without one among named ones (Claude Code didn't say, or a window still runs an
 *   older Nightpace) belongs to its folder's account of the moment.
 * - A request belongs to the account its config folder was signed in to then: the one of the
 *   folder's latest reading up to that time, or of its first reading for a request before any.
 *   A folder that never answered has no account: its requests aren't anyone's.
 */
export class Accounts {
  readonly list: AccountSummary[];
  /** The account the readings from before accounts were told apart belong to. */
  readonly legacy: string | undefined;
  private readonly folders = new Map<string, FolderLine>();
  private readonly owners = new Map<QuotaSnapshot, string>();

  constructor(snapshots: readonly QuotaSnapshot[]) {
    const sorted = [...snapshots].sort((a, b) => a.time - b.time);
    const tagged = sorted.filter((snapshot) => snapshot.account);
    const firstTagged = tagged[0]?.time ?? Infinity;
    this.legacy = legacyOwner(
      sorted.filter((snapshot) => !snapshot.account && snapshot.time < firstTagged),
      tagged,
    );
    const summaries = new Map<string, AccountSummary>();
    /** Each folder's account as of the reading at hand. */
    const signedIn = new Map<string, string>();
    for (const snapshot of sorted) {
      const folder = snapshot.configDir ?? DEFAULT_DIR;
      let key: string | undefined;
      if (snapshot.account) {
        key = accountKey(snapshot.account);
        signedIn.set(folder, key);
      } else {
        // Only the default folder has readings from before accounts were told apart.
        key = signedIn.get(folder) ?? (snapshot.configDir === undefined ? this.legacy : undefined);
      }
      if (key === undefined) continue;
      this.owners.set(snapshot, key);
      const line = this.folders.get(folder) ?? { times: [], keys: [] };
      line.times.push(snapshot.time);
      line.keys.push(key);
      this.folders.set(folder, line);
      const summary = summaries.get(key) ?? {
        key,
        email: '',
        first: snapshot.time,
        last: snapshot.time,
      };
      summary.last = snapshot.time;
      if (snapshot.account) {
        summary.email = snapshot.account.email;
        if (snapshot.account.organization) summary.organization = snapshot.account.organization;
      }
      if (snapshot.plan) summary.plan = snapshot.plan;
      summaries.set(key, summary);
    }
    this.list = [...summaries.values()];
  }

  /** The account of a reading, one of those given. */
  ofSnapshot(snapshot: QuotaSnapshot): string | undefined {
    return this.owners.get(snapshot);
  }

  /** The account a config folder (none: the default one) was signed in to at a time. */
  at(configDir: string | undefined, time: number): string | undefined {
    const line = this.folders.get(configDir ?? DEFAULT_DIR);
    if (!line) return undefined;
    // The last reading at or before the time.
    let low = 0;
    let high = line.times.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (line.times[middle] <= time) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return line.keys[Math.max(found, 0)];
  }

  /**
   * The account to show: the one asked for if it is known, else the one signed in now, else the
   * one read last.
   */
  pick(asked: string | undefined, current: string | undefined): string | undefined {
    const known = (key: string | undefined) =>
      key !== undefined && this.list.some((account) => account.key === key);
    if (known(asked)) return asked;
    if (known(current)) return current;
    return [...this.list].sort((a, b) => b.last - a.last)[0]?.key;
  }

  /** The accounts for the panel to choose from, oldest first. */
  options(current: string | undefined): AccountOption[] {
    return this.list.map(({ key, email, organization, plan }) => ({
      key,
      email,
      ...(organization !== undefined && { organization }),
      ...(plan !== undefined && { plan }),
      current: key === current,
    }));
  }
}

/** `before`: the readings without an account from before any named one, oldest first. */
function legacyOwner(
  before: readonly QuotaSnapshot[],
  tagged: readonly QuotaSnapshot[],
): string | undefined {
  const first = tagged[0]?.account;
  if (!first) return undefined;
  let lastReset: number | undefined;
  for (const snapshot of before) {
    if (snapshot.weekly?.resetsAt) lastReset = snapshot.weekly.resetsAt;
  }
  const going = lastReset
    ? tagged.find(
        (snapshot) =>
          snapshot.weekly?.resetsAt !== undefined &&
          sameTimeOfWeek(snapshot.weekly.resetsAt, lastReset),
      )?.account
    : undefined;
  return accountKey(going ?? first);
}

function sameTimeOfWeek(a: number, b: number): boolean {
  const apart = (((a - b) % WEEK) + WEEK) % WEEK;
  return apart < RESET_SLACK || WEEK - apart < RESET_SLACK;
}
