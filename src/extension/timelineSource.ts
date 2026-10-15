import type { RangeKey, TimelineData } from '../shared/protocol';
import { buildTimeline } from './model/timeline';
import type { QuotaStore } from './store/quotaStore';
import { scanTranscripts } from './transcripts/scanner';
import { UsageLog } from './transcripts/usageLog';

/**
 * The data behind the timeline. Transcripts are read once in full when the panel first asks,
 * then only what was appended; the quota history comes from Nightpace's own store.
 */
export class TimelineSource {
  private readonly log = new UsageLog();
  private readonly offsets = new Map<string, number>();
  private scanning: Promise<void> | undefined;

  constructor(
    private readonly roots: () => string[],
    private readonly store: QuotaStore,
  ) {}

  async timeline(range: RangeKey, now = Date.now()): Promise<TimelineData> {
    await this.scan();
    return buildTimeline({
      range,
      now,
      requests: this.log.usage(),
      snapshots: await this.store.snapshots(),
    });
  }

  /** One scan at a time; a caller arriving during one waits for it. */
  private scan(): Promise<void> {
    this.scanning ??= scanTranscripts(this.roots(), this.offsets, (event) => this.log.add(event))
      .then(() => undefined)
      .finally(() => (this.scanning = undefined));
    return this.scanning;
  }
}
