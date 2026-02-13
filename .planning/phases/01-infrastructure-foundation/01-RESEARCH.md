# Phase 1: Infrastructure Foundation - Research

**Researched:** 2026-02-13
**Domain:** TypeScript project setup, JSON state persistence, environment validation, structured logging
**Confidence:** HIGH

## Summary

Phase 1 builds the reliable foundation every subsequent feature depends on: a runnable TypeScript project with crash-safe JSON state persistence, validated configuration via zod, and structured JSON logging via pino. This phase has zero external API integration concerns (no GitHub polling, no Telegram alerts in production) -- it is purely about project scaffolding and internal infrastructure modules.

The research confirms all technology choices from the project-level stack research are correct and current. The key implementation patterns are: (1) atomic writes via write-to-temp-then-rename for crash-safe state, (2) zod v4 schema parsing of `process.env` for fail-fast config validation, (3) pino child loggers with module-scoped bindings for structured logging, and (4) TypeScript strict mode with `module: "Node16"` / `moduleResolution: "Node16"` for compatibility with @octokit/rest's conditional exports. One actionable finding: `.gitignore` currently includes `.env` but is **missing `state.json`** -- this must be added as part of INFR-08.

**Primary recommendation:** Build four independent modules (config, logger, state store, entry point) that can each be tested in isolation before wiring them together. Use the manual `fs.writeFile` + `fs.rename` pattern for atomic writes rather than adding a dependency like `write-file-atomic` -- the implementation is ~15 lines and avoids an extra package.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.x | Type safety, strict mode, build step | Required by INFR-06. Strict mode catches null issues, config typos, API misuse. Compile to Node16 module format for @octokit/rest compatibility. |
| Node.js | 22.x LTS | Runtime | Required by INFR-06. Render's default (22.22.0). Maintenance LTS until April 2026. Built-in `--env-file` flag eliminates dotenv dependency. |
| zod | ^4.3.6 | Environment variable validation | Required by INFR-03. TypeScript-first schema validation with `z.infer` for automatic type inference. v4 is current stable -- do NOT use v3 for new projects. |
| pino | ^10.3.1 | Structured JSON logging | Required by INFR-04. Fastest Node.js JSON logger. JSON output works with Render's log viewer. Child loggers for module-scoped context. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| grammY | ^1.40.0 | Telegram Bot Framework | Required by INFR-06 as a dependency. In Phase 1, only installed -- not actively used until Phase 2. Bot instance creation validates the token at startup. |
| @octokit/rest | ^22.0.1 | GitHub REST API client | Required by INFR-06 as a dependency. In Phase 1, only installed -- not actively used until Phase 2. Requires `moduleResolution: "Node16"` in tsconfig. |
| node-cron | ^4.2.1 | Cron scheduling | Required by INFR-06 as a dependency. In Phase 1, only installed -- not actively used until Phase 2. |
| pino-pretty | ^14.x | Dev-friendly log formatting | Dev dependency only. Pipe output through it locally: `node dist/index.js | npx pino-pretty`. Never use in production. |
| tsx | ^4.x | TypeScript dev runner | Dev dependency. Run TypeScript directly in development: `tsx --env-file=.env src/index.ts`. Supports `--watch` for auto-reload. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual atomic write (fs.writeFile + fs.rename) | `write-file-atomic` npm package (v7.0.0) | Package adds concurrent write queuing and ownership control. Overkill for GitScope -- single process, single writer. Manual pattern is ~15 lines, zero dependencies, and easier to understand. |
| `module: "Node16"` | `module: "NodeNext"` | NodeNext tracks the latest Node.js module behavior and may change between TypeScript versions. Node16 is stable and sufficient for Node 22.x. Both support conditional exports needed by @octokit/rest. Use Node16 for predictability. |
| `pino.stdTimeFunctions.isoTime` | Custom timestamp function | ISO time is human-readable in logs and standard for JSON logging. No reason to customize. |
| zod `z.string().min(1)` for tokens | Manual `if (!process.env.X)` checks | Manual checks do not scale, provide no type inference, and produce inconsistent error messages. Zod provides all three with less code. |

**Installation:**
```bash
# Core dependencies
npm install grammy @octokit/rest node-cron zod pino

# Dev dependencies
npm install -D typescript tsx @types/node pino-pretty
```

## Architecture Patterns

### Recommended Project Structure (Phase 1 scope)
```
src/
  config.ts          # Environment validation with zod, exports typed config object
  logger.ts          # Pino logger setup, exports createLogger(module) factory
  state/
    store.ts         # JSON file read/write with atomic operations
    schema.ts        # State shape definition (zod schema + TypeScript type)
  index.ts           # Entry point: validate config, init logger, load state, start bot skeleton
```

