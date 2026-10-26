import type { PollRecord } from '../store/quotaStore';
import { shouldPoll } from './schedule';
import type { QuotaSnapshot } from './snapshot';

export interface RecorderDeps {
  /** Asks Claude Code; rejects when it can't. */
  query(): Promise<QuotaSnapshot>;
  /** When a transcript was last written to. */
  lastActivity(): Promise<number | undefined>;
  /**
   * The account Claude Code's config file names now, as `accountKey` makes it; asked every tick,
   * so a switch is recorded within a minute rather than at the next poll.
   */
  signedIn?(): Promise<string | undefined>;
  /** Asks only while signed in: a folder other than VS Code's own may have been left behind. */
  needsSignIn?: boolean;
  lastPoll(): Promise<PollRecord | undefined>;
  recordPoll(record: PollRecord): Promise<void>;
  append(snapshot: QuotaSnapshot): Promise<void>;
  /** A newer snapshot, recorded by this window or another one. */
  onSnapshot(snapshot: QuotaSnapshot): void;
  log(message: string): void;
  now?(): number;
}

/** How often the recorder checks whether it is time to ask. */
export const TICK_MS = 60_000;

/**
 * Records the quota of one Claude Code config folder in the background. Every VS Code window runs
 * one per folder; the poll record they share keeps them from asking more often than one would,
 * and passes on the latest snapshot.
 */
export class QuotaRecorder {
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private shown: number | undefined;

  constructor(private readonly deps: RecorderDeps) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Asks now if it's time to; resolves with the snapshot it recorded, if any. */
  async tick(): Promise<QuotaSnapshot | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    try {
      const { deps } = this;
      const now = deps.now?.() ?? Date.now();
      const last = await deps.lastPoll();
      if (last?.snapshot) this.show(last.snapshot);
      const signedIn = await deps.signedIn?.();
      if (deps.needsSignIn && signedIn === undefined) return undefined;
      const due = shouldPoll({
        now,
        lastPoll: last?.time,
        lastFailed: last?.failed,
        failures: last?.failures,
        lastActivity: await deps.lastActivity(),
        // Each poll keeps what the file said, so a file that disagrees with Claude Code's own
        // answer can't make it ask every minute.
        switched: signedIn !== undefined && signedIn !== last?.signedIn,
      });
      if (!due) return undefined;
      // Claimed before asking, so other windows wait instead of asking at the same time.
      await deps.recordPoll({ time: now, snapshot: last?.snapshot, signedIn });
      try {
        const snapshot = await deps.query();
        await deps.append(snapshot);
        await deps.recordPoll({ time: now, snapshot, signedIn });
        this.show(snapshot);
        return snapshot;
      } catch (error) {
        const failures = last?.failed ? (last.failures ?? 1) + 1 : 1;
        await deps.recordPoll({
          time: now,
          failed: true,
          failures,
          snapshot: last?.snapshot,
          signedIn,
        });
        deps.log(`Couldn't get the quota from Claude Code: ${String(error)}`);
        return undefined;
      }
    } catch (error) {
      this.deps.log(`Quota recorder: ${String(error)}`);
      return undefined;
    } finally {
      this.busy = false;
    }
  }

  private show(snapshot: QuotaSnapshot): void {
    if (snapshot.time === this.shown) return;
    this.shown = snapshot.time;
    this.deps.onSnapshot(snapshot);
  }
}
