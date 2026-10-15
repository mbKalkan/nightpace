// User-facing text. Every message goes through `t`: VS Code's `l10n.t` in the extension, a
// plain formatter in the browser tests, so both show the same words.
import type { PanelStrings } from '../shared/protocol';

export type Translate = (message: string, ...args: Array<string | number>) => string;

export function panelStrings(t: Translate): PanelStrings {
  return {
    title: t('Claude Code usage'),
    loading: t("Reading Claude Code's logs…"),
    empty: t('No Claude Code usage in this period.'),
    privacy: t(
      "Nightpace reads times, models, effort levels and token counts from Claude Code's local logs, and asks Claude Code for your plan's quota. It never stores prompts, replies, tool output or code.",
    ),
    ranges: { '24h': t('24 hours'), '7d': t('7 days'), '30d': t('30 days') },
    rangeLabel: t('Time range'),
    showTable: t('Table'),
    showChart: t('Chart'),
    quotaLane: t('Plan quota used'),
    fiveHour: t('5-hour'),
    weekly: t('Weekly'),
    sessionsLane: t('Sessions working at once'),
    sessions: t('Sessions'),
    tokensLane: t('Tokens by model'),
    tokensNote: t(
      'Weighted like API prices: cache reads count a tenth, cache writes 1.25 or 2 times, output 5 times.',
    ),
    models: {
      opus: 'Opus',
      fable: 'Fable',
      sonnet: 'Sonnet',
      haiku: 'Haiku',
      other: t('Other models'),
    },
    time: t('Time'),
    requests: t('Requests'),
    noQuotaYet: t(
      'Nightpace records the quota from now on; it appears here after the first reading.',
    ),
    quotaSince: t('Quota recorded since {0}', '{0}'),
    chartLabel: t(
      'Timeline of plan quota, sessions working at once and tokens by model. Use the arrow keys to move through time, plus and minus to zoom.',
    ),
    zoomIn: t('Zoom in'),
    zoomOut: t('Zoom out'),
    resetZoom: t('Whole range'),
    zoomHint: t('Drag across the chart to zoom in. Ctrl + scroll or pinch zooms in and out.'),
  };
}
