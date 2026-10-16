<img src="assets/icon.png" alt="" width="96" align="right">

# Nightpace

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version-short/MBKDevStudio.nightpace.svg?label=Marketplace&color=007ec6)](https://marketplace.visualstudio.com/items?itemName=MBKDevStudio.nightpace)
[![Open VSX](https://img.shields.io/open-vsx/v/MBKDevStudio/nightpace?label=Open%20VSX)](https://open-vsx.org/extension/MBKDevStudio/nightpace)
[![CI](https://github.com/mbKalkan/nightpace/actions/workflows/ci.yml/badge.svg)](https://github.com/mbKalkan/nightpace/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**See how fast your Claude Code quota burns, why, and what it would cost on the API.**

Nightpace puts your Claude Code usage on one timeline in VS Code: the 5-hour and weekly plan
limits as Claude Code reports them, how many sessions were working at once, and what the
requests would have cost at Anthropic's API prices, by model, effort level or token type. Below
it, see which sessions and projects spent it. The quota is in the status bar too, so you know
where you stand without opening anything.

> **Preview.** The timeline, the API cost, the session list and the status bar work today.
> Forecasts from your own history (_"three xhigh sessions run out on Thursday; two last until
> Sunday"_) are next.

![A week of Claude Code usage in Nightpace: what it would cost at API prices today, over 7 and 30 days and per active day; the 5-hour and weekly quota lines rise with the cost columns, the sessions lane shows up to four sessions at once, and the table lists the sessions that cost the most](docs/images/timeline-dark.png)

## Why Nightpace

- **History, not just a number.** A status bar percentage tells you where you are. Nightpace
  records the quota every few minutes and shows how it got there, next to what you were doing.
- **Parallel sessions in view.** See when two, three or four sessions were working at once and
  what that did to the 5-hour window.
- **What your plan is worth.** See what today, the last 7 and 30 days and an average working day
  would have cost at API list prices.
- **Model, effort level and token type.** Split the columns by model, effort level or input,
  cache writes, cache reads and output, in dollars or in tokens, to see what an xhigh afternoon
  costs next to a medium one and where the money goes.
- **Private.** Reads usage metadata from Claude Code's local logs; never stores prompts, replies,
  tool output or code. No telemetry, and Nightpace itself makes no network requests.

## Features

### Timeline

Run **Nightpace: Show Timeline** from the Command Palette for the last 24 hours, 7 days or 30
days on one time axis:

- **Plan quota used:** the 5-hour and weekly limits, as Claude Code reported them while Nightpace
  was recording.
- **Sessions working at once:** a session counts as working until it has been quiet for 5
  minutes.
- **API cost or tokens:** by model, by effort level or by token type (input, cache writes, cache
  reads, output). **Cost** prices every request at its model's API list price, cache reads and
  writes, fast mode, US-only inference and web searches included. **Tokens** shows the counts
  Claude Code logged.

Hover or use the arrow keys for every value at a time, or switch to a table. Scroll or pinch over
the chart to zoom in and out around the pointer, or drag across part of the range; Shift + scroll,
or dragging with the wheel held down, moves along time. Columns get finer as you zoom in, down to a minute.

![One working day zoomed in: the 5-hour quota rises during each block of work and drops when the window resets, and the tooltip lists the quota, sessions, cost by model, tokens and requests of a quarter of an hour](docs/images/zoom-dark.png)

### If you had used the API

Above the timeline, what Claude Code's requests would have cost had you paid per token instead
of through your plan: today, the last 7 days, the last 30 days and per active day.

### Where the tokens went

Below the timeline, the sessions or projects of the period shown: when each session started,
how long it worked, its requests, API cost, tokens and share, and the models and effort levels
it used. Sort by any column.

![The timeline in a light theme with the cost columns split by token type, cache writes and cache reads costing the most, and the projects that spent the week's cost](docs/images/types-light.png)

### Status bar

Your plan's 5-hour and weekly usage and when the 5-hour window resets, like
`5h 63% · Wk 41% · ↻14:02`, turning yellow at 80% and red at 95%. Hover for per-model weekly
limits. Click to open the timeline.

## Getting started

1. Use [Claude Code](https://claude.com/product/claude-code) in VS Code (the Claude Code extension) or in a
   terminal on the same machine.
2. Install Nightpace from the
   [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=MBKDevStudio.nightpace)
   or [Open VSX](https://open-vsx.org/extension/MBKDevStudio/nightpace). It starts reading Claude
   Code's logs and recording the quota right away.
3. Run **Nightpace: Show Timeline**.

Tokens and sessions show from the logs Claude Code has kept (by default the last 30 days). The
quota line starts when Nightpace is installed, since Claude Code keeps no quota history.

## Privacy

Nightpace reads usage metadata (timestamps, session IDs, models, effort levels, token counts and
the folder each session ran in) from Claude Code's local session logs. It never stores your
prompts, Claude's replies, tool output or source code. It keeps that metadata in VS Code's
storage for the extension, so your history outlasts Claude Code deleting old logs and opens
without reading them all again.

For the quota, Nightpace asks Claude Code: every 5 minutes while you work and hourly otherwise,
it starts Claude Code briefly and asks for the plan's usage, the same request the Claude Code
extension makes for its own usage view. Claude Code gets the numbers from Anthropic. No prompt
is sent, no quota is used, and Nightpace never reads your credentials.

- Turn quota recording off with the `nightpace.quota.enabled` setting.
- **Nightpace: Delete Recorded Data** deletes everything Nightpace has kept.
- No telemetry. Nightpace itself makes no network requests.

## Limitations

- **Plan limits need a Claude subscription** (Pro, Max, Team). With an API key, Bedrock or
  Vertex there is no plan quota; tokens and sessions still show.
- **The quota is per account, the logs are per machine.** Claude Code on another computer and
  Claude on the web use the same quota but don't appear in the token columns here.
- **API cost is not quota.** Anthropic doesn't publish how usage counts against the plan limits;
  the cost shows what the same requests would cost on the API. Measuring the link from your own
  history is the next step.
- **List prices, built in.** Prices are Anthropic's first-party API list prices of October 2026.
  Batch and Priority Tier discounts, and Bedrock, Vertex AI or Foundry pricing, are not applied.
  A model released after your Nightpace version has no price until Nightpace is updated; the
  panel says how many requests that leaves out.
- **The quota request is not a documented Claude Code API.** If a Claude Code update changes it,
  the quota line pauses until Nightpace is updated; tokens and sessions keep working.
- Subagents' logs often record only part of their output tokens, so their share can be low.

## Contributing

Bug reports, ideas and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Please
don't attach Claude Code session logs to issues: they contain your prompts and code.

## License

[MIT](LICENSE) © MBK Dev Studio. Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Nightpace is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks
of Anthropic.
