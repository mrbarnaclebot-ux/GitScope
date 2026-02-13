# Feature Research

**Domain:** GitHub ecosystem monitoring / trend alert bot (niche-scoped, Telegram delivery)
**Researched:** 2026-02-13
**Confidence:** MEDIUM-HIGH (ecosystem is well-understood; niche-specific features are GitScope-unique)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Keyword-based repo discovery** | The entire value proposition hinges on finding relevant repos. Users expect the bot to search GitHub for repos matching ecosystem keywords (openclaw, claude-code, etc.) | LOW | GitHub Search API: `GET /search/repositories?q={keyword}`. 30 req/min limit on search endpoint -- must batch queries efficiently. Combine keywords into fewer queries where possible. |
| **Star velocity detection** | The core alert trigger. Users expect "this repo is gaining traction" signals, not just "this repo exists." Velocity (stars/day) is the standard metric in this domain. | MEDIUM | Two approaches: (1) Poll repo `stargazers_count` on interval, diff against stored snapshot. (2) Use Stargazers API with `Accept: application/vnd.github.star+json` header for timestamps. Approach 1 is simpler and sufficient for v1. |
| **Configurable thresholds** | Different repo ages and sizes need different thresholds. A 2-week-old repo gaining 5 stars/day is notable; a 3-year-old repo needs 10+/day. Users expect this is tunable. | LOW | Project already defines thresholds: <30 days old = 5 stars/day, older = 10 stars/day, first appearance with >= 20 stars. Store in config, not hardcoded. |
| **Deduplication / alert suppression** | Getting the same alert twice for the same repo is the #1 complaint about monitoring bots. Users assume this works correctly. | LOW | Track `notified_repos` with timestamp of last alert. Enforce minimum re-alert interval (e.g., 24h cooldown before re-alerting for same repo). |
| **Formatted Telegram messages** | Raw data dumps feel broken. Users expect repo name as clickable link, star count, velocity metric, description, and language -- formatted with Telegram Markdown/HTML. | LOW | Telegram Bot API supports HTML and MarkdownV2 parse modes. Use HTML for reliability (fewer escaping issues). Include: repo URL, description, stars, velocity, language, age. |
| **Scheduled polling** | Users expect the bot runs automatically on a cadence -- not something they need to trigger manually. Always-on monitoring. | LOW | node-cron on Render Background Worker. 30-min interval is well within API rate limits (Search: 30/min, Core: 5000/hr). |
| **State persistence** | Bot must remember what it has seen across restarts. Losing state = duplicate alerts flood. | LOW | JSON file is fine for v1 scale (tracking dozens to low hundreds of repos). Contains: repo snapshots with star counts, notification history, last poll timestamp. |
| **Error handling / resilience** | Bot that silently dies and nobody notices is worse than no bot. Users expect it to recover from API failures, rate limits, network issues. | MEDIUM | Exponential backoff on API errors. Log rate limit headers (`x-ratelimit-remaining`, `x-ratelimit-reset`). Use ETags on Events API for 304 responses. Alert to Telegram on repeated failures (meta-alert). |

### Differentiators (Competitive Advantage)

