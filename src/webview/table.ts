// The timeline as a table: every value the chart draws, readable without hovering.
import type { PanelStrings, TimelineData, TokenMeasure, TokenSplit } from '../shared/protocol';
import { tokenSeries } from './chart/series';
import { quotaAt } from './chart/timelineChart';
import type { Formats } from './format';

export function timelineTable(
  data: TimelineData,
  strings: PanelStrings,
  formats: Formats,
  split: TokenSplit,
  measure: TokenMeasure,
): HTMLElement {
  const series = tokenSeries(data, split, measure, strings);
  const amount = (value: number) =>
    measure === 'cost' ? formats.money(value) : formats.amount(value);
  const table = document.createElement('table');
  table.className = 'np-table';
  const caption = document.createElement('caption');
  caption.textContent = strings.title;
  caption.className = 'np-visually-hidden';
  const head = document.createElement('thead');
  const headings = [
    strings.time,
    strings.fiveHour,
    strings.weekly,
    strings.sessions,
    ...series.map(({ label }) => label),
    measure === 'cost' ? strings.cost : strings.tokens,
    strings.requests,
  ];
  const headRow = document.createElement('tr');
  for (const text of headings) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = text;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  // Newest first: the recent past is what a reader looks for.
  for (const bucket of [...data.buckets].reverse()) {
    const end = Math.min(bucket.start + data.bucketMs, data.to);
    const quota = quotaAt(data.quota, end);
    const recent = quota && end - quota.time <= data.bucketMs ? quota : undefined;
    // Before the first reading, the estimate, marked as one.
    const estimate = quota ? undefined : quotaAt(data.quotaEstimate ?? [], end);
    const percent = (recorded?: number, estimated?: number) =>
      recorded !== undefined
        ? formats.percent(recorded)
        : estimated !== undefined
          ? `≈${formats.percent(estimated)}`
          : '—';
    const cells = [
      formats.columnStart(bucket.start, data.bucketMs, data.to - data.from),
      percent(recent?.fiveHour, estimate?.fiveHour),
      percent(recent?.weekly, estimate?.weekly),
      String(bucket.maxSessions),
      ...series.map(({ value }) => amount(value(bucket))),
      amount(bucket[measure].total),
      String(bucket.requests),
    ];
    const row = document.createElement('tr');
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) (cell as HTMLTableCellElement).scope = 'row';
      cell.textContent = text;
      row.append(cell);
    });
    body.append(row);
  }
  table.append(caption, head, body);
  return table;
}
