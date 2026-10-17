# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **This week** and **This 5-hour window**, at the top of the panel. When the week runs out at
  the pace of the last 7 days, or where it will be at the reset, and the hours of work a day that
  last until the reset with one to five sessions at once; how long this 5-hour window lasts with
  one to five sessions at once. One row for each model and effort level you worked with in the
  last 14 days.
- The forecasts are estimated from your own quota readings: Nightpace measures what a dollar of
  API cost is in your 5-hour and weekly limits, and says it under each card. Until it has recorded
  a few days, the cards say **Learning**.
- The timeline's quota lane runs on past now: the weekly line heads, dashed, to the reset at
  the pace of the last 7 days.
- Before Nightpace started recording, the timeline estimates the 5-hour and weekly quota from the
  API cost in your Claude Code logs at your measured rates, dashed. In the tooltip and the table
  these values say they are estimated.
- Under each card, a chart of how much of the limit an hour of your main kind of session took,
  for each 5-hour window and each day of the week over the last 4 weeks: it shows when the limits
  change.

## [0.2.0] - 2026-10-16

A new panel layout, the tokens of the period by type with what caching saved, and a timeline
that zooms with a plain scroll.

### Changed

- Scrolling over the timeline now zooms in and out around the pointer, without holding Ctrl.
  Shift + scroll moves along time. Over the chart the wheel no longer scrolls the panel.
- Drag the zoomed timeline with the left button to move it along time, like a map. Selecting a
  window to zoom into is now a drag with the right button.
- The dates of the window shown sit above the chart, and **Whole range** stays in place, greyed out
  until you zoom: zooming no longer moves the chart down the page.
- A new layout in cards. The timeline takes one half of the panel, headed by the dates shown and
  its own **Model | Effort | Type** and **Table** controls; the other half holds what it would
  have cost at API prices and the tokens by type, and ends level with the timeline. The range,
  zoom and **Cost | Tokens** controls stay at the top. In a narrow panel the cards go one under
  the other.
- The timeline's table view keeps the chart's height and scrolls inside it, so switching between
  chart and table no longer moves the rest of the panel.

### Added

- **Tokens by type**, beside the timeline: the input, cache writes (5-minute and 1-hour), cache
  reads and output of the period shown, with the thinking part of output, each with its tokens,
  API cost and share of both. Above them, how much of the prompt came from the cache, what
  caching saved at API prices and what the requests would have cost without it.
- **Where the tokens went** has a **From cache** column, and pointing at a row's tokens shows them
  by type.
- Double-click the chart for the whole range again. Press Escape to let go of a window being
  selected, and Shift and the arrow keys to move a zoomed window along time.
- Point at a session or project in **Where the tokens went** to see its time marked on the chart,
  and click it, or press Enter, to zoom the chart to it.
- The dates above a zoomed chart say how long the window is.

### Fixed

- Columns are counted from your plan's weekly reset, marked on the chart with a dashed line, so
  seven day columns make one quota week. They used to start at midnight UTC, so outside UTC a
  day's column ran from one local 03:00 (or wherever midnight UTC falls) to the next. Before any
  quota reading, they start at local midnight.
- The table names a month's rows by date, and picks the time format by the length of the window
  shown, zoomed or not.
- The quota lines no longer break where Nightpace wasn't running when what happened is known: a
  share that is the same on both sides held all along, and a 5-hour window was empty until it
  opened. Only the rest is dotted, as **Not recorded**.
- When asking Claude Code for the quota fails, as it can right after the computer starts, the next
  try comes after 2 minutes, then 5, then every 15, instead of 15 from the start.

## [0.1.0] - 2026-10-15

First preview release.

### Added

- **Nightpace: Show Timeline** opens the timeline: the 5-hour and weekly quota as observed, the
  sessions working at once, and API cost or tokens, on one time axis over
  the last 24 hours, 7 days or 30 days. Hover or use the arrow keys for the values at a time, or
  switch to a table. Drag across the chart, Ctrl + scroll, pinch or use the zoom buttons to look
  closer at part of the range, down to half an hour in one-minute columns.
- The timeline's columns show **Cost** (what the requests would have cost at Anthropic's API list
  prices, with cache reads and writes, fast mode, US-only inference and web searches) or
  **Tokens**, split by **Model**, **Effort** or **Type** (input, cache writes, cache reads,
  output).
- **If you had used the API**: what today, the last 7 days, the last 30 days and an average active day
  would have cost on the API.
- Below the timeline, **Where the tokens went** lists the sessions or projects of the period shown:
  when each session started, how long it worked, its requests, API cost, tokens, share, models
  and effort levels. Sort by any column.
- Your plan's 5-hour and weekly quota in the status bar, with the 5-hour reset time on a 24-hour clock; yellow from
  80% and red from 95% of any limit. The hover adds per-model weekly limits.
- Nightpace records the quota in the background: it asks Claude Code every 5 minutes while you
  work and hourly otherwise, without sending a prompt or using quota. The
  `nightpace.quota.enabled` setting turns it off.
- Nightpace keeps the usage it read from Claude Code's logs, so the timeline still shows it after
  Claude Code deletes old logs, and opens in a fraction of a second instead of reading every log
  again. It catches up in the background shortly after VS Code starts and then hourly.
- **Nightpace: Delete Recorded Data** deletes everything Nightpace has kept.

[Unreleased]: https://github.com/mbKalkan/nightpace/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mbKalkan/nightpace/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbKalkan/nightpace/releases/tag/v0.1.0