Features that set GitScope apart. Not expected from generic trending tools, but valuable for this niche use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Niche ecosystem scoping** | Generic trending tools (GitHub Trending, Trendshift, OSSInsight) show ALL trending repos. GitScope's value is laser focus on OpenClaw/Claude Code ecosystem only. This is the #1 differentiator -- no existing tool does this. | LOW | Already designed in. Keyword list + topic filtering. The scoping IS the product. |
| **New repo discovery (first appearance alerts)** | Detecting a brand-new repo that just appeared with 20+ stars is more valuable than tracking known repos. This catches ecosystem forks, new tools, and community experiments early. Most star trackers only monitor repos you already know about. | MEDIUM | Requires search for new repos each cycle, diffing against known repo set. The `created:>YYYY-MM-DD` qualifier helps find genuinely new repos. This is a key v1 feature. |
| **Velocity context in alerts** | Don't just say "repo X has 50 stars." Say "repo X gained 15 stars in the last 24 hours (up from 35), created 5 days ago." Context makes the alert actionable. | LOW | Compute delta from stored snapshots. Include: current stars, delta, velocity (stars/day over measurement window), repo age, and trend direction (accelerating/decelerating). |
| **Fork spike detection** | A sudden increase in forks often signals developer adoption (people building on top of the project) -- a different signal from star popularity. Fork spikes for ecosystem repos indicate tooling being built. | MEDIUM | Same polling pattern as stars but track `forks_count`. Needs separate thresholds (fork velocity is typically 5-10x lower than star velocity). v2 feature. |
| **Release detection** | New releases of ecosystem tools matter to the group. If openclaw/core publishes v2.0, that's newsworthy. Existing tools like github-release-monitor handle this for known repos. | MEDIUM | GitHub Releases API: `GET /repos/{owner}/{repo}/releases/latest`. Poll tracked repos for new release tags. Needs: version comparison logic, pre-release filtering. Per-repo customizable (some repos release often, don't want noise). v2 feature. |
| **Weekly digest summaries** | A rollup of the week's activity: new repos discovered, biggest star gainers, total ecosystem growth. Provides signal even in quiet weeks ("nothing notable happened" is itself useful). | MEDIUM | Aggregate stored data into weekly summary. Send on schedule (e.g., Friday 5PM). Format as a single Telegram message with sections. Requires enough historical data (at least 1 week of snapshots). v2 feature. |
| **Contributor growth signals** | A repo going from 1 to 5 contributors is a stronger adoption signal than star count. Indicates real engagement. | HIGH | Requires `GET /repos/{owner}/{repo}/contributors` per tracked repo. API-expensive (1 call per repo). Better suited for "watched" repos only, not the full search set. v2+ feature. |
| **Hacker News / Reddit cross-validation** | When a repo trends AND appears on HN/Reddit simultaneously, that's a much stronger signal. Daily Stars Explorer already overlays HN mentions on star graphs. | HIGH | Requires additional API integrations (HN Algolia API, Reddit API). Adds significant complexity. High signal value but high implementation cost. Future feature. |
| **Alert severity tiers** | Not all alerts are equal. A repo gaining 100 stars/day is more urgent than one gaining 6. Tiering (normal / hot / viral) helps the group prioritize attention. | LOW | Simple threshold ranges applied to velocity. Use emoji or formatting to distinguish tiers in Telegram messages. Low effort, high signal value. Good v1 addition. |
| **Quiet hours / rate limiting alerts** | In a burst scenario (multiple repos trending simultaneously), batch alerts into a single message rather than flooding the chat. | LOW | Queue alerts, batch-send with a small delay. If >3 alerts in one cycle, combine into a single multi-repo message. Simple but prevents the chat from becoming unusable. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. Deliberately NOT building these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Web dashboard** | "I want to see historical charts and trends" | Massively increases scope (frontend, hosting, auth, API). GitScope's value is push-based alerts, not pull-based analytics. The Telegram group IS the interface. For historical analysis, tools like star-history.com and daily-stars-explorer already exist. | Link to star-history.com in alert messages for anyone who wants to dig deeper. |
| **ML-based trend prediction** | "Predict which repos will trend before they do" | Requires training data that doesn't exist for this niche. False positives would destroy trust in alerts. Star patterns are noisy and heavily influenced by external events (blog posts, conference talks) that are unpredictable. | Simple velocity thresholds are robust and explainable. Add severity tiers instead. |
| **Multi-platform delivery (Discord, Slack, email)** | "What if I'm not on Telegram?" | Splits notification logic, adds auth complexity, increases maintenance surface. The target users are in ONE specific Telegram group. | Keep Telegram-only. If demand emerges, abstract the notification layer later -- but don't build it preemptively. |
| **User-configurable keywords via bot commands** | "Let me add my own keywords to track" | Turns a focused ecosystem monitor into a generic tool. Each keyword adds API calls (search rate limit is 30/min). User-added keywords could exhaust rate limits. Also requires per-user state management. | Admin-managed keyword list in config. Accept keyword suggestions via group discussion. |
| **Real-time streaming alerts** | "I want instant notifications when a star happens" | GitHub Events API has 30s-6h latency and is explicitly "not built for real-time use cases" (per GitHub docs). Webhooks require owning the repos. Polling more frequently than 30min wastes rate limit budget. | 30-minute polling cadence is the sweet spot: fast enough for awareness, slow enough for rate limits. |
| **Fake star detection** | "Filter out repos with bought stars" | Fake star detection is a research-grade problem (CMU found 4.5M+ suspected fake stars). Building reliable detection requires analyzing stargazer accounts, temporal patterns, and profile characteristics. Way beyond scope. | Note: Niche ecosystem repos (OpenClaw/Claude Code) are unlikely targets for star manipulation. If concerned, manually check via dagster-io/fake-star-detector. |
| **Full GitHub event monitoring** | "Track issues, PRs, commits, discussions too" | Event volume would overwhelm a Telegram chat. Each event type needs different thresholds, formatting, and dedup logic. Creates massive alert fatigue. | Focus on high-signal events only: star velocity, fork spikes, releases. These are the "traction" signals. |
| **Database (PostgreSQL/SQLite)** | "JSON files won't scale" | At v1 scale (monitoring dozens of repos, polling every 30 min), JSON is perfectly adequate. A database adds deployment complexity on Render, migration management, and connection pooling concerns -- all for storing a few KB of data. | JSON file for v1. Migrate to SQLite only if tracking >500 repos or needing complex queries. The migration path is straightforward. |

