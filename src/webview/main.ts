import './styles/panel.css';
import {
  RANGES,
  type HostToWebviewMessage,
  type PanelStrings,
  type RangeKey,
  type TimelineData,
  type TimeWindow,
} from '../shared/protocol';
import { clampWindow, coversExtent, MIN_WINDOW_MS, scaleWindow } from '../shared/window';
import { TimelineChart } from './chart/timelineChart';
import { Formats } from './format';
import { timelineTable } from './table';
import { vscode } from './vscodeApi';

const app = document.getElementById('app') as HTMLElement;
/** Scrolling and pinching zoom in many small steps: the host builds only where they settle. */
const ZOOM_SETTLE_MS = 150;

interface ViewState {
  table?: boolean;
}

class Panel {
  private readonly formats: Formats;
  private readonly chart: TimelineChart;
  private readonly body = document.createElement('div');
  private readonly rangeButtons = new Map<RangeKey, HTMLButtonElement>();
  private readonly viewButton = document.createElement('button');
  private readonly zoomLabel = document.createElement('span');
  private readonly zoomInButton = document.createElement('button');
  private readonly zoomOutButton = document.createElement('button');
  private readonly resetButton = document.createElement('button');
  private data: TimelineData | undefined;
  /** The window shown at once while the host builds it. */
  private pending: TimeWindow | undefined;
  private zoomTimer: ReturnType<typeof setTimeout> | undefined;
  private table = (vscode.getState() as ViewState | undefined)?.table === true;

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

    this.body.className = 'np-body';
    const loading = document.createElement('p');
    loading.className = 'np-note-text';
    loading.textContent = strings.loading;
    this.body.append(loading);
    const hint = document.createElement('p');
    hint.className = 'np-note-text';
    hint.textContent = strings.zoomHint;
    const note = document.createElement('p');
    note.className = 'np-note-text';
    note.textContent = strings.tokensNote;
    const privacy = document.createElement('p');
    privacy.className = 'np-privacy';
    privacy.textContent = strings.privacy;
    main.append(header, this.body, hint, note, privacy);
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
    this.resetButton.hidden = true;
    this.resetButton.addEventListener('click', () => this.zoom(undefined, 0));
    this.viewButton.type = 'button';
    this.viewButton.className = 'np-view-toggle';
    this.viewButton.addEventListener('click', () => {
      this.table = !this.table;
      vscode.setState({ table: this.table } satisfies ViewState);
      this.draw();
    });
    row.append(this.zoomLabel, ranges, zoom, this.resetButton, this.viewButton);
    return row;
  }

  /** The window on screen: the one asked for while the host works, then the host's. */
  private get view(): TimeWindow | undefined {
    return this.pending ?? (this.data && { from: this.data.from, to: this.data.to });
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
    this.draw();
  }

  private draw(): void {
    const data = this.data;
    this.viewButton.textContent = this.table ? this.strings.showChart : this.strings.showTable;
    if (!data) return;
    const view = this.view!;
    const zoomed = !coversExtent(view, data.extent);
    this.zoomLabel.textContent = zoomed ? this.formats.window(view.from, view.to) : '';
    this.zoomOutButton.disabled = !zoomed;
    this.zoomInButton.disabled = view.to - view.from <= MIN_WINDOW_MS;
    this.resetButton.hidden = !zoomed;
    if (this.table) {
      this.body.replaceChildren(timelineTable(data, this.strings, this.formats));
      return;
    }
    if (this.chart.element.parentElement !== this.body)
      this.body.replaceChildren(this.chart.element);
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
