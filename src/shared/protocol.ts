// Messages between the extension host and the timeline webview.

export const RANGES = ['24h', '7d', '30d'] as const;
export type RangeKey = (typeof RANGES)[number];

/** Models are grouped by family; the order is the stacking and legend order. */
export const MODEL_FAMILIES = ['opus', 'fable', 'sonnet', 'haiku', 'other'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** Claude Code's effort levels, least first: the stacking and legend order. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** Where requests whose transcript names no effort level are counted. */
export const NO_EFFORT = 'none';

/** What the token lane splits its columns by. */
export type TokenSplit = 'model' | 'effort' | 'type';

/** What the token lane measures: dollars at API list prices, or plain token counts. */
export type TokenMeasure = 'cost' | 'tokens';

/** Kinds of tokens, in stacking order; web searches are billed with `output`. */
export const TOKEN_TYPES = ['input', 'cacheWrite', 'cacheRead', 'output'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** An amount, in dollars or tokens, and how it splits. */
export interface Amounts {
  total: number;
  byModel: Partial<Record<ModelFamily, number>>;
  /** By effort level as Claude Code names it, or `NO_EFFORT`. */
  byEffort: Record<string, number>;
  byType: Partial<Record<TokenType, number>>;
}

/** One quota observation, as Claude Code reported it. Percentages from 0 to 100. */
export interface QuotaPoint {
  time: number;
  fiveHour?: number;
  fiveHourReset?: number;
  weekly?: number;
  weeklyReset?: number;
}

/** From `time` on, `count` sessions were working, until the next step. */
export interface SessionStep {
  time: number;
  count: number;
}

/** Usage within [start, start + bucketMs). */
export interface TokenBucket {
  start: number;
  /** In dollars at API list prices; requests of models without a known price are left out. */
  cost: Amounts;
  tokens: Amounts;
  requests: number;
  /** The most sessions working at once within the bucket. */
  maxSessions: number;
}

/** What one session did within the window shown. */
export interface SessionSummary {
  id: string;
  /** The folder the session ran in, when the transcript says. */
  folder?: string;
  /** Its first request's start and its last request's end within the window. */
  first: number;
  last: number;
  /** Time spent working within the window, subagents' included through their session. */
  active: number;
  requests: number;
  cost: Amounts;
  tokens: Amounts;
}

/** What Claude Code's requests would have cost at API list prices, in dollars. */
export interface Spend {
  /** Since midnight. */
  today: number;
  last7Days: number;
  last30Days: number;
  /** Over the days of the last 30 that had any requests. */
  perActiveDay: number;
  /** Requests of the last 30 days whose model has no known price, so they aren't counted. */
  unpriced: number;
}

export interface TimeWindow {
  from: number;
  to: number;
}

export interface TimelineData {
  range: RangeKey;
  /** The whole range; `from` and `to` lie within it when zoomed in. */
  extent: TimeWindow;
  from: number;
  to: number;
  bucketMs: number;
  /** Observations within the window, plus the last one before and the first one after it. */
  quota: QuotaPoint[];
  /** Steps within the range; the first one starts at `from`. */
  sessions: SessionStep[];
  buckets: TokenBucket[];
  /** The model families that used tokens within the range, in stacking order. */
  models: ModelFamily[];
  /** The effort levels that used tokens within the range, least first, `NO_EFFORT` last. */
  efforts: string[];
  /** Every session that made a request within the window, most cost first. */
  sessionList: SessionSummary[];
  /** Fixed periods up to now, whatever the range shown. */
  spend: Spend;
  /** When Nightpace recorded its first quota snapshot, if ever. */
  recordingSince?: number;
}

/** User-facing text for the webview, translated by the host. */
export interface PanelStrings {
  title: string;
  loading: string;
  empty: string;
  privacy: string;
  ranges: Record<RangeKey, string>;
  rangeLabel: string;
  showTable: string;
  showChart: string;
  quotaLane: string;
  fiveHour: string;
  weekly: string;
  sessionsLane: string;
  sessions: string;
  /** The token lane's title for each measure and split. */
  tokenLanes: Record<TokenMeasure, Record<TokenSplit, string>>;
  noEffort: string;
  splitLabel: string;
  splitByModel: string;
  splitByEffort: string;
  splitByType: string;
  measureLabel: string;
  measures: Record<TokenMeasure, string>;
  /** What the lane's measure means, under the chart. */
  measureNotes: Record<TokenMeasure, string>;
  tokenTypes: Record<TokenType, string>;
  models: Record<ModelFamily, string>;
  spendTitle: string;
  spendToday: string;
  spendLast7Days: string;
  spendLast30Days: string;
  spendPerActiveDay: string;
  /** `{0}`: how many requests. */
  spendUnpriced: string;
  cost: string;
  /** `{0}`: the amount within the window shown. */
  periodTotal: string;
  time: string;
  requests: string;
  noQuotaYet: string;
  /** `{0}`: when recording started. */
  quotaSince: string;
  chartLabel: string;
  breakdownTitle: string;
  bySession: string;
  byProject: string;
  project: string;
  unknownFolder: string;
  started: string;
  active: string;
  tokens: string;
  share: string;
  modelsColumn: string;
  effort: string;
  /** `{0}`: how many rows there are. */
  showAll: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  /** On a row of the table, which zooms the chart to its time. */
  zoomToSession: string;
  zoomToProject: string;
  zoomHint: string;
}

export type HostToWebviewMessage =
  | { type: 'init'; locale: string; strings: PanelStrings }
  | { type: 'timeline'; data: TimelineData };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'range'; range: RangeKey }
  /** Zooms into a part of the range, or back out to the whole of it without a window. */
  | { type: 'zoom'; window?: TimeWindow };
