import { KrakenBot, type BotConfig } from "./krakenBot";

export interface BotInstanceData {
  id: string;
  config: BotConfig;
  status: ReturnType<KrakenBot["getStatus"]>;
}

class BotManager {
  private bots = new Map<string, KrakenBot>();

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
    const bot = new KrakenBot(id, config);
    this.bots.set(id, bot);
    return bot;
  }

  async remove(id: string): Promise<boolean> {
    const bot = this.bots.get(id);
    if (!bot) return false;
    if (bot.getStatus().running) {
      await bot.stop();
    }
    this.bots.delete(id);
    return true;
  }

  toInstance(id: string): BotInstanceData | null {
    const bot = this.bots.get(id);
    if (!bot) return null;
    return { id, config: bot.getConfig(), status: bot.getStatus() };
  }
}

export const botManager = new BotManager();
