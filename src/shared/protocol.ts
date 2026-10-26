// Messages between the extension host and the timeline webview.

/** `week`: one quota week, from the weekly limit's reset to the next. */
export const RANGES = ['24h', '7d', '30d', 'week'] as const;
export type RangeKey = (typeof RANGES)[number];

/** How many quota weeks before this one can be shown. */
export const WEEKS_BACK = 4;

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

/** Kinds of tokens as Claude Code counts them, in the order the token details list them. */
export const TOKEN_DETAILS = [
  'input',
  'cacheWrite5m',
  'cacheWrite1h',
  'cacheRead',
  'output',
] as const;
export type TokenDetailKey = (typeof TOKEN_DETAILS)[number];

/** Tokens of one kind, and what they would have cost at API list prices, in dollars. */
export interface TokenDetail {
  tokens: number;
  cost: number;
}

/** The tokens of the requests within the window shown, by kind. */
export type TokenDetails = Record<TokenDetailKey, TokenDetail> & {
  /** The thinking part of `output`, when Claude Code reports it. */
  thinking: TokenDetail;
  /** What the same requests would have cost with every cached token sent as plain input. */
  uncachedCost: number;
};

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

/** When Claude Code refused a request because a plan limit ran out. */
export interface LimitHit {
  time: number;
  limit: 'fiveHour' | 'weekly';
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

/** The most sessions working at once the 5-hour plan looks at. */
export const PLANNED_SESSIONS = 5;

/** What a session of one model and effort level costs an hour of work, at API prices. */
export interface SessionRate {
  family: ModelFamily;
  effort: string;
  costPerHour: number;
  /** The hours of work it was measured over. */
  hours: number;
}

/** A stretch of a limit's window with the percent a dollar used over it. */
export interface RatePoint {
  from: number;
  to: number;
  perDollar: number;
}

/** The weekly limit ahead, at the pace of the last 7 days. */
export interface WeekForecast {
  /** Percent used now: the last reading and the cost of the requests since. */
  used: number;
  resetsAt: number;
  /** Percent a day at the pace of the last 7 days. */
  pace: number;
  /** When the limit runs out at that pace; none when it lasts to the reset. */
  runsOut?: number;
  /** The percent at the reset at that pace; over 100 when it runs out first. */
  atReset: number;
  /** Percent a day that lasts until the reset. */
  budget: number;
  /** For each session rate, the hours a day of one such session that the budget pays for. */
  budgetHours: number[];
}

/** The 5-hour window ahead, with one to `PLANNED_SESSIONS` sessions working at once. */
export interface WindowForecast {
  used: number;
  /** When the window resets; none while no window is open, as the next request opens one. */
  resetsAt?: number;
  /**
   * For each session rate and each number of sessions at once, the milliseconds until a limit
   * runs out: the 5-hour one in this window or the next, or the weekly one if it comes first;
   * null when work lasts through the next window too.
   */
  lasts: Array<Array<number | null>>;
}

/**
 * How the plan's limits follow API cost, measured from this machine's own quota readings, and
 * what that says about the week and the 5-hour window ahead. Every figure here is estimated.
 */
export interface Pace {
  /** When the figures were worked out. */
  now: number;
  /** While there are too few readings to trust the measure: the figures are rough. */
  learning: boolean;
  /** Percent of each limit a dollar of API cost uses. */
  fiveHourPerDollar: number;
  weeklyPerDollar: number;
  /** The kinds of session worked most in the last 14 days, most hours first. */
  rates: SessionRate[];
  /** The percent a dollar used, stretch by stretch over the last 28 days, oldest first. */
  history: { weekly: RatePoint[]; fiveHour: RatePoint[] };
  week: WeekForecast;
  window: WindowForecast;
}

export interface TimeWindow {
  from: number;
  to: number;
}

/** The quota week shown, from the weekly limit's reset to the next. */
export interface QuotaWeek extends TimeWindow {
  /** 0 for this week, -1 for the one before, and so on. */
  offset: number;
  /** The earliest offset with requests to show, down to `-WEEKS_BACK`. */
  oldest: number;
}

/** One day of a quota week, counted from its reset. */
export interface WeekDay extends TimeWindow {
  /** Percent of the weekly limit used within the day, up to now; none for a day still ahead. */
  used?: number;
  /** Whether `used` is worked out from API cost rather than read from the quota. */
  estimated: boolean;
  /** What the rest of the day can take for the week to last to its reset, from now on. */
  canTake?: number;
  /** API cost of the day's requests, up to now. */
  cost: number;
}

/** A Claude account the panel can show, each with its own quota. */
export interface AccountOption {
  /** Names it in messages; not shown. */
  key: string;
  email: string;
  organization?: string;
  /** `pro`, `max`, `team`, … as Claude Code reports it. */
  plan?: string;
  /** Claude Code in VS Code is signed in to it now. */
  current: boolean;
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
  /**
   * Before the first reading, the quota worked out from the requests' API cost at the measured
   * rates; none without a measure or before the first full week of requests.
   */
  quotaEstimate?: QuotaPoint[];
  /** When a limit ran out within the window, as Claude Code logged it. */
  limitHits: LimitHit[];
  /**
   * The weekly quota's resets within the window, a week apart from the last one Claude Code
   * reported; the columns are counted from them. Empty before any quota reading.
   */
  weeklyResets: number[];
  /** Steps within the range; the first one starts at `from`. */
  sessions: SessionStep[];
  buckets: TokenBucket[];
  /** The model families that used tokens within the range, in stacking order. */
  models: ModelFamily[];
  /** The effort levels that used tokens within the range, least first, `NO_EFFORT` last. */
  efforts: string[];
  /** Every session that made a request within the window, most cost first. */
  sessionList: SessionSummary[];
  tokenDetails: TokenDetails;
  /** Fixed periods up to now, whatever the range shown. */
  spend: Spend;
  /** Where the plan's limits are heading; none until a reading with both limits is recorded. */
  pace?: Pace;
  /** The quota week in focus: the one shown in the `week` range, this one otherwise. */
  week: QuotaWeek;
  /**
   * The weekly limit a day at a time over the quota weeks the window touches, with this week's
   * days ahead when it reaches now; none until the quota has been measured.
   */
  days?: WeekDay[];
  /** When Nightpace recorded its first quota snapshot, if ever. */
  recordingSince?: number;
  /**
   * The accounts Nightpace has seen, when there is more than one; everything above is the chosen
   * one's alone.
   */
  accounts?: AccountOption[];
  /** The key of the account shown, among `accounts`. */
  account?: string;
}

/** User-facing text for the webview, translated by the host. */
export interface PanelStrings {
  title: string;
  /** The label of the account chooser. */
  account: string;
  /** `{0}`: an account, the one Claude Code is signed in to now. */
  accountSignedIn: string;
  loading: string;
  empty: string;
  privacy: string;
  ranges: Record<RangeKey, string>;
  rangeLabel: string;
  previousWeek: string;
  nextWeek: string;
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
  weeklyReset: string;
  /** Where Nightpace wasn't running and the quota can't be worked out. */
  notRecorded: string;
  /** Quota worked out from API cost: before the first reading, and the week ahead. */
  estimated: string;
  /** `{0}`: a series, like `Weekly`. */
  estimatedLabel: string;
  /** Under the chart, what the dashed quota is. */
  estimateNote: string;
  /** After it, when an estimated week starts again from zero before its reset. */
  estimateResetNote: string;
  /** Where Claude Code logged that a limit ran out. */
  limitReached: string;
  /** `{0}`: a series, like `Weekly`. */
  limitReachedAt: string;
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
  tokenDetailsTitle: string;
  type: string;
  tokenDetails: Record<TokenDetailKey, string>;
  thinking: string;
  total: string;
  shareOfTokens: string;
  shareOfCost: string;
  /** The share of prompt tokens read from the cache. */
  cacheReadShare: string;
  /** What caching saved at API prices. */
  cacheSaved: string;
  /** What the requests would have cost at API prices without the cache. */
  uncachedCost: string;
  /** The column of the share of prompt tokens read from the cache. */
  fromCache: string;
  weekTitle: string;
  windowTitle: string;
  learning: string;
  learningHint: string;
  used: string;
  resets: string;
  timeLeft: string;
  /** Instead of a reset time while no 5-hour window is open. */
  windowClosed: string;
  runsOutAtPace: string;
  atResetAtPace: string;
  /** `{0}`: percent a day. */
  paceNote: string;
  /** `{0}`: percent a day. */
  budgetCaption: string;
  /** In the week's last day: `{0}`: percent left. */
  budgetLeftCaption: string;
  /** In place of more than 24 hours a day. */
  allDay: string;
  /** `{0}`: a kind of session, like `Opus xhigh`; `{1}`: percent of the window an hour. */
  rateNote: string;
  /** The week runs out before the reset whatever you do. */
  budgetSpent: string;
  lastsCaption: string;
  sessionsAtOnce: string;
  lasts: string;
  /** `{0}`: cost an hour; `{1}`: hours measured; `{2}` and `{3}`: percent of the window and week an hour. */
  rateHint: string;
  /** `{0}`: a kind of session, like `Opus xhigh`. */
  trendTitle: string;
  /** `{0}`: dollars that use 1% of the limit. */
  trendEstimate: string;
  trendHint: string;
  /** `{0}`: when; `{1}`: a kind of session; `{2}`: percent of the limit an hour; `{3}`: 1% in dollars. */
  trendPoint: string;
  trendEmpty: string;
  /** Without a kind of session to measure an hour of: what 1% of the limit is, over time. */
  trendCostTitle: string;
  /** `{0}`: when; `{1}`: 1% in dollars. */
  trendCostPoint: string;
  /** The lane of the weekly limit a day at a time. */
  daysLane: string;
  /** What a day ahead can take for the week to last to its reset. */
  budgetToLast: string;
  /** A seventh of the limit a day. */
  evenSplit: string;
  /** Where a day of the week starts and ends: `{0}`, the time of day the week resets. */
  daysNote: string;
}

export type HostToWebviewMessage =
  | { type: 'init'; locale: string; strings: PanelStrings }
  | { type: 'timeline'; data: TimelineData };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'range'; range: RangeKey }
  /** Zooms into a part of the range, or back out to the whole of it without a window. */
  | { type: 'zoom'; window?: TimeWindow }
  /** Shows a quota week: 0 for this one, -1 for the one before, and so on. */
  | { type: 'week'; offset: number }
  /** Shows another account's usage. */
  | { type: 'account'; account: string };
