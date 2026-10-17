// What the status bar says about the quota. Pure, so the wording is tested without VS Code.
import type { QuotaSnapshot, QuotaWindow } from './quota/snapshot';
import type { Translate } from './texts';

export type Level = 'normal' | 'warning' | 'error';

export interface QuotaText {
  /** Status bar text, like `5h 63% ↻14:02 · Wk 41% ↻3d 4h`. */
  text: string;
  /** Hover lines, Markdown. */
  tooltip: string[];
  level: Level;
}

export const WARNING_PERCENT = 80;
export const ERROR_PERCENT = 95;

/** A window whose reset time has passed says nothing about now. */
function current(window: QuotaWindow | undefined, now: number): QuotaWindow | undefined {
  return window && (window.resetsAt === undefined || window.resetsAt > now) ? window : undefined;
}

/** How long until `time`, as short as the status bar needs: `3d 4h`, `3d`, `9h`, `40m`. */
function until(time: number, now: number, t: Translate): string {
  const minutes = Math.max(0, Math.floor((time - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? t('{0}d {1}h', days, hours) : t('{0}d', days);
  return hours > 0 ? t('{0}h', hours) : t('{0}m', minutes);
}

export function quotaText(
  snapshot: QuotaSnapshot,
  now: number,
  t: Translate,
  locale: string,
): QuotaText | undefined {
  if (!snapshot.available) return undefined;
  const fiveHour = current(snapshot.fiveHour, now);
  const weekly = current(snapshot.weekly, now);
  // Always 24-hour: shorter in the status bar, and reset times read the same in every locale.
  const clock = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
  const time = new Intl.DateTimeFormat(locale, clock);
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', ...clock });
  const percent = (window: QuotaWindow) => `${Math.round(window.percent)}%`;

  // Each limit with its reset: the 5-hour window's time, and how long the week has left.
  const parts = [
    `5h ${fiveHour ? percent(fiveHour) : '—'}`,
    `${t('Wk')} ${weekly ? percent(weekly) : '—'}`,
  ];
  if (fiveHour?.resetsAt) parts[0] += ` ↻${time.format(fiveHour.resetsAt)}`;
  if (weekly?.resetsAt) parts[1] += ` ↻${until(weekly.resetsAt, now, t)}`;

  const tooltip: string[] = [];
  if (fiveHour) {
    tooltip.push(
      fiveHour.resetsAt
        ? t(
            '5-hour limit: {0} used, resets at {1}',
            percent(fiveHour),
            time.format(fiveHour.resetsAt),
          )
        : t('5-hour limit: {0} used', percent(fiveHour)),
    );
  }
  if (weekly) {
    tooltip.push(
      weekly.resetsAt
        ? t('Weekly limit: {0} used, resets {1}', percent(weekly), day.format(weekly.resetsAt))
        : t('Weekly limit: {0} used', percent(weekly)),
    );
  }
  for (const model of snapshot.models) {
    const window = current(model, now);
    if (window) tooltip.push(t('{0} weekly limit: {1} used', model.model, percent(window)));
  }
  tooltip.push(t('Updated at {0}', time.format(snapshot.time)));

  const highest = Math.max(
    fiveHour?.percent ?? 0,
    weekly?.percent ?? 0,
    ...snapshot.models.map((model) => current(model, now)?.percent ?? 0),
  );
  const level: Level =
    highest >= ERROR_PERCENT ? 'error' : highest >= WARNING_PERCENT ? 'warning' : 'normal';
  return { text: parts.join(' · '), tooltip, level };
}
