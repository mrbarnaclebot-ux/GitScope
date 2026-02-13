---
phase: 02-monitoring-alerting
plan: 01
subsystem: api
tags: [octokit, throttling, github-search, rate-limiting, zod]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Config validation (zod envSchema), state schema, pino logger"
provides:
  - "Throttled GitHub client factory (createGitHubClient)"
  - "GitHub search query builder and executor (buildSearchQuery, searchRepos)"
  - "Config with MONITOR_KEYWORDS (string[]) and MONITOR_CRON"
  - "State schema with language field on repo snapshots"
affects: [02-02, 02-03, 03-deployment]

# Tech tracking
tech-stack:
  added: ["@octokit/plugin-throttling v11.0.3"]
  patterns: ["Octokit.plugin(throttling) for automatic rate limit handling", "OR-combined search queries to minimize API calls"]

key-files:
  created: ["src/github/client.ts", "src/github/search.ts"]
  modified: ["src/config.ts", "src/state/schema.ts", "package.json"]

key-decisions:
  - "Cast ThrottledOctokit to typeof Octokit to avoid non-portable inferred type (TS2742)"
  - "GitHubClient type aliased to InstanceType<typeof Octokit> for simpler downstream usage"

patterns-established:
  - "GitHub modules under src/github/ with client.ts (factory) and search.ts (operations)"
  - "Config uses zod .transform() for comma-separated string to array conversion"

# Metrics
duration: 2min
completed: 2026-02-14
---

# Phase 2 Plan 1: GitHub Integration Layer Summary

**Throttled Octokit client with @octokit/plugin-throttling and OR-combined keyword search across GitHub repos**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T18:58:20Z
- **Completed:** 2026-02-13T19:00:45Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed @octokit/plugin-throttling v11.0.3 with zero peer dependency warnings
- Extended config with MONITOR_KEYWORDS (6 keywords as string[]) and MONITOR_CRON (default 30 min)
- Added language field to repo snapshot schema for alert formatting
- Built throttled GitHub client with automatic retry on primary limits and backoff on secondary limits
- Built search module that combines keywords with OR operator into efficient single-query search

## Task Commits

Each task was committed atomically:

1. **Task 1: Install throttling plugin, extend config and state schema** - `627d3d2` (chore)
2. **Task 2: Create GitHub client and search module** - `70bd935` (feat)

## Files Created/Modified
- `src/github/client.ts` - Throttled Octokit factory with onRateLimit/onSecondaryRateLimit callbacks
- `src/github/search.ts` - buildSearchQuery (OR-combined), SearchResult interface, searchRepos function
- `src/config.ts` - Added MONITOR_KEYWORDS (string[] via transform) and MONITOR_CRON fields
- `src/state/schema.ts` - Added language: z.string().nullable() to repoSnapshotSchema
- `package.json` - Added @octokit/plugin-throttling dependency
- `package-lock.json` - Updated lockfile

## Decisions Made
- Cast `ThrottledOctokit` to `typeof Octokit` to resolve TS2742 non-portable type error from deep plugin type inference. The runtime behavior is correct (throttling is applied), but TypeScript's declaration emit cannot name the deep plugin types without this cast.
- Exported `GitHubClient` as `InstanceType<typeof Octokit>` rather than `InstanceType<typeof ThrottledOctokit>` for the same portability reason. Downstream consumers get full Octokit API surface; throttling is transparent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TS2742 non-portable type inference for ThrottledOctokit**
- **Found during:** Task 2 (Create GitHub client)
- **Issue:** `const ThrottledOctokit = Octokit.plugin(throttling)` produces an inferred type that references internal @octokit/plugin-rest-endpoint-methods types, causing TS2742 error on declaration emit
- **Fix:** Annotated ThrottledOctokit as `typeof Octokit` with `as never` cast, and exported GitHubClient as `InstanceType<typeof Octokit>`
- **Files modified:** src/github/client.ts
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** 70bd935 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type annotation fix necessary for TypeScript compilation. Runtime behavior unchanged -- throttling plugin is still applied. No scope creep.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GitHub client and search modules ready for import by monitoring cycle (Plan 02-02)
- Config provides keywords and cron expression for scheduler (Plan 02-03)
- State schema ready to store language field alongside repo snapshots

## Self-Check: PASSED

All 6 files verified present. Both task commits (627d3d2, 70bd935) verified in git log.

---
*Phase: 02-monitoring-alerting*
*Completed: 2026-02-14*
