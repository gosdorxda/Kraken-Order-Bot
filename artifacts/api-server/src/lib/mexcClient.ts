import { createHmac } from "crypto";
import { logger } from "./logger";

const BASE_URL = "https://api.mexc.com";

/**
 * MEXC Spot API v3 signing scheme (header X-MEXC-APIKEY):
 *   signature = HMAC-SHA256(secret, totalParams).hex()
 * where totalParams is the exact query string sent (including timestamp),
 * NOT sorted — MEXC requires the signed string to match the URL exactly.
 * Docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
 */
function signQuery(secret: string, queryString: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

export interface MexcOrderBookLevel {
  price: string;
  volume: string;
}

/**
 * Fetch public order book depth from MEXC. No authentication required.
 * Response: { bids: [[price, qty], ...], asks: [[price, qty], ...] }
 */
export async function fetchMexcOrderBook(
  symbol: string,
  limit = 20
): Promise<{ bids: MexcOrderBookLevel[]; asks: MexcOrderBookLevel[] }> {
  const url = `${BASE_URL}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`MEXC depth API error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as any;
  if (json?.code != null && json.code !== 0) {
    throw new Error(`MEXC depth API: code=${json.code} ${json.msg ?? ""}`);
  }
  const bidsRaw: [string, string][] = Array.isArray(json?.bids) ? json.bids : [];
  const asksRaw: [string, string][] = Array.isArray(json?.asks) ? json.asks : [];
  return {
    bids: bidsRaw.map(([price, volume]) => ({ price, volume })),
    asks: asksRaw.map(([price, volume]) => ({ price, volume })),
  };
}

/**
 * Derive price precision for a MEXC symbol from the public exchangeInfo endpoint.
 * Uses PRICE_FILTER.tickSize decimals when available, falls back to
 * quotePrecision / baseAssetPrecision, then to 8 on error.
 */
export async function fetchMexcSymbolPrecision(
  symbol: string
): Promise<{ pricePrecision: number }> {
  const decimalsOf = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return null;
    const trimmed = raw.replace(/0+$/, "");
    const parts = trimmed.split(".");
    return parts.length > 1 ? parts[1]!.length : 0;
  };

  try {
    const resp = await fetch(
      `${BASE_URL}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!resp.ok) return { pricePrecision: 8 };
    const json = (await resp.json()) as any;
    const symbols: any[] = Array.isArray(json?.symbols) ? json.symbols : json?.symbol ? [json] : [];
    const s = symbols.find((x: any) => x?.symbol === symbol) ?? symbols[0];
    if (!s) return { pricePrecision: 8 };

    const priceFilter = (s.filters ?? []).find((f: any) => f?.filterType === "PRICE_FILTER");
    const fromTick = decimalsOf(priceFilter?.tickSize);
    if (fromTick !== null) return { pricePrecision: fromTick };

    const fallback = s.quotePrecision ?? s.baseAssetPrecision;
    return { pricePrecision: typeof fallback === "number" ? fallback : 8 };
  } catch {
    return { pricePrecision: 8 };
  }
}

export class MexcClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    queryParams: Record<string, string> = {}
  ): Promise<T> {
    const params: Record<string, string> = { ...queryParams, timestamp: String(Date.now()) };
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    // MEXC signs the query string for every verb, including POST/DELETE.
    const signature = signQuery(this.apiSecret, queryString);
    const url = `${BASE_URL}${path}?${queryString}&signature=${signature}`;

    const resp = await fetch(url, {
      method,
      headers: {
        "X-MEXC-APIKEY": this.apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });

    const text = await resp.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`MEXC non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
    }

    if (!resp.ok || (json?.code != null && json.code !== 0 && json.code !== 200)) {
      const msg = json?.msg ?? json?.message ?? text.slice(0, 200);
      throw new Error(`MEXC API error (code=${json?.code ?? resp.status}): ${msg}`);
    }

    return json as T;
  }

  /**
   * Place a LIMIT BUY order (GTC). Returns the exchange order id as a string.
   */
  async placeOrder(symbol: string, price: string, quantity: string): Promise<string> {
    const data = await this.request<{ orderId?: number | string }>(
      "POST",
      "/api/v3/order",
      { symbol, side: "BUY", type: "LIMIT", timeInForce: "GTC", price, quantity }
    );
    const orderId = data?.orderId;
    if (orderId == null) throw new Error("MEXC placeOrder: no orderId returned");
    return String(orderId);
  }

  /**
   * Cancel an order. Silently swallows "order not found / already done" errors.
   */
  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      await this.request<unknown>("DELETE", "/api/v3/order", { symbol, orderId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown.?order|not.?found|does not exist|-2011|-2013|already/i.test(msg)) return;
      throw err;
    }
  }

  /**
   * Get order status. MEXC status values:
   *   NEW / PARTIALLY_FILLED = open; FILLED = filled; CANCELED / EXPIRED = canceled.
   */
  async getOrder(orderId: string, symbol: string): Promise<{
    isOpen: boolean;
    reason?: "filled" | "canceled" | "unknown";
    executedQty?: string;
  }> {
    try {
      const data = await this.request<{ status?: string; executedQty?: string }>(
        "GET",
        "/api/v3/order",
        { symbol, orderId }
      );
      const state = (data?.status ?? "").toUpperCase();
      const rawExec = data?.executedQty;
      const executedQty = rawExec != null && parseFloat(rawExec) > 0 ? rawExec : undefined;
      if (state === "NEW" || state === "PARTIALLY_FILLED") return { isOpen: true, executedQty };
      if (state === "FILLED") return { isOpen: false, reason: "filled", executedQty };
      if (state === "CANCELED" || state === "EXPIRED" || state === "REJECTED") {
        return { isOpen: false, reason: "canceled", executedQty };
      }
      return { isOpen: false, reason: "unknown", executedQty };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/-2013|unknown.?order|not.?found|does not exist/i.test(msg)) {
        return { isOpen: false, reason: "unknown" };
      }
      throw err;
    }
  }

  /**
   * Cancel all open BUY orders for the given symbol (best-effort startup cleanup).
   * MEXC has no per-symbol cancel-all for spot — list openOrders then cancel each.
   */
  async cancelAllOpenBuyOrders(symbol: string): Promise<void> {
    try {
      const orders = await this.request<any[]>("GET", "/api/v3/openOrders", { symbol });
      if (!Array.isArray(orders) || orders.length === 0) return;
      const buyOrders = orders.filter((o: any) => (o.side ?? "").toUpperCase() === "BUY");
      if (buyOrders.length === 0) return;
      logger.info({ symbol, count: buyOrders.length }, "MEXC: cancelling stale open buy orders on startup");
      for (const order of buyOrders) {
        const id = String(order.orderId ?? "");
        if (!id) continue;
        try {
          await this.cancelOrder(symbol, id);
        } catch {
          // best effort
        }
      }
    } catch {
      // best effort — startup cleanup, non-fatal
    }
  }

  /**
   * Fetch account spot balances (non-zero only).
   * MEXC returns { balances: [{ asset, free, locked }] }.
   */
  async getBalance(): Promise<Array<{ currency: string; available: string; frozen: string }>> {
    type RawBalance = { asset?: string; free?: string; locked?: string };
    const data = await this.request<{ balances?: RawBalance[] }>(
      "GET",
      "/api/v3/account",
      { omitZeroBalances: "true" }
    );
    const list = Array.isArray(data?.balances) ? data.balances : [];
    return list
      .map((b) => ({
        currency: String(b.asset ?? "").toUpperCase(),
        available: b.free ?? "0",
        frozen: b.locked ?? "0",
      }))
      .filter((b) => b.currency && (parseFloat(b.available) > 0 || parseFloat(b.frozen) > 0));
  }
}