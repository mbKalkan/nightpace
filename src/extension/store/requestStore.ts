import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readAppendedLines } from '../transcripts/lines';
import type { RequestUsage } from '../transcripts/usageLog';

const FOLDER = 'requests';
const SCAN = 'scan.json';
/** Raised when the record layout changes: older records are dropped and read again. */
const VERSION = 1;
const MONTH_FILE = /^(\d{4}-\d{2})\.jsonl$/;

type StoredRequest = [
  requestId: string,
  sessionId: string,
  time: number,
  /** Milliseconds from the first line to the last. */
  duration: number,
  model: string,
  effort: string | null,
  /** 1: made by a subagent, 2: final output count, 4: fast mode, 8: inference kept in the US. */
  flags: number,
  input: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  output: number,
  thinking: number,
  project: string | null,
  /** Only when there were any, or when a config folder follows. */
  webSearches?: number,
  /** Only for a config folder other than the default one, so older records stay as they were. */
  configDir?: string,
];

interface ScanState {
  version: number;
  /** Bytes of each transcript whose requests are in the store. */
  offsets: Record<string, number>;
}

export function encodeRequest(request: RequestUsage): string {
  const { tokens } = request;
  const record: StoredRequest = [
    request.requestId,
    request.sessionId,
    request.time,
    request.end - request.time,
    request.model,
    request.effort ?? null,
    (request.sidechain ? 1 : 0) |
      (request.final ? 2 : 0) |
      (request.fast ? 4 : 0) |
      (request.usOnly ? 8 : 0),
    tokens.input,
    tokens.cacheWrite5m,
    tokens.cacheWrite1h,
    tokens.cacheRead,
    tokens.output,
    tokens.thinking,
    request.project ?? null,
  ];
  if (tokens.webSearches || request.configDir !== undefined) record.push(tokens.webSearches ?? 0);
  if (request.configDir !== undefined) record.push(request.configDir);
  return JSON.stringify(record);
}

export function decodeRequest(line: string): RequestUsage | undefined {
  let record: StoredRequest;
  try {
    record = JSON.parse(line) as StoredRequest;
  } catch {
    return undefined; // A line cut short when VS Code closed mid-write.
  }
  if (!Array.isArray(record) || record.length < 14 || record.length > 16) return undefined;
  const [requestId, sessionId, time, duration, model, effort, flags, ...rest] = record;
  const [
    input,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead,
    output,
    thinking,
    project,
    webSearches,
    configDir,
  ] = rest;
  if (typeof requestId !== 'string' || typeof sessionId !== 'string') return undefined;
  if (typeof time !== 'number' || typeof duration !== 'number') return undefined;
  return {
    requestId,
    sessionId,
    time,
    end: time + duration,
    model,
    ...(effort !== null && { effort }),
    sidechain: (flags & 1) !== 0,
    final: (flags & 2) !== 0,
    ...((flags & 4) !== 0 && { fast: true }),
    ...((flags & 8) !== 0 && { usOnly: true }),
    ...(project !== null && { project }),
    ...(typeof configDir === 'string' && { configDir }),
    tokens: {
      input,
      cacheWrite5m,
      cacheWrite1h,
      cacheRead,
      output,
      thinking,
      ...(typeof webSearches === 'number' && webSearches > 0 && { webSearches }),
    },
  };
}

/** `2026-10` for a time, in UTC so every machine files a request the same way. */
export function monthOf(time: number): string {
  return new Date(time).toISOString().slice(0, 7);
}

/**
 * The requests Nightpace has read from Claude Code's transcripts, kept in its global storage so
 * they outlive the transcripts (Claude Code deletes old ones) and need not be read again. One
 * JSON line per request, in a file per month; a request whose counts changed later is written
 * again, and the reader merges the copies. `scan.json` says how far each transcript was read.
 * Every VS Code window shares the folder: what one window wrote, another reads from here.
 */
export class RequestStore {
  private readonly folder: string;
  /** How far this window has read each month file. */
  private readonly read = new Map<string, number>();
  private checked = false;

  constructor(storage: string) {
    this.folder = join(storage, FOLDER);
  }

  /**
   * Passes each request written since the last call, from the months from `since` on, to
   * `onRequest`; the first call passes all of them.
   */
  async readNew(since: number, onRequest: (request: RequestUsage) => void): Promise<void> {
    await this.checkVersion();
    const first = monthOf(since);
    for (const month of await this.months()) {
      if (month < first) continue;
      const path = join(this.folder, `${month}.jsonl`);
      try {
        const next = await readAppendedLines(
          path,
          this.read.get(month) ?? 0,
          (line) => {
            const request = decodeRequest(line);
            if (request) onRequest(request);
          },
          { marker: '[' },
        );
        this.read.set(month, next);
      } catch {
        // Removed meanwhile, or locked: read next time.
      }
    }
  }

  /** Writes requests that are new or changed, each into the file of the month it started in. */
  async append(requests: Iterable<RequestUsage>): Promise<void> {
    const byMonth = new Map<string, string[]>();
    for (const request of requests) {
      const month = monthOf(request.time);
      const lines = byMonth.get(month) ?? [];
      lines.push(encodeRequest(request));
      byMonth.set(month, lines);
    }
    if (byMonth.size === 0) return;
    await mkdir(this.folder, { recursive: true });
    for (const [month, lines] of byMonth) {
      await appendFile(join(this.folder, `${month}.jsonl`), lines.join('\n') + '\n');
    }
  }

  /** How far each transcript has been read into the store, by any window. */
  async offsets(): Promise<Map<string, number>> {
    await this.checkVersion();
    return new Map(Object.entries((await this.scanState())?.offsets ?? {}));
  }

  /**
   * Records how far transcripts were read. Call it only after their requests were appended.
   * Another window may have read further meanwhile: the furthest offset of the two is kept.
   */
  async saveOffsets(offsets: ReadonlyMap<string, number>): Promise<void> {
    const merged = { ...(await this.scanState())?.offsets };
    for (const [path, offset] of offsets) merged[path] = Math.max(merged[path] ?? 0, offset);
    await mkdir(this.folder, { recursive: true });
    // Written beside and renamed, so another window never reads half of it.
    const temporary = join(this.folder, `${SCAN}.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: VERSION, offsets: merged }));
    await rename(temporary, join(this.folder, SCAN));
  }

  /** Deletes every kept request; the next read starts over from the transcripts. */
  async clear(): Promise<void> {
    this.read.clear();
    await rm(this.folder, { recursive: true, force: true });
  }

  /** Records of another layout are dropped, so they are read again from the transcripts. */
  private async checkVersion(): Promise<void> {
    if (this.checked) return;
    this.checked = true;
    const state = await this.scanState();
    if (state && state.version !== VERSION) await this.clear();
  }

  private async scanState(): Promise<ScanState | undefined> {
    try {
      const state = JSON.parse(await readFile(join(this.folder, SCAN), 'utf8')) as ScanState;
      return typeof state.version === 'number' && typeof state.offsets === 'object'
        ? state
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async months(): Promise<string[]> {
    try {
      return (await readdir(this.folder))
        .map((name) => MONTH_FILE.exec(name)?.[1])
        .filter((month): month is string => month !== undefined)
        .sort();
    } catch {
      return [];
    }
  }
}