**What is NOT in Phase 1:**
```
src/
  monitor/           # Phase 2: GitHub polling, velocity detection
  github/            # Phase 2: GitHub API client
  telegram/          # Phase 2: Telegram message formatting
  scheduler.ts       # Phase 2: node-cron scheduling with overlap protection
```

### Pattern 1: Fail-Fast Config Validation
**What:** Parse `process.env` through a zod schema at the very first line of the application. If any required variable is missing or invalid, the process exits immediately with a clear error naming the missing variable.
**When to use:** Always, at application startup, before any other initialization.
**Source:** Verified against zod v4 docs (Context7) and env validation patterns.
**Example:**
```typescript
// src/config.ts
import { z } from "zod";

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_CHAT_ID: z.string().min(1, "TELEGRAM_CHAT_ID is required"),
  STATE_FILE_PATH: z.string().default("./state.json"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Print each validation error clearly
    console.error("Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
```

### Pattern 2: Atomic JSON State Persistence
**What:** Write state to a temporary file in the same directory, then rename it over the target file. On POSIX systems (Linux, macOS), `fs.rename` within the same filesystem is atomic -- the file is either fully the old version or fully the new version, never a partial write.
**When to use:** Every time state is written to disk.
**Source:** Node.js `fs` docs, `write-file-atomic` pattern, verified against community best practices.
**Example:**
```typescript
// src/state/store.ts
import { readFile, writeFile, rename, access } from "node:fs/promises";
import { join, dirname } from "node:path";

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, filePath);
}

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    await access(filePath); // Check file exists
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    // File missing or corrupt -- return fallback, log warning
    return fallback;
  }
}
```

### Pattern 3: Module-Scoped Child Loggers
**What:** Create a root pino logger once, then create child loggers with a `module` binding for each source file/module. All log output includes the module name automatically.
**When to use:** Every module that logs anything.
**Source:** Verified against pino docs (Context7) and BetterStack guide.
**Example:**
```typescript
// src/logger.ts
import pino from "pino";

const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}
```
```typescript
// src/state/store.ts
import { createLogger } from "../logger.js";
const log = createLogger("state");

log.info("State file loaded");
// Output: {"level":30,"time":"2026-02-13T10:30:00.000Z","module":"state","msg":"State file loaded"}
```

### Pattern 4: Graceful Recovery from Corrupt/Missing State
**What:** On startup, attempt to read and parse the state file. If it does not exist, is empty, or contains invalid JSON, log a warning and continue with a default empty state. Never crash on state file issues.
**When to use:** Every time the state file is read (startup and potentially during recovery).
**Source:** INFR-05 requirement.
**Example:**
```typescript
// Inside state/store.ts
const EMPTY_STATE: AppState = {
  meta: { version: 1, lastCycleAt: null },
  repos: {},
  notifications: {},
};

async function loadState(filePath: string, logger: pino.Logger): Promise<AppState> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    // Optionally validate with zod schema here
    logger.info({ filePath }, "State file loaded successfully");
    return parsed as AppState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn({ filePath }, "State file not found, starting with empty state");
    } else {
      logger.warn({ filePath, err }, "State file corrupt or unreadable, starting with empty state");
    }
    return { ...EMPTY_STATE };
  }
}
```

### Anti-Patterns to Avoid
- **Bare `fs.writeFile` for state:** Not atomic. Crash during write = corrupt file = lost state. Always use write-to-temp-then-rename.
- **`JSON.parse` without try/catch:** Unhandled exception on corrupt file crashes the entire bot. Always wrap in error handling.
- **Importing config as side effect at module level without validation:** If config.ts is imported before env vars are loaded, values are undefined. Validate eagerly at startup, export the result.
- **Using `module: "ESNext"` or `moduleResolution: "bundler"` in tsconfig:** Breaks @octokit/rest's conditional exports. Must use `Node16` or `NodeNext`.
- **Console.log instead of pino:** Loses structured JSON, timestamps, module context, and level filtering. Use pino from day one.
- **Storing secrets in config files committed to git:** Even in "private" repos. Use `.env` + `.gitignore`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Environment validation | Manual `if (!process.env.X)` chains | zod `z.object().safeParse(process.env)` | Zod gives type inference, consistent errors, default values, coercion -- all in one schema definition. Manual checks are verbose, error-prone, and produce no types. |
| Structured JSON logging | Custom `JSON.stringify({ level, msg, ... })` wrappers | pino with `child()` loggers | Pino handles serialization performance (5x faster than winston), log levels, timestamp formatting, child context inheritance, and stream management. Hand-rolling misses edge cases (circular references, error serialization, large objects). |
| Atomic file writes | Custom file locking or synchronization | `fs.writeFile` to temp + `fs.rename` pattern | The temp-then-rename pattern is OS-level atomic on same-filesystem. Custom locking (flock, advisory locks) is platform-specific and harder to get right. |
| Schema versioning | Custom `if (data.version === 1) migrate()` chains | A simple version field + migration map | Even a trivial `{ [version]: migrateFn }` lookup is more maintainable than growing if/else chains. But for Phase 1, a single version is sufficient -- just include the version field so migrations are possible later. |

