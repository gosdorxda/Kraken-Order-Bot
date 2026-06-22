import { fetchXtOrderBook, fetchXtSymbolPrecision, XtClient } from "./xtClient";
import { sendTelegramEvent } from "./telegram.js";
import type { BotConfig, BotLog, BotStatus, FillRecord } from "./krakenBot";

export class XtBot {
  readonly id: string;
  private config: BotConfig;
  private client: XtClient;
  private logs: BotLog[] = [];
  private logIdCounter = 0;
  private fills: FillRecord[] = [];
  private fillIdCounter = 0;
  private onPersist?: () => void;

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
  private consecutiveErrors = 0;
  private circuitBreakerTripped = false;

  // Exchange-driven precision (fetched once on first cycle)
  private pricePrecision: number | null = null;
  private quantityPrecision: number | null = null;

  constructor(id: string, config: BotConfig, onPersist?: () => void) {
    this.id = id;
    this.config = { ...config };
    this.onPersist = onPersist;
    const apiKey = process.env["XT_API_KEY"] ?? "";
    const apiSecret = process.env["XT_API_SECRET"] ?? "";
    this.client = new XtClient(apiKey, apiSecret);
  }

  // ─── Public accessors ───────────────────────────────────────────────────────

  getConfig(): BotConfig {
    return { ...this.config };
  }

  setConfig(cfg: BotConfig): void {
    this.config = { ...cfg };
    // Reset cached precision when config changes (pair may have changed)
    this.pricePrecision = null;
    this.quantityPrecision = null;
  }

