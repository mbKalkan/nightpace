// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'MBKDevStudio.nightpace';
const VIEW_TYPE = 'nightpace.timeline';

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const timelineTabs = () =>
  vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(VIEW_TYPE),
    );

const tests: Record<string, () => Promise<void>> = {
  async 'opens the timeline from the command palette'() {
    await vscode.commands.executeCommand('nightpace.showTimeline');
    await waitFor(() => (timelineTabs().length === 1 ? true : undefined));
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID)?.isActive);
  },

  async 'shows the open timeline again instead of opening a second one'() {
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    await vscode.commands.executeCommand('nightpace.showTimeline');
    await waitFor(() => (timelineTabs()[0]?.isActive ? true : undefined));
    assert.equal(timelineTabs().length, 1);
  },
};

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.log(`  ✗ ${name}`);
      failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} smoke test(s) failed:\n${failures.join('\n')}`);
  }
}
