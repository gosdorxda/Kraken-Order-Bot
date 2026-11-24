import { fetchMexcOrderBook, fetchMexcSymbolPrecision, MexcClient } from "./mexcClient.js";
import { sendTelegramEvent } from "./telegram.js";
import type { BotConfig, BotLog, BotStatus, FillRecord } from "./krakenBot.js";

export class MexcBot {
  readonly id: string;
  private config: BotConfig;
  private client: MexcClient;
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
  private cycleRunning = false;

  // Exchange-driven precision (fetched once on first cycle)
  private pricePrecision: number | null = null;

  constructor(id: string, config: BotConfig, onPersist?: () => void) {
    this.id = id;
    this.config = { ...config };
    this.onPersist = onPersist;
    const apiKey    = process.env["MEXC_API_KEY"]    ?? "";
    const apiSecret = process.env["MEXC_API_SECRET"] ?? "";
    this.client = new MexcClient(apiKey, apiSecret);
  }

  // ─── Public accessors ───────────────────────────────────────────────────────

  getConfig(): BotConfig {
    return { ...this.config };
  }

  setConfig(cfg: BotConfig): void {
    this.config = { ...cfg };
    this.pricePrecision = null; // reset on config change
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

    // Guard: credentials required
    if (!process.env["MEXC_API_KEY"] || !process.env["MEXC_API_SECRET"]) {
      this.addLog("error", "MEXC_API_KEY dan MEXC_API_SECRET wajib diisi. Tambahkan di environment/secrets lalu restart server.");
      return;
    }

    this.running = true;
    this.circuitBreakerTripped = false;
    this.consecutiveErrors = 0;
    this.cycleCount = 0;
    this.currentOrderId = null;
    this.currentOrderPrice = null;
    this.currentOrderVolume = null;

    this.addLog("info", `MEXC Bot started for pair ${this.config.pair}`, { config: this.config });
    void sendTelegramEvent("startStop", `▶️ <b>[MX:${this.id}]</b> Bot dimulai untuk pair <b>${this.config.pair}</b>`);

    const jitter = Math.floor(Math.random() * this.config.checkIntervalMs);
    if (jitter > 0) {
      this.addLog("info", `Stagger: menunggu ${jitter}ms sebelum cycle pertama`);
      await new Promise<void>((resolve) => setTimeout(resolve, jitter));
    }
    if (!this.running) return;
    this.intervalHandle = setInterval(() => {
      this.runCycle().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.addLog("error", "Cycle error (fatal)", msg);
        void sendTelegramEvent("circuitBreaker", `⚠️ <b>[MX:${this.id}]</b> Bot berhenti karena error tak terduga:\n${msg}`);
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
    // Wait for any in-flight cycle to finish — prevents race condition where
    // stop() runs while cycle is mid-await and currentOrderId is still null,
    // then the cycle places an order after the cancel block has already passed.
    const deadline = Date.now() + 5000;
    while (this.cycleRunning && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    if (this.currentOrderId) {
      try {
        const wasFilled = await this.cancelTrackedOrder();
        if (wasFilled) {
          this.addLog("info", "Order terisi saat bot dihentikan — fill telah dicatat.");
        } else {
          this.addLog("info", `Cancelled order ${this.currentOrderId} on stop`);
        }
      } catch (err) {
        this.addLog("warn", `Could not cancel order on stop: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.currentOrderId = null;
      this.currentOrderPrice = null;
      this.currentOrderVolume = null;
    }
    // Safety net: cancel ALL open buy orders for this pair on MEXC.
    // Guards against race condition where currentOrderId was null when stop() ran
    // but an order was placed by the in-flight cycle just before it was cleared.
    try {
      await this.client.cancelAllOpenBuyOrders(this.config.pair);
    } catch (err) {
      this.addLog("warn", `Safety-net cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.topBidOwner = "none";
    this.topBidPrice = null;
    this.addLog("info", "MEXC Bot stopped");
    void sendTelegramEvent("startStop", `⏹️ <b>[MX:${this.id}]</b> Bot dihentikan untuk pair <b>${this.config.pair}</b>`);
    this.onPersist?.();
  }

  // ─── Cycle ──────────────────────────────────────────────────────────────────

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    this.cycleCount++;

    try {
      // Bootstrap: fetch exchange-driven precision on the first cycle
      if (this.pricePrecision === null) {
        const prec = await fetchMexcSymbolPrecision(this.config.pair);
        this.pricePrecision = prec.pricePrecision;
        this.addLog("info", `Symbol precision loaded: price=${this.pricePrecision}`);
      }

      const book = await fetchMexcOrderBook(this.config.pair);
      const topBid = book.bids[0];
      if (!topBid) {
        this.addLog("warn", "Empty order book, skipping cycle");
        return;
      }

      this.topBidPrice = topBid.price;
      const topBidPriceNum = parseFloat(topBid.price);
      const maxPriceNum    = parseFloat(this.config.maxBidPrice);
      const tickNum        = parseFloat(this.config.tickSize);

      let myOrderIsAtTop = false;

      if (this.currentOrderId) {
        const orderStatus = await this.client.getOrder(this.currentOrderId, this.config.pair);
        if (!orderStatus.isOpen) {
          if (orderStatus.reason === "filled") {
            const filledOrderId  = this.currentOrderId;
            const filledPrice    = this.currentOrderPrice ?? "0";
            const configVolume   = this.currentOrderVolume ?? this.config.orderSize;
            const actualVolume   = orderStatus.executedQty ?? configVolume;
            const isPartial      = parseFloat(actualVolume) < parseFloat(configVolume) * 0.9995;

            this.addLog("success", `Order ${filledOrderId} ${isPartial ? "partial fill" : "was filled!"}`, { price: filledPrice, executedQty: actualVolume });
            this.recordFill(filledOrderId, filledPrice, actualVolume, isPartial);

            this.currentOrderId    = null;
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
              this.addLog("warn", `Order ${staleId} tidak ditemukan di MEXC — mencoba cancel sebelum re-place`);
              await this.client.cancelOrder(this.config.pair, staleId);
            } else {
              this.addLog("warn", `Order ${staleId} dibatalkan/expired — akan re-place di siklus berikutnya`);
            }
            this.currentOrderId    = null;
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
        const myPrice   = parseFloat(this.currentOrderPrice ?? "0");
        if (secondBid) {
          const secondBidNum   = parseFloat(secondBid.price);
          const optimalPrice   = secondBidNum + tickNum;
          if (myPrice > optimalPrice + tickNum * 0.5) {
            const formattedOptimal = optimalPrice.toFixed(this.effectivePriceDecimals());
            const prevPrice = this.currentOrderPrice;
            const wasFilled = await this.cancelTrackedOrder();
            this.currentOrderId    = null;
            this.currentOrderPrice = null;
            this.currentOrderVolume = null;
            if (wasFilled) {
              this.setLastAction(`Order terisi saat step-down — fill dicatat`);
              this.consecutiveErrors = 0;
              return;
            }
            this.addLog("info", `Step-down: bid turun dari ${prevPrice} ke ${formattedOptimal}`);
            const orderId = await this.client.placeOrder(this.config.pair, formattedOptimal, this.config.orderSize);
            this.currentOrderId    = orderId;
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

        if (this.config.holdAtMax) {
          const holdFormatted = maxPriceNum.toFixed(this.effectivePriceDecimals());

          if (this.currentOrderId && this.currentOrderPrice === holdFormatted) {
            this.setLastAction(`Hold at max ${holdFormatted} (saingan lebih tinggi)`);
            this.consecutiveErrors = 0;
            return;
          }

          if (this.currentOrderId) {
            const wasFilled = await this.cancelTrackedOrder();
            this.currentOrderId    = null;
            this.currentOrderPrice = null;
            this.currentOrderVolume = null;
            if (wasFilled) {
              this.setLastAction(`Order terisi saat hold-at-max — fill dicatat`);
              this.consecutiveErrors = 0;
              return;
            }
          }

          const orderId = await this.client.placeOrder(this.config.pair, holdFormatted, this.config.orderSize);
          this.currentOrderId    = orderId;
          this.currentOrderPrice = holdFormatted;
          this.currentOrderVolume = this.config.orderSize;
          this.addLog("info", `Hold at max: order di ${holdFormatted}`, { orderId, price: holdFormatted, volume: this.config.orderSize });
          this.setLastAction(`Hold at max — order di ${holdFormatted}`);
          this.consecutiveErrors = 0;
          return;
        }

        if (this.currentOrderId) {
          const prevPrice = this.currentOrderPrice;
          const wasFilled = await this.cancelTrackedOrder();
          this.currentOrderId    = null;
          this.currentOrderPrice = null;
          this.currentOrderVolume = null;
          if (wasFilled) {
            this.setLastAction(`Order terisi saat max price — fill dicatat`);
          } else {
            this.addLog("warn", `Max price reached (${maxPriceNum}), order ${prevPrice} dibatalkan, bot pause`);
            this.setLastAction(`Max bid price ${maxPriceNum} reached — paused`);
          }
        } else {
          this.addLog("warn", `Top bid ${topBidPriceNum} + tick ${tickNum} = ${targetPrice} exceeds max ${maxPriceNum}. Not placing order.`);
        }
        this.consecutiveErrors = 0;
        return;
      }

      if (this.currentOrderId) {
        const prevPrice = this.currentOrderPrice;
        const wasFilled = await this.cancelTrackedOrder();
        this.currentOrderId    = null;
        this.currentOrderPrice = null;
        this.currentOrderVolume = null;
        if (wasFilled) {
          this.setLastAction(`Order terisi saat outbid — fill dicatat`);
          this.consecutiveErrors = 0;
          return;
        }
        this.addLog("info", `Cancelled order at ${prevPrice} — re-placing at ${targetPrice.toFixed(this.effectivePriceDecimals())}`);
      }

      const formattedPrice = targetPrice.toFixed(this.effectivePriceDecimals());
      const orderId = await this.client.placeOrder(this.config.pair, formattedPrice, this.config.orderSize);
      this.currentOrderId    = orderId;
      this.currentOrderPrice = formattedPrice;
      this.currentOrderVolume = this.config.orderSize;
      this.topBidOwner = "bot";
      this.setLastAction(`Placed buy order at ${formattedPrice}`);
      this.addLog("success", `Placed buy order`, { orderId, price: formattedPrice, volume: this.config.orderSize });

      this.consecutiveErrors = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/insufficient|balance|saldo|-2010/i.test(msg)) {
        this.addLog("warn", `Saldo tidak cukup — siklus dilewati. Cek saldo akun MEXC.`);
        return;
      }
      if (/-1013|filter|LOT_SIZE|MIN_NOTIONAL|PRICE_FILTER/i.test(msg)) {
        // Order violates an exchange filter (too small value, bad precision) —
        // transient market condition — skip silently, do not count toward circuit breaker.
        this.addLog("warn", `Order ditolak filter exchange (nilai terlalu kecil / presisi). Naikkan orderSize atau sesuaikan tickSize.`);
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
          `🚨 <b>[MX:${this.id}]</b> Circuit breaker aktif — ${maxErrors} error berturut-turut. Bot berhenti.\n\nError terakhir: ${msg}`
        );
        this.stop();
      }
    } finally {
      this.cycleRunning = false;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Cancel the currently-tracked order and detect if it was filled first.
   * Returns true if a FULL fill was detected; false otherwise (re-place order).
   * Partial fills are recorded but still return false.
   * Does NOT mutate currentOrderId/Price/Volume — callers must clear state.
   */
  private async cancelTrackedOrder(): Promise<boolean> {
    if (!this.currentOrderId) return false;
    const orderId      = this.currentOrderId;
    const price        = this.currentOrderPrice  ?? "0";
    const configVolume = this.currentOrderVolume ?? this.config.orderSize;

    // Check status first
    const status = await this.client.getOrder(orderId, this.config.pair);

    if (!status.isOpen && status.reason === "filled") {
      const actualVolume = status.executedQty ?? configVolume;
      const isPartial    = parseFloat(actualVolume) < parseFloat(configVolume) * 0.9995;
      this.addLog("success", `Order ${orderId} ${isPartial ? "partial fill" : "terisi"} (terdeteksi saat cancel)`, { price, executedQty: actualVolume });
      this.recordFill(orderId, price, actualVolume, isPartial);
      return !isPartial;
    }

    // Already cancelled externally with partial fill
    if (!status.isOpen && status.reason === "canceled" && status.executedQty) {
      this.addLog("success", `Order ${orderId} partial fill ${status.executedQty} sebelum dibatalkan`, { price });
      this.recordFill(orderId, price, status.executedQty, true);
      return false;
    }

    // Open (new or partially_filled) — cancel it; capture partial qty before it's gone
    const partialQty = status.executedQty;
    await this.client.cancelOrder(this.config.pair, orderId);
    if (partialQty) {
      this.addLog("success", `Order ${orderId} partial fill ${partialQty} sebelum dibatalkan`, { price });
      this.recordFill(orderId, price, partialQty, true);
    }
    return false;
  }

  private effectivePriceDecimals(): number {
    if (this.pricePrecision !== null) return this.pricePrecision;
    return this.decimalPlaces(this.config.tickSize);
  }

  private recordFill(orderId: string, price: string, volume: string, partial = false): void {
    const fill: FillRecord = {
      id: ++this.fillIdCounter,
      pair: this.config.pair,
      orderId,
      price,
      volume,
      timestamp: new Date().toISOString(),
      partial: partial || undefined,
    };
    this.fills.unshift(fill);
    if (this.fills.length > 500) this.fills = this.fills.slice(0, 500);
    this.onPersist?.();

    const nilai      = (parseFloat(price) * parseFloat(volume)).toFixed(2);
    const icon       = partial ? "🔶" : "✅";
    const label      = partial ? "Partial fill" : "Order terisi";
    const volDisplay = partial ? `${volume}/${this.config.orderSize}` : volume;
    void sendTelegramEvent(
      "fill",
      `${icon} <b>[MX:${this.id}]</b> ${label} — ${volDisplay} ${this.config.pair.toUpperCase()} @ $${parseFloat(price).toLocaleString("en-US", { minimumFractionDigits: 2 })} (~$${nilai})`
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