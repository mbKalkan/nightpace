// Messages between the extension host and the timeline webview.

export const RANGES = ['24h', '7d', '30d'] as const;
export type RangeKey = (typeof RANGES)[number];

/** Models are grouped by family; the order is the stacking and legend order. */
export const MODEL_FAMILIES = ['opus', 'fable', 'sonnet', 'haiku', 'other'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

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

/** Token use within [start, start + bucketMs), weighted the way API prices weigh it. */
export interface TokenBucket {
  start: number;
  byModel: Partial<Record<ModelFamily, number>>;
  requests: number;
  /** The most sessions working at once within the bucket. */
  maxSessions: number;
}

export interface TimelineData {
  range: RangeKey;
  from: number;
  to: number;
  bucketMs: number;
  /** Observations within the range, plus the last one before it. */
  quota: QuotaPoint[];
  /** Steps within the range; the first one starts at `from`. */
  sessions: SessionStep[];
  buckets: TokenBucket[];
  /** The model families that used tokens within the range, in stacking order. */
  models: ModelFamily[];
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
  tokensLane: string;
  tokensNote: string;
  models: Record<ModelFamily, string>;
  time: string;
  requests: string;
  noQuotaYet: string;
  /** `{0}`: when recording started. */
  quotaSince: string;
  chartLabel: string;
}

export type HostToWebviewMessage =
  | { type: 'init'; locale: string; strings: PanelStrings }
  | { type: 'timeline'; data: TimelineData };

export type WebviewToHostMessage = { type: 'ready' } | { type: 'range'; range: RangeKey };
