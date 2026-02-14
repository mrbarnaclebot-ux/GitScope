# Phase 3: Notification Reliability & Deployment - Research

**Researched:** 2026-02-14
**Domain:** Telegram notification reliability (deduplication, batching, retry) + Render deployment
**Confidence:** HIGH

## Summary

Phase 3 completes the project by making notifications production-grade and deploying the bot as an always-on service. The work divides into four distinct concerns: (1) notification deduplication using the existing `notifications` record in state, (2) digest batching when alert volume exceeds a threshold, (3) retry with exponential backoff and plain-text fallback for failed Telegram deliveries, and (4) Render Background Worker deployment with `render.yaml` infrastructure-as-code.

The existing codebase already has the foundational pieces in place. The `notifications` field in `AppState` (record of repo key to `{ lastAlertAt: string }`) was designed for deduplication but is not yet written to or read from in `cycle.ts`. The `sender.ts` returns boolean and never throws, which provides a clean seam for adding retry logic. The `formatter.ts` produces HTML that can fail Telegram's entity parser, making the plain-text fallback a real need. No new npm dependencies are required beyond `@grammyjs/auto-retry`, which handles Telegram 429 rate-limit retries at the transport layer. The application-level retry (for network failures and formatting errors) is simple enough to hand-roll in the sender.

**Primary recommendation:** Use `@grammyjs/auto-retry` for transport-level 429/5xx retries, hand-roll a send-with-fallback wrapper in `sender.ts` for formatting error detection and plain-text fallback, implement deduplication as a check-before-send + write-after-success pattern in `cycle.ts`, collect alerts into an array and branch to digest formatting when count > 5, and deploy via `render.yaml` with `type: worker`.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@grammyjs/auto-retry` | latest (^2.x) | Transport-level retry for 429 and 5xx errors | Official grammY plugin, handles `retry_after` headers, exponential backoff from 3s capped at 1h, used in grammY docs as the standard approach |

### Supporting

No additional libraries needed. All other Phase 3 features are implemented with existing dependencies (grammy, pino, zod, node-cron) and Node.js built-ins.

| Concern | Implementation | Why No Library |
|---------|---------------|----------------|
| Deduplication | Date comparison in cycle.ts | Simple timestamp check against existing state field |
| Digest batching | Array collection + formatter function | Straightforward string concatenation |
| App-level retry | While loop with setTimeout | 2-3 retries with simple backoff; `@grammyjs/auto-retry` handles the complex transport case |
| Render deployment | `render.yaml` + env vars | Render's native IaC, no SDK needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@grammyjs/auto-retry` | Hand-rolled retry in sender | Plugin handles 429 `retry_after` parsing and 5xx exponential backoff correctly; hand-rolling risks getting backoff timing wrong for rate limits |
| JSON file for dedup state | SQLite / Redis | Overkill for ~50-100 repos; JSON file is already the persistence layer and state schema already has the field |
| `render.yaml` IaC | Manual dashboard config | IaC is reproducible, version-controlled, and documented in the repo |

**Installation:**
```bash
npm install @grammyjs/auto-retry
```

## Architecture Patterns

### Recommended Changes to Project Structure

```
src/
├── config.ts              # ADD: COOLDOWN_DAYS env var
├── telegram/
│   ├── sender.ts          # MODIFY: add auto-retry transformer, retry-with-fallback wrapper
│   └── formatter.ts       # ADD: formatDigest() for batched alerts
├── monitor/
│   └── cycle.ts           # MODIFY: dedup check before send, batch collection, write notification record after success
├── state/
│   └── schema.ts          # NO CHANGE (notifications field already exists)
├── index.ts               # ADD: SIGTERM/SIGINT graceful shutdown handler
render.yaml                # NEW: Render Background Worker definition
```

### Pattern 1: Deduplication via State Check Before Send

**What:** Before sending an alert for a repo, check `state.notifications[key]` to see if `lastAlertAt` is within the cooldown period. Only send if outside cooldown. After successful send, write `lastAlertAt` to state.

**When to use:** Every alert decision in `cycle.ts`.

**Example:**
```typescript
// In cycle.ts, before sending an alert:
function isWithinCooldown(
  state: AppState,
  repoKey: string,
  cooldownDays: number,
): boolean {
  const record = state.notifications[repoKey];
  if (!record) return false;

  const lastAlert = new Date(record.lastAlertAt);
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastAlert.getTime() < cooldownMs;
}

// After successful send:
store.updateState((s) => {
  s.notifications[key] = { lastAlertAt: new Date().toISOString() };
});
```

**Key detail:** Write the notification record AFTER `telegram.send()` returns true, not before. This ensures a crash between check and send does not suppress a notification that was never delivered. The state is saved atomically at the end of the cycle via the existing `store.save()` call.

### Pattern 2: Batch Collection Then Conditional Digest

