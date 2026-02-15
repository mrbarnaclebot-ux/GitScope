import { z } from "zod";

const envSchema = z.object({
  GITHUB_TOKEN: z
    .string({ error: "GITHUB_TOKEN is required" })
    .min(1, "GITHUB_TOKEN is required"),
  TELEGRAM_BOT_TOKEN: z
    .string({ error: "TELEGRAM_BOT_TOKEN is required" })
    .min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_CHAT_ID: z
    .string({ error: "TELEGRAM_CHAT_ID is required" })
    .min(1, "TELEGRAM_CHAT_ID is required"),
  STATE_FILE_PATH: z.string().default("./state.json"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  MONITOR_KEYWORDS: z
    .string()
    .default("openclaw,claude-code,clawdbot,moltbot,clawhub,openclaw skills")
    .transform((s) => s.split(",").map((k) => k.trim())),
  MONITOR_CRON: z.string().default("0 * * * *"),
  COOLDOWN_DAYS: z
    .string()
    .default("7")
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().min(1).max(90)),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Configuration validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
