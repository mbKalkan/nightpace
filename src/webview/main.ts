import './styles/panel.css';
import {
  RANGES,
  type HostToWebviewMessage,
  type PanelStrings,
  type RangeKey,
  type TimelineData,
} from '../shared/protocol';
import { TimelineChart } from './chart/timelineChart';
import { Formats } from './format';
import { timelineTable } from './table';
import { vscode } from './vscodeApi';

const app = document.getElementById('app') as HTMLElement;

interface ViewState {
  table?: boolean;
}

class Panel {
  private readonly formats: Formats;
  private readonly chart: TimelineChart;
  private readonly body = document.createElement('div');
  private readonly rangeButtons = new Map<RangeKey, HTMLButtonElement>();
  private readonly viewButton = document.createElement('button');
  private data: TimelineData | undefined;
  private table = (vscode.getState() as ViewState | undefined)?.table === true;

  constructor(
    private readonly strings: PanelStrings,
    locale: string,
  ) {
    this.formats = new Formats(locale);
    this.chart = new TimelineChart(strings, this.formats);

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
    const note = document.createElement('p');
    note.className = 'np-note-text';
    note.textContent = strings.tokensNote;
    const privacy = document.createElement('p');
    privacy.className = 'np-privacy';
    privacy.textContent = strings.privacy;
    main.append(header, this.body, note, privacy);
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
        this.body.classList.add('np-loading');
        vscode.postMessage({ type: 'range', range });
      });
      this.rangeButtons.set(range, button);
      ranges.append(button);
    }
    this.viewButton.type = 'button';
    this.viewButton.className = 'np-view-toggle';
    this.viewButton.addEventListener('click', () => {
      this.table = !this.table;
      vscode.setState({ table: this.table } satisfies ViewState);
      this.draw();
    });
    row.append(ranges, this.viewButton);
    return row;
  }

  show(data: TimelineData): void {
    this.data = data;
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
    if (this.table) {
      this.body.replaceChildren(timelineTable(data, this.strings, this.formats));
      return;
    }
    if (this.chart.element.parentElement !== this.body)
      this.body.replaceChildren(this.chart.element);
    this.chart.render(data, this.body.clientWidth);
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
