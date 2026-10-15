import * as vscode from 'vscode';
import { TimelinePanel } from './timelinePanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('nightpace.showTimeline', () =>
      TimelinePanel.show(context.extensionUri),
    ),
  );
}

export function deactivate(): void {}
