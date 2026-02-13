# Phase 2: Monitoring & Alerting - Research

**Researched:** 2026-02-13
**Domain:** GitHub API search & rate limiting, Telegram message formatting, cron scheduling with overlap protection, star velocity detection
**Confidence:** HIGH

## Summary

Phase 2 is the core value proposition: the bot searches GitHub for repos matching ecosystem keywords, detects star velocity trends, and delivers formatted alerts to Telegram. The implementation spans four technical domains: (1) GitHub Search API queries with `@octokit/rest` and rate limit management via `@octokit/plugin-throttling`, (2) star velocity calculation from stored snapshots, (3) HTML-formatted Telegram alerts via `grammY`'s `bot.api.sendMessage`, and (4) scheduled execution via `node-cron` v4 with built-in `noOverlap` protection.

The most critical finding is that **GitHub's Search API has a separate, more restrictive rate limit** (30 requests/minute for authenticated users) compared to the core REST API (5,000 requests/hour). The `@octokit/plugin-throttling` v11.0.3 handles both automatically via `onRateLimit` and `onSecondaryRateLimit` callbacks, and is compatible with the installed `@octokit/rest` v22 (both use `@octokit/core` ^7.0.0). The six configured keywords can be combined into a single query using GitHub's `OR` operator (max 5 `AND`/`OR`/`NOT` operators per query), reducing API calls from 6 per cycle to 1-2. The `node-cron` v4 API has a built-in `noOverlap: true` option that prevents concurrent cycle execution -- no need to hand-roll a mutex.

**Primary recommendation:** Use `@octokit/plugin-throttling` for automatic rate limit handling rather than building manual counters. Use `node-cron`'s built-in `noOverlap` for overlap protection. Use grammY's `Api` class directly (no `bot.start()` / polling) since the bot only sends outbound messages and does not need to receive updates.

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | ^22.0.1 | GitHub REST API client | Already installed. Provides typed `octokit.rest.search.repos()` and `octokit.rest.repos.get()` methods. Uses `@octokit/core` 7.0.6 internally. |
| grammY | ^1.40.0 | Telegram Bot Framework | Already installed. `bot.api.sendMessage()` with `parse_mode: "HTML"` for formatted alerts. Can use `Api` class standalone without bot polling. |
| node-cron | ^4.2.1 | Cron scheduling | Already installed. v4 has built-in `noOverlap: true` option, `TaskFn` receives `TaskContext` with date info, built-in TypeScript types (no `@types` needed). |
| zod | ^4.3.6 | Config/schema validation | Already installed. Will extend env schema with new monitoring config (keywords, thresholds). |
| pino | ^10.3.1 | Structured logging | Already installed. Will use `createLogger("monitor")`, `createLogger("github")`, `createLogger("telegram")` child loggers. |

### New Dependencies

