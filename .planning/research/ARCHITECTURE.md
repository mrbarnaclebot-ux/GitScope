# Architecture Research

**Domain:** GitHub monitoring bot with Telegram notifications
**Researched:** 2026-02-13
**Confidence:** HIGH

## System Overview

```
                         ┌──────────────────────────────────┐
                         │       Render Background Worker    │
                         │         (always-on process)       │
┌────────────────────────┼──────────────────────────────────┼────────────────────┐
│                        │                                  │                    │
│  ┌─────────────┐   ┌──┴──────────────┐   ┌──────────────┴──┐                 │
│  │  Scheduler   │──>│  Monitor Core   │──>│  Notifier        │                 │
│  │  (node-cron) │   │  (orchestrator) │   │  (Telegram Bot)  │                 │
│  └─────────────┘   └──┬──────┬───────┘   └─────────────────┘                 │
│                        │      │                                               │
│                ┌───────┘      └────────┐                                      │
│                v                       v                                      │
│  ┌─────────────────────┐  ┌───────────────────────┐                          │
│  │   GitHub Client      │  │   State Store          │                          │
│  │   (REST API v3)      │  │   (JSON file)          │                          │
│  └──────────┬──────────┘  └───────────┬───────────┘                          │
│             │                         │                                       │
└─────────────┼─────────────────────────┼───────────────────────────────────────┘
              │                         │
              v                         v
     ┌────────────────┐       ┌──────────────────┐
     │  GitHub API     │       │  Filesystem       │
     │  (api.github.   │       │  (state.json)     │
     │   com)          │       │                   │
     └────────────────┘       └──────────────────┘
```

This is a **single-process polling architecture**. One long-running Node.js process contains all components. node-cron fires on a schedule, the Monitor Core orchestrates each cycle (fetch data, diff against state, detect velocity, send alerts), and results persist to a JSON file between cycles.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Scheduler** | Triggers monitoring cycles at 30-min intervals | `node-cron` with `*/30 * * * *` expression |
| **Monitor Core** | Orchestrates each cycle: discover repos, snapshot stars, detect velocity, trigger notifications | Plain async function, the "brain" of the system |
| **GitHub Client** | Wraps GitHub REST API calls with rate-limit awareness, pagination, and error handling | Thin wrapper around `fetch` or `octokit` with retry logic |
| **State Store** | Persists star snapshots between cycles for velocity comparison | Read/write JSON file with atomic writes |
| **Notifier** | Formats and sends Telegram messages when velocity thresholds are met | Telegram Bot API via `grammy` or direct HTTP calls |
| **Config** | Holds search queries, thresholds, chat IDs, tokens | Environment variables + a config module |

## Recommended Project Structure

```
src/
├── index.js               # Entry point: init scheduler, start process
├── scheduler.js           # node-cron setup, cycle orchestration
├── monitor/
│   ├── core.js            # Main monitoring cycle logic
│   ├── discovery.js       # GitHub Search API: find repos by topic/keyword
│   └── velocity.js        # Star velocity calculations and threshold checks
├── github/
│   ├── client.js          # GitHub REST API wrapper with rate limiting
│   └── queries.js         # Search query builders for the ecosystem
├── telegram/
│   ├── bot.js             # Telegram bot initialization and message sending
│   └── formatter.js       # Message formatting (MarkdownV2 templates)
├── state/
│   ├── store.js           # JSON file read/write with atomic operations
│   └── migrations.js      # State schema versioning (for future changes)
├── config.js              # Environment variables, thresholds, defaults
└── utils/
    ├── logger.js          # Structured logging
    └── retry.js           # Exponential backoff helper
```

### Structure Rationale

- **`monitor/`:** Separates the monitoring domain logic (what to check, how to detect trends) from external API mechanics. `core.js` is the orchestrator that calls into `discovery.js` and `velocity.js`.
- **`github/`:** Isolates all GitHub API interaction behind a clean interface. If GitHub changes rate limits or we switch to GraphQL later, only this folder changes.
- **`telegram/`:** Keeps notification concerns separate. The formatter translates domain events ("repo X gained 50 stars in 6 hours") into Telegram-formatted messages. If we add Discord later, we add a `discord/` folder without touching monitoring logic.
- **`state/`:** Single responsibility for persistence. Today it is a JSON file; later it could swap to SQLite or a database. The rest of the system calls `state.store.load()` and `state.store.save()` without knowing the storage backend.
- **`utils/`:** Cross-cutting concerns that do not belong to any domain.

## Architectural Patterns

### Pattern 1: Poll-Diff-Alert Cycle

**What:** Each monitoring cycle follows a three-step pipeline: poll external data, diff against stored state, alert on significant changes. This is the dominant pattern for monitoring bots that cannot use webhooks (GitScope monitors public repos it does not own, so GitHub webhooks are not an option).

