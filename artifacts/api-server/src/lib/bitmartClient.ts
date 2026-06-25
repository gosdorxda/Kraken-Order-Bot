import { createHmac } from "crypto";
import { logger } from "./logger";

const BASE_URL = "https://api-cloud.bitmart.com";

function signMessage(secret: string, timestamp: number, memo: string, payload: string): string {
  // BitMart sign format: HMAC-SHA256("timestamp#memo#payload")
  const message = `${timestamp}#${memo}#${payload}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

export interface BitmartOrderBookLevel {
  price: string;
  volume: string;
}

/**
 * Fetch public order book from BitMart.
 * Response data.bids = bids (desc), data.asks = asks (asc).
 * Each entry: [price, size]
 */
export async function fetchBitmartOrderBook(
  symbol: string,
  limit = 10
): Promise<{ bids: BitmartOrderBookLevel[]; asks: BitmartOrderBookLevel[] }> {
  const qs = `symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
  const resp = await fetch(`${BASE_URL}/spot/quotation/v3/books?${qs}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`BitMart order book API error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as any;
  if (json.code !== 1000) throw new Error(`BitMart order book: code=${json.code} ${json.message}`);
  const data = json?.data ?? {};
  const bids: string[][] = data.bids ?? [];
  const asks: string[][] = data.asks ?? [];
  return {
    bids: bids.map(([price, vol]) => ({ price, volume: vol })),
    asks: asks.map(([price, vol]) => ({ price, volume: vol })),
  };
}

/**
 * Fetch price precision for a BitMart symbol from the public symbols/details endpoint.
 * Falls back to {pricePrecision: 8} on error.
 */
export async function fetchBitmartSymbolPrecision(
  symbol: string
): Promise<{ pricePrecision: number }> {
  try {
    const resp = await fetch(
      `${BASE_URL}/spot/v1/symbols/details`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!resp.ok) return { pricePrecision: 8 };
    const json = (await resp.json()) as any;
    const symbols: any[] = json?.data?.symbols ?? [];
    const s = symbols.find((x: any) => x.symbol === symbol);
    const prec = s?.price_max_precision ?? s?.priceMaxPrecision ?? s?.price_min_precision;
    return { pricePrecision: typeof prec === "number" ? prec : 8 };
  } catch {
    return { pricePrecision: 8 };
  }
}

export class BitmartClient {
  private apiKey: string;
  private apiSecret: string;
  private memo: string;

  constructor(apiKey: string, apiSecret: string, memo = "") {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.memo = memo;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    queryParams: Record<string, string> = {},
    body?: Record<string, unknown>
  ): Promise<T> {
    const timestamp = Date.now();
    const queryString = Object.keys(queryParams).length > 0
      ? Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    const bodyString = body != null ? JSON.stringify(body) : "";
    const payload = method === "GET" ? queryString : bodyString;
    const signature = signMessage(this.apiSecret, timestamp, this.memo, payload);

    const headers: Record<string, string> = {
      "X-BM-KEY": this.apiKey,
      "X-BM-SIGN": signature,
      "X-BM-TIMESTAMP": String(timestamp),
      "Content-Type": "application/json",
    };
    if (this.memo) headers["X-BM-MEMO"] = this.memo;

    let url = `${BASE_URL}${path}`;
    if (queryString) url += `?${queryString}`;

    const resp = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? bodyString : undefined,
      signal: AbortSignal.timeout(12_000),
    });

    const text = await resp.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`BitMart non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
    }

    if (json.code !== 1000) {
      const msg = json.message ?? json.msg ?? text.slice(0, 200);
      throw new Error(`BitMart API error (code=${json.code}): ${msg}`);
    }

    return json.data as T;
  }

  /**
   * Place a limit buy order. Returns order_id string.
   */
  async placeOrder(symbol: string, price: string, size: string): Promise<string> {
    const data = await this.request<{ order_id: string }>(
      "POST", "/spot/v2/submit_order",
      {},
      { symbol, side: "buy", type: "limit", price, size }
    );
    if (!data?.order_id) throw new Error("BitMart placeOrder: no order_id returned");
    return String(data.order_id);
  }

  /**
   * Cancel an order. Silently swallows "order not found" errors.
   */
  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      await this.request<unknown>(
        "POST", "/spot/v3/cancel_order",
        {},
        { symbol, order_id: orderId }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 50008 = order not found / already done — not an error for us
      if (/50008|not.?exist|not.?found|already.?cancel/i.test(msg)) return;
      throw err;
    }
  }

  /**
   * Get order status.
   * Uses /spot/v2/order_detail.
   * Status codes: 1=new, 2=canceled, 3=partially_filled, 4=fully_filled, 5=partially_canceled
   */
  async getOrder(orderId: string): Promise<{
    isOpen: boolean;
    reason?: "filled" | "canceled" | "unknown";
  }> {
    try {
      const data = await this.request<{ order_id: string; status: number }>(
        "GET", "/spot/v2/order_detail",
        { order_id: orderId }
      );
      const status = data?.status ?? 0;
      if (status === 1 || status === 3) return { isOpen: true };
      if (status === 4)               return { isOpen: false, reason: "filled" };
      if (status === 2 || status === 5) return { isOpen: false, reason: "canceled" };
      return { isOpen: false, reason: "unknown" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/50008|not.?exist|not.?found/i.test(msg)) return { isOpen: false, reason: "unknown" };
      throw err;
    }
  }

  /**
   * Cancel all open LIMIT BUY orders for the given symbol (best-effort startup cleanup).
   */
  async cancelAllOpenBuyOrders(symbol: string): Promise<void> {
    try {
      const data = await this.request<any[]>(
        "GET", "/spot/v4/query/open-orders",
        { symbol, orderMode: "spot" }
      );
      const orders: any[] = Array.isArray(data) ? data : [];
      if (orders.length === 0) return;
      const buyOrders = orders.filter(
        (o: any) => (o.side ?? "").toLowerCase() === "buy"
      );
      if (buyOrders.length === 0) return;
      logger.info({ symbol, count: buyOrders.length }, "BitMart: cancelling stale open buy orders on startup");
      for (const order of buyOrders) {
        const id = String(order.orderId ?? order.order_id ?? "");
        if (!id) continue;
        try { await this.cancelOrder(symbol, id); } catch { /* best effort */ }
      }
    } catch {
      // non-fatal startup cleanup
    }
  }

  /**
   * Fetch account spot wallet balances (non-zero only).
   */
  async getBalance(): Promise<Array<{ currency: string; available: string; frozen: string }>> {
    type WalletAsset = { id?: string; currency?: string; available?: string; frozen?: string };
    const data = await this.request<{ wallet: WalletAsset[] }>("GET", "/account/v1/wallet");
    const wallet: WalletAsset[] = data?.wallet ?? [];
    return wallet
      .filter((a) => parseFloat(a.available ?? "0") > 0 || parseFloat(a.frozen ?? "0") > 0)
      .map((a) => ({
        currency: String(a.id ?? a.currency ?? "").toUpperCase(),
        available: a.available ?? "0",
        frozen:    a.frozen ?? "0",
      }));
  }
}
