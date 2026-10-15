// Where the tokens of the window shown went: by session or by project, as a sortable table.
import {
  MODEL_FAMILIES,
  type ModelFamily,
  type PanelStrings,
  type SessionSummary,
  type TimelineData,
} from '../shared/protocol';
import { modelClass } from './chart/timelineChart';
import type { Formats } from './format';

/** Rows shown before "Show all". */
const FIRST_ROWS = 12;
/** Models and effort levels below this share of a row's tokens are left out of its text. */
const MENTION_SHARE = 0.05;
/** The table starts in token order, most first. */
const TOKENS_COLUMN = 4;

export type Grouping = 'session' | 'project';

interface Row {
  key: string;
  label: string;
  folder?: string;
  first: number;
  sessions: number;
  active: number;
  requests: number;
  tokens: number;
  byModel: Partial<Record<ModelFamily, number>>;
  byEffort: Record<string, number>;
}

interface Column {
  heading: string;
  /** What the column sorts by; columns without one don't sort. */
  value?: (row: Row) => number | string;
  cell: (row: Row, context: CellContext) => Node | string;
  /** Text columns are left-aligned and sort A to Z first. */
  text?: boolean;
}

interface CellContext {
  total: number;
  max: number;
}

export class Breakdown {
  readonly element = document.createElement('section');
  private readonly groupButtons = new Map<Grouping, HTMLButtonElement>();
  private readonly content = document.createElement('div');
  private data: TimelineData | undefined;
  private sortColumn = TOKENS_COLUMN;
  private ascending = false;
  private expanded = false;

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
    private grouping: Grouping,
    private readonly onGrouping: (grouping: Grouping) => void,
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
        this.sortColumn = TOKENS_COLUMN;
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

  render(data: TimelineData): void {
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
    const context: CellContext = {
      total: rows.reduce((sum, row) => sum + row.tokens, 0),
      max: Math.max(...rows.map((row) => row.tokens)),
    };
    const shown = this.expanded ? rows : rows.slice(0, FIRST_ROWS);

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
      columns.forEach((column, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) {
          (cell as HTMLTableCellElement).scope = 'row';
          if (row.folder) cell.title = row.folder;
        }
        if (column.text) cell.classList.add('np-text-cell');
        cell.append(column.cell(row, context));
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
        heading: s.tokens,
        value: (row) => row.tokens,
        cell: (row, context) => this.tokenCell(row, context),
      },
      { heading: s.share, cell: (row, { total }) => f.share(row.tokens / total) },
      {
        heading: s.modelsColumn,
        text: true,
        cell: (row) =>
          mentioned(row.byModel, row.tokens)
            .map((model) => s.models[model as ModelFamily])
            .join(', '),
      },
      {
        heading: s.effort,
        text: true,
        cell: (row) => mentioned(row.byEffort, row.tokens).join(', ') || '—',
      },
    ];
  }

  /** The amount, after a bar as long as the row's share of the largest row, split by model. */
  private tokenCell(row: Row, { max }: CellContext): Node {
    const wrapper = document.createElement('span');
    wrapper.className = 'np-token-cell';
    const bar = document.createElement('span');
    bar.className = 'np-mini-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.style.width = `${Math.max(2, (row.tokens / max) * 100)}%`;
    for (const model of MODEL_FAMILIES) {
      const value = row.byModel[model];
      if (!value) continue;
      const part = document.createElement('span');
      part.className = modelClass(model);
      part.style.flexGrow = String(value);
      bar.append(part);
    }
    const track = document.createElement('span');
    track.className = 'np-mini-track';
    track.append(bar);
    const amount = document.createElement('span');
    amount.textContent = this.formats.amount(row.tokens);
    wrapper.append(track, amount);
    return wrapper;
  }
}

/** The keys holding at least `MENTION_SHARE` of `total`, largest first. */
function mentioned(values: Record<string, number | undefined>, total: number): string[] {
  return Object.entries(values)
    .filter(([, value]) => (value ?? 0) >= total * MENTION_SHARE)
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
    sessions: 1,
    active: session.active,
    requests: session.requests,
    tokens: session.tokens,
    byModel: session.byModel,
    byEffort: session.byEffort,
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
        sessions: 0,
        active: 0,
        requests: 0,
        tokens: 0,
        byModel: {},
        byEffort: {},
      };
      byFolder.set(key, row);
    }
    row.first = Math.min(row.first, session.first);
    row.sessions++;
    row.active += session.active;
    row.requests += session.requests;
    row.tokens += session.tokens;
    for (const [model, value] of Object.entries(session.byModel)) {
      row.byModel[model as ModelFamily] = (row.byModel[model as ModelFamily] ?? 0) + (value ?? 0);
    }
    for (const [effort, value] of Object.entries(session.byEffort)) {
      row.byEffort[effort] = (row.byEffort[effort] ?? 0) + value;
    }
  }
  return [...byFolder.values()].sort((a, b) => b.tokens - a.tokens);
}
