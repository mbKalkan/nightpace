# Nightpace

**Claude Code quota pace for VS Code.** See how fast your 5-hour and weekly Claude limits are burning, how many sessions are running in parallel, and which models and effort levels use your tokens. Then plan ahead with rates measured from your own history: _"At this pace, three xhigh sessions run out on Thursday; two last until Sunday."_

> **Status:** early development. Not yet published.

## Features

- **Timeline:** run **Nightpace: Show Timeline** for the last 24 hours, 7 days or 30 days on one time axis: the 5-hour and weekly quota as Claude Code reported it, how many sessions were working at once, and tokens by model, weighted the way API prices weigh them. Hover or use the arrow keys for every value at a time, or switch to a table. Drag across the chart (or Ctrl + scroll, or pinch) to zoom into part of the range; columns get finer as you zoom in. Split the token columns by model or by effort level. Below it, see which sessions and projects used the tokens of the period shown, with their models and effort levels.
- **Status bar:** your plan's 5-hour and weekly usage and when the 5-hour window resets, like `5h 63% · Wk 41% · ↻14:02`, turning yellow at 80% and red at 95%. Hover for per-model weekly limits.

## Planned features

- **Measured, not guessed:** quota rates are calibrated from your own observed usage; anything estimated is labelled as an estimate.
- **Scenario planner:** compare session count, effort level and model, and see when each runs out.

## Privacy

Local-first, with no telemetry, and Nightpace itself makes no network requests. It reads usage metadata (timestamps, models, effort levels, token counts) from Claude Code's local session logs and never stores your prompts, Claude's replies, tool output or source code. It keeps that metadata, with the folder each session ran in, in VS Code's storage for the extension, so your history outlasts Claude Code deleting old logs and opens without reading them all again.

For the quota, Nightpace asks Claude Code: every 5 minutes while you work and hourly otherwise, it starts Claude Code briefly and asks for the plan's usage, the same request the Claude Code extension makes for its own usage view. Claude Code gets the numbers from Anthropic. No prompt is sent, no quota is used, and Nightpace never reads your credentials. Turn it off with the `nightpace.quota.enabled` setting; **Nightpace: Delete Recorded Data** deletes everything it kept.

## License

[MIT](LICENSE) © MBK Dev Studio