| Library | Version | Purpose | Why Needed |
|---------|---------|---------|------------|
| @octokit/plugin-throttling | ^11.0.3 | Automatic GitHub rate limit handling | Handles both primary (X-RateLimit) and secondary (Retry-After) rate limits automatically. `onRateLimit` and `onSecondaryRateLimit` callbacks for logging. Peer dep `@octokit/core: ^7.0.0` satisfied by installed `@octokit/core@7.0.6`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@octokit/plugin-throttling` | Manual rate limit tracking via response headers | Throttling plugin handles queueing, backoff, and Retry-After automatically. Manual tracking requires parsing `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` headers, implementing sleep/queue logic, and handling edge cases (clock skew, secondary limits). Plugin is ~10 lines of config vs ~100+ lines of manual code. **Use the plugin.** |
| `node-cron` `noOverlap` | Manual boolean mutex flag (`let isRunning = false`) | node-cron v4's `noOverlap` is built into the scheduler and fires the `execution:overlap` event for logging. A manual flag works but misses edge cases (unhandled promise rejection leaving flag stuck). **Use `noOverlap`.** |
| grammY `Bot` class | grammY `Api` class standalone | `Bot` class adds middleware, update handling, and polling -- none needed for outbound-only alerts. However, `Bot` class provides `bot.api` accessor which is convenient and does not require calling `bot.start()`. `new Bot(token)` validates token format at construction time. **Use `Bot` class but never call `bot.start()`.** |
| Multiple search queries (one per keyword) | Single query with `OR` operator | GitHub allows up to 5 `AND`/`OR`/`NOT` operators per query. Six keywords can fit in 1-2 queries using `keyword1 OR keyword2 OR keyword3` syntax, saving 4-5 API calls per cycle. Queries are limited to 256 characters (excluding qualifiers). **Use `OR` to combine keywords.** |

**Installation:**
```bash
npm install @octokit/plugin-throttling
```

No other new dependencies needed -- all core libraries are already installed from Phase 1.

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
src/
  config.ts              # EXTEND: add MONITOR_KEYWORDS, velocity thresholds, cron expression
  logger.ts              # NO CHANGE
  state/
    schema.ts            # EXTEND: add language field to repo snapshot, ensure velocity data is storable
    store.ts             # NO CHANGE (already has updateState + save)
  github/
    client.ts            # NEW: Octokit instance with throttling plugin, exports configured client
    search.ts            # NEW: searchRepos(keywords) -- runs search queries, returns normalized results
    rate-limiter.ts      # NEW: rate limit status logging/tracking (reads from Octokit response headers)
  monitor/
    cycle.ts             # NEW: orchestrates one monitoring cycle (search -> detect -> alert)
    velocity.ts          # NEW: calculateVelocity(repo, snapshots) -- star velocity detection logic
    classifier.ts        # NEW: classifyAlert(velocity, repoAge) -- severity tier assignment
  telegram/
    formatter.ts         # NEW: formatAlert(repo, velocity, tier) -- HTML message builder
    sender.ts            # NEW: sendAlert(chatId, message) -- grammY API wrapper
  scheduler.ts           # NEW: node-cron setup with noOverlap, wires cycle.ts
  index.ts               # EXTEND: init GitHub client, init Telegram, start scheduler
```

### Pattern 1: GitHub Client with Throttling Plugin
**What:** Create a single Octokit instance extended with `@octokit/plugin-throttling`. The plugin automatically queues requests, respects rate limits, and calls back on limit events.
**When to use:** Always. All GitHub API access goes through this client.
**Source:** Verified against @octokit/rest.js docs (Context7) and @octokit/plugin-throttling README.

```typescript
// src/github/client.ts
import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { createLogger } from "../logger.js";

const log = createLogger("github");

const ThrottledOctokit = Octokit.plugin(throttling);

export function createGitHubClient(token: string): InstanceType<typeof ThrottledOctokit> {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        log.warn(
          { method: options.method, url: options.url, retryAfter, retryCount },
          "GitHub rate limit hit"
        );
        // Retry once after waiting
        if (retryCount < 1) {
          log.info({ retryAfter }, "Retrying after rate limit");
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        log.warn(
          { method: options.method, url: options.url, retryAfter },
          "GitHub secondary rate limit hit"
        );
        // Do not retry secondary limits -- back off entirely
        return false;
      },
    },
  });
}
```

### Pattern 2: Search Query Construction with OR Operator
**What:** Combine multiple keywords into a single GitHub search query using the `OR` operator to minimize API calls. GitHub allows up to 5 `AND`/`OR`/`NOT` operators per query, and queries are limited to 256 characters (excluding qualifiers).
**When to use:** Every monitoring cycle when searching for ecosystem repos.
**Source:** Verified against GitHub REST API search docs and GitHub search syntax docs.

```typescript
// src/github/search.ts
// Keywords: openclaw, claude-code, clawdbot, moltbot, clawhub, "openclaw skills"
// Strategy: combine with OR, search in name+description+topics+readme
// 6 keywords = 5 OR operators = exactly at the limit

const QUALIFIERS = "in:name,description,topics,readme";

function buildSearchQuery(keywords: string[]): string {
  // Join keywords with OR, wrap multi-word keywords in quotes
  const keywordQuery = keywords
    .map(k => (k.includes(" ") ? `"${k}"` : k))
    .join(" OR ");
  return `${keywordQuery} ${QUALIFIERS}`;
  // Result: 'openclaw OR claude-code OR clawdbot OR moltbot OR clawhub OR "openclaw skills" in:name,description,topics,readme'
}

// Call with:
// const { data } = await octokit.rest.search.repos({ q: buildSearchQuery(keywords), per_page: 100, sort: "updated" });
```

### Pattern 3: Star Velocity Calculation
**What:** Calculate star velocity by comparing current star count against the most recent stored snapshot. Velocity = (currentStars - previousStars) / hoursSinceLastSnapshot * 24 to normalize to stars/day.
**When to use:** After fetching current repo data, before classification.
**Source:** Derived from requirements MON-02, MON-03.

