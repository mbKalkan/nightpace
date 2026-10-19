import './styles/panel.css';
import {
  RANGES,
  type HostToWebviewMessage,
  type PanelStrings,
  type RangeKey,
  type TimelineData,
  type TimeWindow,
  type TokenMeasure,
  type TokenSplit,
} from '../shared/protocol';
import { clampWindow, coversExtent, MIN_WINDOW_MS, scaleWindow } from '../shared/window';
import { CHART_HEIGHT, TimelineChart } from './chart/timelineChart';
import { Formats } from './format';
import { Breakdown, type Grouping } from './breakdown';
import { PaceCards } from './pace';
import { SpendTiles } from './spend';
import { TokenDetailsView } from './tokenDetails';
import { timelineTable } from './table';
import { vscode } from './vscodeApi';

const app = document.getElementById('app') as HTMLElement;
/** Scrolling and pinching zoom in many small steps: the host builds only where they settle. */
const ZOOM_SETTLE_MS = 150;

interface ViewState {
  table?: boolean;
  grouping?: Grouping;
  split?: TokenSplit;
  measure?: TokenMeasure;
}

class Panel {
  private readonly formats: Formats;
  private readonly chart: TimelineChart;
  private readonly body = document.createElement('div');
  private readonly rangeButtons = new Map<RangeKey, HTMLButtonElement>();
  private readonly previousWeek = document.createElement('button');
  private readonly nextWeek = document.createElement('button');
  private readonly viewButton = document.createElement('button');
  private readonly splitButtons = new Map<TokenSplit, HTMLButtonElement>();
  private readonly measureButtons = new Map<TokenMeasure, HTMLButtonElement>();
  private readonly measureNote = document.createElement('p');
  /** What the dashed quota is, while the chart shows some. */
  private readonly estimateNote = document.createElement('p');
  private readonly spend: SpendTiles;
  private readonly pace: PaceCards;
  private readonly details: TokenDetailsView;
  private readonly columns = document.createElement('div');
  /** Below the header, not in it: a label that comes and goes there wraps the controls. */
  private readonly zoomLabel = document.createElement('p');
  private readonly zoomInButton = document.createElement('button');
  private readonly zoomOutButton = document.createElement('button');
  private readonly resetButton = document.createElement('button');
  private data: TimelineData | undefined;
  /** The window shown at once while the host builds it. */
  private pending: TimeWindow | undefined;
  private zoomTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly breakdown: Breakdown;
  private state: ViewState = (vscode.getState() as ViewState | undefined) ?? {};

  constructor(
    private readonly strings: PanelStrings,
    locale: string,
  ) {
    this.formats = new Formats(locale);
    this.chart = new TimelineChart(strings, this.formats, (window) =>
      this.zoom(window, ZOOM_SETTLE_MS),
    );

    const main = document.createElement('main');
    main.className = 'np-main';
    main.setAttribute('aria-label', strings.title);
    main.setAttribute('aria-busy', 'true');

    const header = document.createElement('header');
    header.className = 'np-header';
    const title = document.createElement('h1');
    title.className = 'np-title';
    title.textContent = strings.title;
    header.append(title, this.controls());
    // The controls stay at the top while the panel scrolls, set off from what passes under them.
    app.addEventListener(
      'scroll',
      () => header.classList.toggle('np-scrolled', app.scrollTop > 0),
      {
        passive: true,
      },
    );

    this.body.className = 'np-body';
    const loading = document.createElement('p');
    loading.className = 'np-note-text';
    loading.textContent = strings.loading;
    this.body.append(loading);
    const hint = document.createElement('p');
    hint.className = 'np-note-text';
    hint.textContent = strings.zoomHint;
    this.measureNote.className = 'np-note-text';
    this.estimateNote.className = 'np-note-text';
    this.estimateNote.hidden = true;
    this.spend = new SpendTiles(strings, this.formats);
    this.pace = new PaceCards(strings, this.formats);
    this.details = new TokenDetailsView(strings, this.formats);
    const privacy = document.createElement('p');
    privacy.className = 'np-privacy';
    privacy.textContent = strings.privacy;
    this.breakdown = new Breakdown(
      strings,
      this.formats,
      this.state.grouping === 'project' ? 'project' : 'session',
      (grouping) => this.remember({ grouping }),
      {
        mark: (span) => {
          if (!this.table) this.chart.mark(span);
        },
        zoom: (span) => this.zoomTo(span),
      },
    );
    // The timeline in one half, the cost and the tokens by type in the other; one under the other
    // where there is no room. The window shown heads the timeline, with the chart's own controls.
    const timeline = document.createElement('div');
    timeline.className = 'np-card np-timeline';
    const timelineHeader = document.createElement('div');
    timelineHeader.className = 'np-card-header';
    timelineHeader.append(this.zoomLabel, this.chartControls());
    const notes = document.createElement('div');
    notes.className = 'np-card-notes';
    notes.append(hint, this.measureNote, this.estimateNote);
    timeline.append(timelineHeader, this.body, notes);
    this.columns.className = 'np-columns';
    this.columns.append(this.spend.element, timeline, this.details.element);
    main.append(header, this.pace.element, this.columns, this.breakdown.element, privacy);
    app.replaceChildren(main);

    new ResizeObserver(() => this.draw()).observe(this.body);
  }

