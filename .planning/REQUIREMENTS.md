# Requirements: GitScope

**Defined:** 2026-02-13
**Core Value:** Developers in the group never miss a rising project in the OpenClaw/Claude Code ecosystem

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Monitoring

- [ ] **MON-01**: Bot searches GitHub for repositories matching configurable keywords (openclaw, claude-code, clawdbot, moltbot, clawhub, openclaw skills) in name, description, topics, and README
- [ ] **MON-02**: Bot detects star velocity — repos <30 days old gaining >=5 stars/day, older repos gaining >=10 stars/day
- [ ] **MON-03**: Bot discovers new repos appearing for the first time with >=20 stars
- [ ] **MON-04**: Bot classifies alerts by severity tier (notable / hot / viral) based on velocity magnitude
- [ ] **MON-05**: Bot runs monitoring cycle every 30 minutes via node-cron with overlap protection
- [ ] **MON-06**: Bot tracks search and REST API rate limits as separate counters, respects Retry-After headers

### Notifications

- [ ] **NOTF-01**: Bot sends formatted Telegram alerts with HTML parse mode — repo name (linked), star count, velocity delta, description, language, age
- [ ] **NOTF-02**: Bot deduplicates notifications — same repo not re-alerted within cooldown period (configurable, default 7 days)
- [ ] **NOTF-03**: Deduplication state persists across restarts (written to disk after successful delivery)
- [ ] **NOTF-04**: Bot batches alerts when >5 repos trend simultaneously into a single digest message
- [ ] **NOTF-05**: Bot retries failed Telegram deliveries with exponential backoff, falls back to plain text on formatting errors

### Infrastructure

- [ ] **INFR-01**: State persisted as JSON file with atomic writes (write to temp file, rename) — crash-safe
- [ ] **INFR-02**: State file stores repo snapshots with star counts, notification history with timestamps, and schema version
- [ ] **INFR-03**: Environment variables validated at startup with zod — fails fast with clear error messages for missing GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
- [ ] **INFR-04**: Structured JSON logging via pino with module-scoped loggers, timestamps, and contextual IDs
- [ ] **INFR-05**: Bot recovers gracefully from corrupt/missing state file (falls back to empty state, logs warning)
- [ ] **INFR-06**: Project uses TypeScript with strict mode, Node.js 22.x, grammY, @octokit/rest, node-cron
- [ ] **INFR-07**: Deploys as Render Background Worker with environment variables for secrets
- [ ] **INFR-08**: .gitignore includes .env and state.json before first commit; GitHub PAT uses fine-grained read-only public scope

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Detection

- **DET-01**: Bot detects fork velocity spikes (>=3 new forks in 24 hours)
- **DET-02**: Bot detects new releases published in last 24 hours for tracked repos
- **DET-03**: Bot detects contributor growth (>=3 new contributors in 48 hours) for watched repos
- **DET-04**: Bot implements sliding window velocity over configurable periods (6h, 24h) for more accurate trend detection

### Enhanced Notifications

- **ENOTF-01**: Bot sends weekly digest summary of ecosystem activity
- **ENOTF-02**: Bot responds to /status command showing last poll time, repos tracked, rate limit usage
- **ENOTF-03**: Bot supports configurable quiet hours (queue overnight discoveries for morning digest)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web dashboard | Telegram is the interface — no need for a web UI |
| ML-based trend prediction | Training data doesn't exist for this niche; simple thresholds are more reliable |
| Multiple Telegram channels | Single private group is the target |
| User-configurable keywords via bot commands | Complicates scope, exhausts rate limits; admin-managed config instead |
| Real-time streaming alerts | GitHub Events API has 30s-6h latency; 30-min polling is the right cadence |
| Fake star detection | Research-grade problem; niche ecosystem repos are unlikely targets |
| OAuth login / multi-user | Single-operator bot, no user accounts needed |
| Mobile app | Telegram IS the mobile app |
| Cross-platform validation (Reddit/HN) | High complexity, defer to future |
| Database (PostgreSQL/SQLite) | JSON file sufficient for v1 scale (~50-100 repos) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MON-01 | — | Pending |
| MON-02 | — | Pending |
| MON-03 | — | Pending |
| MON-04 | — | Pending |
| MON-05 | — | Pending |
| MON-06 | — | Pending |
| NOTF-01 | — | Pending |
| NOTF-02 | — | Pending |
| NOTF-03 | — | Pending |
| NOTF-04 | — | Pending |
| NOTF-05 | — | Pending |
| INFR-01 | — | Pending |
| INFR-02 | — | Pending |
| INFR-03 | — | Pending |
| INFR-04 | — | Pending |
| INFR-05 | — | Pending |
| INFR-06 | — | Pending |
| INFR-07 | — | Pending |
| INFR-08 | — | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 0
- Unmapped: 19 ⚠️

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 after initial definition*
