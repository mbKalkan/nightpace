import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTranscriptLine, type TranscriptEvent } from './events';
import { readAppendedLines, type ReadOptions } from './lines';

export interface ScanResult {
  /** Transcripts that had new bytes. */
  filesRead: number;
  bytesRead: number;
  events: number;
}

/**
 * Reads Claude Code transcripts (`*.jsonl` under each root, subagents included) from where the
 * last scan stopped. `offsets` maps each file to the bytes already read and is updated in place,
 * so a scan after the first reads only what was appended.
 */
export async function scanTranscripts(
  roots: readonly string[],
  offsets: Map<string, number>,
  onEvent: (event: TranscriptEvent) => void,
  options?: ReadOptions,
): Promise<ScanResult> {
  const result: ScanResult = { filesRead: 0, bytesRead: 0, events: 0 };
  for (const root of roots) {
    for (const path of await transcriptFiles(root)) {
      let size: number;
      try {
        size = (await stat(path)).size;
      } catch {
        continue; // Removed since it was listed.
      }
      let offset = offsets.get(path) ?? 0;
      if (size === offset) continue;
      // Smaller than what was read: the file was replaced, so read it again from the start.
      if (size < offset) offset = 0;
      try {
        const next = await readAppendedLines(
          path,
          offset,
          (line) => {
            const event = parseTranscriptLine(line);
            if (event) {
              result.events++;
              onEvent(event);
            }
          },
          options,
        );
        result.filesRead++;
        result.bytesRead += next - offset;
        offsets.set(path, next);
      } catch {
        // Unreadable right now (locked, removed); tried again on the next scan.
      }
    }
  }
  return result;
}

async function transcriptFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}
