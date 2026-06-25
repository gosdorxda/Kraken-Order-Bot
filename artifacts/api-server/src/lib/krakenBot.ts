import KrakenClient from "kraken-api";
import { logger } from "./logger";
import { krakenRateLimiter } from "./krakenRateLimiter";
import { sendTelegramEvent } from "./telegram.js";

export interface BotConfig {
  pair: string;
  orderSize: string;
  maxBidPrice: string;
  tickSize: string;
  checkIntervalMs: number;
  oneShotMode: boolean;
  holdAtMax?: boolean;
  maxConsecutiveErrors: number;
  exchange?: "kraken" | "xt" | "bitmart";
}

export interface BotLog {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  data: string | null;
}

export interface FillRecord {
  id: number;
  pair: string;
  orderId: string;
  price: string;
  volume: string;
  timestamp: string;
  partial?: boolean;
}

export interface BotStatus {
  running: boolean;
  currentOrderId: string | null;
  currentOrderPrice: string | null;
  currentOrderVolume: string | null;
  topBidPrice: string | null;
  topBidOwner: "bot" | "other" | "none";
  cycleCount: number;
  lastAction: string | null;
  lastActionAt: string | null;
  circuitBreakerTripped: boolean;
  consecutiveErrors: number;
}

// ─── Shared Kraken client ─────────────────────────────────────────────────────

const sharedClient: KrakenClient = (() => {
  const apiKey = process.env["KRAKEN_API_KEY"] ?? "";
  const apiSecret = process.env["KRAKEN_API_SECRET"] ?? "";
  return new KrakenClient(apiKey, apiSecret);
})();

// ─── Shared OpenOrders cache ──────────────────────────────────────────────────
// One OpenOrders API call is shared across all KrakenBot instances, refreshed
// every 5 seconds. Eliminates per-bot QueryOrders calls during normal polling:
// N calls per cycle → 1 shared call regardless of how many bots are running.

const OPEN_ORDERS_CACHE_TTL_MS = 5_000;

const openOrdersCache = {
  orders: {} as Record<string, unknown>,
  fetchedAt: 0,
  inFlight: null as Promise<Record<string, unknown>> | null,
};

function invalidateOpenOrdersCache(): void {
  openOrdersCache.fetchedAt = 0;
}

async function getOpenOrdersCached(): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (now - openOrdersCache.fetchedAt < OPEN_ORDERS_CACHE_TTL_MS) {
    return openOrdersCache.orders;
  }
  if (openOrdersCache.inFlight) return openOrdersCache.inFlight;
  openOrdersCache.inFlight = krakenRateLimiter
    .enqueue(() => (sharedClient as any).api("OpenOrders", {}), "OpenOrders(cache)")
    .then((resp: any) => {
      openOrdersCache.orders = (resp.result?.open ?? {}) as Record<string, unknown>;
      openOrdersCache.fetchedAt = Date.now();
      openOrdersCache.inFlight = null;
      return openOrdersCache.orders;
    })
    .catch((err: unknown) => {
      openOrdersCache.inFlight = null;
      throw err;
    });
  return openOrdersCache.inFlight;
}

export async function fetchOrderBook(
  pair: string
): Promise<{ bids: { price: string; volume: string }[]; asks: { price: string; volume: string }[] }> {
  const resp: any = await krakenRateLimiter.enqueue(
    () => (sharedClient as any).api("Depth", { pair, count: 10 }),
    `Depth(${pair})`
  );
  const data = resp.result[Object.keys(resp.result)[0]];
  return {
    bids: (data.bids as [string, string][]).map(([price, volume]) => ({ price, volume })),
    asks: (data.asks as [string, string][]).map(([price, volume]) => ({ price, volume })),
  };
}

export async function fetchBalance(): Promise<Record<string, string>> {
  const resp: any = await krakenRateLimiter.enqueue(
    () => (sharedClient as any).api("Balance", {}),
    "Balance"
  );
  return resp.result as Record<string, string>;
}

