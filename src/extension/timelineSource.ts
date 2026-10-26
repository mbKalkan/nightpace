import {
  WEEKS_BACK,
  type LimitHit,
  type RangeKey,
  type TimelineData,
  type TimeWindow,
} from '../shared/protocol';
import { Accounts } from './model/accounts';
import { PACE_SPAN } from './model/pace';
import { buildTimeline, RANGE_SPANS } from './model/timeline';
import { limitHit, type LimitStore, type StoredLimitHit } from './store/limitStore';
import type { QuotaStore } from './store/quotaStore';
import type { RequestStore } from './store/requestStore';
import { scanTranscripts } from './transcripts/scanner';
import { UsageLog, type RequestUsage } from './transcripts/usageLog';

/** Only lines with this can tell of a limit that ran out. */
const LIMIT_MARKER = '"rate_limit"';

/**
 * The longest range with a day to spare for its first bucket, the quota weeks that can be shown,
 * or further back for the pace: a reading measured without the start of its week's cost would
 * make a dollar use too much.
 */
const KEPT_IN_MEMORY_MS = Math.max(
  RANGE_SPANS['30d'] + 24 * 3_600_000,
  (WEEKS_BACK + 1) * RANGE_SPANS.week,
  PACE_SPAN,
);

/** A folder of Claude Code transcripts, and the config folder it belongs to. */
export interface TranscriptRoot {
  projects: string;
  /** None for the default config folder. */
  configDir?: string;
}

export interface AccountChoice {
  /** The account the panel asked for. */
  asked?: string;
  /** The account VS Code's Claude Code is signed in to now. */
  current?: string;
}

/**
 * The data behind the timeline. Requests come from Nightpace's request store, then from what
 * Claude Code appended to its transcripts since the store last read them; whatever that adds is
 * written back to the store. The quota history comes from Nightpace's quota store, and the limits
 * that ran out from its limit store: once, in the background, every transcript is read for them,
 * then they come with the requests. With more than one account, everything is one account's.
 */
export class TimelineSource {
  private log = new UsageLog();
  private offsets = new Map<string, number>();
  private syncing: Promise<void> | undefined;
  private backfill: Promise<void> | undefined;

  constructor(
    private readonly roots: () => TranscriptRoot[],
    private readonly quota: QuotaStore,
    private readonly requests: RequestStore,
    private readonly limits?: LimitStore,
  ) {}

  /** `week`: in the `week` range, which quota week, 0 for this one. */
  async timeline(
    range: RangeKey,
    zoom?: TimeWindow,
    now = Date.now(),
    week = 0,
    choice: AccountChoice = {},
  ): Promise<TimelineData> {
    await this.sync(now);
    const snapshots = await this.quota.snapshots();
    const limits = (await this.limits?.hits()) ?? [];
    const accounts = new Accounts(snapshots);
    if (accounts.list.length < 2) {
      return buildTimeline({
        range,
        now,
        zoom,
        week,
        requests: this.log.usage(),
        snapshots,
        limits: limits.map(withoutFolder),
      });
    }
    const account = accounts.pick(choice.asked, choice.current);
    const mine = (configDir: string | undefined, time: number) =>
      accounts.at(configDir, time) === account;
    return {
      ...buildTimeline({
        range,
        now,
        zoom,
        week,
        requests: only(this.log.usage(), (request) => mine(request.configDir, request.time)),
        snapshots: snapshots.filter((snapshot) => accounts.ofSnapshot(snapshot) === account),
        limits: limits.filter((hit) => mine(hit.configDir, hit.time)).map(withoutFolder),
      }),
      // Marked only when known: a guess could name the wrong account as signed in.
      accounts: accounts.options(choice.current),
      account,
    };
  }

  /** Brings the store up to date with the transcripts. One sync at a time; others wait for it. */
  sync(now = Date.now()): Promise<void> {
    this.syncing ??= this.read(now).finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  /** Forgets every request, after the store is cleared, so the next sync starts over. */
  async reset(): Promise<void> {
    await this.syncing?.catch(() => undefined);
    await this.backfill;
    await this.requests.clear();
    await this.limits?.clear();
    this.backfill = undefined;
    this.log = new UsageLog();
    this.offsets = new Map();
  }

  private async read(now: number): Promise<void> {
    // Offsets first: a window saves them only after appending their requests, so every request
    // behind an offset read here is in the store by the time the store is read.
    for (const [path, offset] of await this.requests.offsets()) {
      if (offset > (this.offsets.get(path) ?? 0)) this.offsets.set(path, offset);
    }
    await this.requests.readNew(now - KEPT_IN_MEMORY_MS, (request) => this.log.merge(request));

    const changed = new Map<string, RequestUsage>();
    const hits: StoredLimitHit[] = [];
    let bytesRead = 0;
    for (const { projects, configDir } of this.roots()) {
      const scan = await scanTranscripts([projects], this.offsets, (event) => {
        if (event.kind === 'limit') {
          const hit = limitHit(event);
          if (hit) hits.push(configDir === undefined ? hit : { ...hit, configDir });
          return;
        }
        const request = this.log.add(configDir === undefined ? event : { ...event, configDir });
        if (request) changed.set(request.requestId, request);
      });
      bytesRead += scan.bytesRead;
    }
    await this.requests.append(changed.values());
    await this.limits?.append(hits);
    if (bytesRead > 0) await this.requests.saveOffsets(this.offsets);
    this.backfill ??= this.fillLimits().catch(() => undefined);
  }

  /** Reads every transcript once for the limits that ran out before Nightpace kept them. */
  private async fillLimits(): Promise<void> {
    if (!this.limits || (await this.limits.backfilled())) return;
    const hits: StoredLimitHit[] = [];
    for (const { projects, configDir } of this.roots()) {
      await scanTranscripts(
        [projects],
        new Map(),
        (event) => {
          const hit = event.kind === 'limit' ? limitHit(event) : undefined;
          if (hit) hits.push(configDir === undefined ? hit : { ...hit, configDir });
        },
        undefined,
        LIMIT_MARKER,
      );
    }
    await this.limits.append(hits);
    await this.limits.markBackfilled();
  }

  /** Resolves once the transcripts have been read for past limits, if that has started. */
  async limitsFilled(): Promise<void> {
    await this.backfill;
  }
}

function withoutFolder({ time, limit }: StoredLimitHit): LimitHit {
  return { time, limit };
}

function* only<T>(items: Iterable<T>, keep: (item: T) => boolean): Generator<T> {
  for (const item of items) if (keep(item)) yield item;
}