**When to use:** Any time you need to detect changes in external data you do not control.

**Trade-offs:** Simple and reliable, but introduces latency equal to the polling interval. Star changes are detected within 30 minutes, not real-time. This is acceptable for trend detection (velocity is measured over hours, not seconds).

**Example:**
```javascript
// monitor/core.js
export async function runMonitoringCycle(githubClient, stateStore, notifier) {
  // 1. POLL: Discover repos and get current star counts
  const repos = await discoverRepos(githubClient);
  const currentSnapshot = await getStarCounts(githubClient, repos);

  // 2. DIFF: Compare against previous snapshot
  const previousSnapshot = stateStore.getLatestSnapshot();
  const velocityResults = calculateVelocity(currentSnapshot, previousSnapshot);

  // 3. ALERT: Notify on repos exceeding velocity threshold
  const trending = velocityResults.filter(r => r.velocity >= config.VELOCITY_THRESHOLD);
  for (const repo of trending) {
    await notifier.sendTrendAlert(repo);
  }

  // 4. PERSIST: Save current snapshot for next cycle
  stateStore.saveSnapshot(currentSnapshot);
}
```

### Pattern 2: Sliding Window Velocity Detection

**What:** Instead of comparing only the last two snapshots (which gives noisy 30-minute deltas), maintain a time-windowed history and calculate velocity over configurable periods (e.g., stars gained per 6 hours, per 24 hours). This filters out noise and detects sustained trends.

**When to use:** When the raw delta between two polls is too noisy to be meaningful. A repo gaining 3 stars in 30 minutes might be random; gaining 50 stars in 6 hours is a trend.

**Trade-offs:** Requires storing multiple snapshots (state file grows), but for the expected scale (tens to low hundreds of repos), this is negligible. More complex threshold logic but far fewer false positives.

**Example:**
```javascript
// monitor/velocity.js
export function calculateVelocity(repoId, snapshots, windowHours = 6) {
  const now = Date.now();
  const windowStart = now - (windowHours * 60 * 60 * 1000);

  // Find the snapshot closest to the window start
  const baseline = snapshots
    .filter(s => s.timestamp >= windowStart)
    .sort((a, b) => a.timestamp - b.timestamp)[0];

  const latest = snapshots[snapshots.length - 1];

  if (!baseline) return { velocity: 0, period: windowHours };

  const starsGained = latest.stars - baseline.stars;
  const hoursElapsed = (latest.timestamp - baseline.timestamp) / (1000 * 60 * 60);

  return {
    velocity: starsGained,
    perHour: starsGained / hoursElapsed,
    period: hoursElapsed,
  };
}
```

### Pattern 3: Layered Discovery (Search + Track)

**What:** Repo monitoring operates in two modes that feed each other. **Discovery** uses the GitHub Search API to find new repos matching criteria (topics, keywords). **Tracking** monitors a known list of repos for star velocity. Discovery adds repos to the tracking list; repos can be pruned if they go dormant.

**When to use:** When the set of repos to monitor is not static and new repos appear regularly in an active ecosystem like Claude Code/OpenClaw.

**Trade-offs:** Search API has stricter rate limits (30 requests/minute authenticated, 10/minute unauthenticated). Must budget API calls between discovery and tracking. Run discovery less frequently (e.g., every 2-4 hours) than tracking (every 30 minutes).

```javascript
// monitor/discovery.js
const SEARCH_QUERIES = [
  'topic:claude-code stars:>5',
  'topic:openclaw stars:>5',
  '"claude code" in:description stars:>10',
  '"openclaw" in:description stars:>10',
];

export async function discoverNewRepos(githubClient, knownRepoIds) {
  const discovered = [];
  for (const query of SEARCH_QUERIES) {
    const results = await githubClient.searchRepos(query, { sort: 'updated' });
    for (const repo of results) {
      if (!knownRepoIds.has(repo.id)) {
        discovered.push(repo);
      }
    }
  }
  return discovered;
}
```

## Data Flow

### Primary Monitoring Flow

```
[node-cron tick]
    |
    v
[Monitor Core: runMonitoringCycle()]
    |
    ├──> [State Store: load previous snapshots]
    |         |
    |         v
    |    [JSON file read from disk]
    |
    ├──> [GitHub Client: discover + fetch star counts]
    |         |
    |         v
    |    [GitHub API: GET /search/repositories]  (rate: 30/min auth)
    |    [GitHub API: GET /repos/{owner}/{repo}]  (rate: 5000/hr auth)
    |
    ├──> [Velocity Engine: compare snapshots, detect trends]
    |         |
    |         v
    |    [Pure computation: no I/O, no side effects]
    |
    ├──> [Notifier: send alerts for trending repos]
    |         |
    |         v
    |    [Telegram Bot API: POST /sendMessage]
    |
    └──> [State Store: save updated snapshots]
              |
              v
         [JSON file written to disk atomically]
```

