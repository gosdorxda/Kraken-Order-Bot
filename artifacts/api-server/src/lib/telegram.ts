import { logger } from "./logger.js";
import { getAppSettings } from "./appSettings.js";

export type TelegramEvent = "fill" | "circuitBreaker" | "botStartStop";

export async function sendTelegramNotification(text: string, event: TelegramEvent): Promise<void> {
  const token  = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return;

  const notif = getAppSettings().telegramNotifications;
  if (event === "fill"           && !notif.fill)           return;
  if (event === "circuitBreaker" && !notif.circuitBreaker) return;
  if (event === "botStartStop"   && !notif.botStartStop)   return;

  const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: safeText, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "Telegram notification failed");
    }
  } catch (err) {
    logger.warn({ err }, "Telegram notification error");
  }
}
