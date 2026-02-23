---
status: testing
phase: 03-notification-reliability-deployment
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md]
started: 2026-02-14T11:25:00Z
updated: 2026-02-14T11:25:00Z
---

## Current Test

number: 1
name: TypeScript build succeeds
expected: |
  Running `npm run build` completes with zero errors. The dist/ directory contains compiled JavaScript for all source files including the new/modified ones (sender.ts, formatter.ts, cycle.ts, config.ts, index.ts).
awaiting: user response

## Tests

### 1. TypeScript build succeeds
expected: Running `npm run build` completes with zero errors. The dist/ directory contains compiled JavaScript for all source files.
result: [pending]

### 2. Auto-retry wired into Telegram sender
expected: `src/telegram/sender.ts` imports `autoRetry` from `@grammyjs/auto-retry` and calls `bot.api.config.use(autoRetry(...))` with maxRetryAttempts and maxDelaySeconds configured. This means 429 rate limits and 5xx server errors are retried automatically before our code sees them.
result: [pending]

### 3. Plain-text fallback on HTML parse errors
expected: `src/telegram/sender.ts` catches GrammyError with error_code 400 containing "can't parse entities", strips HTML tags from the message, and resends without parse_mode. If the fallback also fails, it returns false instead of crashing.
result: [pending]

### 4. Config has COOLDOWN_DAYS and BATCH_THRESHOLD
expected: `src/config.ts` defines COOLDOWN_DAYS (default "7", transformed to number, min 1, max 90) and BATCH_THRESHOLD (default "5", transformed to number, min 1, max 100). Both are available on the exported `config` object.
result: [pending]

### 5. Digest formatter combines multiple alerts
expected: `src/telegram/formatter.ts` exports `formatDigest(entries: DigestEntry[])` that produces a single HTML message with a "Trending Digest" header, per-repo lines with emoji + linked name + stars + velocity, and a truncation footer when entries exceed 20.
result: [pending]

### 6. Graceful shutdown saves state
expected: `src/index.ts` registers handlers for SIGTERM and SIGINT that call `store.save()` before `process.exit(0)`. The handler is set up after `store.load()` but before `startScheduler()`.
result: [pending]

### 7. Render deployment config
expected: `render.yaml` at project root defines a Background Worker service with `type: worker`, build command `npm install && npm run build`, start command `node dist/index.js`, and env vars for GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (all with `sync: false` for secrets).
result: [pending]

### 8. Deduplication skips repos within cooldown
expected: `src/monitor/cycle.ts` has an `isWithinCooldown()` function that checks `state.notifications[repoKey].lastAlertAt` against COOLDOWN_DAYS. Repos within cooldown are skipped with a debug log instead of being alerted again.
result: [pending]

### 9. Batch-or-individual alert strategy
expected: `src/monitor/cycle.ts` collects alerts into a `pendingAlerts` array. When `pendingAlerts.length > batchThreshold`, it sends a single digest via `formatDigest()`. When at or below threshold, it sends individual messages. Notification records are written ONLY after `telegram.send()` returns true.
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0

## Gaps

[none yet]
