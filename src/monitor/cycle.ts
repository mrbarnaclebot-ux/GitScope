import { searchRepos, type SearchResult } from "../github/search.js";
import { calculateVelocity } from "./velocity.js";
import { classifySeverity, shouldAlertNewRepo } from "./classifier.js";
import { formatAlert, formatNewRepoAlert } from "../telegram/formatter.js";
import type { TelegramSender } from "../telegram/sender.js";
import { StateStore } from "../state/store.js";
import type { GitHubClient } from "../github/client.js";
import { createLogger } from "../logger.js";

const log = createLogger("monitor:cycle");

export async function runMonitoringCycle(
  github: GitHubClient,
  telegram: TelegramSender,
  store: StateStore,
  keywords: string[],
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

      // Determine if alert is needed
      if (velocity.isNew && shouldAlertNewRepo(repo.stars)) {
        const message = formatNewRepoAlert({
          owner: repo.owner,
          name: repo.name,
          description: repo.description,
          stars: repo.stars,
          language: repo.language,
          repoAgeDays: velocity.repoAgeDays,
        });
        const sent = await telegram.send(message);
        if (sent) {
          alertCount++;
          log.info({ repo: key, stars: repo.stars }, "NEW repo alert sent");
        }
      } else if (!velocity.isNew) {
        const tier = classifySeverity(
          velocity.starsPerDay,
          velocity.repoAgeDays,
        );
        if (tier !== null) {
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
          const sent = await telegram.send(message);
          if (sent) {
            alertCount++;
            log.info(
              { repo: key, tier, starsPerDay: velocity.starsPerDay },
              "Velocity alert sent",
            );
          }
        }
      }

      // Update state for this repo
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

        // Prune snapshots to last 48 entries (24 hours at 30-min intervals)
        if (s.repos[key].snapshots.length > 48) {
          s.repos[key].snapshots = s.repos[key].snapshots.slice(-48);
        }
      });
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
