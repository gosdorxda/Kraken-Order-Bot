import { logger } from "./logger.js";

export type TelegramEvent = "fill" | "circuitBreaker" | "startStop";

export interface TelegramEventConfig {
  notifyOnFill: boolean;
  notifyOnCircuitBreaker: boolean;
  notifyOnStartStop: boolean;
}

const DEFAULT_CONFIG: TelegramEventConfig = {
  notifyOnFill: true,
  notifyOnCircuitBreaker: true,
  notifyOnStartStop: false,
};

let _eventConfig: TelegramEventConfig = { ...DEFAULT_CONFIG };

export function getTelegramEventConfig(): TelegramEventConfig {
  return { ..._eventConfig };
}

export function setTelegramEventConfig(config: TelegramEventConfig): void {
  _eventConfig = { ...config };
}

export function isTelegramConfigured(): boolean {
  return !!(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]);
}

export async function sendTelegramEvent(event: TelegramEvent, text: string): Promise<void> {
  const enabled =
    event === "fill"
      ? _eventConfig.notifyOnFill
      : event === "circuitBreaker"
        ? _eventConfig.notifyOnCircuitBreaker
        : _eventConfig.notifyOnStartStop;
  if (!enabled) return;
  await sendTelegramNotification(text);
}

export async function sendTelegramNotification(text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "Telegram notification failed");
    }
  } catch (err) {
    logger.warn({ err }, "Telegram notification error");
  }
}