## Feature Dependencies

```
[Keyword-based repo discovery]
    |
    +--requires--> [GitHub API auth + rate limit handling]
    |
    +--feeds-----> [Star velocity detection]
    |                  |
    |                  +--requires--> [State persistence (snapshots)]
    |                  |
    |                  +--feeds-----> [Formatted Telegram alerts]
    |                  |                  |
    |                  |                  +--requires--> [Telegram Bot API integration]
    |                  |                  |
    |                  |                  +--enhances--> [Alert severity tiers]
    |                  |                  |
    |                  |                  +--enhances--> [Quiet hours / batching]
    |                  |
    |                  +--feeds-----> [Deduplication / alert suppression]
    |                  |
    |                  +--enhances--> [Velocity context in alerts]
    |
    +--feeds-----> [New repo discovery (first appearance)]
    |
    +--feeds-----> [Fork spike detection] (v2, same pattern as star velocity)
    |
    +--feeds-----> [Release detection] (v2, per tracked repo)

[State persistence]
    |
    +--feeds-----> [Weekly digest summaries] (v2, requires 7+ days of snapshots)

[Contributor growth signals] (v2+)
    +--requires--> [State persistence]
    +--requires--> [Tracked repo list] (API-expensive, only for watched repos)

[Scheduled polling]
    +--requires--> [Error handling / resilience]
    +--orchestrates--> [All discovery and detection features]
```

### Dependency Notes

- **Star velocity requires state persistence:** You cannot compute velocity without comparing current star count to a previous snapshot. State must be the first thing built.
- **Alert formatting requires Telegram integration:** The bot connection must work before any alerts can be sent. Build and test Telegram delivery first with a hardcoded test message.
- **Weekly digest requires accumulated history:** Cannot ship digest until the bot has been running for at least a week. Natural v2 feature.
- **Fork/release detection reuses the star velocity pattern:** Same poll-diff-alert loop, just different metrics. Once the core pattern works for stars, extending to forks and releases is incremental.
- **Contributor growth is API-expensive:** Unlike stars (which come free with repo search results), contributors require a separate API call per repo. Reserve for a curated "watched" list, not the full search set.
- **Alert severity tiers and batching are independent enhancements:** They improve any alert type and can be added at any time without changing core logic.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate that ecosystem monitoring provides value to the Telegram group.

- [x] **GitHub API auth + rate limit handling** -- Foundation; everything depends on this
- [x] **Keyword-based repo discovery** -- Search GitHub for OpenClaw/Claude Code ecosystem repos
- [x] **Star velocity detection** -- Core alert trigger: detect repos gaining stars faster than threshold
- [x] **New repo discovery (first appearance)** -- Catch brand-new ecosystem repos with initial traction
- [x] **State persistence (JSON)** -- Remember what we've seen across polling cycles
- [x] **Deduplication / alert suppression** -- Don't flood the chat with repeat alerts
- [x] **Formatted Telegram alerts with velocity context** -- Rich messages: repo link, stars, velocity, age, description
- [x] **Alert severity tiers** -- Visual distinction between "notable" and "hot" repos (low effort, high value)
- [x] **Scheduled polling (30-min cron)** -- Always-on monitoring on Render
- [x] **Error handling with meta-alerts** -- Recover from failures; alert on repeated errors

### Add After Validation (v1.x)

Features to add once core is working and the group finds the alerts valuable.

- [ ] **Fork spike detection** -- Trigger: group requests "what about forks?" or a notable fork event is missed
- [ ] **Alert batching / quiet hours** -- Trigger: multiple repos trend in same cycle and chat gets noisy
- [ ] **Configurable thresholds via environment** -- Trigger: thresholds need tuning after real-world data
- [ ] **Release detection for watched repos** -- Trigger: group wants to know when key ecosystem tools release new versions

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Weekly digest summaries** -- Requires accumulated data; ship after 2+ weeks of running
- [ ] **Contributor growth signals** -- API-expensive; only for a curated watchlist
- [ ] **Hacker News / Reddit cross-validation** -- High value but high complexity; needs separate API integrations
- [ ] **Notification abstraction layer** -- Only if delivery platform expansion is needed

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Keyword-based repo discovery | HIGH | LOW | P1 |
| Star velocity detection | HIGH | MEDIUM | P1 |
| New repo discovery (first appearance) | HIGH | MEDIUM | P1 |
| Formatted Telegram alerts | HIGH | LOW | P1 |
| State persistence (JSON) | HIGH | LOW | P1 |
| Deduplication / alert suppression | HIGH | LOW | P1 |
| Scheduled polling | HIGH | LOW | P1 |
| Error handling / resilience | HIGH | MEDIUM | P1 |
| Alert severity tiers | MEDIUM | LOW | P1 |
| Velocity context in alerts | MEDIUM | LOW | P1 |
| Fork spike detection | MEDIUM | LOW (reuses star pattern) | P2 |
| Alert batching | MEDIUM | LOW | P2 |
| Release detection | MEDIUM | MEDIUM | P2 |
| Weekly digest summaries | MEDIUM | MEDIUM | P3 |
| Contributor growth | LOW | HIGH | P3 |
| HN/Reddit cross-validation | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (v1)
- P2: Should have, add when possible (v1.x)
- P3: Nice to have, future consideration (v2+)

