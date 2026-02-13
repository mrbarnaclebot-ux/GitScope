# Roadmap: GitScope

## Overview

GitScope delivers a Telegram bot that monitors the OpenClaw/Claude Code ecosystem on GitHub and alerts a private group when repos gain traction. The roadmap builds from a reliable infrastructure foundation (state persistence, config validation, logging), through the core monitoring and alerting pipeline (GitHub search, velocity detection, Telegram notifications), to notification refinement and production deployment (deduplication, batching, retry, Render).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Infrastructure Foundation** - Reliable project skeleton with state persistence, config validation, and structured logging
- [ ] **Phase 2: Monitoring & Alerting** - GitHub search, star velocity detection, and formatted Telegram alerts
- [ ] **Phase 3: Notification Reliability & Deployment** - Deduplication, batching, retry logic, and Render deployment

## Phase Details

### Phase 1: Infrastructure Foundation
**Goal**: A runnable TypeScript project with crash-safe state persistence, validated configuration, and structured logging -- the reliable foundation every subsequent feature depends on
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05, INFR-06, INFR-08
**Success Criteria** (what must be TRUE):
  1. Running `npm run build` produces a working TypeScript build with strict mode enabled, and the project uses Node.js 22.x with grammY, @octokit/rest, and node-cron as dependencies
  2. Starting the bot with missing or invalid environment variables (GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) fails immediately with a clear error message naming the missing variable
  3. State file persists a JSON object with repo snapshots and notification history, survives process restarts, and writes are atomic (no corruption on crash)
  4. A corrupt or missing state file causes the bot to log a warning and continue with empty state rather than crashing
  5. All log output is structured JSON with timestamps, module names, and contextual IDs -- visible in stdout
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Project scaffolding + config validation + structured logging
- [ ] 01-02-PLAN.md -- State persistence + entry point wiring

### Phase 2: Monitoring & Alerting
**Goal**: The bot discovers trending repos in the OpenClaw/Claude Code ecosystem and delivers formatted alerts to the Telegram group -- the core value proposition working end to end
**Depends on**: Phase 1
**Requirements**: MON-01, MON-02, MON-03, MON-04, MON-05, MON-06, NOTF-01
**Success Criteria** (what must be TRUE):
  1. The bot searches GitHub every 30 minutes for repos matching configured keywords (openclaw, claude-code, clawdbot, moltbot, clawhub, openclaw skills) in name, description, topics, and README, with overlap protection preventing concurrent cycles
  2. The bot detects repos gaining stars above threshold (>=5 stars/day for repos <30 days old, >=10 stars/day for older repos) and repos appearing for the first time with >=20 stars
  3. Alerts arrive in the Telegram group as HTML-formatted messages containing the repo name (linked), star count, velocity delta, description, language, and age
  4. Each alert is tagged with a severity tier (notable / hot / viral) based on velocity magnitude
  5. The bot tracks GitHub Search API and REST API rate limits as separate counters, respects Retry-After headers, and never exceeds rate limits during normal operation
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Notification Reliability & Deployment
**Goal**: Alerts are deduplicated, batched when busy, retried on failure, and the bot runs reliably on Render as an always-on background worker
**Depends on**: Phase 2
**Requirements**: NOTF-02, NOTF-03, NOTF-04, NOTF-05, INFR-07
**Success Criteria** (what must be TRUE):
  1. The same repo is not re-alerted within the cooldown period (configurable, default 7 days), and this deduplication state survives bot restarts
  2. When more than 5 repos trend simultaneously, the bot sends a single digest message instead of individual alerts
  3. A failed Telegram delivery is retried with exponential backoff, and formatting errors fall back to plain text instead of dropping the notification
  4. The bot runs as a Render Background Worker with environment variables for secrets, starts automatically, and stays online without manual intervention
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure Foundation | 0/2 | Planned | - |
| 2. Monitoring & Alerting | 0/TBD | Not started | - |
| 3. Notification Reliability & Deployment | 0/TBD | Not started | - |
