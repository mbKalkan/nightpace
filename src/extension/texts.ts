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
    tokenLanes: {
      cost: {
        model: t('API cost by model'),
        effort: t('API cost by effort level'),
        type: t('API cost by token type'),
      },
      tokens: {
        model: t('Tokens by model'),
        effort: t('Tokens by effort level'),
        type: t('Tokens by type'),
      },
    },
    noEffort: t('Not recorded'),
    splitLabel: t('Split by'),
    splitByModel: t('Model'),
    splitByEffort: t('Effort'),
    splitByType: t('Type'),
    measureLabel: t('Show'),
    measures: { cost: t('Cost'), tokens: t('Tokens') },
    measureNotes: {
      cost: t(
        "Cost at Anthropic's API list prices for each model, as if the requests had been paid per token instead of through your plan.",
      ),
      tokens: t(
        'Token counts as Claude Code logged them. Most are cache reads, which cost a tenth of input or less.',
      ),
    },
    tokenTypes: {
      input: t('Input'),
      cacheWrite: t('Cache writes'),
      cacheRead: t('Cache reads'),
      output: t('Output'),
    },
    models: {
      opus: 'Opus',
      fable: 'Fable',
      sonnet: 'Sonnet',
      haiku: 'Haiku',
      other: t('Other models'),
    },
    spendTitle: t('Cost at API prices'),
    spendToday: t('Today'),
    spendLast7Days: t('Last 7 days'),
    spendLast30Days: t('Last 30 days'),
    spendPerActiveDay: t('Per active day'),
    spendUnpriced: t('{0} requests of models without a known price are not counted.', '{0}'),
    cost: t('API cost'),
    periodTotal: t('{0} in this period', '{0}'),
    time: t('Time'),
    requests: t('Requests'),
    noQuotaYet: t(
      'Nightpace records the quota from now on; it appears here after the first reading.',
    ),
    quotaSince: t('Quota recorded since {0}', '{0}'),
    chartLabel: t(
      'Timeline of plan quota, sessions working at once, and API cost or tokens. Use the arrow keys to move through time, plus and minus to zoom.',
    ),
    breakdownTitle: t('Where the tokens went'),
    bySession: t('By session'),
    byProject: t('By project'),
    project: t('Project'),
    unknownFolder: t('Unknown folder'),
    started: t('Started'),
    active: t('Active'),
    tokens: t('Tokens'),
    share: t('Share'),
    modelsColumn: t('Models'),
    effort: t('Effort'),
    showAll: t('Show all {0}', '{0}'),
    zoomIn: t('Zoom in'),
    zoomOut: t('Zoom out'),
    resetZoom: t('Whole range'),
    zoomHint: t('Drag across the chart to zoom in. Ctrl + scroll or pinch zooms in and out.'),
  };
}