  getStatus(): BotStatus {
    return {
      running: this.running,
      currentOrderId: this.currentOrderId,
      currentOrderPrice: this.currentOrderPrice,
      currentOrderVolume: this.currentOrderVolume,
      topBidPrice: this.topBidPrice,
      topBidOwner: this.topBidOwner,
      cycleCount: this.cycleCount,
      lastAction: this.lastAction,
      lastActionAt: this.lastActionAt,
      circuitBreakerTripped: this.circuitBreakerTripped,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  getLogs(limit = 500): BotLog[] {
    return this.logs.slice(0, limit);
  }

  getLogIdCounter(): number {
    return this.logIdCounter;
  }

  loadLogs(logs: BotLog[], nextId: number): void {
    this.logs = [...logs];
    this.logIdCounter = nextId;
  }

  getFills(limit = 200): FillRecord[] {
    return this.fills.slice(0, limit);
  }

  getFillIdCounter(): number {
    return this.fillIdCounter;
  }

  loadFills(fills: FillRecord[], nextId: number): void {
    this.fills = [...fills];
    this.fillIdCounter = nextId;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.circuitBreakerTripped = false;
    this.consecutiveErrors = 0;
    this.cycleCount = 0;
    this.currentOrderId = null;
    this.currentOrderPrice = null;
    this.currentOrderVolume = null;

    this.addLog("info", `XT Bot started for pair ${this.config.pair}`, { config: this.config });
    void sendTelegramEvent("startStop", `▶️ <b>[XT:${this.id}]</b> Bot dimulai untuk pair <b>${this.config.pair}</b>`);

    this.intervalHandle = setInterval(() => {
      this.runCycle().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.addLog("error", "Cycle error (fatal)", msg);
        void sendTelegramEvent("circuitBreaker", `⚠️ <b>[XT:${this.id}]</b> Bot berhenti karena error tak terduga:\n${msg}`);
        this.stop();
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
        await this.client.cancelOrder(this.currentOrderId);
        this.addLog("info", `Cancelled order ${this.currentOrderId} on stop`);
      } catch (err) {
        this.addLog("warn", `Could not cancel order on stop: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.currentOrderId = null;
      this.currentOrderPrice = null;
    }
    this.topBidOwner = "none";
    this.topBidPrice = null;
    this.addLog("info", "XT Bot stopped");
    void sendTelegramEvent("startStop", `⏹️ <b>[XT:${this.id}]</b> Bot dihentikan untuk pair <b>${this.config.pair}</b>`);
    this.onPersist?.();
  }

  // ─── Cycle ──────────────────────────────────────────────────────────────────

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    this.cycleCount++;

    try {
      // Bootstrap: fetch exchange-driven precision on the first cycle
      if (this.pricePrecision === null) {
        const prec = await fetchXtSymbolPrecision(this.config.pair);
        this.pricePrecision = prec.pricePrecision;
        this.quantityPrecision = prec.quantityPrecision;
        this.addLog("info", `Symbol precision loaded: price=${this.pricePrecision}, qty=${this.quantityPrecision}`);
      }

      const book = await fetchXtOrderBook(this.config.pair);
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
        const orderStatus = await this.client.getOrder(this.currentOrderId);
        if (!orderStatus.isOpen) {
          if (orderStatus.reason === "filled") {
            const filledOrderId = this.currentOrderId;
            const filledPrice = this.currentOrderPrice ?? "0";
            const filledVolume = this.currentOrderVolume ?? this.config.orderSize;

            this.addLog("success", `Order ${filledOrderId} was filled!`, { price: filledPrice });
            this.recordFill(filledOrderId, filledPrice, filledVolume);

            this.currentOrderId = null;
            this.currentOrderPrice = null;
            this.currentOrderVolume = null;

            if (this.config.oneShotMode) {
              this.addLog("info", "One-shot mode: bot stopped after fill.");
              this.setLastAction("Stopped — order filled (one-shot mode)");
              this.stop();
              return;
            }
          } else {
            const staleId = this.currentOrderId;
            if (orderStatus.reason === "unknown") {
              this.addLog("warn", `Order ${staleId} tidak ditemukan di XT — mencoba cancel sebelum re-place`);
              await this.client.cancelOrder(staleId);
            } else {
              this.addLog("warn", `Order ${staleId} dibatalkan/expired — akan re-place di siklus berikutnya`);
            }
            this.currentOrderId = null;
            this.currentOrderPrice = null;
            this.currentOrderVolume = null;
          }
        } else {
          const myPrice = parseFloat(this.currentOrderPrice ?? "0");
          myOrderIsAtTop = myPrice >= topBidPriceNum;
          if (myOrderIsAtTop) this.topBidOwner = "bot";
        }
      }

      if (this.currentOrderId && myOrderIsAtTop) {
        // Step-down: move order down if there's a gap
        const secondBid = book.bids[1];
        const myPrice = parseFloat(this.currentOrderPrice ?? "0");
        if (secondBid) {
          const secondBidNum = parseFloat(secondBid.price);
          const optimalPrice = secondBidNum + tickNum;
          if (myPrice > optimalPrice + tickNum * 0.5) {
            const formattedOptimal = optimalPrice.toFixed(this.effectivePriceDecimals());
            await this.client.cancelOrder(this.currentOrderId);
            this.addLog("info", `Step-down: bid turun dari ${this.currentOrderPrice} ke ${formattedOptimal}`);
            const orderId = await this.client.placeOrder(this.config.pair, formattedOptimal, this.config.orderSize);
            this.currentOrderId = orderId;
            this.currentOrderPrice = formattedOptimal;
            this.currentOrderVolume = this.config.orderSize;
            this.topBidOwner = "bot";
            this.setLastAction(`Step-down ke ${formattedOptimal}`);
          }
        }
        this.consecutiveErrors = 0;
        return;
      }

      const targetPrice = topBidPriceNum + tickNum;

      if (targetPrice > maxPriceNum) {
        this.topBidOwner = "other";
        if (this.currentOrderId) {
          await this.client.cancelOrder(this.currentOrderId);
          this.addLog("warn", `Max price reached (${maxPriceNum}), order cancelled, bot paused`);
          this.currentOrderId = null;
          this.currentOrderPrice = null;
          this.setLastAction(`Max bid price ${maxPriceNum} reached — paused`);
        } else {
          this.addLog("warn", `Top bid ${topBidPriceNum} + tick ${tickNum} = ${targetPrice} exceeds max ${maxPriceNum}. Not placing order.`);
        }
        this.consecutiveErrors = 0;
        return;
      }

      if (this.currentOrderId) {
        await this.client.cancelOrder(this.currentOrderId);
        this.addLog("info", `Cancelled order at ${this.currentOrderPrice} — re-placing at ${targetPrice.toFixed(this.effectivePriceDecimals())}`);
        this.currentOrderId = null;
        this.currentOrderPrice = null;
      }

      const formattedPrice = targetPrice.toFixed(this.effectivePriceDecimals());
      const orderId = await this.client.placeOrder(this.config.pair, formattedPrice, this.config.orderSize);
      this.currentOrderId = orderId;
      this.currentOrderPrice = formattedPrice;
      this.currentOrderVolume = this.config.orderSize;
      this.topBidOwner = "bot";
      this.setLastAction(`Placed buy order at ${formattedPrice}`);
      this.addLog("success", `Placed buy order`, { orderId, price: formattedPrice, volume: this.config.orderSize });

      this.consecutiveErrors = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/insufficient|balance/i.test(msg)) {
        this.addLog("warn", `Saldo tidak cukup — siklus dilewati. Cek saldo akun XT.`);
        return;
      }
      // SYMBOL_005 / ORDER_008: pair tidak mendukung OpenAPI trading (openapiEnabled: false)
      if (/SYMBOL_005|ORDER_008/i.test(msg)) {
        this.addLog("error", `Pair ${this.config.pair} tidak mendukung trading via XT OpenAPI. Ganti pair atau aktifkan openapiEnabled di XT.`);
        this.circuitBreakerTripped = true;
        this.setLastAction(`Bot berhenti — pair tidak didukung OpenAPI`);
        this.stop();
        return;
      }
      this.addLog("error", `Cycle error: ${msg}`);
      this.consecutiveErrors++;
      const maxErrors = this.config.maxConsecutiveErrors ?? 5;
      if (this.consecutiveErrors >= maxErrors) {
        this.circuitBreakerTripped = true;
        this.addLog("error", `🔌 Circuit breaker: ${maxErrors} errors in a row. Bot stopped.`);
        this.setLastAction(`Circuit breaker tripped after ${maxErrors} errors`);
        void sendTelegramEvent(
          "circuitBreaker",
          `🚨 <b>[XT:${this.id}]</b> Circuit breaker aktif — ${maxErrors} error berturut-turut. Bot berhenti.\n\nError terakhir: ${msg}`
        );
        this.stop();
      }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Returns decimal places for price formatting.
   * Prefers exchange-reported pricePrecision; falls back to tickSize decimals.
   */
  private effectivePriceDecimals(): number {
    if (this.pricePrecision !== null) return this.pricePrecision;
    return this.decimalPlaces(this.config.tickSize);
  }

  private recordFill(orderId: string, price: string, volume: string): void {
    const fill: FillRecord = {
      id: ++this.fillIdCounter,
      pair: this.config.pair,
      orderId,
      price,
      volume,
      timestamp: new Date().toISOString(),
    };
    this.fills.unshift(fill);
    if (this.fills.length > 500) this.fills = this.fills.slice(0, 500);
    this.onPersist?.();

    const nilai = (parseFloat(price) * parseFloat(volume)).toFixed(2);
    void sendTelegramEvent(
      "fill",
      `✅ <b>[XT:${this.id}]</b> Order terisi — ${volume} ${this.config.pair.toUpperCase()} @ $${parseFloat(price).toLocaleString("en-US", { minimumFractionDigits: 2 })} (~$${nilai})`
    );
  }

  private addLog(level: BotLog["level"], message: string, data?: unknown): void {
    const log: BotLog = {
      id: ++this.logIdCounter,
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data !== undefined ? (typeof data === "string" ? data : JSON.stringify(data)) : null,
    };
    this.logs.unshift(log);
    if (this.logs.length > 500) this.logs = this.logs.slice(0, 500);
  }

  private setLastAction(action: string): void {
    this.lastAction = action;
    this.lastActionAt = new Date().toISOString();
  }

  private decimalPlaces(v: string): number {
    const p = v.split(".");
    return p.length > 1 ? p[1]!.length : 0;
  }
}