**What:** Collect all alerts for a cycle into an array. After processing all repos, check array length. If > 5, format as a single digest message. If <= 5, send individually.

**When to use:** In `cycle.ts`, restructure from send-per-repo to collect-then-send.

**Example:**
```typescript
interface PendingAlert {
  repoKey: string;
  message: string;       // Pre-formatted HTML for individual send
  data: AlertData;       // Raw data for digest formatting
}

// Collect during repo loop
const pendingAlerts: PendingAlert[] = [];

// After repo loop:
if (pendingAlerts.length > 5) {
  const digest = formatDigest(pendingAlerts.map((a) => a.data));
  await telegram.send(digest);
} else {
  for (const alert of pendingAlerts) {
    await telegram.send(alert.message);
  }
}
```

### Pattern 3: Send With Retry and Plain-Text Fallback

**What:** Wrap the grammY `sendMessage` call in a retry loop. On `GrammyError` with description containing "can't parse entities", retry without `parse_mode` (plain text). On `HttpError`, retry with exponential backoff.

**When to use:** In `sender.ts`, replace the current simple send with a resilient send.

**Example:**
```typescript
// Source: Telegram Bot API error patterns + grammY error types
async send(message: string): Promise<boolean> {
  // Attempt 1: HTML parse mode
  try {
    await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
    return true;
  } catch (err) {
    if (err instanceof GrammyError) {
      // Check if it's a formatting/parse error (400-level)
      if (err.error_code === 400 && err.description.includes("can't parse entities")) {
        log.warn({ chatId }, "HTML parse failed, falling back to plain text");
        // Strip HTML tags for plain text fallback
        const plainText = message.replace(/<[^>]*>/g, "");
        try {
          await bot.api.sendMessage(chatId, plainText);
          return true;
        } catch (fallbackErr) {
          log.error({ chatId, err: fallbackErr }, "Plain text fallback also failed");
          return false;
        }
      }
      // Other GrammyErrors (non-parse) -- auto-retry plugin handles 429/5xx
      log.error({ chatId, description: err.description }, "Telegram API error");
      return false;
    }
    if (err instanceof HttpError) {
      // auto-retry plugin handles these; if we get here, retries exhausted
      log.error({ chatId, err }, "Could not contact Telegram after retries");
      return false;
    }
    log.error({ chatId, err }, "Unknown error sending alert");
    return false;
  }
}
```

### Pattern 4: Graceful Shutdown for Background Worker

**What:** Listen for SIGTERM and SIGINT in `index.ts`. On signal, stop the cron scheduler, wait for any in-flight cycle to complete, save state, then exit.

**When to use:** Required for Render Background Worker, which sends SIGTERM before stopping.