```typescript
// src/monitor/velocity.ts
interface VelocityResult {
  starsPerDay: number;
  isNew: boolean;        // First time seeing this repo
  repoAgeDays: number;   // Days since repo creation
  currentStars: number;
  previousStars: number;
}

function calculateVelocity(
  currentStars: number,
  createdAt: string,       // ISO timestamp from GitHub
  lastSnapshot: { stars: number; timestamp: string } | null,
  now: Date = new Date()
): VelocityResult {
  const createdDate = new Date(createdAt);
  const repoAgeDays = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

  if (!lastSnapshot) {
    // New repo -- first time seen
    return {
      starsPerDay: 0,   // Cannot calculate velocity without a previous snapshot
      isNew: true,
      repoAgeDays,
      currentStars,
      previousStars: 0,
    };
  }

  const hoursSinceSnapshot = (now.getTime() - new Date(lastSnapshot.timestamp).getTime()) / (1000 * 60 * 60);
  if (hoursSinceSnapshot < 0.1) {
    // Avoid division by near-zero
    return { starsPerDay: 0, isNew: false, repoAgeDays, currentStars, previousStars: lastSnapshot.stars };
  }

  const starsPerDay = ((currentStars - lastSnapshot.stars) / hoursSinceSnapshot) * 24;

  return {
    starsPerDay,
    isNew: false,
    repoAgeDays,
    currentStars,
    previousStars: lastSnapshot.stars,
  };
}
```

### Pattern 4: Severity Tier Classification
**What:** Classify alerts into severity tiers based on velocity magnitude. Requirements specify three tiers: notable, hot, viral.
**When to use:** After velocity calculation, before formatting the alert message.
**Source:** Derived from requirement MON-04.

```typescript
// src/monitor/classifier.ts
type SeverityTier = "notable" | "hot" | "viral";

interface ThresholdConfig {
  youngRepoMinVelocity: number;  // stars/day for repos <30 days old (default: 5)
  oldRepoMinVelocity: number;    // stars/day for repos >=30 days old (default: 10)
  newRepoMinStars: number;       // minimum stars for first-seen repos (default: 20)
  hotMultiplier: number;         // velocity multiplier for "hot" tier (default: 3x threshold)
  viralMultiplier: number;       // velocity multiplier for "viral" tier (default: 10x threshold)
}

function classifySeverity(
  starsPerDay: number,
  repoAgeDays: number,
  config: ThresholdConfig
): SeverityTier | null {
  const threshold = repoAgeDays < 30
    ? config.youngRepoMinVelocity
    : config.oldRepoMinVelocity;

  if (starsPerDay < threshold) return null; // Below threshold -- no alert

  if (starsPerDay >= threshold * config.viralMultiplier) return "viral";
  if (starsPerDay >= threshold * config.hotMultiplier) return "hot";
  return "notable";
}
```

### Pattern 5: Telegram HTML Alert Formatting
**What:** Build HTML-formatted alert messages using only Telegram-supported tags. Escape user-provided text to prevent HTML injection.
**When to use:** Before sending every alert message.
**Source:** Verified against Telegram Bot API docs and grammY docs (Context7).

```typescript
// src/telegram/formatter.ts

// Telegram HTML supports: <b>, <i>, <u>, <s>, <a href="">, <code>, <pre>, <blockquote>
// Must escape: & -> &amp;  < -> &lt;  > -> &gt;  " -> &quot;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface AlertData {
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  starsPerDay: number;
  language: string | null;
  repoAgeDays: number;
  tier: "notable" | "hot" | "viral";
}

function formatAlert(data: AlertData): string {
  const tierEmoji = { notable: "\u2b50", hot: "\ud83d\udd25", viral: "\ud83d\ude80" };
  const url = `https://github.com/${data.owner}/${data.name}`;
  const age = data.repoAgeDays < 1 ? "< 1 day"
    : data.repoAgeDays < 30 ? `${Math.floor(data.repoAgeDays)} days`
    : `${Math.floor(data.repoAgeDays / 30)} months`;

  const lines = [
    `${tierEmoji[data.tier]} <b>[${data.tier.toUpperCase()}]</b> <a href="${url}">${escapeHtml(data.owner)}/${escapeHtml(data.name)}</a>`,
    `Stars: <b>${data.stars}</b> (+${data.starsPerDay.toFixed(1)}/day)`,
    data.description ? escapeHtml(data.description) : "<i>No description</i>",
    `Language: ${data.language ? escapeHtml(data.language) : "N/A"} | Age: ${age}`,
  ];

  return lines.join("\n");
}
```

### Pattern 6: Scheduler with Overlap Protection
**What:** Use node-cron v4's `schedule()` with `noOverlap: true`. The callback receives a `TaskContext` object. Listen to the `execution:overlap` event for observability.
**When to use:** Application startup, after all services are initialized.
**Source:** Verified against node-cron v4 docs (Context7) and TypeScript type definitions.

```typescript
// src/scheduler.ts
import cron from "node-cron";
import type { TaskContext } from "node-cron";
import { createLogger } from "./logger.js";

