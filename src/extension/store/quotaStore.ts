import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QuotaSnapshot } from '../quota/snapshot';

const SNAPSHOTS = 'quota.jsonl';
const POLL = 'poll.json';

/** When a poll was last tried, by any VS Code window, how it went, and the latest snapshot. */
export interface PollRecord {
  time: number;
  failed?: boolean;
  /** Tries that failed in a row, this one included. */
  failures?: number;
  snapshot?: QuotaSnapshot;
}

/**
 * Nightpace's own data, in the extension's global storage folder: the quota snapshots it
 * recorded, one JSON line each, and when it last asked. Every VS Code window shares it.
 */
export class QuotaStore {
  constructor(private readonly folder: string) {}

  async append(snapshot: QuotaSnapshot): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await appendFile(join(this.folder, SNAPSHOTS), JSON.stringify(snapshot) + '\n');
  }

  /** All recorded snapshots, oldest first; lines that can't be read are skipped. */
  async snapshots(): Promise<QuotaSnapshot[]> {
    let text: string;
    try {
      text = await readFile(join(this.folder, SNAPSHOTS), 'utf8');
    } catch {
      return [];
    }
    const snapshots: QuotaSnapshot[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const snapshot = JSON.parse(line) as QuotaSnapshot;
        if (typeof snapshot.time === 'number') snapshots.push(snapshot);
      } catch {
        // A line cut short when VS Code closed mid-write.
      }
    }
    return snapshots;
  }

  async lastPoll(): Promise<PollRecord | undefined> {
    try {
      const record = JSON.parse(await readFile(join(this.folder, POLL), 'utf8')) as PollRecord;
      return typeof record.time === 'number' ? record : undefined;
    } catch {
      return undefined;
    }
  }

  async recordPoll(record: PollRecord): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    // Written beside and renamed, so another window never reads half of it.
    const temporary = join(this.folder, `${POLL}.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(record));
    await rename(temporary, join(this.folder, POLL));
  }

  /** Deletes everything Nightpace has recorded. */
  async clear(): Promise<void> {
    await rm(join(this.folder, SNAPSHOTS), { force: true });
    await rm(join(this.folder, POLL), { force: true });
  }
}
