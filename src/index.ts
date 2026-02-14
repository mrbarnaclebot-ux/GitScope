import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { StateStore } from "./state/store.js";
import { createGitHubClient } from "./github/client.js";
import { createTelegramSender } from "./telegram/sender.js";
import { runMonitoringCycle } from "./monitor/cycle.js";
import { startScheduler } from "./scheduler.js";

const log = createLogger("main");

function setupGracefulShutdown(store: StateStore): void {
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutdown signal received, saving state");
    try {
      await store.save();
      log.info("State saved, exiting");
    } catch (err) {
      log.error({ err }, "Failed to save state on shutdown");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main(): Promise<void> {
  log.info("GitScope starting");

  const store = new StateStore(config.STATE_FILE_PATH, createLogger("state"));
  await store.load();

  setupGracefulShutdown(store);

  const state = store.getState();
  const repoCount = Object.keys(state.repos).length;

  const github = createGitHubClient(config.GITHUB_TOKEN);
  const telegram = createTelegramSender(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);
  const cycle = () => runMonitoringCycle(github, telegram, store, config.MONITOR_KEYWORDS);

  startScheduler(config.MONITOR_CRON, cycle);

  log.info(
    {
      repoCount,
      version: state.meta.version,
      cronExpression: config.MONITOR_CRON,
      keywords: config.MONITOR_KEYWORDS.length,
    },
    "GitScope monitoring started",
  );
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
