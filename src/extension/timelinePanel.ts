import * as vscode from 'vscode';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { panelStrings } from './texts';
import { buildWebviewHtml } from './webviewHtml';

export const TIMELINE_VIEW_TYPE = 'nightpace.timeline';

/** The one timeline panel: shown again rather than opened twice. */
export class TimelinePanel {
  private static current: TimelinePanel | undefined;

  static show(extensionUri: vscode.Uri): void {
    if (TimelinePanel.current) {
      TimelinePanel.current.panel.reveal();
      return;
    }
    const dist = vscode.Uri.joinPath(extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(
      TIMELINE_VIEW_TYPE,
      'Nightpace',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [dist], retainContextWhenHidden: true },
    );
    TimelinePanel.current = new TimelinePanel(panel, dist);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    dist: vscode.Uri,
  ) {
    const { webview } = panel;
    webview.html = buildWebviewHtml({
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview', 'main.js')).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview', 'main.css')).toString(),
      lang: vscode.env.language,
    });
    this.disposables.push(
      webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.receive(message)),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private receive(message: WebviewToHostMessage): void {
    if (message.type === 'ready') {
      this.post({
        type: 'init',
        locale: vscode.env.language,
        strings: panelStrings(vscode.l10n.t),
      });
    }
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    TimelinePanel.current = undefined;
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}
