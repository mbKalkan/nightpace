import * as vscode from 'vscode';
import type { QuotaSnapshot } from './quota/snapshot';
import { quotaText } from './quotaText';

/** The quota in the status bar: hidden until there is one to show. */
export class QuotaStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'nightpace.quota',
    vscode.StatusBarAlignment.Right,
    100,
  );
  private snapshot: QuotaSnapshot | undefined;
  // Reset times pass while nothing new arrives.
  private readonly timer = setInterval(() => this.render(), 60_000);

  constructor() {
    this.item.name = vscode.l10n.t('Claude Code quota');
    this.item.command = 'nightpace.showTimeline';
  }

  show(snapshot: QuotaSnapshot | undefined): void {
    this.snapshot = snapshot;
    this.render();
  }

  private render(): void {
    const text =
      this.snapshot && quotaText(this.snapshot, Date.now(), vscode.l10n.t, vscode.env.language);
    if (!text) {
      this.item.hide();
      return;
    }
    this.item.text = `$(dashboard) ${text.text}`;
    const tooltip = new vscode.MarkdownString(
      [`**${vscode.l10n.t('Claude Code quota')}**`, ...text.tooltip].join('  \n'),
    );
    tooltip.appendMarkdown(
      `\n\n${vscode.l10n.t('Claude Code reports these numbers; Nightpace asks it every few minutes while you work.')}`,
    );
    this.item.tooltip = tooltip;
    this.item.backgroundColor =
      text.level === 'normal'
        ? undefined
        : new vscode.ThemeColor(
            text.level === 'error'
              ? 'statusBarItem.errorBackground'
              : 'statusBarItem.warningBackground',
          );
    this.item.show();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
  }
}
