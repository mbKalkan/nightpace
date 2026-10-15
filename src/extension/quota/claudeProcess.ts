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

/**
 * Asks Claude Code for the plan usage of the signed-in account, with the `get_usage` control
 * request its VS Code extension uses. Claude Code contacts Anthropic itself, as it does for its
 * own usage view; Nightpace sees only the reply. Resolves with the reply's payload.
 */
export function requestUsage(
  { command, args }: Command,
  { timeoutMs = 30_000, cwd = tmpdir() } = {},
): Promise<unknown> {
  const requestId = `nightpace-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (error: QuotaError | undefined, payload?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(payload);
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
      finish(
        new QuotaError('exited', `Claude Code exited (${code}): ${stderr.trim().slice(0, 300)}`),
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
        const reply = controlResponse(line, requestId);
        if (!reply) continue;
        if (reply.subtype === 'success') finish(undefined, reply.response);
        else finish(new QuotaError('refused', reply.error ?? 'Claude Code refused the request'));
      }
    });
    child.stdin.on('error', () => {
      // Exited before reading the request; the exit handler reports it.
    });
    child.stdin.write(
      JSON.stringify({
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'get_usage' },
      }) + '\n',
    );
  });
}

interface ControlResponse {
  subtype?: string;
  error?: string;
  response?: unknown;
}

function controlResponse(line: string, requestId: string): ControlResponse | undefined {
  if (!line.includes(requestId)) return undefined;
  try {
    const message = JSON.parse(line) as {
      type?: string;
      response?: ControlResponse & { request_id?: string };
    };
    if (message.type !== 'control_response' || message.response?.request_id !== requestId) {
      return undefined;
    }
    return message.response;
  } catch {
    return undefined;
  }
}
