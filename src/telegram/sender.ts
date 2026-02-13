import { Bot, GrammyError, HttpError } from "grammy";
import { createLogger } from "../logger.js";

const log = createLogger("telegram");

export interface TelegramSender {
  send(message: string): Promise<boolean>;
}

export function createTelegramSender(
  botToken: string,
  chatId: string,
): TelegramSender {
  const bot = new Bot(botToken);

  return {
    async send(message: string): Promise<boolean> {
      try {
        await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
        log.info({ chatId }, "Alert sent successfully");
        return true;
      } catch (err) {
        if (err instanceof GrammyError) {
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
