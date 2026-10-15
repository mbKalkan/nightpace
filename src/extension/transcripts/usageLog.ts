import type { LimitEvent, TranscriptEvent, UsageEvent } from './events';

/** An API request with its counts, from its first line to its last. */
export interface RequestUsage extends Omit<UsageEvent, 'kind'> {
  /** When its last line was written, in milliseconds since the epoch: `time` is the first. */
  end: number;
}

/**
 * Usage by API request. Claude Code writes a request as several lines, and while a response
 * streams the early lines carry an unfinished output count; a resumed or forked session copies
 * earlier requests into its own file. Each request is counted once, with its final counts and
 * the time from its first line to its last.
 */
export class UsageLog {
  private readonly requests = new Map<string, RequestUsage>();
  private readonly limitKeys = new Set<string>();
  readonly limits: LimitEvent[] = [];

  add(event: TranscriptEvent): void {
    if (event.kind === 'limit') {
      const key = `${event.sessionId}|${event.time}`;
      if (this.limitKeys.has(key)) return;
      this.limitKeys.add(key);
      this.limits.push(event);
      return;
    }
    const { kind: _, ...usage } = event;
    const known = this.requests.get(event.requestId);
    if (!known) {
      this.requests.set(event.requestId, { ...usage, end: event.time });
      return;
    }
    // The session that first wrote the request keeps it; a copy only completes its counts.
    const later = !known.final && (event.final || event.tokens.output > known.tokens.output);
    this.requests.set(event.requestId, {
      ...known,
      time: Math.min(known.time, event.time),
      end: Math.max(known.end, event.time),
      ...(later && { tokens: event.tokens, final: event.final }),
    });
  }

  get size(): number {
    return this.requests.size;
  }

  usage(): IterableIterator<RequestUsage> {
    return this.requests.values();
  }
}
