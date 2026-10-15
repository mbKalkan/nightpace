import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The Claude Code extension for VS Code, which carries its own copy of Claude Code. */
export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';

export interface BinarySearch {
  platform: NodeJS.Platform;
  /** The folder of the installed Claude Code extension, if there is one. */
  claudeExtensionPath?: string;
  /** The PATH environment variable. */
  path?: string;
}

/**
 * Where Claude Code can be found, in the order to try: the copy inside the Claude Code
 * extension, which is what its panel runs, then `claude` on the PATH. Only files that exist.
 */
export function claudeBinaries({
  platform,
  claudeExtensionPath,
  path = '',
}: BinarySearch): string[] {
  const name = platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates: string[] = [];
  if (claudeExtensionPath) {
    candidates.push(join(claudeExtensionPath, 'resources', 'native-binary', name));
  }
  for (const folder of path.split(platform === 'win32' ? ';' : ':')) {
    if (folder) candidates.push(join(folder, name));
  }
  return [...new Set(candidates)].filter((candidate) => existsSync(candidate));
}
