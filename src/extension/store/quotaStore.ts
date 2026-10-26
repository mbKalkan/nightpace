import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QuotaSnapshot } from '../quota/snapshot';

const SNAPSHOTS = 'quota.jsonl';
const POLL = 'poll.json';
const POLL_FILE = /^poll(-[0-9a-f]+)?\.json$/;
const SOURCES = 'sources.json';

/** When a poll was last tried, by any VS Code window, how it went, and the latest snapshot. */
export interface PollRecord {
  time: number;
  failed?: boolean;
  /** Tries that failed in a row, this one included. */
  failures?: number;
  snapshot?: QuotaSnapshot;
  /** The account Claude Code's config file named when it was tried, to notice a switch. */
  signedIn?: string;
}

/** The poll record of the default config folder keeps the name it had before there were others. */
function pollFile(configDir: string | undefined): string {
  if (configDir === undefined) return POLL;
  return `poll-${createHash('sha256').update(configDir).digest('hex').slice(0, 12)}.json`;
}

/**
 * Nightpace's own data, in the extension's global storage folder: the quota snapshots it
 * recorded, one JSON line each, when it last asked each Claude Code config folder, and the
 * folders it follows. Every VS Code window shares it.
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

  /** The last poll of a config folder: the default one when left out. */
  async lastPoll(configDir?: string): Promise<PollRecord | undefined> {
    try {
      const record = JSON.parse(
        await readFile(join(this.folder, pollFile(configDir)), 'utf8'),
      ) as PollRecord;
      return typeof record.time === 'number' ? record : undefined;
    } catch {
      return undefined;
    }
  }

  async recordPoll(record: PollRecord, configDir?: string): Promise<void> {
    await this.write(pollFile(configDir), record);
  }

  /** Config folders VS Code's Claude Code has used, so they are followed after it moves on. */
  async configDirs(): Promise<string[]> {
    try {
      const { configDirs } = JSON.parse(await readFile(join(this.folder, SOURCES), 'utf8')) as {
        configDirs?: unknown;
      };
      return Array.isArray(configDirs)
        ? configDirs.filter((dir): dir is string => typeof dir === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async rememberConfigDir(configDir: string): Promise<void> {
    const known = await this.configDirs();
    if (known.includes(configDir)) return;
    await this.write(SOURCES, { configDirs: [...known, configDir] });
  }

  /** Deletes everything Nightpace has recorded. */
  async clear(): Promise<void> {
    await rm(join(this.folder, SNAPSHOTS), { force: true });
    await rm(join(this.folder, SOURCES), { force: true });
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch {
      return;
    }
    for (const name of names.filter((name) => POLL_FILE.test(name))) {
      await rm(join(this.folder, name), { force: true });
    }
  }

  /** Written beside and renamed, so another window never reads half of it. */
  private async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const temporary = join(this.folder, `${name}.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, join(this.folder, name));
  }
}
