import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

export interface Command {
  command: string;
  args: string[];
}

/**
 * Claude Code in its SDK mode, as quiet as it gets while still signed in: no project settings
 * or hooks from a real folder (it runs in the temp folder, with project settings only), no MCP
 * servers, and no session written to disk. No prompt is ever sent, so no model is called.
 */
export function sdkCommand(binary: string): Command {
  return {
    command: binary,
    args: [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources',
      'project',
    ],
  };
}

export type QuotaErrorReason = 'not-found' | 'timeout' | 'refused' | 'exited';

export class QuotaError extends Error {
  constructor(
    readonly reason: QuotaErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

export interface UsageReply {
  /** The payload of the `get_usage` reply. */
  usage: unknown;
  /** The payload of the `initialize` reply, which names the account; none if it never came. */
  init?: unknown;
}

export interface RequestOptions {
  timeoutMs?: number;
  cwd?: string;
  /** The environment to start Claude Code in, such as another `CLAUDE_CONFIG_DIR`. */
  env?: NodeJS.ProcessEnv;
}

/** How long a reply to `initialize` is waited for once the usage has come. */
const INIT_GRACE_MS = 2_000;

/**
 * Asks Claude Code for the plan usage of the signed-in account, with the `initialize` and
 * `get_usage` control requests its VS Code extension uses. Claude Code contacts Anthropic itself,
 * as it does for its own usage view; Nightpace sees only the replies. The account comes from
 * `initialize`, so the usage and the account are those of the same process; an older Claude Code
 * that doesn't name it still gives the usage.
 */
export function requestUsage(
  { command, args }: Command,
  { timeoutMs = 30_000, cwd = tmpdir(), env }: RequestOptions = {},
): Promise<UsageReply> {
  const id = randomUUID();
  const initId = `nightpace-init-${id}`;
  const usageId = `nightpace-usage-${id}`;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    let init: { payload?: unknown } | undefined;
    let usage: { payload: unknown } | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (error: QuotaError | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else
        resolve({
          usage: usage?.payload,
          ...(init?.payload !== undefined && { init: init.payload }),
        });
    };
    const timer = setTimeout(
      () => finish(new QuotaError('timeout', `No reply from Claude Code in ${timeoutMs} ms`)),
      timeoutMs,
    );

    child.on('error', (error: NodeJS.ErrnoException) =>
      finish(new QuotaError(error.code === 'ENOENT' ? 'not-found' : 'exited', error.message)),
    );
    // 'close' rather than 'exit': a reply written just before exiting is still read first.
    child.on('close', (code) =>
      usage
        ? finish(undefined)
        : finish(
            new QuotaError(
              'exited',
              `Claude Code exited (${code}): ${stderr.trim().slice(0, 300)}`,
            ),
          ),
    );
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < 4096) stderr += data.toString();
    });
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      let newline: number;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        const reply = controlResponse(line, [initId, usageId]);
        if (!reply) continue;
        if (reply.request_id === initId) {
          // Refused by an older Claude Code: the usage still counts, without an account.
          init = { payload: reply.subtype === 'success' ? reply.response : undefined };
        } else if (reply.subtype === 'success') {
          usage = { payload: reply.response };
        } else {
          finish(new QuotaError('refused', reply.error ?? 'Claude Code refused the request'));
          return;
        }
        if (usage && init) finish(undefined);
        else if (usage) grace ??= setTimeout(() => finish(undefined), INIT_GRACE_MS);
      }
    });
    child.stdin.on('error', () => {
      // Exited before reading the requests; the exit handler reports it.
    });
    child.stdin.write(
      [
        { request_id: initId, request: { subtype: 'initialize' } },
        { request_id: usageId, request: { subtype: 'get_usage' } },
      ]
        .map((request) => JSON.stringify({ type: 'control_request', ...request }) + '\n')
        .join(''),
    );
  });
}

interface ControlResponse {
  request_id?: string;
  subtype?: string;
  error?: string;
  response?: unknown;
}

function controlResponse(line: string, ids: readonly string[]): ControlResponse | undefined {
  if (!ids.some((id) => line.includes(id))) return undefined;
  try {
    const message = JSON.parse(line) as { type?: string; response?: ControlResponse };
    const id = message.response?.request_id;
    if (message.type !== 'control_response' || id === undefined || !ids.includes(id)) {
      return undefined;
    }
    return message.response;
  } catch {
    return undefined;
  }
}
