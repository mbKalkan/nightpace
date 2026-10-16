import { describe, expect, it } from 'vitest';
import { requestCost } from '../../src/extension/model/pricing';
import type { TimelineRequest } from '../../src/extension/model/timeline';
import { tokenDetails } from '../../src/extension/model/tokenDetails';
import type { TokenCounts } from '../../src/extension/transcripts/events';

const MILLION = 1_000_000;
const tokens = (overrides: Partial<TokenCounts> = {}): TokenCounts => ({
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
  thinking: 0,
  ...overrides,
});
const request = (time: number, model: string, counts: Partial<TokenCounts>): TimelineRequest => ({
  sessionId: 'a',
  time,
  end: time + 1000,
  model,
  sidechain: false,
  tokens: tokens(counts),
});

describe('requestCost by kind', () => {
  it('prices both kinds of cache writes and the thinking part of output apart', () => {
    // Opus 4.6: $5 input, $25 output per million tokens.
    const cost = requestCost({
      model: 'claude-opus-4-6',
      tokens: tokens({
        cacheWrite5m: MILLION,
        cacheWrite1h: MILLION,
        output: MILLION,
        thinking: MILLION / 2,
      }),
    })!;
    expect(cost.cacheWrite5m).toBeCloseTo(6.25);
    expect(cost.cacheWrite1h).toBeCloseTo(10);
    expect(cost.cacheWrite).toBeCloseTo(16.25);
    expect(cost.thinking).toBeCloseTo(12.5);
    // Thinking is a part of output, not added to it.
    expect(cost.total).toBeCloseTo(16.25 + 25);
  });
});

describe('tokenDetails', () => {
  it('adds up the tokens and cost of each kind within the window', () => {
    const details = tokenDetails(
      [
        request(10, 'claude-opus-4-6', {
          input: MILLION,
          cacheWrite5m: MILLION,
          cacheRead: 10 * MILLION,
          output: MILLION,
          thinking: 200_000,
        }),
        request(20, 'claude-opus-4-6', { cacheWrite1h: MILLION }),
        // Outside the window.
        request(100, 'claude-opus-4-6', { input: MILLION }),
      ],
      0,
      50,
    );
    expect(details.input).toEqual({ tokens: MILLION, cost: 5 });
    expect(details.cacheWrite5m.cost).toBeCloseTo(6.25);
    expect(details.cacheWrite1h.cost).toBeCloseTo(10);
    expect(details.cacheRead).toEqual({ tokens: 10 * MILLION, cost: 5 });
    expect(details.output).toEqual({ tokens: MILLION, cost: 25 });
    expect(details.thinking.tokens).toBe(200_000);
    expect(details.thinking.cost).toBeCloseTo(5);
    // Every cached token as plain input: 13 million at $5, and the output.
    expect(details.uncachedCost).toBeCloseTo(13 * 5 + 25);
  });

  it('counts the tokens of models without a known price, but no cost', () => {
    const details = tokenDetails([request(10, 'some-other-model', { input: 500 })], 0, 50);
    expect(details.input).toEqual({ tokens: 500, cost: 0 });
    expect(details.uncachedCost).toBe(0);
  });
});
