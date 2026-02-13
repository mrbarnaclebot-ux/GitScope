# Project Research Summary

**Project:** GitScope
**Domain:** GitHub ecosystem monitoring bot with Telegram notifications
**Researched:** 2026-02-13
**Confidence:** HIGH

## Executive Summary

GitScope is a specialized GitHub monitoring bot that tracks star velocity and new repository discoveries in niche ecosystems (OpenClaw, Claude Code) and delivers real-time alerts via Telegram. Unlike generic trending tools that track all of GitHub, GitScope's value proposition is laser-focused ecosystem monitoring with automatic discovery of emerging projects. This is a single-process polling architecture running as a Render Background Worker, combining GitHub REST API searches with stateful velocity detection and push notifications.

The recommended implementation centers on Node.js 22.x with grammY for Telegram integration, @octokit/rest for GitHub API access, and node-cron for scheduled polling. The architecture follows a poll-diff-alert cycle pattern: every 30 minutes, search for new repos matching ecosystem keywords, snapshot star counts, compare against stored state to detect velocity trends, and send Telegram alerts for repos exceeding configurable thresholds. State persists to a JSON file using atomic writes to prevent corruption. This approach balances simplicity with reliability—no database needed for v1 scale (tracking 50-100 repos), yet the architecture can scale to SQLite when monitoring 200+ repositories.

The critical risks are GitHub API rate limits (especially the 30 requests/min search API limit), state file corruption under concurrent writes, and notification spam from duplicate alerts or false positives. Mitigation requires separate rate limit tracking for search vs. REST endpoints, atomic file writes with backup fallback, and persistent deduplication state with time-windowed cooldown periods. Research confidence is high across all areas—stack choices are verified against official documentation, feature priorities derive from competitor analysis and domain patterns, architecture follows established monitoring bot patterns, and pitfalls are documented with prevention strategies.

## Key Findings

### Recommended Stack

GitScope's stack prioritizes active maintenance, TypeScript support, and zero unnecessary dependencies. The core is Node.js 22.x LTS (Render's default runtime), grammY 1.40+ for Telegram (actively maintained with better TypeScript support than the abandoned Telegraf), and @octokit/rest 22.x for GitHub API (lighter than the full octokit SDK since we only need REST endpoints). Scheduling uses node-cron 4.2+ (simple dependency-free cron for single-schedule use cases), and state persists via Node.js built-in fs/promises with atomic write-to-temp-then-rename pattern.

**Core technologies:**
- **Node.js 22.x LTS**: Runtime pinned to Render's default to avoid bleeding-edge risk; Maintenance LTS until April 2026
- **grammY ^1.40.0**: Best TypeScript Telegram framework; actively maintained (published same-day as research) vs. Telegraf (2 years stale)
- **@octokit/rest ^22.0.1**: REST-only GitHub client; handles auth, pagination, rate-limit headers; lighter than full SDK since we only need search + stargazers endpoints
- **node-cron ^4.2.1**: Simple cron scheduler for 30-minute polling interval; no need for heavier job queues
- **JSON file with atomic writes**: Project constraint for v1; migrate to SQLite only if tracking >200 repos or needing complex queries
- **zod ^4.3.6**: Config validation to fail fast on missing environment variables at startup
- **pino ^10.3.1**: Structured JSON logging for Render's log viewer; fastest Node.js logger
- **TypeScript ^5.7.x**: Type safety catches config typos, API misuse, null issues even in a small bot

