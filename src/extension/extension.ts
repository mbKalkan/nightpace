import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { accountKey, parseInitializeAccount } from './quota/account';
import { CLAUDE_EXTENSION_ID, claudeBinaries } from './quota/claudeBinary';
import { QuotaError, requestUsage, sdkCommand } from './quota/claudeProcess';
import { QuotaRecorder } from './quota/recorder';
import { parseUsageResponse, type QuotaSnapshot } from './quota/snapshot';
import {
  claudeSources,
  expandHome,
  normalizeDir,
  signedInAccount,
  sourceEnv,
  type ClaudeSource,
} from './quota/sources';
import { QuotaStatusBar } from './statusBar';
import { LimitStore } from './store/limitStore';
import { QuotaStore } from './store/quotaStore';
import { RequestStore } from './store/requestStore';
import { TimelinePanel } from './timelinePanel';
import { TimelineSource } from './timelineSource';
import { scanTranscripts, skipToEnd } from './transcripts/scanner';

/** Keeps requests before Claude Code deletes old transcripts, without slowing VS Code's start. */
const FIRST_SYNC_MS = 2 * 60_000;
const SYNC_EVERY_MS = 60 * 60_000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Nightpace', { log: true });
  const store = new QuotaStore(context.globalStorageUri.fsPath);
  const statusBar = new QuotaStatusBar();
  // The folders known at once; the ones remembered and named join when the settings are applied.
  let sources = claudeSources({ home: homedir(), current: currentConfigDir() });
  /** The latest snapshot of the folder VS Code's Claude Code uses. */
  let current: QuotaSnapshot | undefined;
  const source = new TimelineSource(
    () => sources.map(({ projects, configDir }) => ({ projects, configDir })),
    store,
    new RequestStore(context.globalStorageUri.fsPath),
    new LimitStore(context.globalStorageUri.fsPath),
  );
  const sync = () =>
    source.sync().catch((error: unknown) => output.warn(`Requests: ${String(error)}`));
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  const firstSync = setTimeout(() => {
    void sync();
    syncTimer = setInterval(() => void sync(), SYNC_EVERY_MS);
  }, FIRST_SYNC_MS);

  // One recorder per config folder, made again when a folder becomes or stops being VS Code's.
  const recorders = new Map<string, QuotaRecorder>();
  const recorderFor = (folder: ClaudeSource, key: string): QuotaRecorder => {
    const recorder: QuotaRecorder = new QuotaRecorder({
      query: () => askClaudeCode(folder),
      lastActivity: transcriptActivity(folder.projects),
      signedIn: signedInAccount(folder.configFile),
      needsSignIn: !folder.current,
      lastPoll: () => store.lastPoll(folder.configDir),
      recordPoll: (record) => store.recordPoll(record, folder.configDir),
      append: (snapshot) => store.append(snapshot),
      onSnapshot: (snapshot) => {
        // A poll that was under way when its recorder was replaced shows nothing.
        if (recorders.get(key) !== recorder) return;
        if (folder.current) {
          current = snapshot;
          statusBar.show(snapshot);
        }
        TimelinePanel.refresh();
      },
      log: (message) =>
        output.warn(folder.configDir ? `${message} (${folder.configDir})` : message),
    });
    return recorder;
  };
  const stopRecorders = () => {
    for (const recorder of recorders.values()) recorder.stop();
    recorders.clear();
  };
  const startRecorders = () => {
    const wanted = new Map(sources.map((folder) => [recorderKey(folder), folder]));
    for (const [key, recorder] of recorders) {
      if (wanted.has(key)) continue;
      recorder.stop();
      recorders.delete(key);
    }
    for (const [key, folder] of wanted) {
      if (recorders.has(key)) continue;
      const recorder = recorderFor(folder, key);
      recorders.set(key, recorder);
      recorder.start();
    }
  };

  const quotaEnabled = () =>
    vscode.workspace.getConfiguration('nightpace').get<boolean>('quota.enabled', true);
  const applySettings = async () => {
    const configDir = currentConfigDir();
    let remembered: string[] = [];
    try {
      if (configDir) await store.rememberConfigDir(normalizeDir(configDir));
      remembered = await store.configDirs();
    } catch (error) {
      output.warn(`Config folders: ${String(error)}`);
    }
    const before = currentFolder(sources);
    sources = claudeSources({
      home: homedir(),
      current: configDir,
      others: [...remembered, ...namedConfigDirs()],
    });
    if (currentFolder(sources) !== before) {
      // Another account's numbers until the new folder's own arrive would mislead.
      current = undefined;
      statusBar.show(undefined);
    }
    if (quotaEnabled()) {
      startRecorders();
    } else {
      stopRecorders();
      current = undefined;
      statusBar.show(undefined);
    }
  };
  // One at a time, in order, so an older run can't finish last with stale folders.
  let applying = Promise.resolve();
  const apply = () =>
    (applying = applying
      .then(applySettings)
      .catch((error: unknown) => output.warn(`Settings: ${String(error)}`)));
  void apply();

  context.subscriptions.push(
    output,
    statusBar,
    { dispose: stopRecorders },
    {
      dispose: () => {
        clearTimeout(firstSync);
        clearInterval(syncTimer);
      },
    },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('nightpace.quota.enabled') ||
        event.affectsConfiguration('nightpace.claudeConfigDirs') ||
        event.affectsConfiguration('claudeCode.environmentVariables')
      ) {
        void apply();
      }
    }),
    vscode.commands.registerCommand('nightpace.showTimeline', () =>
      TimelinePanel.show({
        extensionUri: context.extensionUri,
        state: context.globalState,
        source,
        currentAccount: () => (current?.account ? accountKey(current.account) : undefined),
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
            "The quota history and the usage kept from Claude Code logs that have since been deleted can't be recovered. Claude Code's own logs are not touched.",
          ),
        },
        remove,
      );
      if (answer !== remove) return;
      await store.clear();
      await source.reset();
      current = undefined;
      statusBar.show(undefined);
      await apply();
      TimelinePanel.refresh();
      vscode.window.setStatusBarMessage(vscode.l10n.t('Nightpace data deleted'), 3000);
    }),
  );
}