const log = createLogger("scheduler");

export function startScheduler(
  cronExpression: string,
  cycleFn: () => Promise<void>
): void {
  const task = cron.schedule(cronExpression, async (ctx: TaskContext) => {
    log.info({ triggeredAt: ctx.triggeredAt.toISOString() }, "Monitoring cycle starting");
    try {
      await cycleFn();
      log.info("Monitoring cycle completed");
    } catch (err) {
      log.error({ err }, "Monitoring cycle failed");
    }
  }, {
    noOverlap: true,
    name: "gitscope-monitor",
  });

  task.on("execution:overlap", () => {
    log.warn("Monitoring cycle skipped -- previous cycle still running");
  });

  log.info({ cronExpression }, "Scheduler started");
}
// Usage: startScheduler("*/30 * * * *", () => runMonitoringCycle());
```

### Pattern 7: Monitoring Cycle Orchestration
**What:** A single function that orchestrates one complete monitoring cycle: search -> snapshot -> detect velocity -> classify -> format -> send alerts -> save state.
**When to use:** Called by the scheduler every 30 minutes.
**Source:** Composition of all patterns above.

```typescript
// src/monitor/cycle.ts (conceptual flow)
async function runMonitoringCycle(
  github: GitHubClient,
  telegram: TelegramSender,
  store: StateStore,
  config: MonitorConfig
): Promise<void> {
  // 1. Search GitHub for matching repos
  const searchResults = await searchRepos(github, config.keywords);

  // 2. For each result, compare with stored snapshot
  for (const repo of searchResults) {
    const key = `${repo.owner}/${repo.name}`;
    const existing = store.getState().repos[key];
    const lastSnapshot = existing?.snapshots.at(-1) ?? null;

    // 3. Calculate velocity
    const velocity = calculateVelocity(repo.stars, repo.createdAt, lastSnapshot);

    // 4. Classify severity
    const tier = classifySeverity(velocity.starsPerDay, velocity.repoAgeDays, config.thresholds);

    // 5. Check for new repo with high initial stars
    const isNewHighStar = velocity.isNew && repo.stars >= config.thresholds.newRepoMinStars;

    // 6. Store updated snapshot
    store.updateState(state => {
      if (!state.repos[key]) {
        state.repos[key] = { owner: repo.owner, name: repo.name, /* ... */ snapshots: [] };
      }
      state.repos[key].snapshots.push({ timestamp: new Date().toISOString(), stars: repo.stars, forks: repo.forks });
    });

    // 7. Send alert if threshold met or new high-star repo
    if (tier || isNewHighStar) {
      const alertTier = tier ?? "notable"; // New high-star repos default to notable
      const message = formatAlert({ /* ... */ tier: alertTier });
      await telegram.send(message);
    }
  }

  // 8. Update cycle metadata and save state
  store.updateState(state => { state.meta.lastCycleAt = new Date().toISOString(); });
  await store.save();
}
```

### Anti-Patterns to Avoid
- **Polling Telegram for updates (`bot.start()`):** The bot only sends outbound messages. Starting the polling loop wastes resources and can cause issues with multiple instances. Use `bot.api.sendMessage()` directly.
- **One search query per keyword:** Six keywords = 6 API calls = 20% of the 30/minute search rate limit per cycle. Combine with `OR` to use 1-2 calls instead.
- **Manual `isRunning` boolean for overlap protection:** node-cron v4 has `noOverlap: true` built in with proper edge case handling (async tasks, crash recovery). Do not reimplement.
- **Storing raw GitHub API responses in state:** Store only the fields needed (owner, name, stars, forks, timestamp). GitHub search returns 50+ fields per repo -- storing all of them bloats state.json unnecessarily.
- **Calculating velocity from repo creation date:** `starsPerDay = totalStars / repoAge` gives lifetime average, not recent trend. Calculate from the delta between consecutive snapshots.
- **Sending alerts without HTML escaping:** Repo descriptions may contain `<`, `>`, `&` characters. Unescaped HTML causes Telegram API errors or broken formatting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub rate limit handling | Manual header parsing + sleep/queue logic | `@octokit/plugin-throttling` v11 | Handles primary limits (X-RateLimit headers), secondary limits (Retry-After header), automatic queueing via bottleneck, configurable retry logic. Manual implementation misses edge cases: clock skew between client/server, secondary rate limits from abuse detection, concurrent request queuing. |
| Cron scheduling with overlap protection | `setInterval` + boolean mutex | `node-cron` v4 with `noOverlap: true` | node-cron handles cron expression parsing, timezone support, async task tracking, and fires `execution:overlap` events. `setInterval` drifts over time, has no overlap protection, and cannot parse cron expressions. |
| HTML entity escaping for Telegram | Manual regex replacements for each character | A reusable `escapeHtml()` utility function | Only 4 characters need escaping (`& < > "`), so a utility function is simple. But do NOT skip this step -- a single `<` in a repo description breaks the entire message. The function is ~6 lines; the important thing is to always call it on user-provided strings. |
| Search query construction | Hardcoded query strings | A `buildSearchQuery(keywords)` function | Keywords are configurable (config.ts). Hardcoding means editing source code to change keywords. A builder function also handles quoting multi-word terms and respecting the 5-operator limit. |

