import { searchRepos, type SearchResult } from "../github/search.js";
import { calculateVelocity } from "./velocity.js";
import { classifySeverity, shouldAlertNewRepo, THRESHOLD_CONFIG } from "./classifier.js";
import { formatAlert, formatNewRepoAlert } from "../telegram/formatter.js";
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
}

export async function runMonitoringCycle(
  github: GitHubClient,
  telegram: TelegramSender,
  store: StateStore,
  keywords: string[],
  cooldownDays: number,
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

      // Skip repos above max stars -- focus on early trenders
      if (repo.stars > THRESHOLD_CONFIG.maxStars) {
        log.debug({ repo: key, stars: repo.stars }, "Repo exceeds max stars, skipping alert");
      } else if (isWithinCooldown(store.getState(), key, cooldownDays)) {
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
        pendingAlerts.push({ repoKey: key, message });
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
          pendingAlerts.push({ repoKey: key, message });
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

    // Send all alerts as a single combined message
    if (pendingAlerts.length > 0) {
      const combined = pendingAlerts.map((a) => a.message).join("\n\n---\n\n");
      const header = `<b>GitScope Report</b> -- ${pendingAlerts.length} repo${pendingAlerts.length === 1 ? "" : "s"}\n\n`;
      const sent = await telegram.send(header + combined);
      if (sent) {
        for (const alert of pendingAlerts) {
          store.updateState((s) => {
            s.notifications[alert.repoKey] = {
              lastAlertAt: new Date().toISOString(),
            };
          });
        }
        alertCount = pendingAlerts.length;
        log.info({ alertCount }, "Combined alert sent");
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
