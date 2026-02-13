# Pitfalls Research

**Domain:** GitHub monitoring / trend detection Telegram bot
**Researched:** 2026-02-13
**Confidence:** HIGH (verified against official GitHub and Telegram documentation)

## Critical Pitfalls

### Pitfall 1: GitHub Search API Rate Limit Wall (30 req/min)

**What goes wrong:**
The GitHub Search API has a separate, much stricter rate limit than the general REST API: 30 requests per minute for authenticated users, 10 for unauthenticated. Developers build their polling logic around the 5,000 req/hr primary limit and are blindsided when search queries hit 429 errors after just 30 calls in a minute. The bot stops discovering new repos entirely until the limit resets.

**Why it happens:**
The search rate limit is documented separately from the primary rate limit and is easy to overlook. Developers assume authenticated = 5,000/hr applies uniformly. In reality, the search endpoint has its own counter: 30 requests per minute, regardless of how many primary requests remain.

**How to avoid:**
- Track search API usage separately from the primary rate limit counter.
- Read the `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on every search response.
- Design search queries to be maximally efficient: use `per_page=100` (not the default 30) to get 3x the data per request.
- Batch discovery into a single scheduled window rather than spreading searches throughout the hour.
- If monitoring N keyword queries, calculate: N queries x pages_needed <= 30/min budget. For GitScope monitoring the OpenClaw/Claude Code ecosystem, this is likely 2-5 queries with 1-2 pages each -- well within budget if planned correctly.

**Warning signs:**
- HTTP 422 responses with `"message": "Only the first 1000 search results are available"`.
- HTTP 403 responses with `"message": "API rate limit exceeded"` on search endpoints while other API calls work fine.
- Gaps in discovery data where no new repos appear for extended periods.

**Phase to address:**
Phase 1 (Core MVP). Rate limiting must be baked into the very first API call. Never ship a polling loop without rate limit awareness.

---

### Pitfall 2: Secondary Rate Limit / Abuse Detection Ban

**What goes wrong:**
GitHub has an opaque "secondary rate limit" system that monitors behavioral patterns -- concurrent requests, request velocity, CPU time consumed. Bots that make requests too quickly, even well under the primary 5,000/hr cap, get temporarily blocked with 403 responses. Continuing to make requests while blocked leads to permanent integration bans.

**Why it happens:**
The secondary rate limit triggers are intentionally undocumented. GitHub states they "cannot disclose the exact methods used for detecting and preventing abuse." Developers who see 4,970 remaining requests assume they are safe and keep hammering. The secondary system cares about patterns, not just counts: 100 concurrent requests, >900 points per minute for REST, or rapid-fire POST/PATCH/PUT/DELETE calls all trigger it.

**How to avoid:**
- Make all requests serially, never concurrently. Use a request queue.
- Wait at least 1 second between mutation requests (though GitScope likely only uses GET).
- Respect the `Retry-After` header on 403 responses immediately. Do not retry until that time has passed.
- Implement exponential backoff: 1s, 2s, 4s, 8s... up to a maximum.
- Use conditional requests (ETags / `If-None-Match`) aggressively. A 304 response does not count against the primary rate limit at all.
- Log every 403 and 429 response with full context for debugging.

**Warning signs:**
- Intermittent 403 responses that resolve after waiting, then recur.
- `Retry-After` header appearing in responses.
- The phrase "You have exceeded a secondary rate limit" in error messages.

**Phase to address:**
Phase 1 (Core MVP). Must be handled alongside primary rate limiting. The request queue and serial execution pattern should be foundational.

---

### Pitfall 3: JSON State File Corruption Under Concurrent Writes

**What goes wrong:**
Using a JSON file (`state.json`) for persistence seems simple, but Node.js async operations create race conditions. If the polling loop triggers a state write while a previous write is still flushing to disk, the file can be truncated or corrupted. The bot restarts, reads a corrupt/empty file, loses all tracked state, and either re-sends all notifications (spam) or loses track of which repos it already reported (missed alerts).

**Why it happens:**
`fs.writeFile` is not atomic. The operation truncates the file first, then writes new content. If the process crashes between truncation and completion, the file is empty or partial. Even with `await`, if two async paths both read-then-write the same file, the second write overwrites the first's changes (classic lost update).

**How to avoid:**
- Write to a temporary file, then atomically rename it over the original (`write-file-atomic` npm package, or manual `fs.rename`). This is the single most important prevention.
- Implement a write queue: only one write operation in flight at a time. Use a simple mutex/semaphore pattern.
- Keep a backup: before writing, copy the current file to `state.backup.json`. On startup, if `state.json` is corrupt/missing, fall back to the backup.
- Validate JSON on read: wrap `JSON.parse` in try/catch. If it fails, log an error and fall back to backup or empty state with a notification to the operator.
- Consider `node-persist` if the state grows complex, but for a simple bot, atomic writes + backup is sufficient.

**Warning signs:**
- Empty or truncated `state.json` after a crash or restart.
- `SyntaxError: Unexpected end of JSON input` on startup.
- Duplicate notifications after restarts (state was lost).
- Missed notifications after restarts (new state overwrote valid tracking data).

**Phase to address:**
Phase 1 (Core MVP). State persistence is the backbone. Get atomic writes right from day one. Never use bare `fs.writeFile` for state that matters.

---

### Pitfall 4: Star Velocity False Positives from Fake Stars and Growth Hacking

**What goes wrong:**
A repo suddenly gains 500 stars in 24 hours. The bot fires an excited alert. Two weeks later, the repo is abandoned -- the stars were purchased from a star-selling service, or came from a coordinated growth-hacking campaign. Research has identified over 4.5 million suspected inauthentic stars across 22,915 repositories. Star inflation from growth hacking is a documented, widespread problem.

**Why it happens:**
GitHub stars are the easiest metric to game. Creating bot accounts was trivial before verification requirements, and millions of bot accounts still exist. Star-selling services charge as little as $0.01 per star. The bot treats raw star velocity as a signal of organic traction when it may be entirely artificial.

**How to avoid:**
- Never rely on star count alone. Cross-reference with commit activity, issue/PR activity, fork count, and contributor diversity.
- Implement a "cooling off" period: flag repos as "trending" but wait 48-72 hours before promoting them as "gaining real traction." Check if the growth sustains.
- For the OpenClaw/Claude Code ecosystem specifically, the repo universe is small and curated. Focus on repos that are topically relevant (keyword matches, dependency references) rather than casting a wide net where fake-star repos are more common.
- Track star growth rate over multiple samples, not just point-in-time deltas. A repo that gained 200 stars in hour 1 and 0 in the next 23 hours is suspicious. A repo gaining 8-10/hr consistently is more likely organic.
- Consider the repo's age: a 1-day-old repo with 500 stars is far more suspicious than a 6-month-old repo that crossed 500 stars organically.

**Warning signs:**
- Spike-then-flatline pattern in star growth.
- High star count with zero issues, zero PRs, minimal commits.
- Stars from accounts with no other activity.
- Star-to-fork ratio wildly out of normal range (normal is roughly 10:1 to 30:1 stars:forks for active projects).

**Phase to address:**
Phase 2 (Trend Intelligence). Basic star tracking works in Phase 1, but false positive filtering requires additional signals and should be a deliberate Phase 2 enhancement.

---

### Pitfall 5: Telegram Message Parse Mode Escaping Failures

**What goes wrong:**
The bot constructs a notification message containing a repo name like `my_awesome_repo` or a description containing characters like `*`, `[`, `)`, `>`. When sent with `parse_mode: "MarkdownV2"`, Telegram rejects the entire message with a 400 error because special characters were not escaped. The notification is silently lost. Worse: the bot may enter a retry loop on the same malformed message, blocking all subsequent notifications.

**Why it happens:**
Telegram's MarkdownV2 requires escaping of: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`. That is 20 characters. Repo names, descriptions, and URLs routinely contain these characters. Developers test with clean repo names and never encounter the escaping issue until production.

