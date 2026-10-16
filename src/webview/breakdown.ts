// Where the cost and tokens of the window shown went: by session or by project, as a sortable
// table.
import {
  MODEL_FAMILIES,
  NO_EFFORT,
  TOKEN_TYPES,
  type Amounts,
  type ModelFamily,
  type PanelStrings,
  type SessionSummary,
  type TimelineData,
  type TimeWindow,
  type TokenMeasure,
} from '../shared/protocol';
import { modelClass } from './chart/series';
import type { Formats } from './format';

/** Rows shown before "Show all". */
const FIRST_ROWS = 12;
/** Models and effort levels below this share of a row's amount are left out of its text. */
const MENTION_SHARE = 0.05;
/** The columns of the two measures; the table starts sorted by the one shown, most first. */
const MEASURE_COLUMNS: Record<TokenMeasure, number> = { cost: 4, tokens: 5 };

export type Grouping = 'session' | 'project';

/** What the rows ask of the chart: to mark their time while pointed at, and to zoom to it. */
export interface RowActions {
  mark(span: TimeWindow | undefined): void;
  zoom(span: TimeWindow): void;
}

interface Row {
  key: string;
  label: string;
  folder?: string;
  first: number;
  last: number;
  sessions: number;
  active: number;
  requests: number;
  cost: Amounts;
  tokens: Amounts;
}

interface Column {
  heading: string;
  /** What the column sorts by; columns without one don't sort. */
  value?: (row: Row) => number | string;
  cell: (row: Row, context: CellContext) => Node | string;
  /** Shown on pointing at the cell. */
  title?: (row: Row) => string;
  /** Text columns are left-aligned and sort A to Z first. */
  text?: boolean;
}

interface CellContext {
  /** Of the measure shown, over every row. */
  total: number;
  max: number;
}