**Key insight:** The complexity in Phase 2 is not in any single component but in the orchestration: search -> snapshot -> velocity -> classify -> format -> send -> save. Each step is straightforward, but the cycle must handle errors at each step without losing state. The `@octokit/plugin-throttling` and `node-cron` `noOverlap` eliminate the two hardest concurrency problems (rate limiting and overlap), letting the implementation focus on the business logic.

## Common Pitfalls

### Pitfall 1: GitHub Search Rate Limit is Per-Minute, Not Per-Hour
**What goes wrong:** Assuming the search API has the same 5,000/hour limit as core REST. The search API is limited to 30 requests/minute for authenticated users. A burst of 30+ search calls in quick succession triggers rate limiting.
**Why it happens:** The core API limit (5,000/hour) is well-known. The separate, stricter search limit (30/minute) is less obvious. They are tracked independently -- the `GET /rate_limit` endpoint returns separate `core` and `search` objects.
**How to avoid:** Use `@octokit/plugin-throttling` which automatically detects the search rate limit from response headers. Combine keywords with `OR` to minimize search API calls (1-2 per cycle instead of 6). At 2 calls per 30-minute cycle, usage is 2/30 = 6.7% of the search rate limit.
**Warning signs:** HTTP 403 or 429 responses from search endpoints, `X-RateLimit-Remaining: 0` in search response headers.

### Pitfall 2: Velocity Calculation on First Sight
**What goes wrong:** On the very first cycle, every repo is "new" -- there is no previous snapshot to calculate velocity from. If the code tries to calculate velocity for new repos, it either errors (division by zero) or produces meaningless results.
**Why it happens:** Velocity = (current - previous) / time. With no previous snapshot, there is no delta.
**How to avoid:** Treat first-sighting as a special case (MON-03): if the repo has >=20 stars on first sight, emit a "new repo" alert. Store the snapshot. Velocity detection begins on the *second* cycle when there is a previous snapshot to compare against.
**Warning signs:** All repos triggering alerts on the first cycle, zero-velocity alerts, division-by-zero errors.

### Pitfall 3: Telegram HTML Parse Errors Are Not Retried by Default
**What goes wrong:** If the HTML message contains unescaped special characters (`<`, `>`, `&`), Telegram returns a 400 Bad Request error. grammY throws a `GrammyError`. The alert is lost.
**Why it happens:** Repo descriptions, names, and other user-generated content from GitHub may contain HTML-special characters. Without escaping, these break the HTML parser.
**How to avoid:** Always call `escapeHtml()` on every user-provided string before embedding it in the HTML template. Catch `GrammyError` on send and log the failing message for debugging. Phase 3 will add retry with plain-text fallback (NOTF-05), but Phase 2 must at least not crash.
**Warning signs:** `GrammyError: Bad Request: can't parse entities` errors in logs.

