import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TranscriptEvent } from '../../src/extension/transcripts/events';
import { scanTranscripts } from '../../src/extension/transcripts/scanner';
import { UsageLog, type RequestUsage } from '../../src/extension/transcripts/usageLog';

// Synthetic transcripts from scripts/gen-fixtures.mjs.
const FIXTURES = 'test/fixtures/claude/projects';

const folder = mkdtempSync(join(tmpdir(), 'nightpace-scan-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

let copies = 0;
const copyOfFixtures = () => {
  const root = join(folder, String(++copies));
  cpSync(FIXTURES, root, { recursive: true });
  return root;
};

async function scan(roots: string[], offsets = new Map<string, number>(), log = new UsageLog()) {
  const result = await scanTranscripts(roots, offsets, (event) => log.add(event));
  const requests = new Map<string, RequestUsage>([...log.usage()].map((u) => [u.requestId, u]));
  return { result, requests, log, offsets };
}

describe('scanTranscripts', () => {
  it('counts each request once, with its final counts, subagents included', async () => {
    const { requests, log, result } = await scan([FIXTURES]);
    expect([...requests.keys()].sort()).toEqual(['req_r1', 'req_r2', 'req_r3', 'req_r4']);
    expect(result.filesRead).toBe(3);

    // Streamed: the final count, at the time the request started.
    expect(requests.get('req_r2')).toMatchObject({
      final: true,
      time: Date.UTC(2026, 9, 12, 9, 1, 0),
      end: Date.UTC(2026, 9, 12, 9, 1, 9),
      tokens: { output: 400, thinking: 120, cacheWrite1h: 300, cacheRead: 6000 },
    });
    // Copied into a forked session: still the session that made it.
    expect(requests.get('req_r1')).toMatchObject({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tokens: { output: 200 },
    });
    // A subagent's transcript keeps only the first, unfinished count.
    expect(requests.get('req_r3')).toMatchObject({
      sidechain: true,
      final: false,
      tokens: { cacheWrite5m: 3000, output: 8 },
    });
    expect(requests.get('req_r4')).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'high',
      project: '/work/beta',
      tokens: { cacheWrite5m: 700, cacheWrite1h: 0, thinking: 0 },
    });
    expect(log.limits).toEqual([
      {
        kind: 'limit',
        sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        time: Date.UTC(2026, 9, 12, 9, 2),
        limit: 'five_hour',
        resetsAt: Date.UTC(2026, 9, 12, 11, 0),
      },
    ]);
  });

  it('reads only what was appended since the last scan', async () => {
    const root = copyOfFixtures();
    const first = await scan([root]);
    const again = await scan([root], first.offsets, first.log);
    expect(again.result).toEqual({ filesRead: 0, bytesRead: 0, events: 0 });

    const file = join(root, '-work-beta', 'bbbbbbbb-0000-4000-8000-000000000002.jsonl');
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 'bbbbbbbb-0000-4000-8000-000000000002',
      timestamp: '2026-10-12T09:05:00.000Z',
      requestId: 'req_r5',
      message: { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 9 } },
    });
    appendFileSync(file, `${line}\n`);
    const events: TranscriptEvent[] = [];
    const third = await scanTranscripts([root], first.offsets, (event) => events.push(event));
    expect(third).toEqual({ filesRead: 1, bytesRead: line.length + 1, events: 1 });
    expect(events).toMatchObject([{ requestId: 'req_r5', tokens: { output: 9 } }]);
  });

  it('reads a file again from the start when it was replaced by a shorter one', async () => {
    const root = copyOfFixtures();
    const { offsets } = await scan([root]);
    const file = join(root, '-work-beta', 'bbbbbbbb-0000-4000-8000-000000000002.jsonl');
    writeFileSync(
      file,
      `${JSON.stringify({
        type: 'assistant',
        sessionId: 'b',
        timestamp: '2026-10-12T10:00:00.000Z',
        requestId: 'req_new',
        message: { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 1 } },
      })}\n`,
    );
    const { requests } = await scan([root], offsets);
    expect([...requests.keys()]).toEqual(['req_new']);
  });

  it('finds nothing in a folder that does not exist', async () => {
    const { result } = await scan([join(folder, 'missing')]);
    expect(result).toEqual({ filesRead: 0, bytesRead: 0, events: 0 });
  });
});