**Key insight:** Phase 1 modules are small and well-scoped. The risk is not complexity but rather missing edge cases (corrupt files, missing env vars, unstructured logs) that compound into production incidents. Using standard libraries eliminates these edge cases.

## Common Pitfalls

### Pitfall 1: TypeScript Module Resolution Mismatch
**What goes wrong:** Setting `moduleResolution: "bundler"` or omitting it entirely in tsconfig.json, then getting cryptic import errors when using @octokit/rest v22 because it uses package.json conditional exports.
**Why it happens:** @octokit/rest v22 relies on the `exports` field in package.json, which is only respected by `Node16` or `NodeNext` module resolution. The older `"node"` strategy and `"bundler"` do not fully support conditional exports.
**How to avoid:** Set both `"module": "Node16"` and `"moduleResolution": "Node16"` in tsconfig.json. Use `.js` extensions in relative imports (e.g., `import { foo } from "./bar.js"`) even though source files are `.ts`.
**Warning signs:** `Cannot find module '@octokit/rest'` or `Module '"@octokit/rest"' has no exported member...` errors during compilation.

### Pitfall 2: State File Not in .gitignore
**What goes wrong:** `state.json` is committed to the repo. It may contain historical data, or worse, become a merge conflict source. On deploy, the committed version overwrites the production state.
**Why it happens:** The default `.gitignore` template (Node.js) does not include application-specific state files.
**How to avoid:** Add `state.json` to `.gitignore` before the first commit that creates the file. Current `.gitignore` already includes `.env` but is **missing `state.json`** -- this must be fixed in Phase 1.
**Warning signs:** `git status` showing `state.json` as an untracked or modified file.

