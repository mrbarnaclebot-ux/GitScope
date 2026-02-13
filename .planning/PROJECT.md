# GitScope

## What This Is

A Telegram bot that monitors GitHub for repositories related to the OpenClaw and Claude Code ecosystems that are gaining traction. It sends real-time alerts to a private Telegram group chat when repos cross star velocity thresholds, helping a developer community stay on top of ecosystem growth.

## Core Value

Developers in the group never miss a rising project in the OpenClaw/Claude Code ecosystem — alerts arrive within an hour of a repo gaining momentum.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

- [ ] Monitor GitHub for repos matching OpenClaw/Claude Code keywords
- [ ] Detect star velocity (stars gained per day)
- [ ] Send formatted Telegram alerts to private group chat
- [ ] Deduplicate notifications (don't re-alert for the same repo)
- [ ] Run on a schedule (every 30 minutes)
- [ ] Persist state between runs (JSON file)

### Out of Scope

- Web dashboard — not needed, Telegram is the interface
- Fork velocity tracking — v2
- Release detection — v2
- Contributor growth detection — v2
- Weekly digest summaries — v2
- Multiple Telegram channels — v2
- ML-based prediction — future
- Cross-platform validation (Reddit/HN) — future
- Mobile app — not applicable

## Context

**Ecosystem being tracked:**
- OpenClaw: AI assistant framework
- Claude Code: Anthropic's coding agent
- Related projects: Clawdbot, Moltbot, clawhub, OpenClaw skills

**Keywords to monitor:**
- openclaw, clawdbot, moltbot, claude-code, claude code, clawhub, openclaw skills

**Trending thresholds (v1 — star velocity only):**
- Repos <30 days old: >=5 stars/day
- Older repos: >=10 stars/day
- First-time appearance with >=20 stars

**GitHub API constraints:**
- Authenticated: 5,000 requests/hour
- Search API: 30 requests/minute
- Strategy: Cache data, use conditional requests, exponential backoff

**Telegram API constraints:**
- 30 messages/second per bot
- Queue notifications if multiple repos trend simultaneously

## Constraints

- **Runtime**: Node.js
- **Hosting**: Render Background Worker with node-cron scheduling
- **Storage**: JSON file for state persistence (repo snapshots, notification history)
- **APIs**: GitHub REST API v3, Telegram Bot API
- **Rate limits**: 30-minute check interval to stay within GitHub API limits
- **Config**: Environment variables for tokens (GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Star velocity only for v1 | Fewer API calls, simpler logic, ship faster | -- Pending |
| JSON file over SQLite | Simplest approach, easy to inspect/debug, sufficient for small scale | -- Pending |
| Render Background Worker | Always-on process with node-cron, no cold starts | -- Pending |
| Telegram only (no web UI) | Target users are already in a Telegram group | -- Pending |

---
*Last updated: 2026-02-13 after initialization*
