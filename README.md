<img src="assets/icon.png" alt="" width="96" align="right">

# Nightpace

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version-short/MBKDevStudio.nightpace.svg?label=Marketplace&color=007ec6)](https://marketplace.visualstudio.com/items?itemName=MBKDevStudio.nightpace)
[![Open VSX](https://img.shields.io/open-vsx/v/MBKDevStudio/nightpace?label=Open%20VSX)](https://open-vsx.org/extension/MBKDevStudio/nightpace)
[![CI](https://github.com/mbKalkan/nightpace/actions/workflows/ci.yml/badge.svg)](https://github.com/mbKalkan/nightpace/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**See how fast your Claude Code quota burns, why, when it runs out, and what it would cost on the
API.**

Nightpace measures, from your own history, how your Claude Code plan limits follow your usage,
and tells you when this week and this 5-hour window run out at your pace, and how long they last
with one to five sessions working at once. Below, one timeline in VS Code: the 5-hour and weekly
limits as Claude Code reports them, how many sessions were working at once, and what the requests
would have cost at Anthropic's API prices, by model, effort level or token type, and which
sessions and projects spent it. The quota is in the status bar too, so you know where you stand
without opening anything.

![Nightpace: this week is 62% used and runs out on Sunday at this pace, with the hours a day that last until the Monday reset for one to five sessions at once; this 5-hour window is 20% used, and lasts with one Opus xhigh session but runs out in 2h 22m with three; below, a week of quota lines rising with the cost columns and the weekly line heading, dashed, to 100% by Sunday, the weekly limit a day at a time with, dashed, what each day ahead can take for the week to last, the sessions working at once, what it would cost at API prices and the tokens by type](docs/images/timeline-dark.png)

## Why Nightpace

- **When it runs out, and how to make it last.** Nightpace measures what a dollar of API cost is
  in your own 5-hour and weekly limits, and what each kind of session (model and effort) costs
  an hour. It tells you when the week runs out at your pace, how many hours a day last until the
  reset, and how long this 5-hour window lasts with one to five sessions at once.
- **History, not just a number.** A status bar percentage tells you where you are. Nightpace
  records the quota every few minutes and shows how it got there, next to what you were doing.
  For the weeks before you installed it, it estimates the quota from your Claude Code logs, and
  it draws where this week is heading.
- **See when the limits change.** Under each card, a small chart follows how much of the limit
  an hour of your usual session takes. When Anthropic changes the limits, it moves.
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

### This week and this 5-hour window

At the top, two cards. **This week**: how much is used, when it resets, and when it runs out at
the pace of the last 7 days (or where it will be at the reset), with how many hours of work a day
last until the reset with one to five sessions at once, for each kind of session you use.
**This 5-hour window**: how much is used, when it resets, and how long it lasts with one to five
sessions at once, on into the next window when this one resets first.

The figures are estimated. Nightpace measures how your quota readings follow the API cost of
your requests, and says under each card what 1% of the limit is at API prices; and what a
session of each model and effort level costs an hour, over the last 14 days. A limit reset by
hand is measured from where it was reset. Until it has recorded a few days, the cards say
**Learning**: the figures are rough.

At the foot of each card, a small chart follows how much of the limit an hour of your main kind
of session took over the last 4 weeks: a point for each 5-hour window, and for each day of the
week, once it has used at least 10%. The kind is your own: the model and effort level you worked
with most in the last 14 days, so a Sonnet user sees an hour of Sonnet. Until one kind has two
hours of work, the chart follows what 1% of the limit is at API prices instead. When Anthropic
changes the limits, the points move. They also rise when Claude on the web or on another
computer uses the same quota.

### Timeline

Run **Nightpace: Show Timeline** from the Command Palette for the last 24 hours, 7 days or 30
days, or one **quota week** from your plan's weekly reset to the next, on one time axis:

- **Plan quota used:** the 5-hour and weekly limits, as Claude Code reported them while Nightpace
  was recording. Dashed where they are estimated from API cost at your measured rates: before
  Nightpace started recording, from the first full week of your Claude Code logs, and the week
  ahead at the pace of the last 7 days, up to the reset. A mark hangs from 100% where Claude Code
  logged that a limit ran out.
- **Weekly limit by day:** how much of the weekly limit each day used, a column a day counted
  from the reset, lighter where it is estimated from API cost. Past now, dashed: what today and
  each day ahead can take for the week to last until the reset. A dashed line marks an even
  split, a seventh of the limit a day.
- **Sessions working at once:** a session counts as working until it has been quiet for 5
  minutes.
- **API cost or tokens:** by model, by effort level or by token type (input, cache writes, cache
  reads, output). **Cost** prices every request at its model's API list price, cache reads and
  writes, fast mode, US-only inference and web searches included. **Tokens** shows the counts
  Claude Code logged.

Hover or use the arrow keys for every value at a time, or switch to a table. Over the quota and
sessions lanes, the crosshair takes each point of their lines, between columns too, and the
arrow keys go on along them; over the days, a day at a time. Past now, it follows the week ahead to where it runs out and
resets. Scroll or pinch over
the chart to zoom in and out around the pointer, or drag across part of the range with the right
button. Drag the chart with the left button, or Shift + scroll, to move along time, and
double-click for the whole range again. Columns get finer as you zoom in, down to a minute, and
are counted from your plan's weekly reset, marked with a dashed line, so seven day columns make
one quota week. **Previous week** and **Next week** go back through the quota weeks, up to four
before this one; the cost, the tokens by type and the sessions below follow the week shown.
The time range and these buttons stay at the top of the panel as you scroll.

![One working day zoomed in: the 5-hour quota rises during each block of work and drops when the window resets, and the tooltip lists the quota, sessions, cost by model, tokens and requests of a quarter of an hour](docs/images/zoom-dark.png)

### If you had used the API

Beside the timeline, what Claude Code's requests would have cost had you paid per token instead
of through your plan: today, the last 7 days, the last 30 days and per active day.

### Tokens by type

Beside the timeline, under the cost, the tokens of the period shown by kind: input, cache writes
(5-minute and 1-hour), cache reads and output, with the thinking part of output when Claude Code
reports it. Each kind's tokens, API cost and share of both: cache reads are most of the tokens
and a fraction of the cost. Above them, how much of the prompt came from the cache, what caching
saved at API prices and what the requests would have cost without it. In a narrow panel it
moves under the timeline.

### Where the tokens went

Below, the sessions or projects of the period shown: when each session started, how long it
worked, its requests, API cost, tokens, how much of its prompt came from the cache, its share,
and the models and effort levels it used. Point at a row's tokens for them by kind. Sort by any
column. Point at a row to see its time on the chart, and click it to zoom the chart to that
session or project.

![The cost columns of a week split by token type in a light theme; beside them, the week's tokens by type, cache reads 97% of the tokens and a third of the cost, caching saving most of what the requests would have cost; below, the projects, each with 97% of its prompt from the cache](docs/images/types-light.png)

### Status bar

Your plan's 5-hour and weekly usage, with when the 5-hour window resets and how long the week
has left, like `5h 63% ↻14:02 · Wk 41% ↻3d 4h`, turning yellow at 80% and red at 95%. Hover for per-model weekly
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
- **The forecasts are estimates.** Anthropic doesn't publish how usage counts against the plan
  limits. Nightpace measures it from your own readings: they follow the API cost closely, but
  Claude Code on another computer or Claude on the web uses the same quota without showing here,
  so the week can run out sooner than the cards say. The quota before Nightpace started recording
  is estimated at today's rates, and reaches 100% where Claude Code logged that a limit ran out.
  A week that reached 100% and went on working starts again from zero, as after a limit reset.
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
