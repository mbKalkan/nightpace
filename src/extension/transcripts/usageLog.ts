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

  /** Adds a transcript line; returns the request as it now stands if the line changed it. */
  add(event: TranscriptEvent): RequestUsage | undefined {
    if (event.kind === 'limit') {
      const key = `${event.sessionId}|${event.time}`;
      if (this.limitKeys.has(key)) return undefined;
      this.limitKeys.add(key);
      this.limits.push(event);
      return undefined;
    }
    const { kind: _, ...usage } = event;
    return this.merge({ ...usage, end: event.time });
  }

  /** Adds a request kept from earlier; returns it as it now stands if it changed anything. */
  merge(request: RequestUsage): RequestUsage | undefined {
    const known = this.requests.get(request.requestId);
    if (!known) {
      this.requests.set(request.requestId, request);
      return request;
    }
    // The session that first wrote the request keeps it; a copy only completes its counts.
    const later = !known.final && (request.final || request.tokens.output > known.tokens.output);
    const time = Math.min(known.time, request.time);
    const end = Math.max(known.end, request.end);
    if (!later && time === known.time && end === known.end) return undefined;
    const merged = {
      ...known,
      time,
      end,
      ...(later && { tokens: request.tokens, final: request.final }),
    };
    this.requests.set(request.requestId, merged);
    return merged;
  }

  get size(): number {
    return this.requests.size;
  }

  usage(): IterableIterator<RequestUsage> {
    return this.requests.values();
  }
}
