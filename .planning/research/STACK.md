# Stack Research

**Domain:** GitHub monitoring bot with Telegram notifications
**Researched:** 2026-02-13
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS | Runtime | Render's current default (22.22.0). Node 22 is Maintenance LTS until April 2026. Use 22.x over 24.x because Render defaults to it and it avoids bleeding-edge risk on a background worker. Pin to `22.x` in `.node-version`. |
| grammY | ^1.40.0 | Telegram Bot Framework | Best TypeScript support of all Telegram frameworks. Actively maintained (published same-day as this research). Clean `bot.api.sendMessage(chatId, text)` API. Lightweight, no bloated deps. Telegraf 4.16.3 was last published 2 years ago -- grammY is the actively maintained choice. |
| @octokit/rest | ^22.0.1 | GitHub REST API client | Focused REST-only client -- lighter than the full `octokit` SDK. Handles auth, pagination, rate-limit headers. TypeScript types included. We only need REST (search + stargazers), not GraphQL or GitHub Apps. |
| node-cron | ^4.2.1 | Cron scheduling | Simple, dependency-free cron scheduler. Runs the 30-minute check interval. No need for heavier alternatives like `bull` or `agenda` -- there is no job queue, just a single recurring timer. |

### Storage

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js `fs/promises` | built-in | JSON file persistence | Project constraint: JSON file for state. No database needed. Use `fs.readFile` / `fs.writeFile` with `JSON.parse` / `JSON.stringify`. Atomic writes via write-to-temp-then-rename pattern to prevent corruption on crash. |

### Configuration & Environment

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js `--env-file` | built-in (22.x+) | Load `.env` files | Node 22 has built-in `--env-file=.env` flag. Zero dependencies. No `dotenv` package needed. Set in Render start command: `node --env-file=.env src/index.js`. |
| zod | ^4.3.6 | Config validation | Validate environment variables at startup (bot token, GitHub token, chat ID). Fail fast with clear errors instead of mysterious runtime crashes. TypeScript-first with excellent inference. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | ^10.3.1 | Structured JSON logging | All application logging. JSON output works with Render's log viewer. Fastest Node.js logger by benchmarks. Use `pino.child({ module: 'github' })` for module-scoped loggers. |
| pino-pretty | ^14.x | Dev-friendly log formatting | Dev only (`npm install -D`). Pipe output through it locally: `node src/index.js \| pino-pretty`. Never use in production. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript | ^5.7.x | Type safety, editor intelligence | Even for a small bot, TS catches config typos, API misuse, and null issues. Use strict mode. Compile to ESM. |
| tsx | ^4.x | Dev runner | Run TypeScript directly in development without a build step. `tsx watch src/index.js` for auto-reload. |
| @types/node | ^22.x | Node.js type definitions | Match the Node.js runtime version for accurate `fs`, `process` types. |
| ESLint | ^9.x | Linting | Flat config format (eslint.config.js). Use `@typescript-eslint/parser`. |

## Installation

