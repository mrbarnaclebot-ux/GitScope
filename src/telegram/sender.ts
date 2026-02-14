import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, HttpError } from "grammy";
import { createLogger } from "../logger.js";

const log = createLogger("telegram");

export interface TelegramSender {
  send(message: string): Promise<boolean>;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function createTelegramSender(
  botToken: string,
  chatId: string,
): TelegramSender {
  const bot = new Bot(botToken);

  bot.api.config.use(
    autoRetry({
      maxRetryAttempts: 3,
      maxDelaySeconds: 60,
    }),
  );

  return {
    async send(message: string): Promise<boolean> {
      try {
        await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
        log.info({ chatId }, "Alert sent successfully");
        return true;
      } catch (err) {
        if (err instanceof GrammyError) {
          if (
            err.error_code === 400 &&
            err.description.includes("can't parse entities")
          ) {
            log.warn({ chatId }, "HTML parse failed, falling back to plain text");
            try {
              const plainText = stripHtml(message);
              await bot.api.sendMessage(chatId, plainText);
              log.info({ chatId }, "Alert sent as plain text");
              return true;
            } catch (fallbackErr) {
              log.error(
                { chatId, err: fallbackErr },
                "Plain text fallback also failed",
              );
              return false;
            }
          }
          log.error(
            { chatId, description: err.description },
            "Telegram API error",
          );
          return false;
        }
        if (err instanceof HttpError) {
          log.error({ chatId, err }, "Could not contact Telegram");
          return false;
        }
        log.error({ chatId, err }, "Unknown error sending alert");
        return false;
      }
    },
  };
}
