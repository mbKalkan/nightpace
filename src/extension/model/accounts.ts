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

/** A time an account had a folder here, from `from` up to `to`. */
interface Span {
  from: number;
  to: number;
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
  private readonly spans = new Map<string, Span[]>();

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
    for (const line of this.folders.values()) {
      // A folder is an account's from its first reading after another's, as `at` has it.
      line.keys.forEach((key, i) => {
        if (key === line.keys[i - 1]) return;
        let end = i + 1;
        while (end < line.keys.length && line.keys[end] === key) end++;
        const spans = this.spans.get(key) ?? [];
        spans.push({
          from: i === 0 ? -Infinity : line.times[i],
          to: end < line.times.length ? line.times[end] : Infinity,
        });
        this.spans.set(key, spans);
      });
    }
    for (const [key, spans] of this.spans) this.spans.set(key, merged(spans));
  }

  /**
   * Whether an account had one of the folders here all along from one time to another, so that
   * every request it made here then is in hand. While another account has the folder, what this
   * one uses goes on elsewhere, with no cost here.
   */
  signedIn(key: string): (from: number, to: number) => boolean {
    const spans = this.spans.get(key) ?? [];
    return (from, to) => spans.some((span) => span.from <= from && to <= span.to);
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

/** Spans that overlap or meet as one, in time order. */
function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ ...span });
  }
  return out;
}

function sameTimeOfWeek(a: number, b: number): boolean {
  const apart = (((a - b) % WEEK) + WEEK) % WEEK;
  return apart < RESET_SLACK || WEEK - apart < RESET_SLACK;
}
