// When to ask Claude Code for the quota. Each question starts a Claude Code process for a few
// seconds, so it is asked often only while Claude Code is being used.

/** How often to ask while Claude Code is working. */
export const ACTIVE_INTERVAL_MS = 5 * 60_000;
/** How often to ask otherwise: the quota can still change from claude.ai or another machine. */
export const IDLE_INTERVAL_MS = 60 * 60_000;
/**
 * After one, two, three or more failures in a row, how long to wait before trying again. The
 * first try after the computer starts can time out while it is still busy starting up.
 */
export const RETRY_INTERVALS_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000];

export interface ScheduleState {
  now: number;
  /** When any window last asked, or tried to; undefined if never. */
  lastPoll?: number;
  /** Whether that last try failed. */
  lastFailed?: boolean;
  /** How many tries in a row have failed, that last one included. */
  failures?: number;
  /** When a transcript was last written to. */
  lastActivity?: number;
}

export function shouldPoll({
  now,
  lastPoll,
  lastFailed,
  failures,
  lastActivity,
}: ScheduleState): boolean {
  if (lastPoll === undefined) return true;
  const since = now - lastPoll;
  if (lastFailed) {
    // A record from before failures were counted waits the longest.
    const count = failures ?? RETRY_INTERVALS_MS.length;
    return since >= RETRY_INTERVALS_MS[Math.min(Math.max(count, 1), RETRY_INTERVALS_MS.length) - 1];
  }
  const active = lastActivity !== undefined && lastActivity > lastPoll - ACTIVE_INTERVAL_MS;
  return since >= (active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
}