### Pitfall 3: Zod v3 vs v4 API Confusion
**What goes wrong:** Using zod v3 patterns (like `errorMap`) with zod v4, or installing v3 when v4 is the current stable. Breaking changes between versions cause runtime errors or unexpected behavior.
**Why it happens:** Many tutorials and Stack Overflow answers still reference zod v3. The project stack specifies zod ^4.3.6.
**How to avoid:** Install `zod@^4` explicitly. Use `z.prettifyError()` (v4) instead of `errorMap` (v3). Use `error` function parameter instead of `errorMap` for custom errors. Check the [zod v4 docs](https://zod.dev/v4) for current API.
**Warning signs:** TypeScript errors about missing methods, or runtime errors from deprecated API usage.

### Pitfall 4: Pino Transport Configuration in ESM
**What goes wrong:** Configuring pino transports (like pino-pretty) inline in ESM TypeScript causes issues because transports run in worker threads and need resolvable file paths.
**Why it happens:** Pino's transport system spawns worker threads that need to resolve the transport module path independently.
**How to avoid:** For development, pipe output through pino-pretty externally: `node dist/index.js | npx pino-pretty`. Do not configure pino-pretty as an inline transport in production code. If inline transport is desired for dev, use `pino.transport({ target: 'pino-pretty' })` but only conditionally.
**Warning signs:** `Cannot find module 'pino-pretty'` errors in worker threads, or transports silently failing.

### Pitfall 5: fs.rename Fails Across Filesystem Boundaries
**What goes wrong:** The atomic write pattern (write temp, rename to target) fails with `EXDEV` error if the temp file and target file are on different filesystems/mount points.
**Why it happens:** On Unix systems, `rename()` only works within the same filesystem. Docker volumes, tmpdir on different partitions, or Render disk mounts could cause this.
**How to avoid:** Write the temp file in the **same directory** as the target file (e.g., `state.json.PID.tmp` next to `state.json`), not in `/tmp` or `os.tmpdir()`. This guarantees same-filesystem operation.
**Warning signs:** `EXDEV: cross-device link not permitted` error on rename.

### Pitfall 6: Process Exits Before Async Log Flush
**What goes wrong:** Calling `process.exit(1)` in config validation before pino has flushed its output buffer. The error message is lost.
**Why it happens:** Pino uses asynchronous destination streams by default. `process.exit()` terminates before the write buffer is drained.
**How to avoid:** For the config validation failure path (which runs before pino is initialized), use `console.error()` directly -- it is synchronous and guaranteed to flush. Only use pino after successful config validation.
**Warning signs:** Missing error output when the process exits due to invalid config.

## Code Examples

Verified patterns from official sources:

### TypeScript Configuration (tsconfig.json)
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
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```
Source: TypeScript docs for Node16 module resolution + @octokit/rest compatibility requirement from project stack research.

### Package.json Scripts
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js",
    "dev": "tsx --env-file=.env --watch src/index.ts",
    "dev:pretty": "tsx --env-file=.env src/index.ts | npx pino-pretty"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```
Source: Node.js `--env-file` docs, tsx docs, project stack research.

### State Schema Definition
```typescript
// src/state/schema.ts
import { z } from "zod";

const repoSnapshotSchema = z.object({
  owner: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  topics: z.array(z.string()),
  addedAt: z.string(), // ISO timestamp
  snapshots: z.array(
    z.object({
      timestamp: z.string(), // ISO timestamp
      stars: z.number(),
      forks: z.number(),
    })
  ),
});

const notificationRecordSchema = z.object({
  lastAlertAt: z.string(), // ISO timestamp
});

export const stateSchema = z.object({
  meta: z.object({
    version: z.number(),
    lastCycleAt: z.string().nullable(),
  }),
  repos: z.record(z.string(), repoSnapshotSchema),
  notifications: z.record(z.string(), notificationRecordSchema),
});

export type AppState = z.infer<typeof stateSchema>;

export const EMPTY_STATE: AppState = {
  meta: { version: 1, lastCycleAt: null },
  repos: {},
  notifications: {},
};
```
Source: INFR-02 requirement (state structure) + zod v4 docs.

### Full State Store Module
```typescript
// src/state/store.ts
import { readFile, writeFile, rename } from "node:fs/promises";
import type pino from "pino";
import { type AppState, EMPTY_STATE, stateSchema } from "./schema.js";

export class StateStore {
  private state: AppState;
  private readonly filePath: string;
  private readonly log: pino.Logger;

  constructor(filePath: string, logger: pino.Logger) {
    this.filePath = filePath;
    this.log = logger;
    this.state = { ...EMPTY_STATE };
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const result = stateSchema.safeParse(parsed);
      if (result.success) {
        this.state = result.data;
        this.log.info({ filePath: this.filePath }, "State loaded successfully");
      } else {
        this.log.warn(
          { filePath: this.filePath, errors: result.error.issues },
          "State file has invalid schema, starting with empty state"
        );
        this.state = { ...EMPTY_STATE };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.log.warn({ filePath: this.filePath }, "State file not found, starting with empty state");
      } else {
        this.log.warn({ filePath: this.filePath, err }, "State file corrupt or unreadable, starting with empty state");
      }
      this.state = { ...EMPTY_STATE };
    }
  }

  async save(): Promise<void> {
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const content = JSON.stringify(this.state, null, 2);
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, this.filePath);
    this.log.debug({ filePath: this.filePath }, "State saved atomically");
  }

  getState(): AppState {
    return this.state;
  }
}
```
Source: INFR-01 (atomic writes), INFR-02 (state structure), INFR-05 (graceful recovery).

### Entry Point Skeleton
```typescript
// src/index.ts
import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { StateStore } from "./state/store.js";

const log = createLogger("main");

async function main(): Promise<void> {
  log.info("GitScope starting");

  // Load state (gracefully handles missing/corrupt files)
  const stateStore = new StateStore(config.STATE_FILE_PATH, createLogger("state"));
  await stateStore.load();

  log.info("GitScope initialized successfully");
  // Phase 2 will add: GitHub client, Telegram bot, scheduler
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
```
Source: Composition of INFR-01 through INFR-06 patterns.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dotenv` package for `.env` loading | Node.js built-in `--env-file=.env` flag | Node.js 20.6 (stable), 22.x (current) | Zero-dependency env loading. Use `--env-file` in start scripts and tsx. |
| zod v3 `errorMap` for custom errors | zod v4 `error` function parameter | zod 4.0 (2025) | Simpler error customization. `z.prettifyError()` for formatted output. |
| `moduleResolution: "node"` | `moduleResolution: "Node16"` or `"NodeNext"` | TypeScript 4.7+ (2022), required by modern packages | Supports package.json `exports` field used by @octokit/rest, grammY, and other modern packages. |
| pino v9 transport API | pino v10 transport API | pino 10.0 (2025) | Minor transport configuration changes. Use `pino.transport()` for multi-target or pipeline configs. |
| `ts-node` for TypeScript development | `tsx` for TypeScript development | tsx gained dominance ~2024 | tsx is faster, handles ESM correctly, supports `--watch`, and passes through Node.js flags like `--env-file`. |

**Deprecated/outdated:**
- `dotenv`: Unnecessary with Node.js 22.x `--env-file` flag
- `ts-node`: Slower startup, ESM compatibility issues; use `tsx` instead
- `moduleResolution: "node"`: Does not support conditional exports; use `Node16`
- zod v3: Breaking API changes in v4; use v4 for new projects

## Open Questions

1. **Render Disk persistence for state.json**
   - What we know: Render Background Workers lose filesystem data on redeploy unless a Render Disk is mounted. State.json needs to survive deploys.
   - What's unclear: Whether a Render Disk is already provisioned for this project, and what mount path to use.
   - Recommendation: For Phase 1, default `STATE_FILE_PATH` to `./state.json` (relative to project root). Document that Render Disk must be configured before production deployment (Phase 3 scope). The state store code works regardless of the file path.

2. **State schema validation strictness**
   - What we know: INFR-05 says recover gracefully from corrupt state. INFR-02 says state has a schema version.
   - What's unclear: Should the state store validate the full schema on load (strict -- reject partially valid state) or accept any valid JSON object (loose -- might miss schema drift)?
   - Recommendation: Use zod `safeParse` on load. If schema validation fails, log the specific issues as warnings and fall back to empty state. This is strict enough to catch real corruption but graceful enough to not crash. Future schema migrations can handle version upgrades.

3. **Whether to create grammY Bot instance in Phase 1**
   - What we know: INFR-06 requires grammY as a dependency. Success Criteria #1 mentions the project uses grammY. But Phase 1 does not send Telegram messages.
   - What's unclear: Should Phase 1 instantiate `new Bot(token)` to validate the token works, or just install the package?
   - Recommendation: Do NOT start the bot (no `bot.start()`) but DO create the `Bot` instance in index.ts to validate the token is accepted by the constructor. This confirms the dependency is installed correctly and the token format is valid without requiring Telegram polling.

## Sources

### Primary (HIGH confidence)
- [Context7: /pinojs/pino] - Child logger creation, bindings, formatters, timestamp configuration, transport setup
- [Context7: /websites/zod_dev_v4] - Schema definition, `safeParse`, `prettifyError`, `z.object`, default values, `z.infer`, error function
- [Context7: /grammyjs/website] - `bot.api.sendMessage`, HTML parse mode, Bot constructor, Api class
- [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig/) - module, moduleResolution, strict mode options
- [TypeScript Module Resolution Guide](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) - Node16 vs NodeNext recommendation
- [Node.js fs API docs](https://nodejs.org/api/fs.html) - writeFile, rename, readFile semantics
- [Node.js --env-file docs](https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs) - Built-in env file loading

### Secondary (MEDIUM confidence)
- [BetterStack Pino Guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) - Pino setup patterns, child loggers, pino-pretty usage
- [creatures.sh: Env Validation with Zod](https://www.creatures.sh/blog/env-type-safety-and-validation/) - process.env parsing pattern, type inference
- [npm: write-file-atomic](https://www.npmjs.com/package/write-file-atomic) - Atomic write pattern reference (we implement manually but the pattern is the same)
- [tsconfig best practices 2025](https://notes.shiv.info/javascript/2025/04/21/tsconfig-best-practices/) - Modern tsconfig recommendations
- [tsx docs](https://tsx.is/node-enhancement) - Node.js flag passthrough, --env-file support
- [SigNoz Pino Logger Guide 2026](https://signoz.io/guides/pino-logger/) - Pino v10 patterns

### Tertiary (LOW confidence)
- None -- all findings verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified via Context7 and npm. Compatibility confirmed (Node16 + @octokit/rest, zod v4, pino v10).
- Architecture: HIGH - Four independent modules with clear boundaries. Patterns verified against official docs for each library.
- Pitfalls: HIGH - All pitfalls verified against official docs or reproducible conditions (EXDEV, ESM transport issues, missing .gitignore entries).

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable domain, 30-day validity)