  private controls(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'np-controls';
    const ranges = document.createElement('div');
    ranges.className = 'np-segmented';
    ranges.setAttribute('role', 'group');
    ranges.setAttribute('aria-label', this.strings.rangeLabel);
    for (const range of RANGES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = this.strings.ranges[range];
      button.addEventListener('click', () => {
        if (this.data?.range === range) return;
        // The host leaves the zoom behind with the old range.
        clearTimeout(this.zoomTimer);
        this.zoomTimer = undefined;
        this.pending = undefined;
        this.body.classList.add('np-loading');
        vscode.postMessage({ type: 'range', range });
      });
      this.rangeButtons.set(range, button);
      ranges.append(button);
    }
    // A quota week at a time, from anywhere: the week before this one, then on either side.
    const weeks = document.createElement('div');
    weeks.className = 'np-segmented';
    weeks.setAttribute('role', 'group');
    weeks.setAttribute('aria-label', this.strings.ranges.week);
    for (const [button, text, label, step] of [
      [this.previousWeek, `‹ ${this.strings.previousWeek}`, this.strings.previousWeek, -1],
      [this.nextWeek, `${this.strings.nextWeek} ›`, this.strings.nextWeek, 1],
    ] as const) {
      button.type = 'button';
      button.textContent = text;
      button.setAttribute('aria-label', label);
      button.disabled = true;
      button.addEventListener('click', () => this.stepWeek(step));
      weeks.append(button);
    }

    this.zoomLabel.className = 'np-zoom-label';
    const zoom = document.createElement('div');
    zoom.className = 'np-segmented';
    for (const [button, text, label, factor] of [
      [this.zoomOutButton, '−', this.strings.zoomOut, 2],
      [this.zoomInButton, '+', this.strings.zoomIn, 0.5],
    ] as const) {
      button.type = 'button';
      button.className = 'np-zoom-step';
      button.textContent = text;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => {
        const view = this.view;
        if (view) this.zoom(scaleWindow(view, factor, (view.from + view.to) / 2), 0);
      });
      zoom.append(button);
    }
    this.resetButton.type = 'button';
    this.resetButton.className = 'np-view-toggle';
    this.resetButton.textContent = this.strings.resetZoom;
    this.resetButton.disabled = true;
    this.resetButton.addEventListener('click', () => this.zoom(undefined, 0));
    const measure = document.createElement('div');
    measure.className = 'np-segmented';
    measure.setAttribute('role', 'group');
    measure.setAttribute('aria-label', this.strings.measureLabel);
    measure.title = this.strings.measureLabel;
    for (const value of ['cost', 'tokens'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = this.strings.measures[value];
      button.addEventListener('click', () => {
        this.remember({ measure: value });
        this.draw();
        if (this.data) this.breakdown.render(this.data, this.measure);
      });
      this.measureButtons.set(value, button);
      measure.append(button);
    }
    row.append(ranges, weeks, zoom, this.resetButton, measure);
    return row;
  }

