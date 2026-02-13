---
phase: 02-monitoring-alerting
plan: 02
subsystem: monitoring, notifications
tags: [velocity, classifier, telegram, html-formatting, grammy]

# Dependency graph
requires:
  - phase: 01-infrastructure
    provides: "config.ts (env validation), logger.ts (pino child loggers)"
provides:
  - "Star velocity calculation from snapshot deltas (calculateVelocity, VelocityResult)"
  - "Severity tier classification with configurable thresholds (classifySeverity, SeverityTier, THRESHOLD_CONFIG)"
  - "First-sighting detection helper (shouldAlertNewRepo)"
  - "HTML alert formatter with escaping (formatAlert, formatNewRepoAlert, AlertData)"
  - "grammY Telegram sender with error handling (createTelegramSender, TelegramSender)"
affects: [02-03-cycle-orchestrator, 03-notification-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function business logic modules with injectable config for testability"
    - "HTML escaping applied to all user-provided strings before Telegram embedding"
    - "grammY Bot class for bot.api access without bot.start() polling"
    - "Tier classification using base threshold multipliers (1x/3x/10x) with age-dependent base"

key-files:
  created:
    - src/monitor/velocity.ts
    - src/monitor/classifier.ts
    - src/telegram/formatter.ts
    - src/telegram/sender.ts
  modified: []

key-decisions:
  - "Sparkles emoji for NEW repo alerts instead of NEW button emoji for better cross-platform rendering"
  - "Age formatting: < 1 day, N days (< 30), N months (>= 30) for concise display"
  - "Errors in sender return false (never throw) so alerts cannot crash the monitoring cycle"

patterns-established:
  - "Pure business logic modules: velocity.ts and classifier.ts have zero side effects, accept optional config for testing"
  - "HTML escaping via escapeHtml() on all user-provided strings (owner, name, description, language)"
  - "TelegramSender interface for dependency injection -- createTelegramSender returns the interface, not the Bot instance"

# Metrics
duration: 2min
completed: 2026-02-14
---

# Phase 2 Plan 2: Business Logic & Telegram Alert Layer Summary

**Star velocity calculator, severity classifier (notable/hot/viral tiers), HTML alert formatter with escaping, and grammY Telegram sender with error handling**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T19:58:30Z
- **Completed:** 2026-02-13T20:00:32Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Velocity calculator handles normal deltas, first-sighting (isNew=true), and near-zero time intervals
- Severity classifier assigns notable/hot/viral tiers using age-dependent base thresholds (5 stars/day for young repos, 10 for older) with 3x and 10x multipliers
- HTML formatter escapes all user-provided strings, supports tier alerts and new-repo alerts with emoji, linked repo names, velocity, language, and age
- Telegram sender wraps grammY bot.api.sendMessage with GrammyError/HttpError handling, never calls bot.start()

## Task Commits

Each task was committed atomically:

1. **Task 1: Create velocity calculator and severity classifier** - `0d64196` (feat)
2. **Task 2: Create Telegram formatter and sender** - `f215035` (feat)

## Files Created/Modified
- `src/monitor/velocity.ts` - Star velocity calculation from consecutive snapshots with first-sighting and division-by-zero guards
- `src/monitor/classifier.ts` - Severity tier classification (notable/hot/viral) with configurable age-dependent thresholds
- `src/telegram/formatter.ts` - HTML alert message builder with escapeHtml, formatAlert, and formatNewRepoAlert
- `src/telegram/sender.ts` - grammY API wrapper returning TelegramSender interface with comprehensive error handling

## Decisions Made
- Used sparkles emoji for NEW repo alerts (better cross-platform rendering than NEW button emoji)
- Age formatting uses three tiers: "< 1 day", "N days", "N months" for compact display
- Sender returns boolean (true/false) and never re-throws -- alerts must not crash the monitoring cycle

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 4 modules export clean interfaces ready for the cycle orchestrator (02-03) to compose
- Velocity and classifier are pure functions with no external dependencies -- immediately testable
- Formatter and sender depend on grammy types but are isolated behind the TelegramSender interface

---
*Phase: 02-monitoring-alerting*
*Completed: 2026-02-14*
