import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { CLAUDE_EXTENSION_ID, claudeBinaries } from './quota/claudeBinary';
import { QuotaError, requestUsage, sdkCommand } from './quota/claudeProcess';
import { QuotaRecorder } from './quota/recorder';
import { parseUsageResponse } from './quota/snapshot';
import { QuotaStatusBar } from './statusBar';
import { QuotaStore } from './store/quotaStore';
import { TimelinePanel } from './timelinePanel';
import { TimelineSource } from './timelineSource';
import { scanTranscripts, skipToEnd } from './transcripts/scanner';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Nightpace', { log: true });
  const store = new QuotaStore(context.globalStorageUri.fsPath);
  const statusBar = new QuotaStatusBar();
  const source = new TimelineSource(transcriptRoots, store);
  const recorder = new QuotaRecorder({
    query: askClaudeCode,
    lastActivity: transcriptActivity(),
    lastPoll: () => store.lastPoll(),
    recordPoll: (record) => store.recordPoll(record),
    append: (snapshot) => store.append(snapshot),
    onSnapshot: (snapshot) => {
      statusBar.show(snapshot);
      TimelinePanel.refresh();
    },
    log: (message) => output.warn(message),
  });

  const quotaEnabled = () =>
    vscode.workspace.getConfiguration('nightpace').get<boolean>('quota.enabled', true);
  const applySettings = () => {
    if (quotaEnabled()) {
      recorder.start();
    } else {
      recorder.stop();
      statusBar.show(undefined);
    }
  };
  applySettings();

  context.subscriptions.push(
    output,
    statusBar,
    { dispose: () => recorder.stop() },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('nightpace.quota.enabled')) applySettings();
    }),
    vscode.commands.registerCommand('nightpace.showTimeline', () =>
      TimelinePanel.show({
        extensionUri: context.extensionUri,
        state: context.globalState,
        source,
        log: (message) => output.warn(message),
      }),
    ),
    vscode.commands.registerCommand('nightpace.deleteData', async () => {
      const remove = vscode.l10n.t('Delete');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete everything Nightpace has recorded?'),
        {
          modal: true,
          detail: vscode.l10n.t(
            "The quota history can't be recovered. Claude Code's own logs are not touched.",
          ),
        },
        remove,
      );
      if (answer !== remove) return;
      await store.clear();
      statusBar.show(undefined);
      TimelinePanel.refresh();
      vscode.window.setStatusBarMessage(vscode.l10n.t('Nightpace data deleted'), 3000);
    }),
  );
}

export function deactivate(): void {}

/** Asks the Claude Code its VS Code extension runs, or the one on the PATH. */
async function askClaudeCode() {
  const [binary] = claudeBinaries({
    platform: process.platform,
    claudeExtensionPath: vscode.extensions.getExtension(CLAUDE_EXTENSION_ID)?.extensionPath,
    path: process.env.PATH,
  });
  if (!binary) throw new QuotaError('not-found', 'Claude Code is not installed');
  const time = Date.now();
  const snapshot = parseUsageResponse(await requestUsage(sdkCommand(binary)), time);
  if (!snapshot) throw new QuotaError('refused', 'Claude Code sent a reply Nightpace cannot read');
  return snapshot;
}

/** Folders Claude Code keeps its transcripts in. */
function transcriptRoots(): string[] {
  const roots = [join(homedir(), '.claude', 'projects')];
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir) roots.unshift(join(configDir, 'projects'));
  return [...new Set(roots)];
}

/** When Claude Code last wrote a transcript, from what was appended since the last look. */
function transcriptActivity(): () => Promise<number | undefined> {
  const offsets = new Map<string, number>();
  let started = false;
  let latest: number | undefined;
  return async () => {
    if (!started) {
      started = true;
      latest = await skipToEnd(transcriptRoots(), offsets);
      return latest;
    }
    await scanTranscripts(transcriptRoots(), offsets, (event) => {
      latest = Math.max(latest ?? event.time, event.time);
    });
    return latest;
  };
}
