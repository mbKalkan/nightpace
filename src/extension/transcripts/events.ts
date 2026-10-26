// Turns one line of a Claude Code transcript into the usage facts Nightpace keeps. Only metadata
// is read: times, ids, model, effort and token counts. Message text, tool input and output are
// parsed along with the line (JSON has no partial parse) but never copied out.

export interface TokenCounts {
  input: number;
  /** Prompt cache writes kept for 5 minutes, billed at 1.25× input. */
  cacheWrite5m: number;
  /** Prompt cache writes kept for 1 hour, billed at 2× input. */
  cacheWrite1h: number;
  cacheRead: number;
  /** Output, thinking included. */
  output: number;
  /** The thinking part of `output`, when Claude Code reports it. */
  thinking: number;
  /** Web searches, which the API bills per search rather than by tokens. */
  webSearches?: number;
}

export interface UsageEvent {
  kind: 'usage';
  /** One API request; Claude Code writes it as several lines, one per content block. */
  requestId: string;
  sessionId: string;
  /** Milliseconds since the epoch. */
  time: number;
  model: string;
  effort?: string;
  /** Made by a subagent rather than the main conversation. */
  sidechain: boolean;
  /** The folder the session ran in. */
  project?: string;
  /** False while the response was still streaming: the output count is not final yet. */
  final: boolean;
  /** Fast mode, which the API bills at a premium. */
  fast?: true;
  /** Inference kept in the US, which the API bills at 1.1 times. */
  usOnly?: true;
  tokens: TokenCounts;
  /**
   * The Claude Code config folder its transcript is in (`CLAUDE_CONFIG_DIR`); none for the
   * default one. Set by the reader of the folder, not from the line.
   */
  configDir?: string;
}

/** A request refused because a plan limit was reached. */
export interface LimitEvent {
  kind: 'limit';
  sessionId: string;
  time: number;
  /** As Claude Code names it: `five_hour`, `seven_day`, `seven_day_opus`, … */
  limit: string;
  /** When the limit resets, in milliseconds since the epoch. */
  resetsAt?: number;
}

export type TranscriptEvent = UsageEvent | LimitEvent;

/** Text every line worth parsing contains, to skip the rest without decoding them. */
export const ASSISTANT_MARKER = '"type":"assistant"';

/** Lines Claude Code writes for errors and interruptions, with no real request behind them. */
const SYNTHETIC_MODEL = '<synthetic>';

export function parseTranscriptLine(line: string): TranscriptEvent | undefined {
  if (!line.includes(ASSISTANT_MARKER)) return undefined;
  let entry: TranscriptLine;
  try {
    entry = JSON.parse(line) as TranscriptLine;
  } catch {
    return undefined;
  }
  if (entry.type !== 'assistant' || typeof entry.sessionId !== 'string') return undefined;
  const time = Date.parse(entry.timestamp ?? '');
  if (!Number.isFinite(time)) return undefined;

  const info = entry.apiErrorParams?.rate_limit_info ?? entry.quotaLimits;
  if (entry.error === 'rate_limit' && info?.rateLimitType) {
    return {
      kind: 'limit',
      sessionId: entry.sessionId,
      time,
      limit: info.rateLimitType,
      resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined,
    };
  }

  const message = entry.message;
  const usage = message?.usage;
  const model = message?.model;
  const requestId = entry.requestId ?? message?.id;
  if (!usage || !model || model === SYNTHETIC_MODEL || typeof requestId !== 'string') {
    return undefined;
  }
  return {
    kind: 'usage',
    requestId,
    sessionId: entry.sessionId,
    time,
    model,
    effort: entry.effort ?? entry.perTurnEffort ?? undefined,
    sidechain: entry.isSidechain === true,
    project: typeof entry.cwd === 'string' ? entry.cwd : undefined,
    final: message.stop_reason !== null && message.stop_reason !== undefined,
    ...(usage.speed === 'fast' && { fast: true }),
    ...(usage.inference_geo === 'us' && { usOnly: true }),
    tokens: tokenCounts(usage),
  };
}

function tokenCounts(usage: Usage): TokenCounts {
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const split = usage.cache_creation;
  // Older Claude Code versions report cache writes without the split; they were all 5-minute.
  const cacheWrite1h = split ? count(split.ephemeral_1h_input_tokens) : 0;
  const cacheWrite5m = split ? count(split.ephemeral_5m_input_tokens) : cacheWrite;
  const webSearches = count(usage.server_tool_use?.web_search_requests);
  return {
    input: count(usage.input_tokens),
    cacheWrite5m,
    cacheWrite1h,
    cacheRead: count(usage.cache_read_input_tokens),
    output: count(usage.output_tokens),
    thinking: count(usage.output_tokens_details?.thinking_tokens),
    ...(webSearches > 0 && { webSearches }),
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The parts of a transcript line Nightpace reads. */
interface TranscriptLine {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  requestId?: string;
  isSidechain?: boolean;
  cwd?: string;
  effort?: string | null;
  perTurnEffort?: string | null;
  error?: string;
  apiErrorParams?: { rate_limit_info?: RateLimitInfo };
  quotaLimits?: RateLimitInfo;
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string | null;
    usage?: Usage;
  };
}

interface RateLimitInfo {
  rateLimitType?: string;
  resetsAt?: number;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens_details?: { thinking_tokens?: number } | null;
  server_tool_use?: { web_search_requests?: number } | null;
  speed?: string;
  inference_geo?: string;
}
