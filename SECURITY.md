# Security policy

Nightpace only reads usage metadata that Claude Code keeps on your machine: times, models, effort
levels, token counts and the folder a session ran in, and keeps a copy of them in VS Code's
storage for the extension. It never stores prompts, replies, tool output or code, sends no
telemetry, makes no network requests itself, and shows its panel in a webview with a strict
Content Security Policy and no network access. Claude Code's logs are treated as untrusted input
and are never written to. For the plan's quota it runs the installed Claude Code and asks it,
without sending a prompt; Nightpace never reads Claude Code's credentials.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately with GitHub's
**Report a vulnerability** button on the repository's
[Security tab](https://github.com/mbKalkan/nightpace/security). Include the steps that show the
problem if you can.

You'll get a reply within a week. Fixes are released as soon as they're ready, and reporters are
credited unless they prefer not to be.

## Supported versions

Only the latest release receives fixes.