### State Management

```
state.json
├── meta
│   ├── version          # Schema version for migrations
│   └── lastCycleAt      # Timestamp of last successful cycle
├── repos
│   └── {repoId}
│       ├── owner         # GitHub owner
│       ├── name          # Repo name
│       ├── description   # Repo description
│       ├── topics        # Array of topics
│       ├── addedAt       # When we started tracking
│       └── snapshots[]   # Array of {timestamp, stars, forks}
└── notifications
    └── {repoId}
        └── lastAlertAt   # When we last notified about this repo
```

### Key Data Flows

1. **Discovery flow:** Scheduler triggers discovery (less frequent) -> GitHub Search API -> new repos added to `state.repos` -> initial snapshot recorded.
2. **Tracking flow:** Scheduler triggers tracking (every 30 min) -> GitHub Repos API for each tracked repo -> new snapshot appended -> velocity calculated -> alerts sent if threshold exceeded.
3. **Notification deduplication:** Before sending an alert, check `state.notifications[repoId].lastAlertAt`. Enforce a cooldown period (e.g., minimum 6 hours between alerts for the same repo) to avoid spam.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-50 repos tracked | Current design is sufficient. Single JSON file, direct API calls, no batching needed. ~50 API calls per cycle fits within rate limits. |
| 50-200 repos tracked | Batch GitHub API calls. Use the Search API to get star counts for groups instead of individual repo fetches. Paginate carefully. JSON file still fine at this scale. |
| 200-500 repos tracked | JSON file writes may slow. Consider switching to SQLite (via `better-sqlite3` or Node.js built-in `node:sqlite` in Node 22+). Add request queuing to stay under rate limits. |
| 500+ repos tracked | Requires a different architecture: database-backed, possibly GraphQL API for batch queries, multiple GitHub tokens for rate limit pooling. Out of scope for initial design. |

### Scaling Priorities

1. **First bottleneck: GitHub API rate limits.** With 5,000 requests/hour authenticated, and each tracked repo requiring 1 API call per cycle (48 cycles/day), you can track ~104 repos before exhausting the limit. **Mitigation:** Use Search API to batch-fetch star counts, conditional requests (ETags) to skip unchanged repos, and stagger discovery vs. tracking cycles.
2. **Second bottleneck: State file size.** With 100 repos and 48 snapshots/day, the state file grows by ~100KB/day. After 30 days: ~3MB. After a year: ~36MB. **Mitigation:** Prune old snapshots beyond the velocity window (keep last 7 days), archive historical data separately.

## Anti-Patterns

### Anti-Pattern 1: Fetching Every Repo Individually

**What people do:** Call `GET /repos/{owner}/{repo}` once for each tracked repo on every cycle.
**Why it is wrong:** At 100 repos, that is 100 API calls per cycle, 4800/day, consuming nearly all of the 5000/hour budget with no room for discovery or retries.
**Do this instead:** Use the Search API to fetch repos in batches of up to 100. A single `GET /search/repositories?q=repo:owner/name+repo:owner2/name2` query returns star counts for multiple repos at once. Alternatively, use conditional requests with ETags so unchanged repos return 304 (does not count against primary rate limit when authenticated).

### Anti-Pattern 2: Storing Unbounded Snapshot History

**What people do:** Append every snapshot forever, never pruning.
**Why it is wrong:** State file grows linearly. After months of running, reads and writes slow down, and the file becomes unwieldy. JSON parsing of a 50MB file blocks the event loop.
**Do this instead:** Define a retention window (e.g., 7 days of snapshots). On each save, prune snapshots older than the window. If historical data is needed for analytics, write it to a separate archive file that is not loaded every cycle.

### Anti-Pattern 3: Sending Notifications Synchronously in the Poll Loop

**What people do:** For each trending repo, send a Telegram message before moving to the next repo.
**Why it is wrong:** If Telegram is slow or rate-limits you (max 30 messages/second to same chat, 20 messages/minute to same group), the entire monitoring cycle stalls. The next cron tick may fire before the current cycle completes.
**Do this instead:** Collect all alerts during the cycle, then send them in a single batch (or a single combined message). Use a guard flag to prevent overlapping cycles: if a cycle is still running when cron fires, skip the new tick.

### Anti-Pattern 4: No Cycle Overlap Protection

**What people do:** Start a new monitoring cycle on every cron tick regardless of whether the previous one finished.
**Why it is wrong:** If a cycle takes longer than 30 minutes (network issues, rate limit retries), multiple cycles run concurrently, causing duplicate notifications and race conditions on the state file.
**Do this instead:** Use a simple boolean lock. If a cycle is in progress, skip the cron tick and log a warning.

