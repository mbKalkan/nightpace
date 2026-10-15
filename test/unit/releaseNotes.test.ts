import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/release-notes.mjs');
const folder = mkdtempSync(join(tmpdir(), 'nightpace-notes-'));
writeFileSync(
  join(folder, 'CHANGELOG.md'),
  [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.2.0] - 2026-11-01',
    '',
    'Scenarios arrive.',
    '',
    '### Added',
    '',
    '- A scenario planner.',
    '',
    '## [0.1.0] - 2026-10-20',
    '',
    'First preview.',
    '',
    '[0.2.0]: https://github.com/mbKalkan/nightpace/compare/v0.1.0...v0.2.0',
    '',
  ].join('\r\n'),
);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const notes = (version: string) =>
  spawnSync(process.execPath, [SCRIPT, version], { cwd: folder, encoding: 'utf8' });

describe('release notes', () => {
  it("print a version's section of the changelog, without its heading or the links", () => {
    expect(notes('v0.2.0').stdout.trim()).toBe(
      'Scenarios arrive.\n\n### Added\n\n- A scenario planner.',
    );
    expect(notes('0.1.0').stdout.trim()).toBe('First preview.');
  });

  it('fail for a version the changelog has no section for', () => {
    const result = notes('0.3.0');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no section for version 0\.3\.0/);
  });
});
