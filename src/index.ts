import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { StateStore } from "./state/store.js";

const log = createLogger("main");

async function main(): Promise<void> {
  log.info("GitScope starting");

  const store = new StateStore(config.STATE_FILE_PATH, createLogger("state"));
  await store.load();

  const state = store.getState();
  log.info(
    { repoCount: Object.keys(state.repos).length, version: state.meta.version },
    "GitScope initialized successfully"
  );

  // Phase 2 will add: GitHub client init, Telegram bot init, scheduler start
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