**Example:**
```typescript
// In index.ts:
function setupGracefulShutdown(store: StateStore): void {
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutdown signal received");
    // node-cron tasks auto-stop when process exits, but explicit stop is cleaner
    await store.save();
    log.info("State saved, exiting");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

### Anti-Patterns to Avoid

- **Writing notification record before confirming delivery:** If the send fails or the process crashes, the repo will be suppressed for the entire cooldown period despite never being alerted. Always write AFTER successful send.
- **Retrying 400 errors with the same payload:** A 400 (Bad Request) from Telegram means the message is malformed. Retrying the same HTML will fail every time. The correct response is to fall back to plain text.
- **Sending digest AND individual alerts:** When the batch threshold is crossed, send ONLY the digest. Do not also send individual messages.
- **Blocking the process on retry delays:** Use `setTimeout` wrapped in a Promise (or the auto-retry plugin's built-in delay) rather than busy-waiting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 429 rate-limit retry with `retry_after` | Custom retry loop parsing Telegram headers | `@grammyjs/auto-retry` | Plugin correctly parses `retry_after` from Telegram response, handles both 429 and 5xx, uses exponential backoff starting at 3s capped at 1h. Hand-rolling risks incorrect timing. |
| Render deployment config | Shell scripts or manual dashboard setup | `render.yaml` blueprint | IaC is reproducible, version-controlled, documents the deployment in the repo itself |

**Key insight:** The only thing worth using a library for is the Telegram transport-level retry (429/5xx). Everything else in this phase (deduplication, batching, formatting fallback, graceful shutdown) is simple enough that hand-rolling is correct and avoids unnecessary dependencies.

## Common Pitfalls

### Pitfall 1: Deduplication Record Written Before Delivery Confirmed

**What goes wrong:** If `notifications[key].lastAlertAt` is written before `telegram.send()` succeeds, a failed send permanently suppresses the alert for the cooldown period.
**Why it happens:** Developers naturally want to "mark it" before doing the work.
**How to avoid:** Only write the notification record when `send()` returns `true`. The state save happens atomically at end of cycle.
**Warning signs:** Repos appearing in state.notifications but no corresponding Telegram message received.

### Pitfall 2: Digest Message Exceeds Telegram's 4096-Character Limit

**What goes wrong:** When batching many repos into a single digest, the message may exceed Telegram's maximum message length of 4096 characters, causing a 400 error.
**Why it happens:** Each repo entry is ~150-200 chars. 20+ repos in a digest could exceed the limit.
**How to avoid:** Truncate the digest at a safe limit (e.g., first 20 repos, ~3500 chars). Add a "and N more..." footer if truncated.
**Warning signs:** Digest sends failing with 400 errors during high-activity periods.

### Pitfall 3: Auto-Retry Plugin Retries 400 Errors

**What goes wrong:** The auto-retry plugin does NOT retry 400 errors (it only retries 429 and 5xx). But if the fallback logic is placed after the auto-retry layer, you might think retries are happening when they are not.
**Why it happens:** Misunderstanding the auto-retry plugin's scope.
**How to avoid:** Understand the layering: `auto-retry` handles transport (429/5xx) at the API config level. Application-level fallback (400 parse errors) happens in the `send()` wrapper. These are two separate retry mechanisms at two separate layers.
**Warning signs:** HTML parse errors logged repeatedly without plain-text fallback kicking in.

### Pitfall 4: Race Condition Between Cooldown Check and State Save

**What goes wrong:** The cooldown check reads from in-memory state, but the state is only saved to disk at end of cycle. If the process crashes mid-cycle, some notifications might be re-sent on restart.
**Why it happens:** The existing pattern saves state once at cycle end, not after each send.
**How to avoid:** This is acceptable behavior -- re-sending a notification once after a crash is better than missing it entirely. The in-memory state is authoritative during the cycle; disk persistence is for restart recovery. Document this as a known trade-off.
**Warning signs:** Duplicate notifications after bot crashes (rare, acceptable).

### Pitfall 5: Render Restarts on Crash Without Backoff

**What goes wrong:** If the bot crashes on startup (e.g., missing env var), Render restarts it immediately and repeatedly, consuming resources.
**Why it happens:** Render's default behavior is to restart crashed containers indefinitely.
**How to avoid:** The existing `config.ts` already calls `process.exit(1)` on invalid config, which is correct. Render will eventually stop restarting after repeated failures. Ensure startup errors are logged clearly so the issue is visible in Render's log viewer.
**Warning signs:** Rapid restart loops visible in Render dashboard logs.

### Pitfall 6: State File Path on Render

**What goes wrong:** The default `STATE_FILE_PATH` is `./state.json`, which works locally but on Render the working directory may differ, and the filesystem is ephemeral (wiped on each deploy).
**Why it happens:** Render's filesystem does not persist between deploys.
**How to avoid:** For v1, accept that state resets on deploy -- deduplication cooldowns reset, repo snapshots start fresh. This is acceptable for the project's scale. If persistence across deploys becomes critical, use Render Disks (persistent volume) at `$RENDER_DISK_PATH`. For now, the `STATE_FILE_PATH` env var allows overriding the path.
**Warning signs:** All repos re-alerted after every deploy.

## Code Examples

Verified patterns from official sources:

### Installing and Configuring auto-retry

```typescript
// Source: grammY docs (grammy.dev/plugins/auto-retry) + Context7
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";

const bot = new Bot(botToken);

bot.api.config.use(autoRetry({
  maxRetryAttempts: 3,       // Retry up to 3 times
  maxDelaySeconds: 60,       // Fail if retry_after > 60s
  rethrowHttpErrors: false,  // Retry network errors (default)
  rethrowInternalServerErrors: false,  // Retry 5xx errors (default)
}));

// Exponential backoff for 5xx/network errors:
// Starts at 3 seconds, doubles each retry, capped at 3600 seconds (1 hour)
```

### Render Background Worker Configuration (render.yaml)

```yaml
# Source: Render docs (render.com/docs/blueprint-spec)
services:
  - type: worker
    name: gitscope
    env: node
    plan: starter
    region: oregon
    buildCommand: npm install && npm run build
    startCommand: node dist/index.js
    autoDeploy: true
    envVars:
      - key: GITHUB_TOKEN
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_CHAT_ID
        sync: false
      - key: LOG_LEVEL
        value: info
      - key: STATE_FILE_PATH
        value: ./state.json
      - key: NODE_ENV
        value: production
```

### Detecting Telegram HTML Parse Errors in grammY

```typescript
// Source: grammY error types + Telegram Bot API error patterns
import { GrammyError } from "grammy";

function isParseError(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    err.error_code === 400 &&
    err.description.includes("can't parse entities")
  );
}