**How to avoid:**
- Use `parse_mode: "HTML"` instead of MarkdownV2. HTML is far more forgiving -- only `<`, `>`, `&`, and `"` need escaping (via `&lt;`, `&gt;`, `&amp;`, `&quot;`), and these are rare in repo names/descriptions. This is the single strongest recommendation.
- If using MarkdownV2, build a dedicated escaping function that handles all 20 special characters and apply it to every dynamic string before interpolation.
- Wrap every `sendMessage` call in try/catch. On formatting errors (400 response), retry with `parse_mode` removed (plain text fallback) so the notification still goes through.
- Never let a single failed message block the notification queue. Process notifications independently.

**Warning signs:**
- 400 errors from the Telegram API containing "Bad Request: can't parse entities."
- Notifications that silently disappear (no error handling on the send call).
- Notifications that work for some repos but not others (depends on characters in the name/description).

**Phase to address:**
Phase 1 (Core MVP). Message formatting is core delivery. Use HTML parse mode from the start. Add a plain-text fallback immediately.

---

### Pitfall 6: Notification Deduplication Failure Across Restarts

**What goes wrong:**
The bot detects repo X is trending, sends a notification. The process restarts (deploy, crash, server reboot). On restart, repo X is still trending. Without proper deduplication state, the bot sends the notification again. And again after the next restart. Users get spammed with duplicate alerts and lose trust in the bot.