```bash
# Core dependencies
npm install grammy @octokit/rest node-cron zod pino

# Dev dependencies
npm install -D typescript tsx @types/node pino-pretty eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **grammY** | Telegraf 4.x | Never for new projects. Telegraf 4.16.3 was last published 2 years ago. grammY was created by a former Telegraf maintainer specifically to fix its limitations. grammY has overtaken Telegraf in weekly downloads (~137K each, but grammY is growing while Telegraf is declining). |
| **grammY** | node-telegram-bot-api | Never. Depends on deprecated `request` package. No TypeScript support. Violates single-responsibility principle. |
| **@octokit/rest** | Full `octokit` SDK (v5) | Only if you need GraphQL + GitHub Apps + OAuth. The full SDK bundles REST, GraphQL, auth strategies, and webhooks. Overkill for this project -- we only call 2 REST endpoints. |
| **@octokit/rest** | Raw `fetch()` | Only for trivial one-off scripts. Octokit handles pagination, auth headers, rate-limit retries, and TypeScript types. Not worth reimplementing. |
| **node-cron** | `cron` (kelektiv) | If you need timezone-aware scheduling or `CronJob` class pattern. `node-cron` is simpler for single-schedule use cases. |
| **node-cron** | `setInterval` | Never for production. `setInterval` drifts over time, has no cron expression support, and does not handle overlapping executions. |
| **JSON file** | SQLite via `better-sqlite3` | If state grows beyond a few hundred repos or you need querying. For v1 tracking ~50-100 repos, JSON is simpler and has zero native dependencies (no build step). |
| **pino** | winston | If you need transport plugins (email, Slack, etc). Pino is 5x faster and JSON-native. Winston's flexibility is unnecessary here. |
| **zod** | Manual validation | Never. Manual `if (!process.env.BOT_TOKEN)` checks do not scale, provide no type inference, and produce inconsistent error messages. |
| **Node.js --env-file** | dotenv | If targeting Node < 20.6. Since we pin Node 22.x on Render, the built-in flag eliminates a dependency. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Telegraf** | Last published 2 years ago (4.16.3). Active development has stalled. The creator of grammY was a Telegraf contributor who built grammY to address its architectural limitations. | grammY |
| **node-telegram-bot-api** | Depends on deprecated `request` package. No TypeScript. Poor API design (event emitter pattern loses context). | grammY |
| **Express/Fastify** | This is a background worker, not a web server. There are no incoming HTTP requests. Adding a web framework creates unnecessary attack surface and resource usage. | Direct `node-cron` scheduling |
| **dotenv** | Unnecessary dependency when Node 22.x has `--env-file` built-in. One less package to audit and maintain. | `--env-file=.env` flag |
| **axios** | Unnecessary when `@octokit/rest` handles all GitHub API calls and `grammY` handles all Telegram API calls. No raw HTTP needed. | Built-in clients in grammY and Octokit |
| **MongoDB/PostgreSQL** | Massive overhead for tracking star counts on ~50-100 repos. JSON file reads/writes in < 1ms. Database adds connection management, migrations, hosting costs. | JSON file with `fs/promises` |
| **Bull/BullMQ/Agenda** | Job queue systems require Redis or MongoDB. This project has exactly one job on one schedule. `node-cron` is the right tool. | `node-cron` |
| **PM2** | Render manages process lifecycle. PM2 adds a process manager inside a managed platform -- redundant and can conflict with Render's health checks. | Render's built-in process management |

## Stack Patterns by Variant

**If you later need webhook support (e.g., GitHub push events):**
- Add Fastify as the HTTP framework
- grammY supports both polling and webhook modes natively
- Render can run a Web Service alongside the Background Worker

**If state outgrows JSON file (hundreds of repos, historical data):**
- Migrate to SQLite via `better-sqlite3`
- No external database server needed -- it is a single file
- Works on Render's persistent disk storage

**If you need to track more than star velocity (forks, issues, contributors):**
- Consider the full `octokit` SDK for GraphQL to batch multiple data points per request
- GraphQL avoids the N+1 problem of REST calls per metric per repo

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @octokit/rest@22 | TypeScript 5.x | Requires `"moduleResolution": "node16"` and `"module": "node16"` in tsconfig.json due to conditional exports. |
| grammY@1.40 | Node.js 18+ | Works with Node 22.x. ESM and CJS both supported. |
| node-cron@4.2 | Node.js 18+ | Pure JS, no native deps. |
| zod@4.3 | TypeScript 5.x | Major version 4 is current stable. Breaking changes from zod@3 -- use v4 for new projects. |
| pino@10.3 | Node.js 18+ | v10 is current major. Breaking changes from v9 (transport API changes). |

## Key API Details for Implementation

### GitHub Search API Rate Limits
- **Authenticated**: 30 search requests per minute (separate from the 5,000/hr core limit)
- **Unauthenticated**: 10 search requests per minute
- **Core API (stargazers endpoint)**: 5,000 requests per hour (authenticated)
- **Conditional requests**: `If-None-Match` with ETag returns 304 and does NOT count against rate limit

### GitHub Search Qualifiers for Repo Discovery
```
stars:>50 created:>2025-01-01 topic:claude-code    # Find Claude Code repos gaining traction
stars:>50 created:>2025-01-01 topic:openclaw        # Find OpenClaw ecosystem repos
stars:>20 pushed:>2026-01-01 "openclaw" in:readme   # Catch repos without topic tags
```

### GitHub Stargazers with Timestamps
```
GET /repos/{owner}/{repo}/stargazers
Accept: application/vnd.github.star+json
```
Returns `{ starred_at: "ISO8601", user: {...} }` -- critical for calculating star velocity (stars per time period).

### grammY Message Sending
```typescript
// Send alert to group chat
await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
```
Group chat IDs are negative numbers for supergroups.

### Recommended tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

## Confidence Assessment

| Decision | Confidence | Basis |
|----------|------------|-------|
| grammY over Telegraf | HIGH | NPM publish dates verified (grammY: same-day active, Telegraf: 2 years stale). grammY comparison page on official site confirms advantages. Download parity with growth trend favoring grammY. |
| @octokit/rest over full octokit | HIGH | Official Octokit docs confirm REST-only vs batteries-included distinction. Project only needs 2 REST endpoints. |
| node-cron for scheduling | HIGH | NPM verified at 4.2.1. Standard choice for single-schedule Node.js cron. No competing pattern for this use case. |
| Node.js --env-file over dotenv | HIGH | Official Node.js docs confirm `--env-file` stable since Node 20.6. Render supports Node 22.x by default. |
| zod for config validation | HIGH | Verified at v4.3.6 on NPM. Industry standard for TypeScript runtime validation. |
| pino for logging | HIGH | Verified at v10.3.1 on NPM. Fastest Node.js JSON logger by maintained benchmarks. |
| JSON file over database | MEDIUM | Correct for v1 scope (~50-100 repos). May need reassessment if scope grows. Documented migration path to SQLite. |
| Node 22.x over 24.x | MEDIUM | Render defaults to 22.22.0. Node 22 is Maintenance LTS until April 2026. Node 24 is current LTS but newer -- lower risk to stay on Render's default. |

## Sources

- [grammY official site](https://grammy.dev/) -- framework features, API reference, comparison page
- [grammY vs other frameworks comparison](https://grammy.dev/resources/comparison) -- official comparison with Telegraf and node-telegram-bot-api
- [grammY npm](https://www.npmjs.com/package/grammy) -- version 1.40.0, actively published
- [Telegraf npm](https://www.npmjs.com/package/telegraf) -- version 4.16.3, last published 2 years ago
- [@octokit/rest npm](https://www.npmjs.com/package/@octokit/rest) -- version 22.0.1
- [Octokit.js GitHub](https://github.com/octokit/octokit.js/) -- REST vs full SDK distinction
- [node-cron npm](https://www.npmjs.com/package/node-cron) -- version 4.2.1
- [GitHub REST API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) -- 5,000/hr core, 30/min search
- [GitHub Search API](https://docs.github.com/en/rest/search/search) -- search endpoints and rate limits
- [GitHub Starring API](https://docs.github.com/en/rest/activity/starring) -- stargazers with timestamps via `star+json` media type
- [GitHub Repository Search Qualifiers](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories) -- stars, created, topic qualifiers
- [Render Node Version Docs](https://render.com/docs/node-version) -- default 22.22.0, `.node-version` file support
- [Render Background Workers Docs](https://render.com/docs/background-workers) -- background worker configuration
- [Node.js Releases](https://nodejs.org/en/about/previous-releases) -- Node 22 Maintenance LTS, Node 24 Active LTS
- [Pino npm](https://www.npmjs.com/package/pino) -- version 10.3.1
- [Zod npm](https://www.npmjs.com/package/zod) -- version 4.3.6
- [Node.js --env-file support](https://nodejs.org/en/blog/) -- built-in since Node 20.6
- [npmtrends grammY vs Telegraf](https://npmtrends.com/grammy-vs-node-telegram-bot-api-vs-telegraf-vs-telegram-bot-api) -- download comparison

---
*Stack research for: GitScope -- GitHub monitoring bot with Telegram notifications*
*Researched: 2026-02-13*