### Pitfall 4: node-cron v4 API Changes from v3
**What goes wrong:** Using v3 patterns (`scheduled: false`, `runOnInit: true`) with v4. These options no longer exist. Tasks created with `cron.schedule()` start immediately in v4.
**Why it happens:** node-cron v4 simplified the API. `scheduled` and `runOnInit` were removed. Use `cron.createTask()` for tasks that should not start immediately.
**How to avoid:** Use `cron.schedule()` for tasks that should start immediately (our use case). Use `cron.createTask()` + `task.start()` for delayed start. Check the v4 migration guide. The `TaskOptions` type in v4 has: `timezone`, `name`, `noOverlap`, `maxExecutions`, `maxRandomDelay`.
**Warning signs:** TypeScript errors about unknown options, tasks not starting, or starting twice.

### Pitfall 5: Search Results Limited to 1,000 Per Query
**What goes wrong:** GitHub Search API returns a maximum of 1,000 results per query, even if `total_count` is higher. For niche keywords this is unlikely to be an issue, but the code should handle `incomplete_results: true`.
**Why it happens:** GitHub imposes this hard limit for performance reasons. The `incomplete_results` boolean in the response indicates if the search timed out.
**How to avoid:** Check `data.incomplete_results` and log a warning if true. For the OpenClaw/Claude Code ecosystem, result counts are likely in the tens to low hundreds -- well within the 1,000 limit. If results grow, consider more specific queries or additional qualifiers (e.g., `stars:>0`).
**Warning signs:** `incomplete_results: true` in search responses, missing repos that should match.

### Pitfall 6: Snapshot Array Growth Without Pruning
**What goes wrong:** Every 30-minute cycle appends a snapshot to each repo's `snapshots` array. Over time, `state.json` grows unbounded: 48 snapshots/day * 100 repos * 30 days = 144,000 entries.
**Why it happens:** No pruning logic removes old snapshots.
**How to avoid:** Keep only the last N snapshots per repo (e.g., last 48 = 24 hours). Velocity calculation only needs the most recent snapshot. Prune during the state update step of each cycle. This is a Phase 2 concern because state growth directly affects cycle performance.
**Warning signs:** state.json file growing by megabytes per week, slow JSON parse times.

### Pitfall 7: Not Using `bot.api` Correctly Without Polling
**What goes wrong:** Calling `bot.start()` to enable `bot.api`, then the bot enters a long-polling loop consuming resources and potentially conflicting with other instances.
**Why it happens:** Confusion between polling mode (receiving updates) and API mode (sending messages only). `bot.api` is available immediately after `new Bot(token)` -- no need to call `bot.start()`.
**How to avoid:** Create `new Bot(token)` for token validation and `bot.api` access. Never call `bot.start()`. Use `bot.api.sendMessage(chatId, text, { parse_mode: "HTML" })` directly.
**Warning signs:** Logs showing "Listening for updates", unexpected Telegram webhook or polling activity.

## Code Examples

Verified patterns from official sources:

### GitHub Search API Call via Octokit
```typescript
// Source: Verified against @octokit/rest.js Context7 docs and GitHub REST API docs
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: token });

// Search repos matching ecosystem keywords
const { data } = await octokit.rest.search.repos({
  q: 'openclaw OR claude-code OR clawdbot OR moltbot OR clawhub OR "openclaw skills" in:name,description,topics,readme',
  sort: "updated",
  order: "desc",
  per_page: 100,
});

// data.total_count: number -- total matches
// data.incomplete_results: boolean -- true if search timed out
// data.items: Array<{ full_name, owner.login, name, description, stargazers_count, language, created_at, ... }>

for (const repo of data.items) {
  console.log(repo.full_name, repo.stargazers_count, repo.language, repo.created_at);
}
```

### Paginating Search Results
```typescript
// Source: Verified against @octokit/rest.js Context7 pagination docs
// Use paginate.iterator for async iteration when results may span multiple pages

for await (const response of octokit.paginate.iterator(octokit.rest.search.repos, {
  q: 'openclaw OR claude-code in:name,description,topics,readme',
  per_page: 100,
})) {
  for (const repo of response.data) {
    // Process each repo
  }
}
```

