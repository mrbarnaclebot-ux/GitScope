---
phase: 03-notification-reliability-deployment
plan: 03
subsystem: notification
tags: [deduplication, cooldown, batch-alerting, digest, monitoring-cycle]

# Dependency graph
requires:
  - phase: 03-01
    provides: "Resilient TelegramSender with auto-retry, COOLDOWN_DAYS and BATCH_THRESHOLD config"
  - phase: 03-02
    provides: "formatDigest() function and DigestEntry interface"
  - phase: 02-core-monitoring-pipeline
    provides: "runMonitoringCycle, velocity calculation, severity classification"
provides:
  - "Deduplication-aware monitoring cycle with cooldown checking"
  - "Batch-or-individual alert strategy based on BATCH_THRESHOLD"
  - "Notification records written only after successful delivery"
affects: [deployment, operations]

# Tech tracking
tech-stack:
  added: []
  patterns: [collect-then-send, cooldown-gating, batch-branching, write-after-delivery]

key-files:
  created: []
  modified:
    - "src/monitor/cycle.ts"
    - "src/index.ts"

key-decisions:
  - "Cooldown check happens before alert collection, not at send time, to avoid wasted formatting work"
  - "Notification records written only after telegram.send() returns true to prevent suppressing undelivered alerts"

patterns-established:
  - "Collect-then-send: accumulate alerts in array, decide delivery strategy after loop completes"
  - "Write-after-delivery: state mutations for notification records gated on successful send confirmation"

# Metrics
duration: 1min
completed: 2026-02-14
---

# Phase 3 Plan 3: Cycle Integration -- Deduplication & Batch Alerting Summary

**Cooldown-gated deduplication and batch-or-individual alert strategy wired into the monitoring cycle loop**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-14T11:17:36Z
- **Completed:** 2026-02-14T11:18:50Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Restructured runMonitoringCycle to collect PendingAlerts instead of sending inline
- Added isWithinCooldown helper that checks notification records against configurable cooldown period
- When pending alerts exceed BATCH_THRESHOLD, a single digest message is sent via formatDigest
- When pending alerts are at or below BATCH_THRESHOLD, individual messages are sent as before
- Notification records (lastAlertAt) written only after confirmed successful delivery
- index.ts passes COOLDOWN_DAYS and BATCH_THRESHOLD from config to the cycle function

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deduplication check and restructure cycle for collect-then-send** - `2a0c92c` (feat)

## Files Created/Modified
- `src/monitor/cycle.ts` - Added isWithinCooldown, PendingAlert interface, collect-then-send loop, batch-or-individual send strategy, notification record writes
- `src/index.ts` - Updated cycle closure to pass cooldownDays and batchThreshold arguments

## Decisions Made
- Cooldown check happens before alert collection rather than at send time, avoiding wasted formatting for repos that will be skipped
- Notification records written only after telegram.send() returns true -- prevents suppressing alerts that were never actually delivered

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full monitoring pipeline is now complete: search -> velocity -> classify -> cooldown check -> collect -> batch-or-individual send -> write notification record -> save state
- All three plans in Phase 3 are integrated: resilient sender (P01), digest formatter (P02), and cycle integration (P03)
- Ready for deployment via render.yaml

## Self-Check: PASSED

All files exist. Commit 2a0c92c verified in git log.

---
*Phase: 03-notification-reliability-deployment*
*Completed: 2026-02-14*