export class Breakdown {
  readonly element = document.createElement('section');
  private readonly groupButtons = new Map<Grouping, HTMLButtonElement>();
  private readonly content = document.createElement('div');
  private data: TimelineData | undefined;
  private measure: TokenMeasure = 'cost';
  private sortColumn = MEASURE_COLUMNS.cost;
  private ascending = false;
  private expanded = false;

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
    private grouping: Grouping,
    private readonly onGrouping: (grouping: Grouping) => void,
    private readonly actions: RowActions,
  ) {
    this.element.className = 'np-breakdown';
    this.element.setAttribute('aria-labelledby', 'np-breakdown-title');
    const header = document.createElement('div');
    header.className = 'np-breakdown-header';
    const title = document.createElement('h2');
    title.id = 'np-breakdown-title';
    title.className = 'np-subtitle';
    title.textContent = strings.breakdownTitle;
    const toggle = document.createElement('div');
    toggle.className = 'np-segmented';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', strings.breakdownTitle);
    for (const [grouping, label] of [
      ['session', strings.bySession],
      ['project', strings.byProject],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        if (this.grouping === grouping) return;
        this.grouping = grouping;
        this.sortColumn = MEASURE_COLUMNS[this.measure];
        this.ascending = false;
        this.expanded = false;
        this.onGrouping(grouping);
        this.draw();
      });
      this.groupButtons.set(grouping, button);
      toggle.append(button);
    }
    header.append(title, toggle);
    this.element.append(header, this.content);
  }

  render(data: TimelineData, measure: TokenMeasure): void {
    // Sorted by the measure shown, the order follows the measure.
    if (measure !== this.measure && this.sortColumn === MEASURE_COLUMNS[this.measure]) {
      this.sortColumn = MEASURE_COLUMNS[measure];
    }
    this.measure = measure;
    this.data = data;
    this.draw();
  }

  private draw(): void {
    const data = this.data;
    for (const [grouping, button] of this.groupButtons) {
      button.setAttribute('aria-pressed', String(grouping === this.grouping));
    }
    if (!data) return;
    const rows = this.grouping === 'session' ? sessionRows(data.sessionList) : projectRows(data);
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'np-note-text';
      empty.textContent = this.strings.empty;
      this.content.replaceChildren(empty);
      return;
    }
    const columns = this.columns(data);
    const sortBy = columns[this.sortColumn].value!;
    const direction = this.ascending ? 1 : -1;
    rows.sort((a, b) => {
      const [x, y] = [sortBy(a), sortBy(b)];
      return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * direction;
    });
    const measure = this.measure;
    const context: CellContext = {
      total: rows.reduce((sum, row) => sum + row[measure].total, 0),
      max: Math.max(...rows.map((row) => row[measure].total)),
    };
    const shown = this.expanded ? rows : rows.slice(0, FIRST_ROWS);
    // The rows are about to be replaced, and a replaced row never says the pointer left it.
    this.actions.mark(undefined);
    const hint =
      this.grouping === 'session' ? this.strings.zoomToSession : this.strings.zoomToProject;

    const table = document.createElement('table');
    table.className = 'np-table np-breakdown-table';
    const caption = document.createElement('caption');
    caption.className = 'np-visually-hidden';
    caption.textContent = `${this.strings.breakdownTitle}, ${
      this.grouping === 'session' ? this.strings.bySession : this.strings.byProject
    }`;
    const headRow = document.createElement('tr');
    columns.forEach((column, index) => headRow.append(this.headerCell(column, index)));
    const head = document.createElement('thead');
    head.append(headRow);
    const body = document.createElement('tbody');
    for (const row of shown) {
      const tr = document.createElement('tr');
      const span = { from: row.first, to: row.last };
      tr.title = hint;
      tr.addEventListener('mouseenter', () => this.actions.mark(span));
      tr.addEventListener('mouseleave', () => this.actions.mark(undefined));
      tr.addEventListener('click', () => this.actions.zoom(span));
      columns.forEach((column, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (column.text) cell.classList.add('np-text-cell');
        if (column.title) cell.title = column.title(row);
        const content = column.cell(row, context);
        if (index === 0) {
          (cell as HTMLTableCellElement).scope = 'row';
          if (row.folder) cell.title = row.folder;
          // The row's click, within reach of the keyboard; the click itself reaches the row.
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'np-row-button';
          button.setAttribute('aria-description', hint);
          button.append(content);
          button.addEventListener('focus', () => this.actions.mark(span));
          button.addEventListener('blur', () => this.actions.mark(undefined));
          cell.append(button);
        } else {
          cell.append(content);
        }
        tr.append(cell);
      });
      body.append(tr);
    }
    table.append(caption, head, body);
    const parts: Node[] = [table];
    if (shown.length < rows.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'np-link-button';
      more.textContent = this.strings.showAll.replace('{0}', String(rows.length));
      more.addEventListener('click', () => {
        this.expanded = true;
        this.draw();
      });
      parts.push(more);
    }
    this.content.replaceChildren(...parts);
  }

  private headerCell(column: Column, index: number): HTMLTableCellElement {
    const cell = document.createElement('th');
    cell.scope = 'col';
    if (column.text) cell.classList.add('np-text-cell');
    if (!column.value) {
      cell.textContent = column.heading;
      return cell;
    }
    const sorted = this.sortColumn === index;
    if (sorted) cell.setAttribute('aria-sort', this.ascending ? 'ascending' : 'descending');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'np-sort';
    button.textContent = column.heading;
    button.addEventListener('click', () => {
      // A second click reverses; a new column starts A to Z, or largest first.
      this.ascending = sorted ? !this.ascending : column.text === true;
      this.sortColumn = index;
      this.draw();
    });
    cell.append(button);
    return cell;
  }

  private columns(data: TimelineData): Column[] {
    const s = this.strings;
    const f = this.formats;
    const measure = this.measure;
    const long = data.to - data.from > 26 * 3_600_000;
    const first: Column =
      this.grouping === 'session'
        ? {
            heading: s.started,
            value: (row) => row.first,
            cell: (row) => (long ? f.dateClock(row.first) : f.clock(row.first)),
          }
        : {
            heading: s.sessions,
            value: (row) => row.sessions,
            cell: (row) => String(row.sessions),
          };
    return [
      {
        heading: s.project,
        value: (row) => (row.label || s.unknownFolder).toLocaleLowerCase(),
        cell: (row) => row.label || s.unknownFolder,
        text: true,
      },
      first,
      { heading: s.active, value: (row) => row.active, cell: (row) => f.duration(row.active) },
      { heading: s.requests, value: (row) => row.requests, cell: (row) => String(row.requests) },
      {
        heading: s.cost,
        value: (row) => row.cost.total,
        cell: (row, context) => this.amountCell(row, context, 'cost'),
      },
      {
        heading: s.tokens,
        value: (row) => row.tokens.total,
        cell: (row, context) => this.amountCell(row, context, 'tokens'),
        title: (row) =>
          TOKEN_TYPES.filter((type) => row.tokens.byType[type])
            .map((type) => `${s.tokenTypes[type]}: ${f.amount(row.tokens.byType[type]!)}`)
            .join('\n'),
      },
      {
        heading: s.fromCache,
        value: (row) => cacheShare(row.tokens),
        cell: (row) => f.share(cacheShare(row.tokens)),
      },
      {
        heading: s.share,
        cell: (row, { total }) => f.share(total > 0 ? row[measure].total / total : 0),
      },
      {
        heading: s.modelsColumn,
        text: true,
        cell: (row) =>
          mentioned(row[measure].byModel, row[measure].total)
            .map((model) => s.models[model as ModelFamily])
            .join(', '),
      },
      {
        heading: s.effort,
        text: true,
        cell: (row) =>
          mentioned(row[measure].byEffort, row[measure].total)
            .filter((effort) => effort !== NO_EFFORT)
            .join(', ') || '—',
      },
    ];
  }

  /**
   * An amount; in the measure shown, after a bar as long as the row's share of the largest row,
   * split by model.
   */
  private amountCell(row: Row, { max }: CellContext, measure: TokenMeasure): Node {
    const value = row[measure].total;
    const text = measure === 'cost' ? this.formats.money(value) : this.formats.amount(value);
    if (measure !== this.measure) return document.createTextNode(text);
    const wrapper = document.createElement('span');
    wrapper.className = 'np-token-cell';
    const bar = document.createElement('span');
    bar.className = 'np-mini-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.style.width = `${Math.max(2, max > 0 ? (value / max) * 100 : 0)}%`;
    for (const model of MODEL_FAMILIES) {
      const part = row[measure].byModel[model];
      if (!part) continue;
      const segment = document.createElement('span');
      segment.className = modelClass(model);
      segment.style.flexGrow = String(part);
      bar.append(segment);
    }
    const track = document.createElement('span');
    track.className = 'np-mini-track';
    track.append(bar);
    const amount = document.createElement('span');
    amount.textContent = text;
    wrapper.append(track, amount);
    return wrapper;
  }
}

