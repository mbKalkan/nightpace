// What a request would cost on Anthropic's API, at its list prices: the price of a Claude Code
// plan's usage had it been paid per token. Prices are per million tokens, in US dollars, from
// https://platform.claude.com/docs/en/about-claude/pricing as of 15 October 2026.
import type { TokenCounts } from '../transcripts/events';

export interface ModelPrice {
  input: number;
  output: number;
  /** Cache reads as a share of `input`: a tenth on most models. */
  cacheRead: number;
  /** Fast mode's input and output prices, on the models that have it. */
  fast?: { input: number; output: number };
  /** Higher prices for a request whose prompt is longer than `tokens`. */
  longPrompt?: { tokens: number; input: number; output: number };
}

/** Cache writes as a share of `input`, on every model. */
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
/** Inference kept in the US. */
const US_ONLY = 1.1;
const PER_WEB_SEARCH = 10 / 1000;

const price = (input: number, output: number, extra: Partial<ModelPrice> = {}): ModelPrice => ({
  input,
  output,
  cacheRead: 0.1,
  ...extra,
});

/** By family and version, as `opus-4.1`; a version without a minor number is `.0`. */
const PRICES: Record<string, ModelPrice> = {
  'fable-5.1': price(10, 50, { cacheRead: 0.025 }),
  'mythos-5.1': price(10, 50, { cacheRead: 0.025 }),
  'fable-5.0': price(10, 50),
  'mythos-5.0': price(10, 50),
  'opus-5.5': price(4, 20, { cacheRead: 0.05, fast: { input: 8, output: 40 } }),
  'opus-5.0': price(5, 25, { fast: { input: 10, output: 50 } }),
  'opus-4.8': price(5, 25, { fast: { input: 10, output: 50 } }),
  'opus-4.7': price(5, 25),
  'opus-4.6': price(5, 25),
  'opus-4.5': price(5, 25),
  'opus-4.1': price(15, 75),
  'opus-4.0': price(15, 75),
  'opus-3.0': price(15, 75),
  'sonnet-5.5': price(2, 10, { cacheRead: 0.05 }),
  'sonnet-5.0': price(2, 10),
  'sonnet-4.6': price(3, 15),
  'sonnet-4.5': price(3, 15),
  'sonnet-4.0': price(3, 15),
  'sonnet-3.7': price(3, 15),
  'sonnet-3.5': price(3, 15),
  'haiku-5.5': price(0.1, 0.5, { longPrompt: { tokens: 100_000, input: 0.5, output: 2.5 } }),
  'haiku-4.5': price(1, 5),
  'haiku-3.5': price(0.8, 4),
  'haiku-3.0': price(0.25, 1.25),
};

const FAMILIES = 'opus|sonnet|haiku|fable|mythos';
/** `claude-opus-4-1-20250805`, `claude-sonnet-4-20250514`, `us.anthropic.claude-opus-5-5-v1:0` */
const CURRENT_ID = new RegExp(`(${FAMILIES})-(\\d+)(?:[-.](\\d)(?!\\d))?`);
/** `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` */
const OLDER_ID = new RegExp(`claude-(\\d)(?:[-.](\\d))?-(${FAMILIES})`);

/** The list price of a model, by the id Claude Code records; none for a model it doesn't know. */
export function priceOf(model: string): ModelPrice | undefined {
  const id = model.toLowerCase();
  const older = OLDER_ID.exec(id);
  const current = older ? undefined : CURRENT_ID.exec(id);
  const [family, major, minor] = older
    ? [older[3], older[1], older[2]]
    : current
      ? [current[1], current[2], current[3]]
      : [];
  if (!family) return undefined;
  return PRICES[`${family}-${major}.${minor ?? '0'}`];
}

export interface PricedRequest {
  model: string;
  fast?: boolean;
  usOnly?: boolean;
  tokens: TokenCounts;
}

/** Cost by token type, in dollars; undefined when the model has no known price. */
export interface RequestCost {
  input: number;
  /** Both kinds of cache writes; the two after it apart. */
  cacheWrite: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  /** Output, with web searches, which come with the answer. */
  output: number;
  /** The thinking part of `output`. */
  thinking: number;
  total: number;
}

export function requestCost({
  model,
  fast,
  usOnly,
  tokens,
}: PricedRequest): RequestCost | undefined {
  const known = priceOf(model);
  if (!known) return undefined;
  const prompt = tokens.input + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;
  const long = known.longPrompt && prompt > known.longPrompt.tokens ? known.longPrompt : undefined;
  const rates = (fast && known.fast) || long || known;
  const scale = (usOnly ? US_ONLY : 1) / 1_000_000;
  const input = tokens.input * rates.input * scale;
  const cacheWrite5m = tokens.cacheWrite5m * CACHE_WRITE_5M * rates.input * scale;
  const cacheWrite1h = tokens.cacheWrite1h * CACHE_WRITE_1H * rates.input * scale;
  const cacheWrite = cacheWrite5m + cacheWrite1h;
  const cacheRead = tokens.cacheRead * known.cacheRead * rates.input * scale;
  const output = tokens.output * rates.output * scale + (tokens.webSearches ?? 0) * PER_WEB_SEARCH;
  const thinking = tokens.thinking * rates.output * scale;
  return {
    input,
    cacheWrite,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead,
    output,
    thinking,
    total: input + cacheWrite + cacheRead + output,
  };
}