// GrammyError fields:
// - error_code: number (HTTP status from Telegram)
// - description: string (Telegram's error message)
// - method: string (the API method that failed, e.g., "sendMessage")
```

### Stripping HTML for Plain-Text Fallback

```typescript
// Simple HTML tag stripping for fallback messages
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")        // Remove HTML tags
    .replace(/&amp;/g, "&")          // Restore entities
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
```

### Adding COOLDOWN_DAYS to Config

```typescript
// In config.ts, add to envSchema:
COOLDOWN_DAYS: z
  .string()
  .default("7")
  .transform((s) => parseInt(s, 10))
  .pipe(z.number().min(1).max(90)),

BATCH_THRESHOLD: z
  .string()
  .default("5")
  .transform((s) => parseInt(s, 10))
  .pipe(z.number().min(1).max(100)),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual retry loops for Telegram | `@grammyjs/auto-retry` plugin as API transformer | grammY plugin ecosystem stable since 2023 | Handles 429/5xx at transport layer; app only handles business logic (400 fallback) |
| MarkdownV2 parse mode | HTML parse mode | Telegram Bot API ongoing | HTML is more predictable for entity parsing; fewer escape characters needed |
| Per-token rate limits | Per-chat rate limits | Telegram layer 167, Feb 2025 | Each chat has ~1 msg/sec budget independently; sending to one chat does not affect another |

**Deprecated/outdated:**
- Markdown (v1) parse mode: Use HTML or MarkdownV2 instead. The project already uses HTML, which is correct.
- `bot.start()` for long polling in workers: Not needed here since the bot only sends messages (no incoming updates to poll for).

## Open Questions

1. **State persistence across Render deploys**
   - What we know: Render's filesystem is ephemeral; state.json resets on each deploy. Render Disks can provide persistent storage.
   - What's unclear: Whether the user wants state to survive deploys or is okay with cooldown resets.
   - Recommendation: Accept ephemeral state for v1. The `STATE_FILE_PATH` env var already allows pointing to a Render Disk path later. Document this trade-off. The impact is limited: after a deploy, repos may be re-alerted once, which is better than missing alerts.

2. **Digest message format**
   - What we know: Must combine >5 alerts into a single message. Telegram has a 4096-char limit.
   - What's unclear: Exact visual format the user prefers for the digest.
   - Recommendation: Use a compact table-like format with one line per repo (emoji + tier + linked name + stars + velocity). Cap at ~20 repos with "and N more..." footer. This keeps it under the 4096-char limit.

3. **Should `node-cron` task be explicitly stopped on shutdown?**
   - What we know: `node-cron` tasks run via `setInterval` internally. When the process exits, they stop.
   - What's unclear: Whether an in-flight cycle should be awaited before exit.
   - Recommendation: On SIGTERM, save state immediately and exit. If a cycle is running, the `noOverlap` flag on node-cron means the next cycle won't start, and the current cycle will complete or be interrupted. Saving state on signal is the important part.

## Sources

### Primary (HIGH confidence)
- Context7 `/grammyjs/website` - auto-retry plugin configuration, error handling patterns, GrammyError/HttpError types
- grammY auto-retry source code (`github.com/grammyjs/auto-retry/blob/main/src/mod.ts`) - exponential backoff starting at 3s, doubling, capped at 3600s; options: `maxRetryAttempts`, `maxDelaySeconds`, `rethrowInternalServerErrors`, `rethrowHttpErrors`
- Render Blueprint YAML Reference (`render.com/docs/blueprint-spec`) - worker type schema, envVars with `sync: false`
- Render Environment Variables docs (`render.com/docs/configure-environment-variables`) - secrets management, Dashboard vs IaC
- Existing codebase (`src/state/schema.ts`, `src/telegram/sender.ts`, `src/monitor/cycle.ts`) - notifications field, sender interface, cycle structure

### Secondary (MEDIUM confidence)
- Telegram Bot API (`core.telegram.org/bots/api`) - 400 error for malformed HTML entities, 429 rate limits with `retry_after`
- Telegram Bots FAQ (`core.telegram.org/bots/faq`) - ~1 msg/sec per chat, ~30 users/sec for broadcast, 20 msg/min in groups
- Render Background Workers docs (`render.com/docs/background-workers`) - no incoming traffic, continuous process, auto-restart on crash

### Tertiary (LOW confidence)
- Render filesystem ephemerality - confirmed by multiple community sources but specific behavior (deploy-only vs restart) not verified against official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `@grammyjs/auto-retry` is the official grammY plugin, verified via Context7 and source code inspection
- Architecture: HIGH - deduplication, batching, and retry patterns are straightforward; existing codebase has clean seams for all changes
- Pitfalls: HIGH - verified against Telegram Bot API behavior and grammY error types; state persistence trade-off is well-understood
- Deployment: MEDIUM - Render `render.yaml` schema verified via official docs; filesystem ephemerality details from community sources

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (30 days - stable domain, no fast-moving APIs)
