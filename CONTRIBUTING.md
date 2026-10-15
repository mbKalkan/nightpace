# Contributing to Nightpace

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/mbKalkan/nightpace/issues/new/choose) with:

- what you expected and what you saw (a screenshot of the panel helps a lot),
- your Nightpace, Claude Code, VS Code and OS versions and your color theme,
- whether you run Claude Code in the VS Code extension, in a terminal, or both.

Please don't attach Claude Code session logs: they contain your prompts and code.

## Development setup

Requires [Node.js](https://nodejs.org/) 22 or later.

```bash
npm install
npm run build        # bundle the extension and the webview into dist/
npm run watch        # rebuild on change
```

Press <kbd>F5</kbd> in VS Code to start an Extension Development Host. Alternatively, build a
package with `npm run package` and install the `.vsix` with **Extensions: Install from VSIX…**.

## Project layout

| Path             | What lives there                                                  |
| ---------------- | ----------------------------------------------------------------- |
| `src/extension/` | Extension host: commands, the panel, reading Claude Code's data   |
| `src/webview/`   | The timeline UI that runs in the webview                          |
| `src/shared/`    | Code used on both sides: the message protocol                     |
| `test/unit/`     | Unit tests (Vitest)                                               |
| `test/visual/`   | Browser tests of the panel UI in four color themes (Playwright)   |
| `test/smoke/`    | End-to-end tests in a real copy of VS Code                        |
| `scripts/`       | Build and helper scripts                                          |

The webview never touches the file system or the network: the extension host reads the data and
sends it with `postMessage`, and the panel runs under a strict Content Security Policy.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
npm run format:check # Prettier (npm run format fixes it)
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm test             # unit tests
npm run test:visual  # browser tests (uses Microsoft Edge on Windows, Chromium elsewhere)
npm run test:smoke   # end-to-end tests in a downloaded copy of VS Code
```

If you change the UI, look at the screenshots the browser tests save in `test-results/screens`,
in both the dark and the light theme.

Test data is synthetic. Never commit real Claude Code logs or usage numbers, yours or anyone
else's.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- Write commit messages and PR titles as
  [Conventional Commits](https://www.conventionalcommits.org/) in the imperative mood:
  `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`, `ci: …`.
- Update `CHANGELOG.md` under `[Unreleased]` for changes users will notice.
- User-facing text goes through `vscode.l10n.t` (or `t` in `src/extension/texts.ts`); add the
  Turkish translation to `l10n/bundle.l10n.tr.json`. Manifest strings live in
  `package.nls.json` and `package.nls.tr.json`.
- New dependencies must be MIT, Apache-2.0, BSD or ISC licensed; list bundled ones in
  `THIRD_PARTY_NOTICES.md`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
