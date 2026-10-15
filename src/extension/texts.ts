// User-facing text. Every message goes through `t`: VS Code's `l10n.t` in the extension, a
// plain formatter in the browser tests, so both show the same words.
import type { PanelStrings } from '../shared/protocol';

export type Translate = (message: string, ...args: Array<string | number>) => string;

export function panelStrings(t: Translate): PanelStrings {
  return {
    title: t('Claude Code usage'),
    empty: t('No usage recorded yet.'),
    privacy: t(
      "Nightpace reads times, models, effort levels and token counts from Claude Code's local logs. It never stores prompts, replies, tool output or code.",
    ),
  };
}
