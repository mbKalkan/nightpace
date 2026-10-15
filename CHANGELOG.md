# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A **Nightpace: Show Timeline** command opens the Nightpace panel.
- Your plan's 5-hour and weekly quota in the status bar, with the 5-hour reset time on a 24-hour clock; yellow from
  80% and red from 95% of any limit. The hover adds per-model weekly limits.
- Nightpace records the quota in the background: it asks Claude Code every 5 minutes while you
  work and hourly otherwise, without sending a prompt or using quota. The
  `nightpace.quota.enabled` setting turns it off.
- **Nightpace: Delete Recorded Data** deletes everything Nightpace has kept.

[Unreleased]: https://github.com/mbKalkan/nightpace/commits/main