### Sending HTML Telegram Alert via grammY
```typescript
// Source: Verified against grammY Context7 docs (guide/basics.md, guide/api.md)
import { Bot, GrammyError, HttpError } from "grammy";

const bot = new Bot(token);
// bot.api is available immediately -- no need for bot.start()

try {
  await bot.api.sendMessage(
    chatId,
    '<b>[HOT]</b> <a href="https://github.com/owner/repo">owner/repo</a>\nStars: <b>150</b> (+12.5/day)\nA cool project\nLanguage: TypeScript | Age: 5 days',
    { parse_mode: "HTML" }
  );
} catch (err) {
  if (err instanceof GrammyError) {
    log.error({ description: err.description }, "Telegram API error");
  } else if (err instanceof HttpError) {
    log.error({ err }, "Could not contact Telegram");
  } else {
    throw err;
  }
}
```

### node-cron v4 Schedule with Overlap Protection
```typescript
// Source: Verified against node-cron v4 docs (Context7) and TypeScript type definitions
import cron from "node-cron";

// Every 30 minutes with overlap protection
const task = cron.schedule("*/30 * * * *", async (ctx) => {
  console.log(`Cycle triggered at ${ctx.triggeredAt.toISOString()}`);
  await runMonitoringCycle();
}, {
  noOverlap: true,
  name: "gitscope-monitor",
});

// Listen for overlap events
task.on("execution:overlap", () => {
  console.warn("Previous cycle still running, skipping this execution");
});

// Task starts immediately on creation in v4 (no need for task.start())
```

### GitHub Rate Limit Check
```typescript
// Source: Verified against GitHub REST API rate limit docs
// The /rate_limit endpoint returns separate counters for core and search

const { data: rateLimits } = await octokit.rest.rateLimit.get();

console.log("Core:", rateLimits.resources.core);
// { limit: 5000, used: 42, remaining: 4958, reset: 1707847200 }

console.log("Search:", rateLimits.resources.search);
// { limit: 30, used: 2, remaining: 28, reset: 1707847260 }
```

