// Reads the plan usage Claude Code reports for its `get_usage` request. The reply isn't a
// documented format, so every field is checked and anything unexpected is left out.

export interface QuotaWindow {
  /** How much of the limit is used, from 0 to 100. */
  percent: number;
  /** When the window resets, in milliseconds since the epoch. */
  resetsAt?: number;
}

export interface ModelQuota extends QuotaWindow {
  /** As Claude Code shows it, like "Fable". */
  model: string;
}

export interface QuotaSnapshot {
  /** When it was asked for, in milliseconds since the epoch. */
  time: number;
  /** False when no plan limits apply: an API key, Bedrock or Vertex. */
  available: boolean;
  /** `pro`, `max`, `team`, … */
  plan?: string;
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
  /** Weekly limits of single models, kept apart from the overall weekly limit. */
  models: ModelQuota[];
}

export function parseUsageResponse(response: unknown, time: number): QuotaSnapshot | undefined {
  if (!isObject(response)) return undefined;
  const limits = isObject(response.rate_limits) ? response.rate_limits : undefined;
  const available = response.rate_limits_available !== false && limits !== undefined;
  const snapshot: QuotaSnapshot = { time, available, models: [] };
  if (typeof response.subscription_type === 'string') snapshot.plan = response.subscription_type;
  if (!limits) return snapshot;

  const fiveHour = quotaWindow(limits.five_hour, 'utilization');
  const weekly = quotaWindow(limits.seven_day, 'utilization');
  if (fiveHour) snapshot.fiveHour = fiveHour;
  if (weekly) snapshot.weekly = weekly;
  if (Array.isArray(limits.model_scoped)) {
    for (const entry of limits.model_scoped) {
      const window = quotaWindow(entry, 'utilization');
      if (window && isObject(entry) && typeof entry.display_name === 'string') {
        snapshot.models.push({ model: entry.display_name, ...window });
      }
    }
  }
  return snapshot;
}

function quotaWindow(value: unknown, field: string): QuotaWindow | undefined {
  if (!isObject(value)) return undefined;
  const percent = value[field];
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined;
  const window: QuotaWindow = { percent: Math.min(Math.max(percent, 0), 100) };
  const resetsAt = timeOf(value.resets_at);
  if (resetsAt !== undefined) window.resetsAt = resetsAt;
  return window;
}

/** An ISO date, or seconds since the epoch, as milliseconds since the epoch. */
function timeOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
