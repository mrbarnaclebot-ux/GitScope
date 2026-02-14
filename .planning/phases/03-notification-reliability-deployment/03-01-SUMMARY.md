---
phase: 03-notification-reliability-deployment
plan: 01
subsystem: notification
tags: [grammy, auto-retry, telegram, resilience, backoff]

# Dependency graph
requires:
  - phase: 02-core-monitoring-pipeline
    provides: "TelegramSender interface and basic grammy Bot integration"
provides:
  - "Resilient Telegram sender with transport-level auto-retry (429/5xx)"
  - "Plain-text fallback on HTML parse errors"
  - "COOLDOWN_DAYS and BATCH_THRESHOLD config fields"
affects: [03-02, 03-03]

# Tech tracking
tech-stack:
  added: ["@grammyjs/auto-retry"]
  patterns: ["Transport-level retry via API transformer", "Graceful degradation from HTML to plain text"]

key-files:
  created: []
  modified:
    - "src/telegram/sender.ts"
    - "src/config.ts"
    - "package.json"

key-decisions:
  - "autoRetry plugin with 3 retries and 60s max delay for transport errors"
  - "stripHtml as unexported module-level helper for fallback formatting"

patterns-established:
  - "API transformer pattern: bot.api.config.use() for cross-cutting API behavior"
  - "Graceful degradation: try rich format first, fall back to plain on error"

# Metrics
duration: 1min
completed: 2026-02-14
---

# Phase 3 Plan 1: Notification Resilience Summary

**Auto-retry plugin for 429/5xx transport errors with HTML-to-plain-text fallback on parse failures**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-14T11:13:22Z
- **Completed:** 2026-02-14T11:14:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Installed @grammyjs/auto-retry and wired it into the Bot API transformer with 3 retries and 60s max delay
- Added plain-text fallback path that strips HTML when Telegram returns 400 parse errors
- Extended config with COOLDOWN_DAYS (default 7) and BATCH_THRESHOLD (default 5) for future notification tuning

## Task Commits

Each task was committed atomically:

1. **Task 1: Install auto-retry and extend config** - `7f3d700` (feat)
2. **Task 2: Make sender resilient with auto-retry and plain-text fallback** - `c7df557` (feat)

## Files Created/Modified
- `package.json` - Added @grammyjs/auto-retry dependency
- `src/config.ts` - Added COOLDOWN_DAYS and BATCH_THRESHOLD env var fields with zod validation
- `src/telegram/sender.ts` - Integrated autoRetry plugin and added stripHtml fallback logic

## Decisions Made
- autoRetry configured with maxRetryAttempts=3 and maxDelaySeconds=60 -- balances reliability against not stalling the monitoring cycle
- stripHtml is a module-level unexported function since it is only used by the sender internally

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Sender is now resilient against transport errors and formatting failures
- COOLDOWN_DAYS and BATCH_THRESHOLD config fields ready for use by cooldown/digest logic in Plan 02
- TelegramSender interface unchanged -- no downstream breakage

## Self-Check: PASSED

All files exist. All commits verified (7f3d700, c7df557).

---
*Phase: 03-notification-reliability-deployment*
*Completed: 2026-02-14*