```javascript
let isRunning = false;

cron.schedule('*/30 * * * *', async () => {
  if (isRunning) {
    logger.warn('Previous cycle still running, skipping');
    return;
  }
  isRunning = true;
  try {
    await runMonitoringCycle();
  } catch (err) {
    logger.error('Cycle failed', err);
  } finally {
    isRunning = false;
  }
});
```

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **GitHub REST API v3** | HTTP GET with Bearer token auth, JSON responses. Rate-limit-aware with header inspection and backoff. | Authenticated: 5,000 req/hr. Search API: 30 req/min. Use `Accept: application/vnd.github+json` header. Conditional requests via `If-None-Match` with ETags. |
| **Telegram Bot API** | HTTP POST to `https://api.telegram.org/bot{token}/sendMessage`. MarkdownV2 for formatting. | Send to a specific `chat_id`. Rate limit: 30 msgs/sec to same chat (1 msg/sec to groups). Use `parse_mode: "MarkdownV2"` for rich formatting. |
| **Render** | Deployed as a Background Worker (no HTTP port exposed). Environment variables for secrets. Persistent disk optional. | Process must stay alive (no HTTP health check for workers). Use structured logging to stdout for Render log viewer. Redeploys restart the process; state file persists on disk between restarts if using Render Disk. |
| **Filesystem** | `fs.readFile` / `fs.writeFile` with atomic write pattern (write to temp file, rename). | On Render, use a Render Disk mount for persistence across deploys. Without it, state resets on each deploy. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Scheduler -> Monitor Core | Direct function call | Scheduler calls `runMonitoringCycle()` on each tick. Synchronous boundary (async/await). |
| Monitor Core -> GitHub Client | Async function calls returning data | Client handles HTTP, retries, rate limits. Core receives clean domain objects. |
| Monitor Core -> State Store | Async function calls (load/save) | Store handles file I/O and atomicity. Core works with plain JS objects. |
| Monitor Core -> Notifier | Async function calls (sendAlert) | Notifier handles Telegram formatting and HTTP. Core passes domain events. |
| Velocity Engine -> Nothing external | Pure functions | Takes snapshots in, returns velocity calculations. No side effects, easily testable. |

## Build Order (Dependency Graph)

Components should be built in this order based on dependencies:

```
Phase 1: Foundation (no external dependencies between these)
├── config.js           # Everything depends on config
├── utils/logger.js     # Everything uses logging
├── utils/retry.js      # GitHub client needs retry logic
└── state/store.js      # Core depends on state; build + test with mock data

Phase 2: External Clients (depend on config + utils)
├── github/client.js    # Needs config (token), retry util
├── github/queries.js   # Needs config (search terms)
└── telegram/bot.js     # Needs config (bot token, chat ID)

Phase 3: Domain Logic (depends on clients + state)
├── monitor/discovery.js   # Needs GitHub client
├── monitor/velocity.js    # Needs state store (pure logic, easily testable)
└── telegram/formatter.js  # Needs domain knowledge of what alerts look like

Phase 4: Orchestration (depends on everything)
├── monitor/core.js     # Wires discovery + velocity + state + notifier
├── scheduler.js        # Wraps core in cron schedule with overlap protection
└── index.js            # Entry point: init all components, start scheduler
```

**Rationale:** Each phase can be independently tested before the next phase begins. Phase 1 has zero external API dependencies. Phase 2 can be tested with real APIs. Phase 3 can be tested with mock data. Phase 4 is integration.

## Sources

- [GitHub REST API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) -- Official docs. HIGH confidence.
- [GitHub REST API Best Practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) -- Official docs. HIGH confidence.
- [GitHub Search API](https://docs.github.com/en/free-pro-team@latest/rest/reference/search) -- Official docs. HIGH confidence.
- [GitHub Repos API](https://docs.github.com/en/rest/repos/repos) -- Official docs. HIGH confidence.
- [Render Background Workers](https://render.com/docs/background-workers) -- Official docs. HIGH confidence.
- [node-cron](https://github.com/node-cron/node-cron) -- Official repo. HIGH confidence.
- [grammY Framework Comparison](https://grammy.dev/resources/comparison) -- Official docs. HIGH confidence.
- [Telegram Bot API](https://core.telegram.org/bots/api) -- Official docs. HIGH confidence.
- [lowdb - JSON Database](https://github.com/typicode/lowdb) -- Official repo. MEDIUM confidence (architecture pattern, not specific endorsement).
- [Daily Stars Explorer](https://github.com/emanuelef/daily-stars-explorer) -- Reference implementation for star tracking patterns. LOW confidence (third-party project, not authoritative).

---
*Architecture research for: GitHub monitoring bot with Telegram notifications (GitScope)*
*Researched: 2026-02-13*
