import cron from "node-cron";
import { createLogger } from "./logger.js";

const log = createLogger("scheduler");

export function startScheduler(
  cronExpression: string,
  cycleFn: () => Promise<void>,
): void {
  const task = cron.schedule(
    cronExpression,
    async () => {
      log.info("Monitoring cycle starting");
      try {
        await cycleFn();
        log.info("Monitoring cycle completed");
      } catch (err) {
        log.error({ err }, "Monitoring cycle failed");
      }
    },
    { noOverlap: true, name: "gitscope-monitor" },
  );

  task.on("execution:overlap", () => {
    log.warn("Monitoring cycle skipped -- previous cycle still running");
  });

  log.info({ cronExpression }, "Scheduler started");
}
