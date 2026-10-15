// Writes synthetic Claude Code transcripts to test/fixtures/claude/projects. They have the shape
// of real ones (the line types, ids, usage fields and their quirks) and made-up content.
// Usage: node scripts/gen-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = 'test/fixtures/claude/projects';
const VERSION = '2.1.300';

const at = (minutes, seconds = 0) =>
  new Date(Date.UTC(2026, 9, 12, 9, minutes, seconds)).toISOString();

let uuid = 0;
const nextUuid = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;

const common = (session, cwd, time, extra = {}) => ({
  parentUuid: null,
  isSidechain: false,
  userType: 'external',
  entrypoint: 'claude-vscode',
  cwd,
  sessionId: session,
  version: VERSION,
  gitBranch: 'main',
  uuid: nextUuid(),
  timestamp: time,
  ...extra,
});

const usage = ({ input = 2, cw5m = 0, cw1h = 0, read = 0, out, thinking = 0 }) => ({
  input_tokens: input,
  cache_creation_input_tokens: cw5m + cw1h,
  cache_read_input_tokens: read,
  output_tokens: out,
  output_tokens_details: { thinking_tokens: thinking },
  service_tier: 'standard',
  cache_creation: { ephemeral_1h_input_tokens: cw1h, ephemeral_5m_input_tokens: cw5m },
  speed: 'standard',
});

/** One line of an assistant response: a content block plus the usage so far. */
const assistant = ({ session, cwd, time, requestId, model, effort, block, stop, use, extra }) => ({
  ...common(session, cwd, time, extra),
  type: 'assistant',
  requestId,
  requestedModel: model,
  effort,
  perTurnEffort: effort,
  message: {
    model,
    id: `msg_${requestId}`,
    type: 'message',
    role: 'assistant',
    content: [block],
    stop_reason: stop,
    stop_sequence: null,
    usage: use,
  },
});

const thinking = { type: 'thinking', thinking: '', signature: 'c2lnbmF0dXJl' };
const toolUse = {
  type: 'tool_use',
  id: 'toolu_01',
  name: 'Bash',
  input: { command: 'echo "{\\"type\\":\\"assistant\\"}"', description: 'Print a line' },
};
const text = (words) => ({ type: 'text', text: words });

const user = (session, cwd, time, words) => ({
  ...common(session, cwd, time),
  type: 'user',
  promptId: nextUuid(),
  // A prompt that quotes a transcript line: its marker is escaped, so it is never parsed.
  message: { role: 'user', content: [text(words)] },
});

const files = {};
const write = (path, lines) => (files[path] = lines.map((line) => JSON.stringify(line)));

// Project alpha: a main session with a streamed response, a refused request and a subagent.
{
  const session = 'aaaaaaaa-0000-4000-8000-000000000001';
  const cwd = '/work/alpha';
  const base = { session, cwd, model: 'claude-opus-5-5', effort: 'xhigh' };
  const r1 = usage({ cw1h: 1000, read: 5000, out: 200, thinking: 50 });
  const r2 = (out) => usage({ cw1h: 300, read: 6000, out, thinking: 120 });
  write(`-work-alpha/${session}.jsonl`, [
    { type: 'queue-operation', operation: 'enqueue', timestamp: at(0), sessionId: session },
    user(session, cwd, at(0), 'Explain {"type":"assistant"} lines, please.'),
    {
      type: 'api-request-blob',
      sessionId: session,
      hash: 'f'.repeat(64),
      message: { role: 'system', content: [text('x'.repeat(100_000))] },
    },
    // r1: two content blocks, the same final usage on both lines.
    assistant({
      ...base,
      time: at(0, 5),
      requestId: 'req_r1',
      block: thinking,
      stop: 'tool_use',
      use: r1,
    }),
    assistant({
      ...base,
      time: at(0, 6),
      requestId: 'req_r1',
      block: toolUse,
      stop: 'tool_use',
      use: r1,
    }),
    // r2: streamed; the first lines carry the output count so far.
    assistant({
      ...base,
      time: at(1),
      requestId: 'req_r2',
      block: thinking,
      stop: null,
      use: r2(10),
    }),
    assistant({
      ...base,
      time: at(1, 1),
      requestId: 'req_r2',
      block: thinking,
      stop: null,
      use: r2(10),
    }),
    assistant({
      ...base,
      time: at(1, 9),
      requestId: 'req_r2',
      block: text('Done.'),
      stop: 'end_turn',
      use: r2(400),
    }),
    // A request refused at the five-hour limit, written as a synthetic message.
    {
      ...common(session, cwd, at(2)),
      type: 'assistant',
      requestId: 'req_refused',
      message: {
        id: nextUuid(),
        model: '<synthetic>',
        role: 'assistant',
        type: 'message',
        stop_reason: 'stop_sequence',
        content: [text("You've hit your session limit")],
        usage: usage({ input: 0, out: 0 }),
      },
      apiError: 'usage_limit_reached',
      apiErrorParams: {
        rate_limit_info: {
          status: 'rejected',
          resetsAt: Date.UTC(2026, 9, 12, 11, 0) / 1000,
          rateLimitType: 'five_hour',
        },
      },
      error: 'rate_limit',
      isApiErrorMessage: true,
      apiErrorStatus: 429,
      perTurnEffort: 'xhigh',
    },
    { type: 'last-prompt', lastPrompt: 'Explain…', leafUuid: nextUuid(), sessionId: session },
  ]);
  // r3: a subagent's request; its transcript keeps only the first, unfinished count.
  write(`-work-alpha/${session}/subagents/agent-a0000000000000001.jsonl`, [
    assistant({
      ...base,
      time: at(0, 30),
      requestId: 'req_r3',
      block: thinking,
      stop: null,
      use: usage({ cw5m: 3000, out: 8 }),
      extra: { isSidechain: true, agentId: 'a0000000000000001' },
    }),
  ]);
}

// Project beta: another session at the same time, on an older Claude Code that didn't split cache
// writes by duration, which also copied r1 when it was forked from the alpha session.
{
  const session = 'bbbbbbbb-0000-4000-8000-000000000002';
  const cwd = '/work/beta';
  const r4 = usage({ cw5m: 700, read: 900, out: 50 });
  delete r4.cache_creation;
  delete r4.output_tokens_details;
  write(`-work-beta/${session}.jsonl`, [
    user(session, cwd, at(0, 40), 'Hello'),
    assistant({
      session,
      cwd: '/work/alpha',
      time: at(0, 5),
      requestId: 'req_r1',
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      block: thinking,
      stop: 'tool_use',
      use: usage({ cw1h: 1000, read: 5000, out: 200, thinking: 50 }),
    }),
    assistant({
      session,
      cwd,
      time: at(0, 45),
      requestId: 'req_r4',
      model: 'claude-sonnet-5-5',
      effort: 'high',
      block: text('Hi.'),
      stop: 'end_turn',
      use: r4,
    }),
  ]);
}

rmSync(ROOT, { recursive: true, force: true });
for (const [path, lines] of Object.entries(files)) {
  const file = join(ROOT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join('\n') + '\n');
}
console.log(`Wrote ${Object.keys(files).length} transcripts to ${ROOT}`);
