import { KrakenBot, type BotConfig } from "./krakenBot";
import { loadPersistedBots, savePersistedBots } from "./persistence";
import { logger } from "./logger";

export interface BotInstanceData {
  id: string;
  config: BotConfig;
  status: ReturnType<KrakenBot["getStatus"]>;
}

class BotManager {
  private bots = new Map<string, KrakenBot>();

  async initialize(): Promise<void> {
    const persisted = await loadPersistedBots();
    for (const p of persisted) {
      try {
        const config: BotConfig = {
          ...p.config,
          checkIntervalMs: p.config.checkIntervalMs ?? 3000,
          oneShotMode: p.config.oneShotMode ?? false,
          maxConsecutiveErrors: p.config.maxConsecutiveErrors ?? 5,
        };
        const bot = new KrakenBot(p.id, config, () => this.persist());
        bot.loadFills(p.fills ?? [], p.fillIdCounter ?? 0);
        this.bots.set(p.id, bot);
        const isDev = process.env["NODE_ENV"] !== "production";
        if (p.running && !isDev) {
          bot.start().catch((err: unknown) => {
            logger.error({ err, botId: p.id }, "Failed to auto-start bot on restore");
          });
        } else if (p.running && isDev) {
          logger.info({ botId: p.id }, "Dev mode: bot not auto-started (run published app or start manually)");
        }
      } catch (err) {
        logger.warn({ err, botId: p.id }, "Skipping corrupt persisted bot");
      }
    }
    logger.info({ count: this.bots.size }, "BotManager initialized from persisted state");
  }

  persist(): void {
    const data = Array.from(this.bots.entries()).map(([id, bot]) => ({
      id,
      config: bot.getConfig(),
      running: bot.getStatus().running,
      fills: bot.getFills(500),
      fillIdCounter: bot.getFillIdCounter(),
    }));
    savePersistedBots(data).catch((err: unknown) => {
      process.stderr.write(`[persistence] savePersistedBots error: ${String(err)}\n`);
    });
  }

  list(): BotInstanceData[] {
    return Array.from(this.bots.entries()).map(([id, bot]) => ({
      id,
      config: bot.getConfig(),
      status: bot.getStatus(),
    }));
  }

  get(id: string): KrakenBot | undefined {
    return this.bots.get(id);
  }

  create(config: BotConfig): KrakenBot {
    const id = config.pair;
    if (this.bots.has(id)) {
      throw new Error(`Bot for pair ${id} already exists`);
    }
    const bot = new KrakenBot(id, config, () => this.persist());
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
