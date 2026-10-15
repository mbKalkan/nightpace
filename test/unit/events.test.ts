import { describe, expect, it } from 'vitest';
import { parseTranscriptLine } from '../../src/extension/transcripts/events';

const line = (entry: object) => JSON.stringify(entry);

const assistant = (overrides: Record<string, unknown> = {}, message: object = {}) =>
  line({
    type: 'assistant',
    sessionId: 's1',
    timestamp: '2026-10-12T09:00:05.000Z',
    requestId: 'req_1',
    isSidechain: false,
    cwd: '/work/alpha',
    effort: 'xhigh',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'secret answer' }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 1300,
        cache_read_input_tokens: 5000,
        output_tokens: 200,
        output_tokens_details: { thinking_tokens: 50 },
        cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 1000 },
      },
      ...message,
    },
    ...overrides,
  });

describe('parseTranscriptLine', () => {
  it('reads the usage of an assistant line, and nothing of its content', () => {
    const event = parseTranscriptLine(assistant());
    expect(event).toEqual({
      kind: 'usage',
      requestId: 'req_1',
      sessionId: 's1',
      time: Date.UTC(2026, 9, 12, 9, 0, 5),
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      sidechain: false,
      project: '/work/alpha',
      final: true,
      tokens: {
        input: 2,
        cacheWrite5m: 300,
        cacheWrite1h: 1000,
        cacheRead: 5000,
        output: 200,
        thinking: 50,
      },
    });
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('marks a line written while the response was still streaming', () => {
    expect(parseTranscriptLine(assistant({}, { stop_reason: null }))).toMatchObject({
      final: false,
    });
  });

  it('marks subagent requests', () => {
    expect(parseTranscriptLine(assistant({ isSidechain: true }))).toMatchObject({
      sidechain: true,
    });
  });

  it('falls back to the per-turn effort, and to the message id', () => {
    const event = parseTranscriptLine(
      assistant({ effort: undefined, perTurnEffort: 'high', requestId: undefined }),
    );
    expect(event).toMatchObject({ effort: 'high', requestId: 'msg_1' });
  });

  it('counts cache writes without a duration split as 5-minute writes', () => {
    const event = parseTranscriptLine(
      assistant(
        {},
        {
          usage: { input_tokens: 1, cache_creation_input_tokens: 700, output_tokens: 3 },
        },
      ),
    );
    expect(event).toMatchObject({
      tokens: { input: 1, cacheWrite5m: 700, cacheWrite1h: 0, cacheRead: 0, output: 3 },
    });
  });

  it('reads a refused request as the limit it hit', () => {
    const event = parseTranscriptLine(
      assistant(
        {
          error: 'rate_limit',
          apiErrorParams: {
            rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1_791_982_800 },
          },
        },
        { model: '<synthetic>' },
      ),
    );
    expect(event).toEqual({
      kind: 'limit',
      sessionId: 's1',
      time: Date.UTC(2026, 9, 12, 9, 0, 5),
      limit: 'five_hour',
      resetsAt: 1_791_982_800_000,
    });
  });

  it('skips synthetic messages, which made no request', () => {
    expect(parseTranscriptLine(assistant({}, { model: '<synthetic>' }))).toBeUndefined();
  });

  it('skips other lines, broken lines and lines that only quote an assistant line', () => {
    expect(parseTranscriptLine(line({ type: 'user', sessionId: 's1' }))).toBeUndefined();
    expect(parseTranscriptLine('{"type":"assistant","sessionId":')).toBeUndefined();
    expect(parseTranscriptLine(assistant({ timestamp: 'never' }))).toBeUndefined();
    expect(
      parseTranscriptLine(
        line({ type: 'user', message: { content: '{"type":"assistant","sessionId":"x"}' } }),
      ),
    ).toBeUndefined();
  });
});