/** The share of the prompt tokens read from the cache rather than sent or written to it. */
function cacheShare(tokens: Amounts): number {
  const { input = 0, cacheWrite = 0, cacheRead = 0 } = tokens.byType;
  const prompt = input + cacheWrite + cacheRead;
  return prompt > 0 ? cacheRead / prompt : 0;
}

/** The keys holding at least `MENTION_SHARE` of `total`, largest first. */
function mentioned(values: Record<string, number | undefined>, total: number): string[] {
  return Object.entries(values)
    .filter(([, value]) => (value ?? 0) > 0 && (value ?? 0) >= total * MENTION_SHARE)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([key]) => key);
}

/** The last part of a folder path, on any platform. */
export function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

function sessionRows(sessions: readonly SessionSummary[]): Row[] {
  return sessions.map((session) => ({
    key: session.id,
    label: session.folder ? folderName(session.folder) : '',
    folder: session.folder,
    first: session.first,
    last: session.last,
    sessions: 1,
    active: session.active,
    requests: session.requests,
    cost: session.cost,
    tokens: session.tokens,
  }));
}

function projectRows(data: TimelineData): Row[] {
  const byFolder = new Map<string, Row>();
  for (const session of data.sessionList) {
    const key = session.folder ?? '';
    let row = byFolder.get(key);
    if (!row) {
      row = {
        key,
        label: session.folder ? folderName(session.folder) : '',
        folder: session.folder,
        first: session.first,
        last: session.last,
        sessions: 0,
        active: 0,
        requests: 0,
        cost: emptyAmounts(),
        tokens: emptyAmounts(),
      };
      byFolder.set(key, row);
    }
    row.first = Math.min(row.first, session.first);
    row.last = Math.max(row.last, session.last);
    row.sessions++;
    row.active += session.active;
    row.requests += session.requests;
    addAmounts(row.cost, session.cost);
    addAmounts(row.tokens, session.tokens);
  }
  return [...byFolder.values()];
}

function emptyAmounts(): Amounts {
  return { total: 0, byModel: {}, byEffort: {}, byType: {} };
}

function addAmounts(into: Amounts, from: Amounts): void {
  into.total += from.total;
  for (const key of ['byModel', 'byEffort', 'byType'] as const) {
    const target = into[key] as Record<string, number | undefined>;
    for (const [name, value] of Object.entries(from[key])) {
      target[name] = (target[name] ?? 0) + (value ?? 0);
    }
  }
}