### Telegram Supported HTML Tags Reference
```html
<!-- Source: Verified against Telegram Bot API docs (core.telegram.org/bots/api) -->
<b>bold</b>
<strong>bold</strong>
<i>italic</i>
<em>italic</em>
<u>underline</u>
<ins>underline</ins>
<s>strikethrough</s>
<strike>strikethrough</strike>
<del>strikethrough</del>
<span class="tg-spoiler">spoiler</span>
<a href="https://example.com">link</a>
<code>inline code</code>
<pre>pre-formatted block</pre>
<pre><code class="language-python">code block with language</code></pre>
<blockquote>blockquote</blockquote>
<blockquote expandable>expandable blockquote</blockquote>

<!-- Characters that MUST be escaped in HTML mode: -->
<!-- & -> &amp;   < -> &lt;   > -> &gt;   " -> &quot; -->
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-cron v3 `scheduled: false` option | node-cron v4 `cron.createTask()` for stopped tasks | node-cron 4.0 (2024) | `scheduled` and `runOnInit` removed. `cron.schedule()` starts immediately. `noOverlap` replaces manual mutex patterns. |
| `@octokit/plugin-throttling` v9 with `@octokit/core` v6 | `@octokit/plugin-throttling` v11 with `@octokit/core` v7 | Late 2025 | Peer dep bumped to `@octokit/core ^7.0.0`. Callback signatures unchanged. Compatible with `@octokit/rest` v22. |
| Manual `Retry-After` header parsing | `@octokit/plugin-throttling` automatic handling | Always available | Plugin reads `Retry-After` header on 429 responses and delays retry automatically. Manual parsing is error-prone (header may be seconds or HTTP date). |
| grammY `bot.start()` for all use cases | grammY `bot.api` for outbound-only bots | Always available | `bot.api` is available after `new Bot(token)` without starting polling. Polling is only needed when receiving user messages/commands. |

**Deprecated/outdated:**
- node-cron v3 `scheduled` option: Removed in v4. Use `createTask()` for initially-stopped tasks.
- node-cron v3 `runOnInit` option: Removed in v4. Use `task.execute()` for immediate first run.
- `@octokit/plugin-throttling` v9: Incompatible with `@octokit/rest` v22. Use v11.

## Open Questions

1. **Velocity thresholds are hardcoded in requirements -- should they be configurable?**
   - What we know: MON-02 specifies >=5 stars/day for young repos, >=10 stars/day for older repos. MON-03 specifies >=20 stars for new repos.
   - What's unclear: Whether these should be environment variables or hardcoded constants. Making them env vars adds config complexity; hardcoding makes tuning require code changes.
   - Recommendation: Define as constants in a config object within the source code (not env vars). These are business logic thresholds that change rarely and benefit from code review when changed. If needed later, they can be promoted to env vars.

2. **Severity tier boundaries for "hot" and "viral"**
   - What we know: MON-04 requires three tiers: notable, hot, viral based on "velocity magnitude." The threshold for "notable" is defined by MON-02 (5 or 10 stars/day depending on age).
   - What's unclear: What velocity constitutes "hot" vs "viral." The requirements do not specify exact boundaries.
   - Recommendation: Use multipliers of the base threshold: notable = 1x, hot = 3x (15-30 stars/day), viral = 10x (50-100 stars/day). These are reasonable for the niche ecosystem and can be tuned based on real data.

3. **Should the `language` field be added to the state schema?**
   - What we know: NOTF-01 requires showing the repo's language in alerts. The current state schema (`repoSnapshotSchema`) does not include a `language` field.
   - What's unclear: Whether to store language in state or re-fetch it from GitHub each cycle.
   - Recommendation: Add `language: z.string().nullable()` to `repoSnapshotSchema`. Language is returned by the search API and rarely changes. Storing it avoids an extra API call and makes the formatter self-contained.

4. **Snapshot pruning strategy**
   - What we know: Each cycle adds a snapshot. Without pruning, state grows unbounded.
   - What's unclear: How many snapshots to retain. Velocity only needs the latest, but historical data could be useful for future v2 features (sliding window detection).
   - Recommendation: Keep the last 48 snapshots per repo (24 hours at 30-minute intervals). This supports future 24-hour sliding window analysis while keeping state manageable. Prune in the cycle's state update step.

## Sources

### Primary (HIGH confidence)
- [Context7: /octokit/rest.js] - Search repos method, pagination, throttling plugin integration, rate limit handling
- [Context7: /grammyjs/website] - `bot.api.sendMessage` with HTML parse mode, `GrammyError`/`HttpError` handling, `Api` class usage
- [Context7: /websites/nodecron] - `cron.schedule()`, `noOverlap` option, `createTask()`, v3-to-v4 migration, `TaskOptions` type, `TaskEvent` types
- [Context7: /websites/github_en_rest] - `GET /search/repositories` endpoint, query syntax, rate limit categories (core vs search), response schema
- [GitHub REST API rate limit docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) - Search: 30 req/min, Core: 5,000 req/hour, separate tracking
- [GitHub REST API rate limit endpoint](https://docs.github.com/en/rest/rate-limit/rate-limit) - `GET /rate_limit` response structure: `resources.core`, `resources.search`
- [GitHub search qualifiers docs](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories) - `in:name,description,topics,readme`, `OR` operator, query limits
- npm registry: `@octokit/plugin-throttling@11.0.3` peerDependencies `@octokit/core: ^7.0.0` (verified via `npm view`)
- npm registry: `@octokit/rest@22.0.1` dependencies `@octokit/core: ^7.0.6` (verified via `npm ls`)
- node-cron v4 TypeScript definitions (verified from `node_modules/node-cron/dist/esm/tasks/scheduled-task.d.ts`): `TaskOptions`, `ScheduledTask`, `TaskEvent`, `TaskFn`

### Secondary (MEDIUM confidence)
- [GitHub best practices for REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) - Retry-After header handling, rate limit response codes
- [Telegram Bot API](https://core.telegram.org/bots/api) - HTML tag support, entity types, parse_mode options
- [GitHub search tips](https://www.freecodecamp.org/news/github-search-tips/) - OR operator syntax, query construction patterns

### Tertiary (LOW confidence)
- None -- all findings verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All library versions verified via npm registry and installed `node_modules`. `@octokit/plugin-throttling` v11 peer dep compatibility with `@octokit/rest` v22 confirmed via `@octokit/core` version match (^7.0.0 satisfied by 7.0.6).
- Architecture: HIGH - All patterns verified against official docs via Context7. Search query syntax, rate limit separation, and node-cron v4 API confirmed against multiple sources.
- Pitfalls: HIGH - Rate limit separation (30/min search vs 5,000/hr core) verified against GitHub docs. node-cron v4 breaking changes verified against migration guide. Telegram HTML escaping verified against Bot API docs.

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable domain, 30-day validity)
