import { describe, expect, it } from 'vitest';
import { priceOf, requestCost } from '../../src/extension/model/pricing';
import type { TokenCounts } from '../../src/extension/transcripts/events';

const tokens = (overrides: Partial<TokenCounts> = {}): TokenCounts => ({
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
  thinking: 0,
  ...overrides,
});
const MILLION = 1_000_000;

describe('priceOf', () => {
  it('knows models by the ids Claude Code and the clouds record', () => {
    expect(priceOf('claude-opus-5-5')).toMatchObject({ input: 4, output: 20, cacheRead: 0.05 });
    expect(priceOf('claude-opus-5-5[1m]')).toMatchObject({ input: 4 });
    expect(priceOf('us.anthropic.claude-opus-5-5-v1:0')).toMatchObject({ input: 4 });
    expect(priceOf('claude-opus-5')).toMatchObject({ input: 5, output: 25 });
    expect(priceOf('claude-fable-5-1')).toMatchObject({ input: 10, cacheRead: 0.025 });
    expect(priceOf('claude-fable-5')).toMatchObject({ input: 10, cacheRead: 0.1 });
    expect(priceOf('claude-opus-4-1-20250805')).toMatchObject({ input: 15, output: 75 });
    expect(priceOf('claude-opus-4-20250514')).toMatchObject({ input: 15 });
    expect(priceOf('claude-sonnet-4-5-20250929')).toMatchObject({ input: 3, output: 15 });
    expect(priceOf('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 });
    expect(priceOf('claude-3-5-haiku-20241022')).toMatchObject({ input: 0.8, output: 4 });
    expect(priceOf('claude-3-7-sonnet-20250219')).toMatchObject({ input: 3 });
  });

  it('leaves models it has no price for unpriced', () => {
    expect(priceOf('claude-opus-9')).toBeUndefined();
    expect(priceOf('gpt-something')).toBeUndefined();
  });
});

describe('requestCost', () => {
  it('prices each token type the way the API bills it', () => {
    const cost = requestCost({
      model: 'claude-sonnet-4-6',
      tokens: tokens({
        input: MILLION,
        cacheWrite5m: MILLION,
        cacheWrite1h: MILLION,
        cacheRead: MILLION,
        output: MILLION,
      }),
    })!;
    expect(cost.input).toBeCloseTo(3);
    expect(cost.cacheWrite).toBeCloseTo(3.75 + 6);
    expect(cost.cacheRead).toBeCloseTo(0.3);
    expect(cost.output).toBeCloseTo(15);
    expect(cost.total).toBeCloseTo(3 + 9.75 + 0.3 + 15);
  });

  it('charges the long-prompt price on Haiku 5.5 above 100,000 prompt tokens', () => {
    const short = requestCost({
      model: 'claude-haiku-5-5',
      tokens: tokens({ cacheRead: 100_000, output: MILLION }),
    })!;
    const long = requestCost({
      model: 'claude-haiku-5-5',
      tokens: tokens({ input: 1, cacheRead: 100_000, output: MILLION }),
    })!;
    expect(short.output).toBeCloseTo(0.5);
    expect(long.output).toBeCloseTo(2.5);
  });

  it('uses fast mode prices only where the model has them', () => {
    const output = tokens({ output: MILLION });
    expect(requestCost({ model: 'claude-opus-5-5', fast: true, tokens: output })!.total).toBe(40);
    expect(requestCost({ model: 'claude-opus-4-6', fast: true, tokens: output })!.total).toBe(25);
  });

  it('has no cost for a model without a known price', () => {
    expect(requestCost({ model: 'claude-opus-9', tokens: tokens({ output: 1 }) })).toBeUndefined();
  });
});
