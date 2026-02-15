import { searchRepos, type SearchResult } from "../github/search.js";
import { calculateVelocity } from "./velocity.js";
import { classifySeverity, shouldAlertNewRepo } from "./classifier.js";
import {
  formatAlert,
  formatNewRepoAlert,
  formatDigest,
  type DigestEntry,
} from "../telegram/formatter.js";
import type { TelegramSender } from "../telegram/sender.js";
import { StateStore } from "../state/store.js";
import type { GitHubClient } from "../github/client.js";
import type { AppState } from "../state/schema.js";
import { createLogger } from "../logger.js";

const log = createLogger("monitor:cycle");

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

interface PendingAlert {
  repoKey: string;
  message: string;
  digestEntry: DigestEntry;
}

export async function runMonitoringCycle(
  github: GitHubClient,
  telegram: TelegramSender,
  store: StateStore,
  keywords: string[],
  cooldownDays: number,
  batchThreshold: number,
): Promise<void> {
  let results: SearchResult[];

  try {
    results = await searchRepos(github, keywords);
    log.info({ count: results.length }, "Search returned repos");
  } catch (err) {
    log.error({ err }, "Search failed, aborting cycle");
    return;
  }

  let alertCount = 0;
  const pendingAlerts: PendingAlert[] = [];

  try {
    for (const repo of results) {
      const key = `${repo.owner}/${repo.name}`;
      const existing = store.getState().repos[key];
      const lastSnapshot = existing?.snapshots.at(-1) ?? null;

      const velocity = calculateVelocity(
        repo.stars,
        repo.createdAt,
        lastSnapshot,
      );

      // Check cooldown before alerting
      if (isWithinCooldown(store.getState(), key, cooldownDays)) {
        log.debug({ repo: key }, "Repo within cooldown, skipping alert");
      } else if (velocity.isNew && shouldAlertNewRepo(repo.stars)) {
        // New repo alert
        const message = formatNewRepoAlert({
          owner: repo.owner,
          name: repo.name,
          description: repo.description,
          stars: repo.stars,
          language: repo.language,
          repoAgeDays: velocity.repoAgeDays,
        });
        const digestEntry: DigestEntry = {
          owner: repo.owner,
          name: repo.name,
          stars: repo.stars,
          starsPerDay: 0,
          tier: "new" as const,
        };
        pendingAlerts.push({ repoKey: key, message, digestEntry });
      } else if (!velocity.isNew) {
        const tier = classifySeverity(
          velocity.starsPerDay,
          velocity.repoAgeDays,
        );
        if (tier !== null) {
          // Velocity alert
          const message = formatAlert({
            owner: repo.owner,
            name: repo.name,
            description: repo.description,
            stars: repo.stars,
            starsPerDay: velocity.starsPerDay,
            language: repo.language,
            repoAgeDays: velocity.repoAgeDays,
            tier,
          });
          const digestEntry: DigestEntry = {
            owner: repo.owner,
            name: repo.name,
            stars: repo.stars,
            starsPerDay: velocity.starsPerDay,
            tier,
          };
          pendingAlerts.push({ repoKey: key, message, digestEntry });
        }
      }

      // Update state for this repo (unchanged)
      store.updateState((s) => {
        if (!s.repos[key]) {
          s.repos[key] = {
            owner: repo.owner,
            name: repo.name,
            description: repo.description,
            language: repo.language,
            topics: repo.topics,
            addedAt: new Date().toISOString(),
            snapshots: [],
          };
        }

        s.repos[key].snapshots.push({
          timestamp: new Date().toISOString(),
          stars: repo.stars,
          forks: repo.forks,
        });

        // Prune snapshots to last 48 entries (48 hours at 1-hour intervals)
        if (s.repos[key].snapshots.length > 48) {
          s.repos[key].snapshots = s.repos[key].snapshots.slice(-48);
        }
      });
    }

    // Send alerts using batch-or-individual strategy
    if (pendingAlerts.length > batchThreshold) {
      // Digest mode: single message
      const digest = formatDigest(pendingAlerts.map((a) => a.digestEntry));
      const sent = await telegram.send(digest);
      if (sent) {
        for (const alert of pendingAlerts) {
          store.updateState((s) => {
            s.notifications[alert.repoKey] = {
              lastAlertAt: new Date().toISOString(),
            };
          });
        }
        alertCount = pendingAlerts.length;
        log.info({ alertCount }, "Digest alert sent");
      }
    } else {
      // Individual mode: one message per repo
      for (const alert of pendingAlerts) {
        const sent = await telegram.send(alert.message);
        if (sent) {
          alertCount++;
          store.updateState((s) => {
            s.notifications[alert.repoKey] = {
              lastAlertAt: new Date().toISOString(),
            };
          });
          log.info({ repo: alert.repoKey }, "Individual alert sent");
        }
      }
    }

    // Update cycle metadata
    store.updateState((s) => {
      s.meta.lastCycleAt = new Date().toISOString();
    });

    await store.save();

    log.info(
      { alertCount, repoCount: results.length },
      "Monitoring cycle complete",
    );
  } catch (err) {
    log.error({ err }, "Monitoring cycle failed");
  }
}
