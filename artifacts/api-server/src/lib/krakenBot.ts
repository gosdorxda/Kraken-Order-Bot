import KrakenClient from "kraken-api";
import { logger } from "./logger";

export interface BotConfig {
  pair: string;
  orderSize: string;
  maxBidPrice: string;
  tickSize: string;
  checkIntervalMs: number;
}

export interface BotLog {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  data: string | null;
}

export interface BotStatus {
  running: boolean;
  pair: string | null;
  currentOrderId: string | null;
  currentOrderPrice: string | null;
  currentOrderVolume: string | null;
  topBidPrice: string | null;
  topBidOwner: "bot" | "other" | "none";
  cycleCount: number;
  lastAction: string | null;
  lastActionAt: string | null;
}

const DEFAULT_CONFIG: BotConfig = {
  pair: "XXBTZUSD",
  orderSize: "0.001",
  maxBidPrice: "100000",
  tickSize: "0.1",
  checkIntervalMs: 3000,
};

class KrakenBot {
  private client: KrakenClient;
  private config: BotConfig = { ...DEFAULT_CONFIG };
  private logs: BotLog[] = [];
  private logIdCounter = 0;

  private running = false;
  private currentOrderId: string | null = null;
  private currentOrderPrice: string | null = null;
  private currentOrderVolume: string | null = null;
  private topBidPrice: string | null = null;
  private topBidOwner: "bot" | "other" | "none" = "none";
  private cycleCount = 0;
  private lastAction: string | null = null;
  private lastActionAt: string | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const apiKey = process.env["KRAKEN_API_KEY"] ?? "";
    const apiSecret = process.env["KRAKEN_API_SECRET"] ?? "";
    this.client = new KrakenClient(apiKey, apiSecret);
  }

  private addLog(level: BotLog["level"], message: string, data?: unknown): void {
    const entry: BotLog = {
      id: ++this.logIdCounter,
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data != null ? JSON.stringify(data) : null,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs = this.logs.slice(0, 200);
    logger.info({ botLog: entry }, message);
  }

  getConfig(): BotConfig {
    return { ...this.config };
  }

  setConfig(cfg: BotConfig): void {
    this.config = { ...cfg };
  }

  getStatus(): BotStatus {
    return {
      running: this.running,
      pair: this.running ? this.config.pair : null,
      currentOrderId: this.currentOrderId,
      currentOrderPrice: this.currentOrderPrice,
      currentOrderVolume: this.currentOrderVolume,
      topBidPrice: this.topBidPrice,
      topBidOwner: this.topBidOwner,
      cycleCount: this.cycleCount,
      lastAction: this.lastAction,
      lastActionAt: this.lastActionAt,
    };
  }

  getLogs(limit = 50): BotLog[] {
    return this.logs.slice(0, limit);
  }

  async getOrderBook(pair?: string): Promise<{ bids: { price: string; volume: string }[]; asks: { price: string; volume: string }[] }> {
    const targetPair = pair ?? this.config.pair;
    const resp = await (this.client as any).api("Depth", { pair: targetPair, count: 10 });
    const data = resp.result[Object.keys(resp.result)[0]];
    return {
      bids: (data.bids as [string, string][]).map(([price, volume]) => ({ price, volume })),
      asks: (data.asks as [string, string][]).map(([price, volume]) => ({ price, volume })),
    };
  }

  async getBalance(): Promise<Record<string, string>> {
    const resp = await (this.client as any).api("Balance", {});
    return resp.result as Record<string, string>;
  }

  async start(config: BotConfig): Promise<void> {
    if (this.running) {
      await this.stop();
    }
    this.config = { ...config };
    this.running = true;
    this.cycleCount = 0;
    this.addLog("info", `Bot started for pair ${this.config.pair}`, { config });
    this.intervalHandle = setInterval(() => {
      this.runCycle().catch((err: unknown) => {
        this.addLog("error", "Cycle error", err instanceof Error ? err.message : String(err));
      });
    }, this.config.checkIntervalMs);
    await this.runCycle();
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    if (this.currentOrderId) {
      try {
        await this.cancelOrder(this.currentOrderId);
        this.addLog("info", `Cancelled order ${this.currentOrderId} on stop`);
      } catch (err) {
        this.addLog("warn", `Could not cancel order on stop: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.currentOrderId = null;
      this.currentOrderPrice = null;
    }
    this.topBidOwner = "none";
    this.topBidPrice = null;
    this.addLog("info", "Bot stopped");
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    this.cycleCount++;

    try {
      const book = await this.getOrderBook(this.config.pair);
      const topBid = book.bids[0];
      if (!topBid) {
        this.addLog("warn", "Empty order book, skipping cycle");
        return;
      }

      this.topBidPrice = topBid.price;
      const topBidPriceNum = parseFloat(topBid.price);
      const maxPriceNum = parseFloat(this.config.maxBidPrice);
      const tickNum = parseFloat(this.config.tickSize);

      let myOrderIsAtTop = false;

      if (this.currentOrderId) {
        const orderStatus = await this.checkOrderOpen(this.currentOrderId);
        if (!orderStatus.isOpen) {
          this.addLog("success", `Order ${this.currentOrderId} was filled!`, { price: this.currentOrderPrice });
          this.currentOrderId = null;
          this.currentOrderPrice = null;
        } else {
          const myPrice = parseFloat(this.currentOrderPrice ?? "0");
          myOrderIsAtTop = myPrice >= topBidPriceNum;
          if (myOrderIsAtTop) {
            this.topBidOwner = "bot";
          }
        }
      }

      if (this.currentOrderId && myOrderIsAtTop) {
        return;
      }

      const targetPrice = topBidPriceNum + tickNum;

      if (targetPrice > maxPriceNum) {
        this.topBidOwner = "other";
        if (this.currentOrderId) {
          await this.cancelOrder(this.currentOrderId);
          this.addLog("warn", `Max price reached (${maxPriceNum}), order cancelled, bot paused`);
          this.currentOrderId = null;
          this.currentOrderPrice = null;
          this.setLastAction(`Max bid price ${maxPriceNum} reached — paused`);
        } else {
          this.addLog("warn", `Top bid ${topBidPriceNum} + tick ${tickNum} = ${targetPrice} exceeds max ${maxPriceNum}. Not placing order.`);
        }
        return;
      }

      if (this.currentOrderId) {
        await this.cancelOrder(this.currentOrderId);
        this.addLog("info", `Cancelled order at ${this.currentOrderPrice} — re-placing at ${targetPrice.toFixed(this.decimalPlaces(this.config.tickSize))}`);
        this.currentOrderId = null;
        this.currentOrderPrice = null;
      }

      const formattedPrice = targetPrice.toFixed(this.decimalPlaces(this.config.tickSize));
      const orderId = await this.placeOrder(this.config.pair, formattedPrice, this.config.orderSize);
      this.currentOrderId = orderId;
      this.currentOrderPrice = formattedPrice;
      this.currentOrderVolume = this.config.orderSize;
      this.topBidOwner = "bot";
      this.setLastAction(`Placed buy order at ${formattedPrice}`);
      this.addLog("success", `Placed buy order`, { orderId, price: formattedPrice, volume: this.config.orderSize });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog("error", `Cycle error: ${msg}`);
    }
  }

  private async cancelOrder(orderId: string): Promise<void> {
    await (this.client as any).api("CancelOrder", { txid: orderId });
  }

  private async checkOrderOpen(orderId: string): Promise<{ isOpen: boolean }> {
    const resp = await (this.client as any).api("QueryOrders", { txid: orderId, trades: false });
    const order = resp.result?.[orderId];
    if (!order) return { isOpen: false };
    const openStatuses = ["open", "pending"];
    return { isOpen: openStatuses.includes(order.status) };
  }

  private async placeOrder(pair: string, price: string, volume: string): Promise<string> {
    const resp = await (this.client as any).api("AddOrder", {
      pair,
      type: "buy",
      ordertype: "limit",
      price,
      volume,
    });
    const txids: string[] = resp.result?.txid ?? [];
    if (!txids.length) {
      throw new Error("No order ID returned from Kraken");
    }
    return txids[0]!;
  }

  private setLastAction(action: string): void {
    this.lastAction = action;
    this.lastActionAt = new Date().toISOString();
  }

  private decimalPlaces(value: string): number {
    const parts = value.split(".");
    return parts.length > 1 ? parts[1]!.length : 0;
  }
}

export const krakenBot = new KrakenBot();
