// When to ask Claude Code for the quota. Each question starts a Claude Code process for a few
// seconds, so it is asked often only while Claude Code is being used.

/** How often to ask while Claude Code is working. */
export const ACTIVE_INTERVAL_MS = 5 * 60_000;
/** How often to ask otherwise: the quota can still change from claude.ai or another machine. */
export const IDLE_INTERVAL_MS = 60 * 60_000;
/** After a failure, how long to wait before trying again. */
export const RETRY_INTERVAL_MS = 15 * 60_000;

export interface ScheduleState {
  now: number;
  /** When any window last asked, or tried to; undefined if never. */
  lastPoll?: number;
  /** Whether that last try failed. */
  lastFailed?: boolean;
  /** When a transcript was last written to. */
  lastActivity?: number;
}

export function shouldPoll({ now, lastPoll, lastFailed, lastActivity }: ScheduleState): boolean {
  if (lastPoll === undefined) return true;
  const since = now - lastPoll;
  if (lastFailed) return since >= RETRY_INTERVAL_MS;
  const active = lastActivity !== undefined && lastActivity > lastPoll - ACTIVE_INTERVAL_MS;
  return since >= (active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
}
