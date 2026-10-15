import { open } from 'node:fs/promises';
import { ASSISTANT_MARKER } from './events';

const NEWLINE = 0x0a;

export interface ReadOptions {
  /** Bytes read at a time. */
  chunkSize?: number;
  /** Only lines containing this are decoded; by default, the transcript lines with usage. */
  marker?: string;
}

/**
 * Reads what was appended to a JSON lines file since `offset` and passes each complete line that
 * may hold usage to `onLine`; other lines, most of the bytes, are never decoded. Returns the
 * offset after the last complete line: a line still being written is read next time.
 */
export async function readAppendedLines(
  path: string,
  offset: number,
  onLine: (line: string) => void,
  { chunkSize = 4 * 1024 * 1024, marker = ASSISTANT_MARKER }: ReadOptions = {},
): Promise<number> {
  const markerBytes = Buffer.from(marker);
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    let position = offset;
    let consumed = offset;
    let carry: Buffer = Buffer.alloc(0);
    while (position < size) {
      const chunk = Buffer.allocUnsafe(Math.min(chunkSize, size - position));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const buffer = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk;
      const length = carry.length + bytesRead;
      const end = buffer.lastIndexOf(NEWLINE, length - 1);
      if (end < 0) {
        carry = buffer.subarray(0, length);
        continue;
      }
      emitMarkedLines(buffer, end, markerBytes, onLine);
      carry = buffer.subarray(end + 1, length);
      consumed = position - carry.length;
    }
    return consumed;
  } finally {
    await file.close();
  }
}

/** Calls `onLine` for each line in `buffer[0, end)` that contains the marker. */
function emitMarkedLines(
  buffer: Buffer,
  end: number,
  marker: Buffer,
  onLine: (line: string) => void,
): void {
  let from = 0;
  for (;;) {
    const hit = buffer.indexOf(marker, from);
    if (hit < 0 || hit >= end) return;
    const start = buffer.lastIndexOf(NEWLINE, hit) + 1;
    const stop = buffer.indexOf(NEWLINE, hit);
    onLine(buffer.toString('utf8', start, stop));
    from = stop + 1;
  }
}
