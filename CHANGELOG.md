# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Scrolling over the timeline now zooms in and out around the pointer, without holding Ctrl.
  Shift + scroll moves along time. Over the chart the wheel no longer scrolls the panel.
- Drag the zoomed timeline with the left button to move it along time, like a map. Selecting a
  window to zoom into is now a drag with the right button.
- The dates of the window shown sit above the chart, and **Whole range** stays in place, greyed out
  until you zoom: zooming no longer moves the chart down the page.

### Added

- **Tokens by type**, beside the timeline: the input, cache writes (5-minute and 1-hour), cache
  reads and output of the period shown, with the thinking part of output, each with its tokens,
  API cost and share of both. A line above it says how much of the prompt came from the cache and
  what caching saved at API prices. The timeline and the tokens by type take half the panel each,
  and go one under the other in a narrow panel.
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

[Unreleased]: https://github.com/mbKalkan/nightpace/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mbKalkan/nightpace/releases/tag/v0.1.0
