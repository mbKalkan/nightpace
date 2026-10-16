// The tokens of the window shown by kind, as a table: how many, what they would have cost at
// API prices, and the share of each. Tokens and cost split very differently (cache reads are
// most of the tokens and little of the cost), so each share gets a bar to compare at a glance.
import {
  TOKEN_DETAILS,
  type PanelStrings,
  type TokenDetail,
  type TokenDetailKey,
  type TokenDetails,
  type TokenType,
} from '../shared/protocol';
import { typeClass } from './chart/series';
import type { Formats } from './format';

/** The color of each kind: both cache writes share theirs. */
const TYPE_OF: Record<TokenDetailKey, TokenType> = {
  input: 'input',
  cacheWrite5m: 'cacheWrite',
  cacheWrite1h: 'cacheWrite',
  cacheRead: 'cacheRead',
  output: 'output',
};

interface Row {
  label: string;
  detail: TokenDetail;
  className?: string;
  /** A part of the row above it, set in under it. */
  part?: boolean;
  total?: boolean;
}

export class TokenDetailsView {
  readonly element = document.createElement('section');
  /** What the cache did: the share it served, what it saved and the cost without it. */
  private readonly summary = document.createElement('dl');
  private readonly content = document.createElement('div');

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
  ) {
    this.element.className = 'np-card np-details';
    this.element.setAttribute('aria-labelledby', 'np-details-title');
    this.element.hidden = true;
    const title = document.createElement('h2');
    title.id = 'np-details-title';
    title.className = 'np-card-title';
    title.textContent = strings.tokenDetailsTitle;
    const header = document.createElement('div');
    header.className = 'np-card-header';
    header.append(title);
    this.summary.className = 'np-figures np-details-summary';
    this.content.className = 'np-table-scroll';
    this.element.append(header, this.summary, this.content);
  }

  render(details: TokenDetails): void {
    const s = this.strings;
    const total: TokenDetail = { tokens: 0, cost: 0 };
    for (const key of TOKEN_DETAILS) {
      total.tokens += details[key].tokens;
      total.cost += details[key].cost;
    }
    this.element.hidden = total.tokens === 0;
    if (total.tokens === 0) return;

    const rows: Row[] = [];
    for (const key of TOKEN_DETAILS) {
      // A kind Claude Code didn't use, like hour-long cache writes, is left out.
      if (details[key].tokens === 0) continue;
      rows.push({
        label: s.tokenDetails[key],
        detail: details[key],
        className: typeClass(TYPE_OF[key]),
      });
      if (key === 'output' && details.thinking.tokens > 0) {
        rows.push({ label: s.thinking, detail: details.thinking, part: true });
      }
    }
    rows.push({ label: s.total, detail: total, total: true });

    const table = document.createElement('table');
    table.className = 'np-table np-details-table';
    const caption = document.createElement('caption');
    caption.className = 'np-visually-hidden';
    caption.textContent = s.tokenDetailsTitle;
    const headRow = document.createElement('tr');
    for (const [index, heading] of [
      s.type,
      s.tokens,
      s.shareOfTokens,
      s.cost,
      s.shareOfCost,
    ].entries()) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = heading;
      if (index === 0) cell.classList.add('np-text-cell');
      headRow.append(cell);
    }
    const head = document.createElement('thead');
    head.append(headRow);
    const body = document.createElement('tbody');
    for (const row of rows) body.append(this.row(row, total));
    table.append(caption, head, body);
    this.content.replaceChildren(table);

    const prompt =
      details.input.tokens +
      details.cacheWrite5m.tokens +
      details.cacheWrite1h.tokens +
      details.cacheRead.tokens;
    const saved = details.uncachedCost - total.cost;
    this.summary.hidden = details.cacheRead.tokens === 0 || saved <= 0;
    this.summary.replaceChildren(
      ...(
        [
          [s.cacheReadShare, this.formats.share(details.cacheRead.tokens / prompt)],
          [s.cacheSaved, this.formats.money(saved)],
          [s.uncachedCost, this.formats.money(details.uncachedCost)],
        ] as const
      ).map(([label, value]) => {
        const figure = document.createElement('div');
        figure.className = 'np-figure';
        const term = document.createElement('dt');
        term.textContent = label;
        const amount = document.createElement('dd');
        amount.textContent = value;
        figure.append(term, amount);
        return figure;
      }),
    );
  }

  private row(row: Row, total: TokenDetail): HTMLTableRowElement {
    const tr = document.createElement('tr');
    if (row.part) tr.className = 'np-details-part';
    if (row.total) tr.className = 'np-details-total';
    const name = document.createElement('th');
    name.scope = 'row';
    name.className = 'np-text-cell';
    if (row.className) {
      const key = document.createElement('span');
      key.className = `np-details-key ${row.className}`;
      key.setAttribute('aria-hidden', 'true');
      name.append(key);
    }
    name.append(row.label);
    tr.append(
      name,
      this.cell(this.formats.amount(row.detail.tokens)),
      this.shareCell(row, total.tokens > 0 ? row.detail.tokens / total.tokens : 0),
      this.cell(this.formats.money(row.detail.cost)),
      this.shareCell(row, total.cost > 0 ? row.detail.cost / total.cost : 0),
    );
    return tr;
  }

  private cell(text: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  /** A share, after a bar as long as it in the row's color; the total has no bar. */
  private shareCell(row: Row, share: number): HTMLTableCellElement {
    const cell = document.createElement('td');
    const wrapper = document.createElement('span');
    wrapper.className = 'np-token-cell';
    if (!row.total) {
      const track = document.createElement('span');
      track.className = 'np-mini-track';
      track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span');
      bar.className = `np-details-bar ${row.className ?? 'np-details-bar-part'}`;
      bar.style.width = `${Math.max(share * 100, share > 0 ? 2 : 0)}%`;
      track.append(bar);
      wrapper.append(track);
    }
    const text = document.createElement('span');
    text.textContent = this.formats.share(share);
    wrapper.append(text);
    cell.append(wrapper);
    return cell;
  }
}
