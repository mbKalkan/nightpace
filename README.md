# Nightpace

**Claude Code quota pace for VS Code.** See how fast your 5-hour and weekly Claude limits are burning, how many sessions are running in parallel, and which models and effort levels use your tokens. Then plan ahead with rates measured from your own history: *"At this pace, three xhigh sessions run out on Thursday; two last until Sunday."*

> **Status:** early development. Not yet published.

## Planned features

- **One timeline:** 5-hour and weekly quota %, parallel session count, and token usage by model and effort level, all on the same time axis.
- **Status bar:** current 5-hour and weekly usage with reset times.
- **Measured, not guessed:** quota rates are calibrated from your own observed usage; anything estimated is labelled as an estimate.
- **Scenario planner:** compare session count, effort level and model, and see when each runs out.

## Privacy

Local-first, with no network access and no telemetry. Nightpace reads usage metadata (timestamps, models, effort levels, token counts) from Claude Code's local session logs and the quota percentages Claude Code reports to its status line. It never stores your prompts, Claude's replies, tool output or source code.

## License

[MIT](LICENSE) © MBK Dev Studio
