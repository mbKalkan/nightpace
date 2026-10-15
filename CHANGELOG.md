# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/mbKalkan/nightpace/commits/main
