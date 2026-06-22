import { KrakenBot, type BotConfig, cancelAllOpenBuyOrders } from "./krakenBot";
import { XtBot } from "./xtBot";
import { XtClient } from "./xtClient";
import { loadPersistedState, savePersistedState } from "./persistence";
import { getTelegramEventConfig, setTelegramEventConfig, type TelegramEventConfig } from "./telegram";
import { logger } from "./logger";

export type AnyBot = KrakenBot | XtBot;

export interface BotInstanceData {
  id: string;
  config: BotConfig;
  status: ReturnType<KrakenBot["getStatus"]>;
}

class BotManager {
  private bots = new Map<string, AnyBot>();

  async initialize(): Promise<void> {
    const state = await loadPersistedState();

    if (state.telegramSettings) {
      setTelegramEventConfig(state.telegramSettings);
    }

    const krakenBotsToStart: KrakenBot[] = [];
    const xtBotsToStart: XtBot[] = [];

    for (const p of state.bots) {
      try {
        const config: BotConfig = {
          ...p.config,
          checkIntervalMs: p.config.checkIntervalMs ?? 3000,
          oneShotMode: p.config.oneShotMode ?? false,
          maxConsecutiveErrors: p.config.maxConsecutiveErrors ?? 5,
        };
        const bot = this.instantiate(p.id, config);
        bot.loadFills(p.fills ?? [], p.fillIdCounter ?? 0);
        bot.loadLogs(p.logs ?? [], p.logIdCounter ?? 0);
        this.bots.set(p.id, bot);
        const isDev = process.env["NODE_ENV"] !== "production";
        if (p.running && !isDev) {
          if (bot instanceof XtBot) xtBotsToStart.push(bot);
          else krakenBotsToStart.push(bot as KrakenBot);
        } else if (p.running && isDev) {
          logger.info({ botId: p.id }, "Dev mode: bot not auto-started (run published app or start manually)");
        }
      } catch (err) {
        logger.warn({ err, botId: p.id }, "Skipping corrupt persisted bot");
      }
    }

    // Cancel ALL open Kraken buy orders ONCE before starting any Kraken bot.
    // Prevents duplicate orders during rolling restarts/redeploys.
    if (krakenBotsToStart.length > 0) {
      const pairs = krakenBotsToStart.map((b) => b.getConfig().pair);
      await cancelAllOpenBuyOrders(pairs);
    }

    // Cancel ALL open XT buy orders ONCE (manager-level, analogous to Kraken).
    // Each symbol is cleaned up before any XT bot starts trading.
    if (xtBotsToStart.length > 0) {
      const xtClient = new XtClient(
        process.env["XT_API_KEY"] ?? "",
        process.env["XT_API_SECRET"] ?? ""
      );
      const xtPairs = xtBotsToStart.map((b) => b.getConfig().pair);
      logger.info({ pairs: xtPairs }, "BotManager: cancelling stale XT open orders before autostart");
      for (const pair of xtPairs) {
        await xtClient.cancelAllOpenOrders(pair);
      }
    }

    for (const bot of krakenBotsToStart) {
      bot.start().catch((err: unknown) => {
        logger.error({ err, botId: bot.getConfig().pair }, "Failed to auto-start Kraken bot on restore");
      });
    }

    for (const bot of xtBotsToStart) {
      bot.start().catch((err: unknown) => {
        logger.error({ err, botId: bot.getConfig().pair }, "Failed to auto-start XT bot on restore");
      });
    }

    logger.info({ count: this.bots.size }, "BotManager initialized from persisted state");
  }

  persist(): void {
    const bots = Array.from(this.bots.entries()).map(([id, bot]) => ({
      id,
      config: bot.getConfig(),
      running: bot.getStatus().running,
      fills: bot.getFills(500),
      fillIdCounter: bot.getFillIdCounter(),
      logs: bot.getLogs(500),
      logIdCounter: bot.getLogIdCounter(),
    }));
    savePersistedState({ bots, telegramSettings: getTelegramEventConfig() }).catch((err: unknown) => {
      process.stderr.write(`[persistence] savePersistedState error: ${String(err)}\n`);
    });
  }

  getTelegramSettings(): TelegramEventConfig {
    return getTelegramEventConfig();
  }

  updateTelegramSettings(config: TelegramEventConfig): void {
    setTelegramEventConfig(config);
    this.persist();
  }

  list(): BotInstanceData[] {
    return Array.from(this.bots.entries()).map(([id, bot]) => ({
      id,
      config: bot.getConfig(),
      status: bot.getStatus(),
    }));
  }

  get(id: string): AnyBot | undefined {
    return this.bots.get(id);
  }

  private instantiate(id: string, config: BotConfig): AnyBot {
    if (config.exchange === "xt") {
      return new XtBot(id, config, () => this.persist());
    }
    return new KrakenBot(id, config, () => this.persist());
  }

  create(config: BotConfig): AnyBot {
    const id = config.pair;
    if (this.bots.has(id)) {
      throw new Error(`Bot for pair ${id} already exists`);
    }
    const bot = this.instantiate(id, config);
    this.bots.set(id, bot);
    this.persist();
    return bot;
  }

  async remove(id: string): Promise<boolean> {
    const bot = this.bots.get(id);
    if (!bot) return false;
    if (bot.getStatus().running) {
      await bot.stop();
    }
    this.bots.delete(id);
    this.persist();
    return true;
  }

  toInstance(id: string): BotInstanceData | null {
    const bot = this.bots.get(id);
    if (!bot) return null;
    return { id, config: bot.getConfig(), status: bot.getStatus() };
  }
}

export const botManager = new BotManager();
