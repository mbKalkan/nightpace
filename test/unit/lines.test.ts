import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readAppendedLines } from '../../src/extension/transcripts/lines';

const folder = mkdtempSync(join(tmpdir(), 'nightpace-lines-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

let files = 0;
const transcript = (content: string) => {
  const path = join(folder, `${++files}.jsonl`);
  writeFileSync(path, content);
  return path;
};

const marked = (n: number) => `{"type":"assistant","n":${n}}`;
const other = (size: number) => `{"type":"user","text":"${'é'.repeat(size)}"}`;

async function read(path: string, offset = 0, chunkSize?: number) {
  const lines: string[] = [];
  const next = await readAppendedLines(path, offset, (line) => lines.push(line), { chunkSize });
  return { lines, next };
}

describe('readAppendedLines', () => {
  it('passes on only the lines that may hold usage', async () => {
    const content = [marked(1), other(10), marked(2), ''].join('\n');
    const { lines, next } = await read(transcript(content));
    expect(lines).toEqual([marked(1), marked(2)]);
    expect(next).toBe(Buffer.byteLength(content));
  });

  it('leaves a line still being written for the next read', async () => {
    const path = transcript(`${marked(1)}\n${marked(2).slice(0, 10)}`);
    const first = await read(path);
    expect(first.lines).toEqual([marked(1)]);
    expect(first.next).toBe(marked(1).length + 1);

    appendFileSync(path, `${marked(2).slice(10)}\n${marked(3)}\n`);
    const second = await read(path, first.next);
    expect(second.lines).toEqual([marked(2), marked(3)]);
  });

  it('reads lines that cross chunk boundaries, multi-byte characters included', async () => {
    const content = [other(40), marked(1), other(25), marked(2), other(3), ''].join('\n');
    const path = transcript(content);
    for (const chunkSize of [1, 7, 16, 33, 1000]) {
      const { lines, next } = await read(path, 0, chunkSize);
      expect(lines, `chunks of ${chunkSize}`).toEqual([marked(1), marked(2)]);
      expect(next).toBe(Buffer.byteLength(content));
    }
  });

  it('reads nothing when nothing was appended', async () => {
    const path = transcript(`${marked(1)}\n`);
    const { next } = await read(path);
    expect(await read(path, next)).toEqual({ lines: [], next });
  });
});