**Alternatives to avoid:**
- Telegraf (last published 2 years ago), node-telegram-bot-api (depends on deprecated `request` package), Express/Fastify (no web server needed), dotenv (Node 22.x has built-in --env-file), MongoDB/PostgreSQL (massive overhead for ~50-100 repos), Bull/BullMQ (requires Redis for a single scheduled job), PM2 (redundant on Render's managed platform).

### Expected Features

GitScope's feature set divides into table stakes (users assume these exist), competitive differentiators (unique to this niche), and anti-features (deliberately not building despite common requests).

**Must have (table stakes):**
- Keyword-based repo discovery via GitHub Search API
- Star velocity detection with configurable thresholds (young repos: 5 stars/day, older: 10 stars/day)
- New repo discovery alerts (first appearance with >=20 stars)
- Deduplication / alert suppression (cooldown periods to prevent spam)
- Formatted Telegram messages with HTML parse mode (repo link, stars, velocity, age, description)
- Scheduled polling on 30-minute intervals (always-on monitoring)
- State persistence across restarts (JSON file)
- Error handling with exponential backoff and meta-alerts on repeated failures

**Should have (competitive differentiators):**
- Niche ecosystem scoping (OpenClaw/Claude Code focus—no existing tool does this)
- Velocity context in alerts (not just "50 stars" but "gained 15 in 24h, up from 35, created 5 days ago")
- Alert severity tiers (visual distinction between "notable" and "hot" repos)
- New repo discovery automation (catches ecosystem forks and community experiments early)
- Fork spike detection (v2—developer adoption signal, lower thresholds than star velocity)
- Release detection for watched repos (v2—new versions of ecosystem tools)
- Weekly digest summaries (v2—rollup of the week's activity)

**Defer (v2+):**
- Web dashboard (push-based alerts are the value; for historical analysis, star-history.com exists)
- ML-based trend prediction (no training data for this niche; simple velocity thresholds are robust)
- Multi-platform delivery (Telegram-only for target users; abstraction layer only if demand emerges)
- User-configurable keywords (would exhaust search rate limit; admin-managed keyword list)
- Real-time streaming alerts (GitHub Events API has 30s-6h latency; 30-min polling is the sweet spot)
- Fake star detection (research-grade problem; niche repos unlikely targets)
- Full GitHub event monitoring (issues/PRs/commits create alert fatigue; focus on high-signal events only)

### Architecture Approach

GitScope is a single-process polling architecture with five core components: Scheduler (node-cron triggers every 30 minutes), Monitor Core (orchestrates discover-snapshot-detect-notify cycle), GitHub Client (wraps REST API with rate-limit awareness), State Store (JSON file with atomic writes), and Notifier (Telegram Bot API via grammY). The dominant pattern is poll-diff-alert: fetch current data, compare against stored snapshots, alert on velocity thresholds, persist updated state. This is the standard approach for monitoring bots that cannot use webhooks (GitScope monitors public repos it does not own).

**Major components:**
1. **Scheduler (node-cron)** — Triggers monitoring cycles at 30-minute intervals; uses completion-triggered scheduling (setTimeout after cycle completes) rather than fixed setInterval to prevent overlapping cycles
2. **Monitor Core** — Orchestrates each cycle: calls discovery for new repos, velocity engine for trend detection, notifier for alerts; contains the business logic and decision-making
3. **GitHub Client** — Thin wrapper around @octokit/rest; handles rate-limit header inspection, exponential backoff, pagination, ETag-based conditional requests; isolates all GitHub API interaction
4. **State Store** — Manages JSON file persistence; implements atomic writes (write-to-temp-then-rename), maintains backup copy, validates on read with fallback to backup if corrupt
5. **Notifier (Telegram)** — Formats domain events into HTML-formatted Telegram messages; queues sends to respect rate limits (1 msg/sec to groups); separates formatting (formatter.js) from delivery (bot.js)

**Key patterns:**
- **Layered discovery:** Search API finds new repos (every 2-4 hours), tracking monitors known repos (every 30 minutes)—feeds each other with different rate limit budgets
- **Sliding window velocity:** Calculate stars/hour over 6-24 hour windows rather than raw 30-minute deltas to filter noise
- **Serial execution with overlap protection:** One cycle at a time; if previous cycle is still running when cron fires, skip the tick and log a warning

### Critical Pitfalls

Research identified seven critical pitfalls with documented prevention strategies. These are verified against official GitHub and Telegram documentation and real-world bot operator experiences.

1. **GitHub Search API Rate Limit Wall (30 req/min)** — Search endpoint has separate, stricter limit than primary 5,000/hr REST limit. Track separately, use per_page=100, batch queries efficiently. Prevention: Separate counter for search API, read X-RateLimit-* headers on every search response.

2. **Secondary Rate Limit / Abuse Detection Ban** — GitHub's opaque behavioral monitoring system blocks patterns (concurrent requests, rapid velocity) even under primary limit. Prevention: Make all requests serially (never concurrently), respect Retry-After header immediately, implement exponential backoff, use ETags aggressively (304 responses are free).

3. **JSON State File Corruption Under Concurrent Writes** — fs.writeFile is not atomic; crash during write = corrupt/empty file = lost state = duplicate spam. Prevention: Write to temp file then atomically rename (write-file-atomic pattern), keep backup copy, validate JSON on read with fallback.

4. **Star Velocity False Positives from Fake Stars** — Repos can buy stars (4.5M+ suspected fake stars across GitHub). Prevention: Cross-reference multiple signals (stars + commits + forks), implement 48-72h cooling period before promoting as "real traction," track growth rate consistency (spike-then-flatline is suspicious).

5. **Telegram Message Parse Mode Escaping Failures** — MarkdownV2 requires escaping 20 special characters; repo names/descriptions routinely contain them; unescaped = 400 error = lost notification. Prevention: Use HTML parse mode (only 4 characters need escaping), wrap sendMessage in try/catch with plain-text fallback.

6. **Notification Deduplication Failure Across Restarts** — In-memory-only dedup state = every restart = duplicate alerts. Prevention: Write deduplication state to disk immediately after successful Telegram delivery, use composite key (repo:date_window), implement cooldown periods (e.g., 7 days).

7. **GitHub Search API 1,000-Result Hard Ceiling** — Search returns max 1,000 results regardless of matches; repos beyond page 10 are invisible. Prevention: For niche queries (OpenClaw/Claude Code), results are well under 1,000; check incomplete_results field; segment by date range if needed.

## Implications for Roadmap

Based on research, recommended four-phase structure prioritizes foundational infrastructure, core MVP features, polish and trend intelligence, then ecosystem expansion.

### Phase 1: Foundation & Core Polling
**Rationale:** Must establish reliable infrastructure before any features—rate limiting, state management, and error handling are prerequisites for all monitoring functionality.
**Delivers:**
- GitHub API client with dual rate-limit tracking (search: 30/min, REST: 5,000/hr)
- State store with atomic writes and backup fallback
- Telegram bot initialization with HTML message formatting
- Config validation (zod) and structured logging (pino)
- Scheduler with overlap protection
**Addresses:**
- Pitfall 1 (Search API rate limit), Pitfall 2 (Secondary rate limit), Pitfall 3 (State corruption), Pitfall 5 (Telegram escaping), Pitfall 7 (Search ceiling)
**Avoids:**
- Technical debt from bare fs.writeFile, untracked rate limits, hardcoded credentials
**Research flag:** Standard patterns—no phase research needed. Well-documented GitHub API + Telegram Bot API.

### Phase 2: Discovery & Velocity Detection
**Rationale:** With infrastructure proven, implement the core value proposition: discover trending repos and send alerts. Builds on Phase 1's foundation.
**Delivers:**
- Keyword-based repo discovery (GitHub Search API)
- Star velocity calculation with sliding windows (6h, 24h)
- New repo discovery (first appearance alerts)
- Configurable velocity thresholds (young vs. old repos)
- Alert severity tiers (notable / hot / viral)
**Addresses:**
- Features: Keyword discovery, star velocity, new repo alerts, formatted messages (all table stakes)
**Uses:**
- GitHub Client from Phase 1, State Store for snapshot comparison, Notifier for delivery
**Implements:**
- Monitor Core orchestrator, discovery.js, velocity.js components
**Research flag:** Standard patterns—velocity calculation is well-understood. No phase research needed.

### Phase 3: Notification Refinement & UX
**Rationale:** Core monitoring works; now optimize the user experience to prevent notification fatigue and improve signal quality.
**Delivers:**
- Deduplication with time-windowed cooldowns (no re-alerts within 7 days)
- Alert batching for simultaneous trending repos (digest mode)
- Velocity context enrichment (delta, repo age, trend direction)
- Error recovery with meta-alerts (notify operators on repeated GitHub/Telegram failures)
**Addresses:**
- Pitfall 6 (Deduplication failure)
- UX pitfalls: flooding, no context, duplicate alerts
**Uses:**
- State Store for notification history, Notifier for digest formatting
**Research flag:** Standard patterns—deduplication is well-understood. No phase research needed.

### Phase 4: Trend Intelligence & Expansion
**Rationale:** MVP validated with group usage; now add deeper signals and ecosystem-specific enhancements.
**Delivers:**
- Fork spike detection (reuses star velocity pattern with different thresholds)
- Release detection for watched repos (GitHub Releases API)
- Weekly digest summaries (aggregate accumulated data)
- Contributor growth signals (API-expensive, only for curated watchlist)
**Addresses:**
- Pitfall 4 (Star velocity false positives via multi-signal validation)
- Features: Fork spikes, releases, weekly digests (v2 features)
**Uses:**
- Sliding window pattern from Phase 2, State Store for historical data aggregation
**Research flag:** Fork/release patterns are standard—no phase research needed. Contributor growth may need API optimization research (API-expensive).

### Phase Ordering Rationale

- **Infrastructure-first:** Phases 1-2 establish foundation before features. Rate limiting, state persistence, and error handling cannot be retrofitted—they must be foundational.
- **Dependency-driven:** Phase 2 (velocity detection) depends on Phase 1 (GitHub Client, State Store). Phase 3 (deduplication) depends on Phase 2's notification flow. Phase 4 (multi-signal validation) depends on Phase 2's velocity baseline.
- **Value-driven pacing:** Phase 2 delivers the core value proposition (trending alerts). Phase 3 prevents user annoyance (spam/duplicates). Phase 4 adds intelligence only after core is validated with real users.
- **Risk mitigation:** Critical pitfalls (rate limits, state corruption, escaping) are addressed in Phases 1-2 before any production usage. False positive filtering (Pitfall 4) defers to Phase 4 after real data informs threshold tuning.

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** GitHub REST API and Telegram Bot API are official, well-documented. Rate limiting patterns are standard.
- **Phase 2 (Discovery & Velocity):** Star velocity calculation is well-understood in the monitoring bot domain. Search API patterns are documented.
- **Phase 3 (Notification Refinement):** Deduplication and batching are standard notification system patterns.
- **Phase 4 (Trend Intelligence - Fork/Release):** Fork and release detection reuse the poll-diff-alert pattern from Phase 2.

**Phases potentially needing deeper research during planning:**
- **Phase 4 (Contributor Growth Signals):** Contributor API is expensive (1 call per repo); may need research into pagination optimization and caching strategies if API budget becomes constrained.

**No phases require domain research.** GitHub monitoring patterns are well-established, and ecosystem-specific knowledge (OpenClaw/Claude Code) is already embedded in feature requirements (keyword lists, topics).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technology choices verified against official npm, Render docs, and Node.js LTS schedule. grammY vs. Telegraf comparison based on publish dates and official comparison page. Version compatibility checked against package requirements. |
| Features | HIGH | Table stakes derived from competitor analysis (5 existing similar tools reviewed), domain patterns (GitHub monitoring bots), and project requirements. Differentiators are unique to niche scoping (no competing tool offers this). Anti-features based on documented pitfalls in adjacent projects. |
| Architecture | HIGH | Poll-diff-alert cycle is the standard pattern for webhook-less monitoring. Component boundaries follow single-responsibility principle. Scaling considerations grounded in GitHub API rate limits (5,000/hr primary, 30/min search). Build order tested via dependency graph. |
| Pitfalls | HIGH | All critical pitfalls verified against official GitHub REST API docs, Telegram Bot API docs, and documented real-world bot operator experiences (GitHub community discussions, PyGithub issues). Prevention strategies are specific and testable. |

**Overall confidence:** HIGH

### Gaps to Address

Research is comprehensive with no critical gaps. Minor areas for runtime validation:

- **Actual search result counts for OpenClaw/Claude Code queries:** Research assumes niche queries return <1,000 results and avoid the search API ceiling. Validate this assumption during Phase 2 implementation by logging total_count vs. retrieved count for each search query. If any query approaches 1,000, implement date-range segmentation.

- **Real-world velocity thresholds:** Recommended thresholds (5 stars/day for young repos, 10 stars/day for older) are based on research into similar monitoring tools (ROSS Index, Trendshift). Fine-tune these during Phase 3 based on actual alert volume and user feedback. State Store design supports easy threshold adjustment via config.

- **Telegram group rate limit behavior:** Official docs specify 20 msg/min to groups, but real-world enforcement may vary by group size and history. Monitor for 429 responses during Phase 3 alert batching implementation and adjust batch size dynamically if needed.

## Sources

### Primary (HIGH confidence)
- [GitHub REST API Rate Limits - Official Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — Primary, secondary, search rate limits
- [GitHub REST API Best Practices - Official Docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — Conditional requests, serial execution
- [GitHub Search API - Official Docs](https://docs.github.com/en/rest/search/search) — Search endpoints, 1,000-result limit, incomplete_results field
- [GitHub Stargazers API - Official Docs](https://docs.github.com/en/rest/activity/starring) — Stargazers with timestamps via star+json media type
- [Telegram Bot API - Official Docs](https://core.telegram.org/bots/api) — Parse modes, rate limits, sendMessage endpoint
- [grammY Framework - Official Site](https://grammy.dev/) — Framework comparison, API reference, TypeScript support
- [Render Background Workers - Official Docs](https://render.com/docs/background-workers) — Process lifecycle, persistent disk
- [Node.js Releases - Official](https://nodejs.org/en/about/previous-releases) — LTS schedule, version support windows
- [NPM: grammY](https://www.npmjs.com/package/grammy) — Version 1.40.0, publish dates
- [NPM: Telegraf](https://www.npmjs.com/package/telegraf) — Version 4.16.3, last published 2 years ago
- [NPM: @octokit/rest](https://www.npmjs.com/package/@octokit/rest) — Version 22.0.1, compatibility
- [NPM: node-cron](https://www.npmjs.com/package/node-cron) — Version 4.2.1
- [NPM: zod](https://www.npmjs.com/package/zod) — Version 4.3.6
- [NPM: pino](https://www.npmjs.com/package/pino) — Version 10.3.1

### Secondary (MEDIUM confidence)
- [Daily Stars Explorer](https://github.com/emanuelef/daily-stars-explorer) — Reference implementation for star tracking patterns
- [Trendshift](https://trendshift.io/) — Alternative trending algorithm and scoring
- [OSSInsight](https://ossinsight.io/) — Comprehensive GitHub analytics
- [gh-telegram-stars-bot](https://github.com/0xfurai/gh-telegram-stars-bot) — Similar bot (TypeScript, Supabase)
- [github-trending-repos](https://github.com/vitalets/github-trending-repos) — GitHub-native trending notifications
- [Dagster: Detecting Fake GitHub Stars](https://dagster.io/blog/fake-stars) — 4.5M+ suspected fake stars analysis
- [OpenSauced: Growth Hacking Killed GitHub Stars](https://opensauced.pizza/blog/growth-hacking-killed-github-stars) — Star inflation patterns
- [ROSS Index Methodology - Runa Capital](https://runacap.com/ross-index/methodology/) — Star growth rate formulas
- [Jamie Magee: Making Most of GitHub Rate Limits](https://jamiemagee.co.uk/blog/making-the-most-of-github-rate-limits/) — ETag savings quantified
- [GitHub Community Discussion #151675](https://github.com/orgs/community/discussions/151675) — Rate limit handling experiences
- [GitHub Community Discussion #141073](https://github.com/orgs/community/discussions/141073) — Secondary rate limit triggers
- [PyGithub Issue #824](https://github.com/PyGithub/PyGithub/issues/824) — 1,000-result limit workarounds
- [grammY Flood Control Docs](https://grammy.dev/advanced/flood) — Telegram rate limit details

### Tertiary (LOW confidence)
- [lowdb JSON Database](https://github.com/typicode/lowdb) — Architecture pattern reference (not specific endorsement)
- [Node.js Help Issue #2346](https://github.com/nodejs/help/issues/2346) — writeFile corruption discussion

---
*Research completed: 2026-02-13*
*Ready for roadmap: yes*
