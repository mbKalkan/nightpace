import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const manifest = readJson('package.json') as {
  engines: { vscode: string };
  extensionKind: string[];
  contributes: { commands: { command: string }[] };
  keywords: string[];
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
};

describe('extension manifest', () => {
  it('targets the same VS Code API version as @types/vscode', () => {
    const engine = manifest.engines.vscode.replace(/^\^/, '');
    const types = manifest.devDependencies['@types/vscode'].replace(/^[\^~]/, '');
    expect(types).toBe(engine);
  });

  it('runs where Claude Code runs, next to its logs', () => {
    expect(manifest.extensionKind).toEqual(['workspace']);
  });

  it('registers every command it contributes', () => {
    const source = readFileSync('src/extension/extension.ts', 'utf8');
    for (const { command } of manifest.contributes.commands) {
      expect(source, command).toContain(`'${command}'`);
    }
  });

  it('stays within the Marketplace limit of 30 keywords', () => {
    expect(manifest.keywords.length).toBeLessThanOrEqual(30);
    expect(new Set(manifest.keywords).size).toBe(manifest.keywords.length);
  });

  it('defines every %placeholder% in each package.nls file', () => {
    const placeholders = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    expect(placeholders.length).toBeGreaterThan(0);
    for (const file of ['package.nls.json', 'package.nls.tr.json']) {
      const nls = readJson(file);
      for (const key of placeholders) {
        expect(nls, `${file} is missing "${key}"`).toHaveProperty([key]);
      }
    }
  });

  it('keeps the English and Turkish manifest strings in sync', () => {
    const en = Object.keys(readJson('package.nls.json')).sort();
    const tr = Object.keys(readJson('package.nls.tr.json')).sort();
    expect(tr).toEqual(en);
  });
});
