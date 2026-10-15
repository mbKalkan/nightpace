# Nightpace

**Claude Code quota pace for VS Code.** See how fast your 5-hour and weekly Claude limits are burning, how many sessions are running in parallel, and which models and effort levels use your tokens. Then plan ahead with rates measured from your own history: *"At this pace, three xhigh sessions run out on Thursday; two last until Sunday."*

> **Status:** early development. Not yet published.

## Features

- **Status bar:** your plan's 5-hour and weekly usage and when the 5-hour window resets, like `5h 63% · Wk 41% · ↻14:02`, turning yellow at 80% and red at 95%. Hover for per-model weekly limits.

## Planned features

- **One timeline:** 5-hour and weekly quota %, parallel session count, and token usage by model and effort level, all on the same time axis.
- **Measured, not guessed:** quota rates are calibrated from your own observed usage; anything estimated is labelled as an estimate.
- **Scenario planner:** compare session count, effort level and model, and see when each runs out.

## Privacy

Local-first, with no telemetry, and Nightpace itself makes no network requests. It reads usage metadata (timestamps, models, effort levels, token counts) from Claude Code's local session logs and never stores your prompts, Claude's replies, tool output or source code.

For the quota, Nightpace asks Claude Code: every 5 minutes while you work and hourly otherwise, it starts Claude Code briefly and asks for the plan's usage, the same request the Claude Code extension makes for its own usage view. Claude Code gets the numbers from Anthropic. No prompt is sent, no quota is used, and Nightpace never reads your credentials. Turn it off with the `nightpace.quota.enabled` setting; **Nightpace: Delete Recorded Data** deletes the history it kept.

## License

[MIT](LICENSE) © MBK Dev Studio
