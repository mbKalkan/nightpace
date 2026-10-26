// The Claude Code config folders Nightpace follows. Claude Code keeps an account's sign-in,
// settings and transcripts in one folder: `~/.claude` (with `~/.claude.json`), or the one
// `CLAUDE_CONFIG_DIR` names. Each folder is signed in to one account at a time.

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { accountKey, parseConfigAccount } from './account';

export interface ClaudeSource {
  /**
   * The folder as `CLAUDE_CONFIG_DIR` was written: files are opened and Claude Code is started
   * with this spelling, since Claude Code may key its sign-in by the exact text. None for the
   * default folder.
   */
  dir?: string;
  /** The folder's name in Nightpace's records: `dir` normalized. None for the default folder. */
  configDir?: string;
  /** Where its transcripts are. */
  projects: string;
  /** Its global config file, which names the account signed in. */
  configFile: string;
  /** The folder VS Code's Claude Code uses: its quota is the one in the status bar. */
  current: boolean;
}

/** One spelling per folder, so a folder is known by the same name in every record. */
export function normalizeDir(dir: string, platform: NodeJS.Platform = process.platform): string {
  const full = resolve(dir);
  return platform === 'win32' ? full.toLowerCase() : full;
}

/** `~/…` as the full path; other paths as they are. */
export function expandHome(dir: string, home: string): string {
  return dir === '~' || dir.startsWith('~/') || dir.startsWith('~\\')
    ? join(home, dir.slice(1))
    : dir;
}

export interface SourceOptions {
  home: string;
  /** The folder VS Code's Claude Code uses; none for the default one. */
  current?: string;
  /** Other folders to follow: ones used before, and ones the user named. */
  others?: readonly string[];
  platform?: NodeJS.Platform;
}

/**
 * The current folder first, then the default one, then the others; one source per transcripts
 * folder, the first one kept.
 */
export function claudeSources({
  home,
  current,
  others = [],
  platform = process.platform,
}: SourceOptions): ClaudeSource[] {
  const source = (dir: string | undefined, isCurrent: boolean): ClaudeSource =>
    dir === undefined
      ? {
          projects: join(home, '.claude', 'projects'),
          configFile: join(home, '.claude.json'),
          current: isCurrent,
        }
      : {
          dir,
          configDir: normalizeDir(dir, platform),
          projects: join(dir, 'projects'),
          configFile: join(dir, '.claude.json'),
          current: isCurrent,
        };
  const dirs = [current, undefined, ...others].map((dir) => dir?.trim() || undefined);
  const sources: ClaudeSource[] = [];
  const seen = new Set<string>();
  dirs.forEach((dir, index) => {
    const candidate = source(dir, index === 0);
    const key = normalizeDir(candidate.projects, platform);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(candidate);
  });
  return sources;
}

/** The environment to start Claude Code in for a source. */
export function sourceEnv(
  source: ClaudeSource,
  base: NodeJS.ProcessEnv,
  /** What VS Code's Claude Code starts with: it applies to the current folder. */
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...(source.current && extra) };
  if (source.dir === undefined) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = source.dir;
  return env;
}

/**
 * The account a source is signed in to, from its config file: a cheap look, read again only when
 * the file changed. Undefined when signed out or when there is no such file.
 */
export function signedInAccount(configFile: string): () => Promise<string | undefined> {
  let seen: { mtimeMs: number; size: number; key: string | undefined } | undefined;
  return async () => {
    let mtimeMs: number;
    let size: number;
    try {
      ({ mtimeMs, size } = await stat(configFile));
    } catch {
      seen = undefined;
      return undefined;
    }
    if (seen?.mtimeMs === mtimeMs && seen.size === size) return seen.key;
    try {
      const account = parseConfigAccount(JSON.parse(await readFile(configFile, 'utf8')));
      seen = { mtimeMs, size, key: account && accountKey(account) };
      return seen.key;
    } catch {
      // Caught mid-write: the last answer stands until the file reads whole.
      return seen?.key;
    }
  };
}