export async function fetchLockedZusd(): Promise<string> {
  const resp: any = await krakenRateLimiter.enqueue(
    () => (sharedClient as any).api("OpenOrders", {}),
    "OpenOrders(balance)"
  );
  const orders: Record<string, any> = resp.result?.open ?? {};
  let locked = 0;
  for (const order of Object.values(orders)) {
    if (order.descr?.type !== "buy") continue;
    if (!String(order.descr?.pair ?? "").endsWith("USD")) continue;
    const price     = parseFloat(order.descr?.price ?? "0");
    const vol       = parseFloat(order.vol      ?? "0");
    const volExec   = parseFloat(order.vol_exec ?? "0");
    const remaining = vol - volExec;
    if (remaining > 0 && price > 0) locked += remaining * price;
  }
  return locked.toFixed(4);
}

/**
 * Cancel ALL open buy orders on Kraken for the given pairs in one shot.
 * Call this ONCE in BotManager before starting any bots so rolling restarts
 * cannot leave orphan orders behind.
 */
export async function cancelAllOpenBuyOrders(pairs: string[]): Promise<void> {
  const pairSet = new Set(pairs);
  try {
    const resp: any = await krakenRateLimiter.enqueue(
      () => (sharedClient as any).api("OpenOrders", {}),
      "OpenOrders(startup-cleanup)"
    );
    const orders: Record<string, any> = resp.result?.open ?? {};
    const toCancel = Object.entries(orders).filter(
      ([, o]) => o.descr?.type === "buy" && pairSet.has(o.descr?.pair)
    );
    if (toCancel.length === 0) return;
    process.stderr.write(`[startup] Cancelling ${toCancel.length} stale open buy order(s) for pairs: ${pairs.join(", ")}\n`);
    for (const [txid] of toCancel) {
      try {
        await krakenRateLimiter.enqueue(
          () => (sharedClient as any).api("CancelOrder", { txid }),
          `CancelOrder(${txid})`
        );
        process.stderr.write(`[startup] Cancelled stale order ${txid}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/unknown order/i.test(msg)) {
          process.stderr.write(`[startup] Failed to cancel ${txid}: ${msg}\n`);
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[startup] cancelAllOpenBuyOrders failed: ${String(err)}\n`);
  }
}

/**
 * Emergency: cancel ALL open buy orders on Kraken across ALL pairs.
 * No pair filter — nuclear option for when the user needs to stop everything.
 * Returns count of orders cancelled.
 */
export async function emergencyCancelAllKrakenBuyOrders(): Promise<{ cancelled: number }> {
  let cancelled = 0;
  try {
    const resp: any = await krakenRateLimiter.enqueue(
      () => (sharedClient as any).api("OpenOrders", {}),
      "OpenOrders(emergency)"
    );
    const orders: Record<string, any> = resp.result?.open ?? {};
    const toCancel = Object.entries(orders).filter(([, o]) => o.descr?.type === "buy");
    if (toCancel.length === 0) return { cancelled: 0 };
    for (const [txid] of toCancel) {
      try {
        await krakenRateLimiter.enqueue(
          () => (sharedClient as any).api("CancelOrder", { txid }),
          `CancelOrder(emergency:${txid})`
        );
        cancelled++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/unknown order/i.test(msg)) {
          process.stderr.write(`[emergency] Failed to cancel ${txid}: ${msg}\n`);
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[emergency] emergencyCancelAllKrakenBuyOrders failed: ${String(err)}\n`);
  }
  return { cancelled };
}

export interface MarketTicker {
  pair: string;
  displayName: string;
  bid: string;
  ask: string;
  last: string;
  open24h: string;
  change24h: number;
  spread: string;
  spreadPct: number;
  volume24h: string;
  high24h: string;
  low24h: string;
}

let marketCache: { data: MarketTicker[]; fetchedAt: number } | null = null;
const MARKET_CACHE_TTL_MS = 10_000;

export async function fetchMarket(): Promise<MarketTicker[]> {
  if (marketCache && Date.now() - marketCache.fetchedAt < MARKET_CACHE_TTL_MS) {
    return marketCache.data;
  }

  const pairsResp: any = await krakenRateLimiter.enqueue(
    () => (sharedClient as any).api("AssetPairs", {}),
    "AssetPairs"
  );

  const usdPairs = Object.entries(pairsResp.result as Record<string, any>).filter(
    ([, info]) =>
      info.status === "online" &&
      typeof info.wsname === "string" &&
      info.wsname.endsWith("/USD")
  );

  if (usdPairs.length === 0) return [];

  const pairNames = usdPairs.map(([name]) => name).join(",");
  const tickerResp: any = await krakenRateLimiter.enqueue(
    () => (sharedClient as any).api("Ticker", { pair: pairNames }),
    "Ticker(USD)"
  );

  const result: MarketTicker[] = [];
  for (const [krakenKey, info] of usdPairs) {
    const ticker = tickerResp.result[krakenKey];
    if (!ticker) continue;

    const bid = parseFloat(ticker.b[0]);
    const ask = parseFloat(ticker.a[0]);
    const spread = ask - bid;
    const mid = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const dp: number = (info as any).pair_decimals ?? 2;

    const lastPrice = parseFloat(ticker.c[0]);
    const openPrice = parseFloat(ticker.o);
    const change24h = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;

    result.push({
      pair: krakenKey,
      displayName: (info as any).wsname as string,
      bid: ticker.b[0],
      ask: ticker.a[0],
      last: ticker.c[0],
      open24h: ticker.o,
      change24h: Math.round(change24h * 1000) / 1000,
      spread: spread.toFixed(dp),
      spreadPct: Math.round(spreadPct * 100000) / 100000,
      volume24h: (parseFloat(ticker.v[1]) * lastPrice).toFixed(0),
      high24h: ticker.h[1],
      low24h: ticker.l[1],
    });
  }

  marketCache = { data: result, fetchedAt: Date.now() };
  return result;
}

// ─── KrakenBot ────────────────────────────────────────────────────────────────

export class KrakenBot {
  readonly id: string;
  private config: BotConfig;
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
  private consecutiveInsufficientFunds = 0;
  private circuitBreakerTripped = false;
  private cycleRunning = false;

  constructor(id: string, config: BotConfig, onPersist?: () => void) {
    this.id = id;
    this.config = { ...config };
    this.onPersist = onPersist;
  }

  // ─── Public accessors ───────────────────────────────────────────────────────

  getConfig(): BotConfig {
    return { ...this.config };
  }

  setConfig(cfg: BotConfig): void {
    this.config = { ...cfg };
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
    if (!process.env["KRAKEN_API_KEY"] || !process.env["KRAKEN_API_SECRET"]) {
      this.addLog("error", "KRAKEN_API_KEY dan KRAKEN_API_SECRET wajib diisi. Tambahkan di Replit Secrets lalu restart server.");
      return;
    }
    this.running = true;
    this.circuitBreakerTripped = false;
    this.consecutiveErrors = 0;
    this.consecutiveInsufficientFunds = 0;
    this.cycleCount = 0;
    this.currentOrderId = null;
    this.currentOrderPrice = null;
    this.currentOrderVolume = null;
    this.addLog("info", `Bot started for pair ${this.config.pair}`, { config: this.config });
    void sendTelegramEvent("startStop", `▶️ <b>[${this.id}]</b> Bot dimulai untuk pair <b>${this.config.pair}</b>`);
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
        void sendTelegramEvent("circuitBreaker", `⚠️ <b>[${this.id}]</b> Bot berhenti karena error tak terduga:\n${msg}`);
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
    await this.cancelStaleOpenOrders();
    this.topBidOwner = "none";
    this.topBidPrice = null;
    this.addLog("info", "Bot stopped");
    void sendTelegramEvent("startStop", `⏹️ <b>[${this.id}]</b> Bot dihentikan untuk pair <b>${this.config.pair}</b>`);
    this.onPersist?.();
  }

  // ─── Cycle ──────────────────────────────────────────────────────────────────

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      await this.runCycleInner();
    } finally {
      this.cycleRunning = false;
    }
  }

  private async runCycleInner(): Promise<void> {
    if (!this.running) return;
    this.cycleCount++;

    try {
      const book = await fetchOrderBook(this.config.pair);
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
          if (orderStatus.reason === "filled") {
            const filledOrderId  = this.currentOrderId;
            const filledPrice    = this.currentOrderPrice ?? "0";
            const configVolume   = this.currentOrderVolume ?? this.config.orderSize;
            const actualVolume   = orderStatus.executedQty ?? configVolume;
            const isPartial      = parseFloat(actualVolume) < parseFloat(configVolume) * 0.9995;

            this.addLog("success", `Order ${filledOrderId} ${isPartial ? "partial fill" : "was filled!"}`, { price: filledPrice, executedQty: actualVolume });
            this.recordFill(filledOrderId, filledPrice, actualVolume, isPartial);

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
            // Order is not open (canceled, expired, or not found on Kraken).
            // For "unknown": the order may still be open (e.g. QueryOrders
            // returned null for a freshly-placed order). Cancel it first to
            // prevent duplicate open orders before clearing our tracking state.
            // For "canceled"/"expired": Kraken already closed it; no cancel needed.
            const staleId = this.currentOrderId;
            if (orderStatus.reason === "unknown") {
              this.addLog("warn", `Order ${staleId} tidak ditemukan di Kraken — mencoba cancel untuk keamanan sebelum re-place`);
              await this.cancelOrder(staleId); // no-op if already gone
            } else {
              const reasonLabel = orderStatus.reason === "canceled" ? "dibatalkan Kraken" : "expired di Kraken";
              this.addLog("warn", `Order ${staleId} ${reasonLabel} — akan re-place di siklus berikutnya`);
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
        // Step-down: if there's a gap between our price and the second-best bid,
        // move our order down to secondBid + tick to avoid overpaying.
        const secondBid = book.bids[1];
        const myPrice = parseFloat(this.currentOrderPrice ?? "0");
        if (secondBid) {
          const secondBidNum = parseFloat(secondBid.price);
          const optimalPrice = secondBidNum + tickNum;
          const gapInTicks = Math.round((myPrice - optimalPrice) / tickNum);
          if (gapInTicks >= 4) {
            const formattedOptimal = optimalPrice.toFixed(this.decimalPlaces(this.config.tickSize));
            const prevPrice = this.currentOrderPrice;
            const wasFilled = await this.cancelTrackedOrder();
            this.currentOrderId = null;
            this.currentOrderPrice = null;
            this.currentOrderVolume = null;
            if (wasFilled) {
              this.setLastAction(`Order terisi saat step-down — fill dicatat`);
              this.consecutiveErrors = 0;
              return;
            }
            this.addLog("info", `Step-down: bid turun dari ${prevPrice} ke ${formattedOptimal} (bid kedua: ${secondBid.price})`);
            const volume = await this.calculateVolume(optimalPrice);
            const orderId = await this.placeOrder(this.config.pair, formattedOptimal, volume);
            this.currentOrderId = orderId;
            this.currentOrderPrice = formattedOptimal;
            this.currentOrderVolume = volume;
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
        const dp = this.decimalPlaces(this.config.tickSize);

        if (this.config.holdAtMax) {
          const holdFormatted = maxPriceNum.toFixed(dp);

          if (this.currentOrderId && this.currentOrderPrice === holdFormatted) {
            this.setLastAction(`Hold at max ${holdFormatted} (saingan lebih tinggi)`);
            this.consecutiveErrors = 0;
            return;
          }

          if (this.currentOrderId) {
            const wasFilled = await this.cancelTrackedOrder();
            this.currentOrderId = null;
            this.currentOrderPrice = null;
            this.currentOrderVolume = null;
            if (wasFilled) {
              this.setLastAction(`Order terisi saat hold-at-max — fill dicatat`);
              this.consecutiveErrors = 0;
              return;
            }
          }

          const volume = await this.calculateVolume(maxPriceNum);
          const orderId = await this.placeOrder(this.config.pair, holdFormatted, volume);
          this.currentOrderId = orderId;
          this.currentOrderPrice = holdFormatted;
          this.currentOrderVolume = volume;
          this.addLog("info", `Hold at max: order di ${holdFormatted}`, { orderId, price: holdFormatted, volume });
          this.setLastAction(`Hold at max — order di ${holdFormatted}`);
          this.consecutiveErrors = 0;
          return;
        }

        if (this.currentOrderId) {
          const prevPrice = this.currentOrderPrice;
          const wasFilled = await this.cancelTrackedOrder();
          this.currentOrderId = null;
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
        const dp = this.decimalPlaces(this.config.tickSize);
        const wasFilled = await this.cancelTrackedOrder();
        this.currentOrderId = null;
        this.currentOrderPrice = null;
        this.currentOrderVolume = null;
        if (wasFilled) {
          this.setLastAction(`Order terisi saat outbid — fill dicatat`);
          this.consecutiveErrors = 0;
          return;
        }
        this.addLog("info", `Cancelled order at ${prevPrice} — re-placing at ${targetPrice.toFixed(dp)}`);
      }

      const formattedPrice = targetPrice.toFixed(this.decimalPlaces(this.config.tickSize));
      const volume = await this.calculateVolume(targetPrice);
      const orderId = await this.placeOrder(this.config.pair, formattedPrice, volume);
      this.currentOrderId = orderId;
      this.currentOrderPrice = formattedPrice;
      this.currentOrderVolume = volume;
      this.topBidOwner = "bot";
      this.setLastAction(`Placed buy order at ${formattedPrice}`);
      this.addLog("success", `Placed buy order`, { orderId, price: formattedPrice, volume });

      this.consecutiveErrors = 0;
      this.consecutiveInsufficientFunds = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/insufficient funds/i.test(msg)) {
        this.consecutiveInsufficientFunds++;
        this.addLog("warn", `Saldo ZUSD tidak cukup — siklus dilewati. Cek saldo akun Kraken.`);
        if (this.consecutiveInsufficientFunds >= 5) {
          this.addLog("error", `Saldo tidak cukup 5x berturut-turut — bot dihentikan otomatis.`);
          this.setLastAction("Auto-stop: saldo tidak cukup berulang");
          void sendTelegramEvent(
            "circuitBreaker",
            `⚠️ <b>[${this.id}]</b> Bot dihentikan otomatis — saldo ZUSD tidak cukup 5x berturut-turut.`
          );
          this.stop();
        }
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
          `🚨 <b>[${this.id}]</b> Circuit breaker aktif — ${maxErrors} error berturut-turut. Bot berhenti.\n\nError terakhir: ${msg}`
        );
        this.stop();
      }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

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
    const symbol     = this.config.pair.replace(/^X|ZUSD$|USD$/g, "");
    const icon       = partial ? "🔶" : "✅";
    const label      = partial ? "Partial fill" : "Order terisi";
    const volDisplay = partial ? `${volume}/${this.config.orderSize}` : volume;
    void sendTelegramEvent(
      "fill",
      `${icon} <b>[${this.id}]</b> ${label} — ${volDisplay} ${symbol} @ $${parseFloat(price).toLocaleString("en-US", { minimumFractionDigits: 2 })} (~$${nilai})`
    );
  }

  private async calculateVolume(_targetPrice: number): Promise<string> {
    return this.config.orderSize;
  }

  private async cancelStaleOpenOrders(): Promise<void> {
    try {
      const resp: any = await krakenRateLimiter.enqueue(
        () => (sharedClient as any).api("OpenOrders", {}),
        "OpenOrders"
      );
      const orders: Record<string, any> = resp.result?.open ?? {};
      const stale = Object.entries(orders).filter(
        ([, o]) => o.descr?.pair === this.config.pair && o.descr?.type === "buy"
      );
      if (stale.length === 0) return;
      this.addLog("warn", `Ditemukan ${stale.length} order terbuka di Kraken untuk ${this.config.pair} — membatalkan sebelum mulai`);
      for (const [txid] of stale) {
        try {
          await this.cancelOrder(txid);
          this.addLog("info", `Order stale ${txid} dibatalkan`);
        } catch (err) {
          this.addLog("warn", `Gagal batalkan order stale ${txid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      this.addLog("warn", `Gagal cek open orders saat start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async cancelOrder(orderId: string): Promise<"cancelled" | "already_gone"> {
    try {
      const resp: any = await krakenRateLimiter.enqueue(
        () => (sharedClient as any).api("CancelOrder", { txid: orderId }),
        `CancelOrder(${orderId})`
      );
      // Invalidate cache so the post-cancel checkOrderOpen fetches fresh data
      invalidateOpenOrdersCache();
      return (resp.result?.count ?? 0) > 0 ? "cancelled" : "already_gone";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown order/i.test(msg)) return "already_gone";
      throw err;
    }
  }

  /**
   * Cancel the currently-tracked order and check if it was filled before we
   * could cancel it.  Returns true if a FULL fill was detected (and recorded).
   * Partial fills are recorded but still return false (bot re-places order).
   * Does NOT mutate currentOrderId/Price/Volume — callers must clear state.
   */
  private async cancelTrackedOrder(): Promise<boolean> {
    if (!this.currentOrderId) return false;
    const orderId      = this.currentOrderId;
    const price        = this.currentOrderPrice  ?? "0";
    const configVolume = this.currentOrderVolume ?? this.config.orderSize;

    const cancelResult = await this.cancelOrder(orderId);

    // Always query final state to detect full or partial fills
    const finalStatus = await this.checkOrderOpen(orderId);

    if (!finalStatus.isOpen && finalStatus.reason === "filled") {
      const actualVolume = finalStatus.executedQty ?? configVolume;
      const isPartial   = parseFloat(actualVolume) < parseFloat(configVolume) * 0.9995;
      this.addLog("success", `Order ${orderId} ${isPartial ? "partial fill" : "terisi"} (terdeteksi saat cancel)`, { price, executedQty: actualVolume });
      this.recordFill(orderId, price, actualVolume, isPartial);
      return !isPartial;
    }

    // Cancelled (or unknown) — check for partial fill
    if (finalStatus.executedQty) {
      this.addLog("success", `Order ${orderId} partial fill ${finalStatus.executedQty} sebelum dibatalkan`, { price });
      this.recordFill(orderId, price, finalStatus.executedQty, true);
    }

    // Suppress unused-variable warning when cancelResult is not checked explicitly
    void cancelResult;
    return false;
  }

  private async checkOrderOpen(
    orderId: string
  ): Promise<{ isOpen: true; executedQty?: string } | { isOpen: false; reason: "filled" | "canceled" | "expired" | "unknown"; executedQty?: string }> {
    try {
      // Fast path: shared OpenOrders cache (one API call serves all bots)
      const openOrders = await getOpenOrdersCached();
      const cached = openOrders[orderId] as any | undefined;
      if (cached) {
        const rawExec = cached.vol_exec;
        const executedQty = rawExec != null && parseFloat(String(rawExec)) > 0 ? String(rawExec) : undefined;
        return { isOpen: true, executedQty };
      }

      // Not in open orders — call QueryOrders to get exact status (filled/cancelled/expired)
      const resp: any = await krakenRateLimiter.enqueue(
        () => (sharedClient as any).api("QueryOrders", { txid: orderId, trades: false }),
        `QueryOrders(${orderId})`
      );
      const order = resp.result?.[orderId];
      if (!order) return { isOpen: false, reason: "unknown" };
      const rawExec = order.vol_exec;
      const executedQty = rawExec != null && parseFloat(String(rawExec)) > 0 ? String(rawExec) : undefined;
      if (["open", "pending"].includes(order.status)) return { isOpen: true, executedQty };
      if (order.status === "canceled") return { isOpen: false, reason: "canceled", executedQty };
      if (order.status === "expired") return { isOpen: false, reason: "expired", executedQty };
      return { isOpen: false, reason: "filled", executedQty };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown order/i.test(msg)) {
        this.addLog("info", `Order ${orderId} not found on Kraken — assumed cancelled`);
        return { isOpen: false, reason: "unknown" };
      }
      throw err;
    }
  }

  private async placeOrder(pair: string, price: string, volume: string): Promise<string> {
    const resp: any = await krakenRateLimiter.enqueue(
      () =>
        (sharedClient as any).api("AddOrder", {
          pair,
          type: "buy",
          ordertype: "limit",
          price,
          volume,
        }),
      `AddOrder(${pair}@${price})`
    );
    const txids: string[] = resp.result?.txid ?? [];
    if (!txids.length) throw new Error("No order ID returned from Kraken");
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

  private addLog(level: BotLog["level"], message: string, data?: unknown): void {
    const entry: BotLog = {
      id: ++this.logIdCounter,
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data != null ? JSON.stringify(data) : null,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs = this.logs.slice(0, 500);
    logger.info({ botId: this.id, botLog: entry }, message);
  }
}
