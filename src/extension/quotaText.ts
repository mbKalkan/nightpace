// What the status bar says about the quota. Pure, so the wording is tested without VS Code.
import type { QuotaSnapshot, QuotaWindow } from './quota/snapshot';
import type { Translate } from './texts';

export type Level = 'normal' | 'warning' | 'error';

export interface QuotaText {
  /** Status bar text, like `5h 63% · Wk 41% · ↻14:02`. */
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

export function quotaText(
  snapshot: QuotaSnapshot,
  now: number,
  t: Translate,
  locale: string,
): QuotaText | undefined {
  if (!snapshot.available) return undefined;
  const fiveHour = current(snapshot.fiveHour, now);
  const weekly = current(snapshot.weekly, now);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const percent = (window: QuotaWindow) => `${Math.round(window.percent)}%`;

  const parts = [
    `5h ${fiveHour ? percent(fiveHour) : '—'}`,
    `${t('Wk')} ${weekly ? percent(weekly) : '—'}`,
  ];
  if (fiveHour?.resetsAt) parts.push(`↻${time.format(fiveHour.resetsAt)}`);

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