  /** What only the timeline answers to: how its columns split, and chart or table. */
  private chartControls(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'np-controls';
    const split = document.createElement('div');
    split.className = 'np-segmented';
    split.setAttribute('role', 'group');
    split.setAttribute('aria-label', this.strings.splitLabel);
    split.title = this.strings.splitLabel;
    for (const [value, label] of [
      ['model', this.strings.splitByModel],
      ['effort', this.strings.splitByEffort],
      ['type', this.strings.splitByType],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        this.remember({ split: value });
        this.draw();
      });
      this.splitButtons.set(value, button);
      split.append(button);
    }
    this.viewButton.type = 'button';
    this.viewButton.className = 'np-view-toggle';
    this.viewButton.addEventListener('click', () => {
      this.remember({ table: !this.table });
      this.draw();
    });
    row.append(split, this.viewButton);
    return row;
  }

  /** Shows the quota week before or after the one in focus, which is this one outside the range. */
  private stepWeek(step: -1 | 1): void {
    const data = this.data;
    if (!data) return;
    clearTimeout(this.zoomTimer);
    this.zoomTimer = undefined;
    this.pending = undefined;
    this.body.classList.add('np-loading');
    const offset = (data.range === 'week' ? data.week.offset : 0) + step;
    vscode.postMessage({ type: 'week', offset });
  }

  /** The window on screen: the one asked for while the host works, then the host's. */
  private get view(): TimeWindow | undefined {
    return this.pending ?? (this.data && { from: this.data.from, to: this.data.to });
  }

  /** Zooms to a session or project from the table, with a margin, and brings the chart into view. */
  private zoomTo(span: TimeWindow): void {
    this.chart.mark(undefined);
    const center = (span.from + span.to) / 2;
    const half = Math.max((span.to - span.from) * 0.55, MIN_WINDOW_MS / 2);
    this.zoom({ from: center - half, to: center + half }, 0);
    if (this.zoomLabel.getBoundingClientRect().top < 0) this.zoomLabel.scrollIntoView();
  }

  /** Shows `window` (or the whole range) at once and asks the host for it when it settles. */
  private zoom(window: TimeWindow | undefined, delay: number): void {
    const data = this.data;
    if (!data) return;
    const target = window && clampWindow(window, data.extent);
    const whole = !target || coversExtent(target, data.extent);
    this.pending = whole ? data.extent : target;
    this.draw();
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => {
      this.zoomTimer = undefined;
      vscode.postMessage(whole ? { type: 'zoom' } : { type: 'zoom', window: target });
    }, delay);
  }

  show(data: TimelineData): void {
    this.data = data;
    // A zoom still settling keeps its window until the host answers it.
    if (this.zoomTimer === undefined) this.pending = undefined;
    this.body.classList.remove('np-loading');
    app.querySelector('main')?.setAttribute('aria-busy', 'false');
    for (const [range, button] of this.rangeButtons) {
      button.setAttribute('aria-pressed', String(range === data.range));
    }
    const offset = data.range === 'week' ? data.week.offset : 0;
    this.previousWeek.disabled = offset <= data.week.oldest;
    this.nextWeek.disabled = offset >= 0 || data.range !== 'week';
    // Before the chart: whether the details show sets how wide the chart is.
    this.details.render(data.tokenDetails);
    this.draw();
    this.spend.render(data.spend);
    this.pace.render(data.pace);
    this.breakdown.render(data, this.measure);
  }

  private get table(): boolean {
    return this.state.table === true;
  }

  private get split(): TokenSplit {
    const split = this.state.split;
    return split === 'effort' || split === 'type' ? split : 'model';
  }

  private get measure(): TokenMeasure {
    return this.state.measure === 'tokens' ? 'tokens' : 'cost';
  }

  /** Kept by VS Code while the panel lives, hidden or not. */
  private remember(change: ViewState): void {
    this.state = { ...this.state, ...change };
    vscode.setState(this.state);
  }

  private draw(): void {
    const data = this.data;
    this.viewButton.textContent = this.table ? this.strings.showChart : this.strings.showTable;
    for (const [value, button] of this.splitButtons) {
      button.setAttribute('aria-pressed', String(value === this.split));
    }
    for (const [value, button] of this.measureButtons) {
      button.setAttribute('aria-pressed', String(value === this.measure));
    }
    this.measureNote.textContent = this.strings.measureNotes[this.measure];
    if (!data) return;
    const view = this.view!;
    const estimate = data.quotaEstimate ?? [];
    // The chart draws the week ahead whenever it reaches the present; the table doesn't.
    const ahead =
      !this.table &&
      data.pace !== undefined &&
      view.to >= data.extent.to &&
      data.extent.to >= data.pace.now;
    this.estimateNote.hidden = estimate.length === 0 && !ahead;
    // A drop to zero that is not the weekly reset: a week reset by hand.
    const restarted = estimate.some(
      (point, i) =>
        i > 0 &&
        point.weekly === 0 &&
        (estimate[i - 1].weekly ?? 0) > 0 &&
        estimate[i - 1].time === point.time &&
        !data.weeklyResets.includes(point.time),
    );
    this.estimateNote.textContent = restarted
      ? `${this.strings.estimateNote} ${this.strings.estimateResetNote}`
      : this.strings.estimateNote;
    const zoomed = !coversExtent(view, data.extent);
    // The window shown, zoomed or not, so the line keeps its place; how long it is when zoomed.
    // A whole quota week runs to its reset, past now for this one.
    const shown =
      data.range === 'week' && !zoomed
        ? this.formats.window(data.week.from, data.week.to)
        : this.formats.window(view.from, view.to);
    this.zoomLabel.textContent = zoomed
      ? `${shown} · ${this.formats.duration(view.to - view.from)}`
      : shown;
    this.zoomOutButton.disabled = !zoomed;
    this.zoomInButton.disabled = view.to - view.from <= MIN_WINDOW_MS;
    this.resetButton.disabled = !zoomed;
    if (this.table) {
      // Half the width can be narrower than the table's columns; and as tall as the chart, so
      // the panel doesn't jump between the two.
      const scroll = document.createElement('div');
      scroll.className = 'np-table-scroll';
      scroll.style.maxHeight = `${CHART_HEIGHT}px`;
      scroll.append(timelineTable(data, this.strings, this.formats, this.split, this.measure));
      this.body.replaceChildren(scroll);
      return;
    }
    if (this.chart.element.parentElement !== this.body)
      this.body.replaceChildren(this.chart.element);
    this.chart.split = this.split;
    this.chart.measure = this.measure;
    this.chart.render(data, this.body.clientWidth, this.pending);
  }
}

let panel: Panel | undefined;

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    document.documentElement.lang = message.locale;
    panel = new Panel(message.strings, message.locale);
  } else if (message.type === 'timeline') {
    panel?.show(message.data);
  }
});

vscode.postMessage({ type: 'ready' });
