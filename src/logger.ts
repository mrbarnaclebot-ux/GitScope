import pino from "pino";
import { config } from "./config.js";

const rootLogger = pino({
  level: config.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}