**Why it happens:**
Deduplication requires persistent state: "I already notified about repo X on date Y." If the state is only in memory, every restart wipes it. If the state is in a JSON file but the "notified" flag was not written before the crash, it is lost. If deduplication keys are poorly chosen (e.g., just the repo name without a time window), the bot either never re-notifies about a repo (missing legitimate re-trending) or always re-notifies (spam).

**How to avoid:**
- Write deduplication state to disk immediately after successful Telegram delivery, not before. This guarantees that if the process crashes between detection and notification, the worst case is a re-send (acceptable) rather than a missed notification (unacceptable).
- Use a composite deduplication key: `{repo_full_name}:{date_window}`. This allows re-notification if a repo trends again in a future time window (e.g., weekly).
- On startup, load the deduplication state and skip any repos already in it for the current window.
- Include a "last notified" timestamp per repo so you can implement cooldown periods (e.g., don't re-notify about the same repo within 7 days).

**Warning signs:**
- Users reporting duplicate notifications, especially after deploys.
- Notification log showing the same repo notified multiple times on the same day.
- After a crash, a burst of notifications for repos that were already reported.

**Phase to address:**
Phase 1 (Core MVP). Deduplication is table stakes for a notification bot. It must be in the initial implementation, not retrofitted.

---

### Pitfall 7: GitHub Search API 1,000-Result Hard Ceiling

**What goes wrong:**
The GitHub Search API returns at most 1,000 results per query, regardless of how many actually match. If you search for repos with `stars:>10` in a popular topic, there may be 50,000 matches, but you only see the first 1,000. Repos that should be in your results are invisible. The bot thinks it has complete data when it does not.

**Why it happens:**
GitHub enforces a hard 1,000-result limit for performance reasons. The `total_count` field in the response may say 50,000, but you can only paginate through the first 1,000. Additionally, the API may set `incomplete_results: true` if the query timed out internally before finding all matches.

**How to avoid:**
- For GitScope's use case (OpenClaw/Claude Code ecosystem), this is likely manageable because the ecosystem is niche. Queries like `claude code` or `openclaw` will return far fewer than 1,000 results.
- If broader monitoring is needed, segment queries by date range: `created:2026-02-01..2026-02-07`, `created:2026-02-08..2026-02-13`, etc. Each segment gets its own 1,000-result window.
- Always check the `incomplete_results` field in the API response. If `true`, your data is partial -- log a warning and consider narrowing the query.
- Use `per_page=100` to minimize the number of API calls needed to reach results (10 pages instead of 34 at the default of 30).

**Warning signs:**
- `total_count` in search response is significantly higher than the repos you actually retrieved.
- `incomplete_results: true` in the response.
- Known trending repos in the ecosystem are not appearing in your bot's results.

**Phase to address:**
Phase 1 (Core MVP). Query design is foundational. Validate that your specific queries return complete results early.

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Bare `fs.writeFile` for state | Simple, no dependencies | File corruption on crash, lost state, duplicate notifications | Never. Use atomic writes from day one. |
| Storing PAT directly in source code | Quick to get started | Token leaked if repo goes public. GitHub auto-revokes detected tokens. | Never. Use `.env` file + `.gitignore` from the very first commit. |
| Polling without conditional requests (ETags) | Simpler code, fewer headers to manage | 3-5x unnecessary API consumption, hits rate limits faster | MVP only. Add ETags in Phase 2 at the latest. |
| In-memory-only deduplication | No file I/O, simpler | All state lost on restart, duplicate spam | Never for production. Acceptable only during initial 10-minute prototyping. |
| Single monolithic poll-then-notify function | Fast to write | Impossible to test, debug, or extend. Rate limit handling tangled with business logic. | First prototype only. Refactor into separate concerns before Phase 1 is "done." |
| Hardcoded search queries | Works for initial scope | Adding new keywords requires code changes and redeployment | MVP Phase 1. Move to config file in Phase 2. |
| No logging | Less code | Blind when things go wrong. Cannot diagnose rate limit issues, missed notifications, or state corruption. | Never. Structured logging (with timestamps) from day one. |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub REST API | Treating search rate limit (30/min) as the same bucket as primary rate limit (5,000/hr) | Track them as separate counters. Read `X-RateLimit-*` headers on every search response separately. |
| GitHub REST API | Ignoring `Retry-After` header on 403 secondary rate limit responses | Parse the header, wait that exact duration, then retry. Continuing to send requests risks a ban. |
| GitHub REST API | Using default `per_page=30` on search results | Always set `per_page=100`. Reduces request count by 70% for the same data. |
| GitHub REST API | Not using `Accept: application/vnd.github.star+json` header on stargazers endpoint | Without this custom media type, you only get user objects. With it, you get `starred_at` timestamps, critical for velocity calculations. |
| Telegram Bot API | Using MarkdownV2 parse mode with unescaped dynamic content | Use HTML parse mode. Only 4 characters need escaping vs. 20 for MarkdownV2. |
| Telegram Bot API | Sending >1 msg/sec to the same chat, or >20 msg/min to a group | Implement a per-chat send queue. Respect 429 `retry_after` values. Never suppress or ignore them. |
| Telegram Bot API | Ignoring 429 `Retry-After` responses | The `retry_after` value is per-chat since early 2025. Store it and obey it. Continued violation leads to temporary bot ban. |
| JSON state file | Using `JSON.parse(fs.readFileSync(...))` without try/catch | Always wrap in error handling. Corrupt files should fall back to backup, not crash the bot. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching all stargazers to count them instead of reading `stargazers_count` from the repo object | API calls scale linearly with star count (100 stars = 1 call, 10,000 stars = 100 calls) | Use the repo object's `stargazers_count` field. Only fetch individual stargazers if you need timestamps. | Any repo with >100 stars starts consuming disproportionate API budget. |
| Re-fetching unchanged data on every poll cycle | Wasted requests, faster rate limit exhaustion | Use ETags/conditional requests. 304 responses are free against the primary rate limit. | When monitoring >10 repos with hourly polling, unconditional requests eat ~240 calls/day unnecessarily. |
| Loading entire state file into memory on every write | Fine for 10 repos, slow for 10,000 | For GitScope's likely scale (<500 repos), this is fine. Only optimize if monitoring scope grows significantly. | >5,000 tracked repos with complex state objects. |
| No pagination handling on search results | Missing repos that appear on page 2+ | Always follow the `Link` header for next page. Loop until no `next` link. | Any search returning >100 results (with `per_page=100`). |
| Synchronous `setInterval` scheduler without overlap protection | If a poll cycle takes 90 seconds and the interval is 60 seconds, two cycles run simultaneously | Use a pattern where the next cycle is scheduled only after the current one completes: `setTimeout` after completion, not `setInterval`. | When network latency or rate limit waits cause poll cycles to exceed the interval duration. |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| GitHub PAT committed to the repo (even in a "private" repo) | GitHub detected 39M+ leaked secrets in 2024. Even if you delete the commit, the token is in git history. GitHub auto-revokes some detected tokens, breaking your bot. | Use `.env` file, add to `.gitignore` before first commit. Use fine-grained PAT with minimum required scopes (public repo read access only). |
| PAT with excessive scopes (`repo`, `admin:org`) | If leaked, attacker can modify/delete your repositories, access private repos, manage org settings | Use a fine-grained PAT scoped to public repository read-only access. GitScope only needs to read public data. |
| Telegram bot token in source code | Anyone with the token can impersonate your bot, send messages to your subscribers, read incoming messages | Same as PAT: `.env` file, `.gitignore`. Rotate immediately if exposed. |
| No input validation on repo names/URLs before processing | Path traversal or injection if repo data is used in file paths or shell commands | Validate repo names match `^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$` before using them in any file operations or display strings. |
| Running the bot as root or with broad filesystem access | A bug or dependency vulnerability could affect the entire system | Run with minimal permissions. Use a dedicated user account. Containerize if possible. |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Sending raw JSON or unformatted data in notifications | Users cannot quickly scan and understand what is trending and why | Format with clear hierarchy: repo name (linked), star count, growth rate, one-line description. Use HTML bold/italic sparingly. |
| Flooding the channel with 20+ notifications at once during a spike | Users mute the channel and never unmute | Batch notifications: if >5 repos are trending simultaneously, send a single digest message. "5 repos trending today:" with a compact list. |
| No context on WHY a repo is notable | Users see "repo X has 50 stars" and think "so what?" | Include delta: "+32 stars in 24h (was 18)." Include the repo description. Link directly to the repo. |
| Notifications at 3 AM in the user's timezone | Users wake up to stale alerts they cannot act on | Schedule notification delivery during business hours (configurable). Queue overnight discoveries for a morning digest. |
| No way to see what the bot is monitoring or its status | Users wonder if the bot is working or dead | Provide a `/status` command showing: last poll time, repos being tracked, next poll scheduled, current rate limit usage. |
| Notifications about repos the user has already seen/dismissed | Repeated noise erodes trust | Track "notified" state per repo. Only re-notify if significant new traction occurs (e.g., crossed 100, 500, 1000 star thresholds). |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Rate Limiting:** Often missing separate tracking for search API vs. REST API limits -- verify both are tracked independently with separate counters.
- [ ] **State Persistence:** Often missing atomic write protection -- verify that a kill -9 during write does not corrupt the file (test by writing large state and killing the process mid-write).
- [ ] **Notification Delivery:** Often missing retry on Telegram API failure -- verify that a temporary Telegram outage does not permanently lose notifications (they should be queued and retried).
- [ ] **Deduplication:** Often missing time-window awareness -- verify that a repo can be re-notified if it trends again next week, but NOT re-notified on every poll cycle this week.
- [ ] **Error Handling:** Often missing graceful degradation -- verify that a GitHub API outage does not crash the bot (it should log, wait, and retry on the next cycle).
- [ ] **Message Formatting:** Often missing special character escaping -- verify notifications work for repos named `my_[test]_repo*` or with descriptions containing markdown characters.
- [ ] **Search Completeness:** Often missing `incomplete_results` check -- verify the bot logs a warning when GitHub returns partial search results.
- [ ] **Startup Recovery:** Often missing corrupt state handling -- verify the bot starts cleanly even if `state.json` is empty, truncated, or contains invalid JSON.
- [ ] **Logging:** Often missing timestamps and context -- verify every log line includes ISO timestamp, the operation being performed, and relevant IDs (repo name, API endpoint).
- [ ] **Credential Security:** Often missing `.gitignore` entries -- verify that `.env`, `state.json`, and any local config files with tokens are in `.gitignore` before the first commit.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| State file corruption | LOW | Fall back to `state.backup.json`. If no backup exists, start fresh -- the bot will re-detect currently trending repos and may send some duplicate notifications. Notify the operator. |
| GitHub API ban (secondary rate limit) | MEDIUM | Stop all requests immediately. Wait the `Retry-After` duration (typically minutes). If banned for longer, create a new fine-grained PAT. Review request patterns and add stricter throttling before resuming. |
| Telegram bot token leaked | LOW | Revoke token via @BotFather immediately. Generate new token. Update `.env`. Restart bot. No data is lost -- Telegram bots are stateless on the server side. |
| GitHub PAT leaked | LOW | Revoke in GitHub Settings > Developer settings > Personal access tokens. Generate new fine-grained token with minimal scopes. Update `.env`. GitHub may have auto-revoked it already. |
| Mass duplicate notifications sent | MEDIUM | Send an apology message to the channel acknowledging the duplicates. Fix the deduplication logic. Backfill the deduplication state from the notification log to prevent re-occurrence. |
| Missed trending repos (query too narrow) | LOW | Broaden search queries. Review the `total_count` vs. retrieved count in recent API responses. Add additional keyword variations. No historical data is lost -- the bot will pick up currently-trending repos on the next cycle. |
| False positive alert flood (fake stars) | LOW | Send correction to channel if warranted. Add the repo to an ignore list. Implement or tighten the multi-signal validation (commits, issues, forks alongside stars). |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Search API rate limit wall | Phase 1: Core MVP | Log shows separate search rate limit tracking. Bot never hits 429 on search in normal operation. |
| Secondary rate limit / abuse ban | Phase 1: Core MVP | All requests are serial. Retry-After is respected. No 403 responses in production logs. |
| JSON state file corruption | Phase 1: Core MVP | Kill the bot process mid-write 5 times. State file is never corrupted (atomic writes verified). |
| Star velocity false positives | Phase 2: Trend Intelligence | Bot cross-references at least 2 signals (stars + commits or stars + forks). Cooldown period implemented. |
| Telegram parse mode escaping | Phase 1: Core MVP | Send test notifications with repos containing `_`, `*`, `[`, `(`, `.` in names/descriptions. All render correctly. |
| Notification deduplication failure | Phase 1: Core MVP | Restart the bot 3 times in 10 minutes. No duplicate notifications sent for the same repo in the same time window. |
| Search API 1,000-result ceiling | Phase 1: Core MVP | `incomplete_results` field is checked and logged. For GitScope's niche queries, results are well under 1,000. |
| Credential exposure | Phase 1: Core MVP | `.gitignore` includes `.env` and `state.json`. `git log` shows no tokens in history. Fine-grained PAT with read-only public scope. |
| Notification flooding / poor UX | Phase 2: Polish | Digest mode implemented for >5 simultaneous trending repos. Status command available. |
| Scheduler overlap / drift | Phase 1: Core MVP | Use completion-triggered scheduling (`setTimeout` after cycle completes), not fixed `setInterval`. Log confirms no overlapping cycles. |

## Sources

- [GitHub REST API Rate Limits - Official Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) -- PRIMARY rate limits, secondary rate limits, point system (HIGH confidence)
- [GitHub REST API Best Practices - Official Docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) -- Conditional requests, serial execution, abuse prevention (HIGH confidence)
- [GitHub Starring API - Official Docs](https://docs.github.com/en/rest/activity/starring) -- Stargazers endpoints, custom media types, pagination (HIGH confidence)
- [GitHub Search API Documentation](https://github.com/github/docs/blob/main/content/rest/search/search.md) -- 1,000-result limit, `incomplete_results` field (HIGH confidence)
- [grammY Flood Control Documentation](https://grammy.dev/advanced/flood) -- Telegram rate limits: ~30 msg/sec bulk, 20 msg/min per group, 1 msg/sec per chat (HIGH confidence)
- [Telegram Bot API](https://core.telegram.org/bots/api) -- Parse modes, MarkdownV2 escaping requirements, HTML formatting (HIGH confidence)
- [Dagster Blog: Detecting Fake GitHub Stars](https://dagster.io/blog/fake-stars) -- 4.5M+ suspected fake stars, bot account patterns (MEDIUM confidence)
- [OpenSauced: Growth Hacking Killed GitHub Stars](https://opensauced.pizza/blog/growth-hacking-killed-github-stars) -- Star inflation, growth hacking patterns (MEDIUM confidence)
- [ROSS Index Methodology - Runa Capital](https://runacap.com/ross-index/methodology/) -- Star growth rate calculation: AGR = (now/quarter_ago)^4 - 1 (MEDIUM confidence)
- [GitHub Community Discussion #151675](https://github.com/orgs/community/discussions/151675) -- Rate limit handling real-world experiences (MEDIUM confidence)
- [GitHub Community Discussion #141073](https://github.com/orgs/community/discussions/141073) -- Secondary rate limit triggered after minimal search queries (MEDIUM confidence)
- [PyGithub Issue #824](https://github.com/PyGithub/PyGithub/issues/824) -- 1,000-result limit documentation and workarounds (MEDIUM confidence)
- [PyGithub Issue #2812](https://github.com/PyGithub/PyGithub/issues/2812) -- Inconsistent results when sorting by stars (MEDIUM confidence)
- [Node.js Help Issue #2346](https://github.com/nodejs/help/issues/2346) -- writeFile corruption under high-frequency writes (MEDIUM confidence)
- [Jamie Magee: Making the Most of GitHub Rate Limits](https://jamiemagee.co.uk/blog/making-the-most-of-github-rate-limits/) -- ETag/conditional request savings quantified (MEDIUM confidence)
- [Endor Labs: Getting Most Out of GitHub API Rate Limits](https://www.endorlabs.com/learn/how-to-get-the-most-out-of-github-api-rate-limits) -- Practical optimization strategies (MEDIUM confidence)

---
*Pitfalls research for: GitHub monitoring / trend detection Telegram bot (GitScope)*
*Researched: 2026-02-13*