## Competitor Feature Analysis

| Feature | github-trending-repos | gh-telegram-stars-bot | Daily Stars Explorer | Trendshift | OSSInsight | **GitScope** |
|---------|----------------------|----------------------|---------------------|------------|------------|-------------|
| Niche ecosystem focus | No (all languages) | No (user-specified repos) | No (any repo) | No (all repos) | No (all repos) | **Yes -- core differentiator** |
| Star velocity alerts | No (trending list only) | Yes (star count changes) | No (visualization only) | No (web only) | No (web only) | **Yes** |
| New repo discovery | No (known trending only) | No (must subscribe manually) | No (must search manually) | Partial (trending page) | Partial (trending API) | **Yes -- automatic** |
| Push notifications | GitHub notifications | Telegram | None | None | None | **Telegram** |
| Fork tracking | No | No | Yes (visualization) | No | Yes (analytics) | **v2** |
| Release tracking | No | No | No | No | No | **v2** |
| Weekly digest | Yes (weekly issue update) | No | No | No | No | **v2** |
| Historical data | No | No | Yes (full star history) | Yes (daily metrics) | Yes (5B+ events) | **Snapshots only** |
| Configurable thresholds | No | No | No (not alert-based) | No | No | **Yes** |
| Alert deduplication | N/A | Basic | N/A | N/A | N/A | **Yes (with cooldown)** |
| Fake star awareness | No | No | No | Partial (scoring algo) | No | **Out of scope (niche repos unlikely targets)** |

**Key takeaway from competitor analysis:** No existing tool combines niche ecosystem scoping + velocity-based alerting + push delivery to Telegram. The closest tools either track everything (no focus) or require manual repo subscription (no discovery). GitScope's combination of automatic discovery + velocity detection + ecosystem focus is genuinely novel for this use case.

## Sources

- [gh-telegram-stars-bot](https://github.com/0xfurai/gh-telegram-stars-bot) -- Telegram star tracking bot (TypeScript, Supabase)
- [tg-stargazers-bot](https://github.com/x1unix/tg-stargazers-bot) -- Go-based Telegram star tracker
- [github-trending-repos](https://github.com/vitalets/github-trending-repos) -- GitHub-native trending notifications via issues
- [Daily Stars Explorer](https://github.com/emanuelef/daily-stars-explorer) -- Granular daily star history with trend detection
- [Trendshift](https://trendshift.io/) -- Alternative to GitHub Trending with scoring algorithm
- [OSSInsight](https://ossinsight.io/) -- Comprehensive GitHub analytics with trending API
- [github-release-monitor](https://github.com/iamspido/github-release-monitor) -- Multi-notification release tracking
- [github_monitor](https://github.com/misiektoja/github_monitor) -- Full GitHub OSINT monitoring tool
- [GitHub REST API: Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) -- Official rate limit documentation (HIGH confidence)
- [GitHub REST API: Events](https://docs.github.com/en/rest/activity/events) -- Events API with ETag polling (HIGH confidence)
- [GitHub REST API: Starring](https://docs.github.com/en/rest/activity/starring) -- Stargazers with timestamps (HIGH confidence)
- [GitHub Search: Repositories](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories) -- Search qualifiers documentation (HIGH confidence)
- [Fake GitHub Stars Research (CMU/arXiv)](https://arxiv.org/html/2412.13459v1) -- 4.5M suspected fake stars analysis
- [star-history.com](https://www.star-history.com/) -- Star history visualization tool
- [Bomberbot: 5 Ways to Track Trending Repos](https://www.bomberbot.com/github/5-ways-to-keep-track-of-trending-repositories-on-github/) -- Ecosystem overview
- [ToolJet: GitHub Stars Guide](https://blog.tooljet.com/github-stars-guide/) -- Star velocity and evaluation metrics

---
*Feature research for: GitHub ecosystem monitoring / trend alert bot*
*Researched: 2026-02-13*
