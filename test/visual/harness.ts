import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { panelStrings, type Translate } from '../../src/extension/texts';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import type { HostToWebviewMessage } from '../../src/shared/protocol';
import { themes, type ThemeName } from './themes';

interface Theme {
  kind: string;
  classes: readonly string[];
  variables: Record<string, string>;
}

const ORIGIN = 'http://webview.test';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

/** English, as VS Code shows it without a language pack. */
export const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

export const strings = panelStrings(english);

/**
 * Loads the built webview (dist/webview) the way VS Code does: same HTML, same CSP,
 * a stubbed `acquireVsCodeApi`, and theme variables on the root element.
 */
export async function openPanel(page: Page, theme: ThemeName) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/index.html') {
      await route.fulfill({
        contentType: 'text/html',
        body: buildWebviewHtml({
          cspSource: ORIGIN,
          scriptUri: `${ORIGIN}/dist/webview/main.js`,
          styleUri: `${ORIGIN}/dist/webview/main.css`,
          lang: 'en',
        }),
      });
      return;
    }
    try {
      const body = readFileSync(join(process.cwd(), path));
      await route.fulfill({ body, contentType: CONTENT_TYPES[extname(path)] });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });

  await page.addInitScript(
    ({ theme }) => {
      const sent: unknown[] = [];
      // VS Code replaces all theme variables and classes on a theme change.
      const applyTheme = ({ kind, classes, variables }: typeof theme) => {
        const root = document.documentElement;
        for (const name of [...root.style]) {
          if (name.startsWith('--vscode-')) root.style.removeProperty(name);
        }
        for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
        document.body.classList.remove(
          'vscode-dark',
          'vscode-light',
          'vscode-high-contrast',
          'vscode-high-contrast-light',
        );
        document.body.classList.add(...classes);
        document.body.dataset.vscodeThemeKind = kind;
      };
      Object.assign(window, {
        __sent: sent,
        __applyTheme: applyTheme,
        acquireVsCodeApi: () => {
          let state: unknown;
          return {
            postMessage: (message: unknown) => sent.push(message),
            getState: () => state,
            setState: (value: unknown) => void (state = value),
          };
        },
      });
      // Init scripts run before the document exists, so theme it once parsing is done.
      document.addEventListener('DOMContentLoaded', () => applyTheme(theme));
    },
    { theme: themes[theme] as Theme },
  );

  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() =>
    (window as unknown as { __sent: { type: string }[] }).__sent.some((m) => m.type === 'ready'),
  );

  return {
    problems,
    /** Delivers a message as if it came from the extension host. */
    async post(message: HostToWebviewMessage) {
      await page.evaluate(
        (data) => window.dispatchEvent(new MessageEvent('message', { data })),
        message,
      );
    },
    /** Sends what the host sends once the webview says it is ready. */
    async init() {
      await this.post({ type: 'init', locale: 'en', strings });
    },
    /** Switches the theme the way VS Code does: CSS variables plus body classes. */
    async setTheme(name: ThemeName) {
      await page.evaluate(
        (theme) => (window as unknown as { __applyTheme(theme: Theme): void }).__applyTheme(theme),
        themes[name] as Theme,
      );
    },
    sent: () => page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent),
  };
}
