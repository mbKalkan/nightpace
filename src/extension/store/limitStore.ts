import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LimitHit } from '../../shared/protocol';
import type { LimitEvent } from '../transcripts/events';

const HITS = 'limits.jsonl';
const STATE = 'limits.json';

/** The limit a refused request ran into, as the timeline tells them apart; others are left out. */
export function limitHit(event: LimitEvent): LimitHit | undefined {
  if (event.limit === 'five_hour') return { time: event.time, limit: 'fiveHour' };
  if (event.limit.startsWith('seven_day')) return { time: event.time, limit: 'weekly' };
  return undefined;
}

/**
 * When Claude Code refused a request because a plan limit ran out, as its transcripts say, kept
 * by Nightpace: Claude Code deletes old transcripts. One JSON line each; every VS Code window
 * shares the file, so the same hit may be written twice and is read once.
 */
export class LimitStore {
  constructor(private readonly folder: string) {}

  async append(hits: readonly LimitHit[]): Promise<void> {
    if (hits.length === 0) return;
    await mkdir(this.folder, { recursive: true });
    await appendFile(
      join(this.folder, HITS),
      hits.map((hit) => JSON.stringify(hit) + '\n').join(''),
    );
  }

  /** Every hit kept, oldest first. */
  async hits(): Promise<LimitHit[]> {
    let text: string;
    try {
      text = await readFile(join(this.folder, HITS), 'utf8');
    } catch {
      return [];
    }
    const hits = new Map<string, LimitHit>();
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const hit = JSON.parse(line) as LimitHit;
        if (typeof hit.time === 'number' && (hit.limit === 'fiveHour' || hit.limit === 'weekly')) {
          hits.set(`${hit.time}|${hit.limit}`, hit);
        }
      } catch {
        // A line cut short when VS Code closed mid-write.
      }
    }
    return [...hits.values()].sort((a, b) => a.time - b.time);
  }

  /** Whether the transcripts from before Nightpace kept hits have been read for them. */
  async backfilled(): Promise<boolean> {
    try {
      return (
        (JSON.parse(await readFile(join(this.folder, STATE), 'utf8')) as { backfilled?: boolean })
          .backfilled === true
      );
    } catch {
      return false;
    }
  }

  async markBackfilled(): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await writeFile(join(this.folder, STATE), JSON.stringify({ backfilled: true }));
  }

  async clear(): Promise<void> {
    await rm(join(this.folder, HITS), { force: true });
    await rm(join(this.folder, STATE), { force: true });
  }
}
