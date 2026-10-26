import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claudeBinaries } from '../../src/extension/quota/claudeBinary';
import {
  QuotaError,
  requestUsage,
  sdkCommand,
  type Command,
} from '../../src/extension/quota/claudeProcess';
import { parseInitializeAccount } from '../../src/extension/quota/account';
import { parseUsageResponse } from '../../src/extension/quota/snapshot';

const FAKE = resolve('test/fixtures/quota/fake-claude.mjs');
const fake = (): Command => ({ command: process.execPath, args: [FAKE] });

async function withMode<T>(mode: string, run: () => Promise<T>): Promise<T> {
  const before = process.env.FAKE_CLAUDE;
  process.env.FAKE_CLAUDE = mode;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.FAKE_CLAUDE;
    else process.env.FAKE_CLAUDE = before;
  }
}

describe('parseUsageResponse', () => {
  const time = Date.UTC(2026, 9, 15, 11, 0);

  it('reads the five-hour, weekly and per-model limits', () => {
    const snapshot = parseUsageResponse(
      {
        subscription_type: 'team',
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 41, resets_at: '2026-10-15T11:30:00.382961+00:00' },
          seven_day: { utilization: 7.5, resets_at: 1_792_612_800 },
          seven_day_opus: null,
          model_scoped: [
            { display_name: 'Fable', utilization: 0, resets_at: '2026-10-21T20:00:00+00:00' },
            { display_name: 'Broken' },
          ],
          extra_usage: { is_enabled: false },
        },
      },
      time,
    );
    expect(snapshot).toEqual({
      time,
      available: true,
      plan: 'team',
      fiveHour: { percent: 41, resetsAt: Date.parse('2026-10-15T11:30:00.382Z') },
      weekly: { percent: 7.5, resetsAt: 1_792_612_800_000 },
      models: [{ model: 'Fable', percent: 0, resetsAt: Date.UTC(2026, 9, 21, 20) }],
    });
  });

  it('says when no plan limits apply', () => {
    expect(parseUsageResponse({ rate_limits_available: false, rate_limits: null }, time)).toEqual({
      time,
      available: false,
      models: [],
    });
  });

  it('leaves out windows it does not understand', () => {
    const snapshot = parseUsageResponse(
      { rate_limits: { five_hour: { utilization: 'high' }, seven_day: { utilization: 130 } } },
      time,
    );
    expect(snapshot).toEqual({ time, available: true, models: [], weekly: { percent: 100 } });
  });

  it('reads nothing from something that is not a reply', () => {
    expect(parseUsageResponse(null, time)).toBeUndefined();
    expect(parseUsageResponse([1], time)).toBeUndefined();
  });
});

describe('requestUsage', () => {
  it("returns the reply's payload, reassembled from the pipe", async () => {
    const { usage } = await requestUsage(fake());
    expect(parseUsageResponse(usage, 0)).toMatchObject({
      plan: 'max',
      fiveHour: { percent: 41 },
      weekly: { percent: 7 },
      models: [{ model: 'Fable', percent: 2 }],
    });
  });

  it('names the account that answered, from the same process', async () => {
    const { init } = await requestUsage(fake(), {
      env: { ...process.env, FAKE_CLAUDE_EMAIL: 'Work@Example.com', CLAUDE_CONFIG_DIR: 'Acme' },
    });
    expect(parseInitializeAccount(init)).toEqual({
      email: 'Work@Example.com',
      organization: 'Acme',
    });
  });

  it('still gives the usage when an older Claude Code refuses initialize', async () => {
    await withMode('old', async () => {
      const reply = await requestUsage(fake());
      expect(reply.init).toBeUndefined();
      expect(parseUsageResponse(reply.usage, 0)).toMatchObject({ fiveHour: { percent: 41 } });
    });
  });

  it('keeps the usage when initialize gets no answer', async () => {
    await withMode('noinit', async () => {
      const short = await requestUsage(fake(), { timeoutMs: 400 });
      expect(short.init).toBeUndefined();
      expect(parseUsageResponse(short.usage, 0)).toMatchObject({ fiveHour: { percent: 41 } });
      const graced = await requestUsage(fake());
      expect(parseUsageResponse(graced.usage, 0)).toMatchObject({ fiveHour: { percent: 41 } });
    });
  });

  it('fails when Claude Code refuses the request', async () => {
    await withMode('refuse', async () => {
      const error = await requestUsage(fake()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QuotaError);
      expect(error).toMatchObject({ reason: 'refused', message: /Unsupported/ });
    });
  });

  it('gives up when there is no reply in time', async () => {
    await withMode('silent', async () => {
      await expect(requestUsage(fake(), { timeoutMs: 300 })).rejects.toMatchObject({
        reason: 'timeout',
      });
    });
  });

  it('fails when Claude Code exits without answering', async () => {
    await withMode('crash', async () => {
      await expect(requestUsage(fake())).rejects.toMatchObject({
        reason: 'exited',
        message: /Not logged in/,
      });
    });
  });

  it('fails when Claude Code is not there', async () => {
    await expect(
      requestUsage({ command: join(tmpdir(), 'no-claude-here'), args: [] }),
    ).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('runs Claude Code in SDK mode without a session on disk or MCP servers', () => {
    const { command, args } = sdkCommand('/bin/claude');
    expect(command).toBe('/bin/claude');
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--input-format',
        '--output-format',
      ]),
    );
  });
});

describe('claudeBinaries', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nightpace-bin-'));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const file = (...parts: string[]) => {
    const path = join(folder, ...parts);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
    return path;
  };

  it("prefers the Claude Code extension's own copy, then the PATH", () => {
    const bundled = file('ext', 'resources', 'native-binary', 'claude.exe');
    const onPath = file('bin', 'claude.exe');
    const found = claudeBinaries({
      platform: 'win32',
      claudeExtensionPath: join(folder, 'ext'),
      path: [join(folder, 'missing'), join(folder, 'bin'), join(folder, 'bin')].join(';'),
    });
    expect(found).toEqual([bundled, onPath]);
  });

  it('looks for claude without an extension elsewhere, with the PATH separator of the platform', () => {
    // Drive letters make the Linux separator meaningless for Windows paths, so test what runs.
    const windows = process.platform === 'win32';
    const onPath = file('unix', windows ? 'claude.exe' : 'claude');
    const path = `${windows ? ';' : ':'}${join(folder, 'unix')}`;
    expect(claudeBinaries({ platform: windows ? 'win32' : 'linux', path })).toEqual([onPath]);
  });

  it('finds nothing when Claude Code is not installed', () => {
    expect(claudeBinaries({ platform: 'linux', path: join(folder, 'missing') })).toEqual([]);
  });
});