export function deactivate(): void {}

/** A recorder stands for a folder, and for whether VS Code's Claude Code uses it. */
function recorderKey(folder: ClaudeSource): string {
  return `${folder.configDir ?? ''}|${folder.current ? 'current' : ''}`;
}

/** The folder VS Code's Claude Code uses, as `ClaudeSource.configDir` names it: '' for the default. */
function currentFolder(sources: readonly ClaudeSource[]): string {
  return sources.find((folder) => folder.current)?.configDir ?? '';
}

/**
 * A setting from the user's own settings only. What starts Claude Code, and which folders it
 * reads, must never come from a workspace someone else wrote; VS Code keeps machine settings out
 * of workspaces, but only for settings an installed extension declares.
 */
function userSetting(section: string, name: string): unknown {
  return vscode.workspace.getConfiguration(section).inspect<unknown>(name)?.globalValue;
}

/** What VS Code's Claude Code starts Claude with, from its `environmentVariables` setting. */
function claudeCodeEnv(): Record<string, string> {
  const variables = userSetting('claudeCode', 'environmentVariables');
  const env: Record<string, string> = {};
  if (!Array.isArray(variables)) return env;
  for (const variable of variables as Array<{ name?: unknown; value?: unknown }>) {
    if (typeof variable?.name === 'string' && variable.name && typeof variable.value === 'string') {
      env[variable.name] = variable.value;
    }
  }
  return env;
}

/** The config folder VS Code's Claude Code uses; none for the default one. */
function currentConfigDir(): string | undefined {
  return (
    claudeCodeEnv().CLAUDE_CONFIG_DIR?.trim() || process.env.CLAUDE_CONFIG_DIR?.trim() || undefined
  );
}

/** Config folders the user asked Nightpace to follow too, such as one the terminal's Claude uses. */
function namedConfigDirs(): string[] {
  const dirs = userSetting('nightpace', 'claudeConfigDirs');
  if (!Array.isArray(dirs)) return [];
  return dirs
    .filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '')
    .map((dir) => expandHome(dir.trim(), homedir()));
}

/**
 * Asks the Claude Code its VS Code extension runs, or the one on the PATH, for the quota of the
 * account a config folder is signed in to.
 */
async function askClaudeCode(folder: ClaudeSource): Promise<QuotaSnapshot> {
  const [binary] = claudeBinaries({
    platform: process.platform,
    claudeExtensionPath: vscode.extensions.getExtension(CLAUDE_EXTENSION_ID)?.extensionPath,
    path: process.env.PATH,
  });
  if (!binary) throw new QuotaError('not-found', 'Claude Code is not installed');
  const time = Date.now();
  const reply = await requestUsage(sdkCommand(binary), {
    env: sourceEnv(folder, process.env, claudeCodeEnv()),
  });
  const snapshot = parseUsageResponse(reply.usage, time);
  if (!snapshot) throw new QuotaError('refused', 'Claude Code sent a reply Nightpace cannot read');
  const account = parseInitializeAccount(reply.init);
  return {
    ...snapshot,
    ...(account && { account }),
    ...(folder.configDir !== undefined && { configDir: folder.configDir }),
  };
}

/** When Claude Code last wrote a transcript in a folder, from what was appended since the last look. */
function transcriptActivity(projects: string): () => Promise<number | undefined> {
  const offsets = new Map<string, number>();
  let started = false;
  let latest: number | undefined;
  return async () => {
    if (!started) {
      started = true;
      latest = await skipToEnd([projects], offsets);
      return latest;
    }
    await scanTranscripts([projects], offsets, (event) => {
      latest = Math.max(latest ?? event.time, event.time);
    });
    return latest;
  };
}
