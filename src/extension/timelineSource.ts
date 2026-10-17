import type { RangeKey, TimelineData, TimeWindow } from '../shared/protocol';
import { buildTimeline, RANGE_SPANS } from './model/timeline';
import { limitHit, type LimitStore } from './store/limitStore';
import type { QuotaStore } from './store/quotaStore';
import type { RequestStore } from './store/requestStore';
import { scanTranscripts } from './transcripts/scanner';
import { UsageLog, type RequestUsage } from './transcripts/usageLog';
import type { LimitHit } from '../shared/protocol';

/** Only lines with this can tell of a limit that ran out. */
const LIMIT_MARKER = '"rate_limit"';

/** The longest range, and a day to spare for its first bucket. */
const KEPT_IN_MEMORY_MS = RANGE_SPANS['30d'] + 24 * 3_600_000;

/**
 * The data behind the timeline. Requests come from Nightpace's request store, then from what
 * Claude Code appended to its transcripts since the store last read them; whatever that adds is
 * written back to the store. The quota history comes from Nightpace's quota store, and the limits
 * that ran out from its limit store: once, in the background, every transcript is read for them,
 * then they come with the requests.
 */
export class TimelineSource {
  private log = new UsageLog();
  private offsets = new Map<string, number>();
  private syncing: Promise<void> | undefined;
  private backfill: Promise<void> | undefined;

  constructor(
    private readonly roots: () => string[],
    private readonly quota: QuotaStore,
    private readonly requests: RequestStore,
    private readonly limits?: LimitStore,
  ) {}

  async timeline(range: RangeKey, zoom?: TimeWindow, now = Date.now()): Promise<TimelineData> {
    await this.sync(now);
    return buildTimeline({
      range,
      now,
      zoom,
      requests: this.log.usage(),
      snapshots: await this.quota.snapshots(),
      limits: (await this.limits?.hits()) ?? [],
    });
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
    const hits: LimitHit[] = [];
    const { bytesRead } = await scanTranscripts(this.roots(), this.offsets, (event) => {
      if (event.kind === 'limit') {
        const hit = limitHit(event);
        if (hit) hits.push(hit);
        return;
      }
      const request = this.log.add(event);
      if (request) changed.set(request.requestId, request);
    });
    await this.requests.append(changed.values());
    await this.limits?.append(hits);
    if (bytesRead > 0) await this.requests.saveOffsets(this.offsets);
    this.backfill ??= this.fillLimits().catch(() => undefined);
  }

  /** Reads every transcript once for the limits that ran out before Nightpace kept them. */
  private async fillLimits(): Promise<void> {
    if (!this.limits || (await this.limits.backfilled())) return;
    const hits: LimitHit[] = [];
    await scanTranscripts(
      this.roots(),
      new Map(),
      (event) => {
        const hit = event.kind === 'limit' ? limitHit(event) : undefined;
        if (hit) hits.push(hit);
      },
      undefined,
      LIMIT_MARKER,
    );
    await this.limits.append(hits);
    await this.limits.markBackfilled();
  }

  /** Resolves once the transcripts have been read for past limits, if that has started. */
  async limitsFilled(): Promise<void> {
    await this.backfill;
  }
}
