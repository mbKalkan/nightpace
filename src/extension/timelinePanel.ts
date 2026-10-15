import * as vscode from 'vscode';
import {
  RANGES,
  type HostToWebviewMessage,
  type RangeKey,
  type TimeWindow,
  type WebviewToHostMessage,
} from '../shared/protocol';
import { panelStrings } from './texts';
import type { TimelineSource } from './timelineSource';
import { buildWebviewHtml } from './webviewHtml';

export const TIMELINE_VIEW_TYPE = 'nightpace.timeline';
const RANGE_KEY = 'nightpace.timelineRange';
/** While the panel shows, new transcript lines and snapshots appear within this time. */
const REFRESH_MS = 60_000;

export interface TimelineContext {
  extensionUri: vscode.Uri;
  /** Remembers the chosen time range across panels and windows. */
  state: vscode.Memento;
  source: TimelineSource;
  log(message: string): void;
}

/** The one timeline panel: shown again rather than opened twice. */
export class TimelinePanel {
  private static current: TimelinePanel | undefined;

  static show(context: TimelineContext): void {
    if (TimelinePanel.current) {
      TimelinePanel.current.panel.reveal();
      return;
    }
    const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(
      TIMELINE_VIEW_TYPE,
      'Nightpace',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [dist], retainContextWhenHidden: true },
    );
    TimelinePanel.current = new TimelinePanel(panel, dist, context);
  }

  /** Redraws the open panel, if any: a new snapshot arrived. */
  static refresh(): void {
    void TimelinePanel.current?.update();
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private ready = false;
  private updating = 0;
  /** The part of the range zoomed into; not remembered past the panel. */
  private zoom: TimeWindow | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    dist: vscode.Uri,
    private readonly context: TimelineContext,
  ) {
    const { webview } = panel;
    webview.html = buildWebviewHtml({
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview', 'main.js')).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview', 'main.css')).toString(),
      lang: vscode.env.language,
    });
    this.timer = setInterval(() => {
      if (this.panel.visible) void this.update();
    }, REFRESH_MS);
    this.disposables.push(
      webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.receive(message)),
      panel.onDidChangeViewState(() => {
        if (this.panel.visible) void this.update();
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private get range(): RangeKey {
    const saved = this.context.state.get<string>(RANGE_KEY);
    return RANGES.find((range) => range === saved) ?? '24h';
  }

  private receive(message: WebviewToHostMessage): void {
    if (message.type === 'ready') {
      this.ready = true;
      this.post({
        type: 'init',
        locale: vscode.env.language,
        strings: panelStrings(vscode.l10n.t),
      });
      void this.update();
    } else if (message.type === 'range' && RANGES.includes(message.range)) {
      this.zoom = undefined;
      void this.context.state.update(RANGE_KEY, message.range).then(() => this.update());
    } else if (message.type === 'zoom') {
      const { window } = message;
      this.zoom =
        window &&
        Number.isFinite(window.from) &&
        Number.isFinite(window.to) &&
        window.from < window.to
          ? { from: window.from, to: window.to }
          : undefined;
      void this.update();
    }
  }

  private async update(): Promise<void> {
    if (!this.ready) return;
    // A slower, older update must not replace a newer one.
    const id = ++this.updating;
    try {
      const data = await this.context.source.timeline(this.range, this.zoom);
      if (id === this.updating) this.post({ type: 'timeline', data });
    } catch (error) {
      this.context.log(`Timeline: ${String(error)}`);
    }
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    TimelinePanel.current = undefined;
    clearInterval(this.timer);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}
