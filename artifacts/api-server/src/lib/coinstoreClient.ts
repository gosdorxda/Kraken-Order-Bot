import { createHmac } from "crypto";
import { logger } from "./logger";

const BASE_URL = "https://api.coinstore.com/api";

/**
 * Coinstore signing scheme (X-CS-* headers):
 *   1. keyHex = HMAC-SHA256(secret, floor(expires/30000).toString()).hex()
 *   2. sign   = HMAC-SHA256(keyHex (as utf8 string), payload).hex()
 * Payload is the raw query string (GET, no leading "?") or the exact JSON
 * body string sent (POST) — NOT sorted, just concatenated as-is.
 * Docs: https://coinstore-openapi.github.io/en/
 */
function signPayload(secret: string, expires: number, payload: string): string {
  const expiresKey = String(Math.floor(expires / 30000));
  const key = createHmac("sha256", secret).update(expiresKey).digest("hex");
  return createHmac("sha256", key).update(payload).digest("hex");
}

export interface CoinstoreOrderBookLevel {
  price: string;
  volume: string;
}

/**
 * Fetch public order book depth from Coinstore. No authentication required.
 * Response: data.b = bids, data.a = asks, each entry [price, qty, side].
 */
export async function fetchCoinstoreOrderBook(
  symbol: string,
  depth = 20
): Promise<{ bids: CoinstoreOrderBookLevel[]; asks: CoinstoreOrderBookLevel[] }> {
  const url = `${BASE_URL}/v1/market/depth/${encodeURIComponent(symbol)}?depth=${depth}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Coinstore depth API error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as any;
  if (json.code !== 0 && json.code !== "0") {
    throw new Error(`Coinstore depth API: code=${json.code} ${json.message ?? ""}`);
  }
  const data = json?.data ?? {};
  const bidsRaw: [string, string, unknown][] = data.b ?? [];
  const asksRaw: [string, string, unknown][] = data.a ?? [];
  return {
    bids: bidsRaw.map(([price, volume]) => ({ price, volume })),
    asks: asksRaw.map(([price, volume]) => ({ price, volume })),
  };
}

/**
 * Fetch price/quantity precision for a Coinstore symbol from the public
 * config endpoint. tickSz/lotSz are decimal-place counts.
 * Falls back to {pricePrecision: 8, quantityPrecision: 8} on error.
 */
export async function fetchCoinstoreSymbolPrecision(
  symbol: string
): Promise<{ pricePrecision: number; quantityPrecision: number }> {
  try {
    const resp = await fetch(`${BASE_URL}/v2/public/config/spot/symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbolCodes: [symbol] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return { pricePrecision: 8, quantityPrecision: 8 };
    const json = (await resp.json()) as any;
    const s = Array.isArray(json?.data) ? json.data[0] : undefined;
    return {
      pricePrecision: typeof s?.tickSz === "number" ? s.tickSz : 8,
      quantityPrecision: typeof s?.lotSz === "number" ? s.lotSz : 8,
    };
  } catch {
    return { pricePrecision: 8, quantityPrecision: 8 };
  }
}

export class CoinstoreClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    queryParams: Record<string, string> = {},
    bodyParams?: Record<string, unknown>
  ): Promise<T> {
    const expires = Date.now();
    const hasQuery = Object.keys(queryParams).length > 0;
    const queryString = hasQuery
      ? Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    const bodyJson = method === "POST" ? JSON.stringify(bodyParams ?? {}) : "";
    const payload = method === "GET" ? queryString : bodyJson;
    const signature = signPayload(this.apiSecret, expires, payload);

    const headers: Record<string, string> = {
      "X-CS-APIKEY": this.apiKey,
      "X-CS-SIGN": signature,
      "X-CS-EXPIRES": String(expires),
      "Content-Type": "application/json",
    };

    let url = `${BASE_URL}${path}`;
    if (queryString) url += `?${queryString}`;

    const resp = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? bodyJson : undefined,
      signal: AbortSignal.timeout(12_000),
    });

    const text = await resp.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Coinstore non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
    }

    const code = json?.code;
    if (!resp.ok || (code !== undefined && code !== 0 && code !== "0")) {
      const msg = json?.msg ?? json?.message ?? text.slice(0, 200);
      throw new Error(`Coinstore API error (code=${code ?? resp.status}): ${msg}`);
    }

    return json.data as T;
  }

  /**
   * Place a limit buy order. Returns the exchange order id as a string.
   */
  async placeOrder(symbol: string, price: string, quantity: string): Promise<string> {
    const data = await this.request<{ ordId?: number | string; order_id?: number | string }>(
      "POST",
      "/trade/order/place",
      {},
      {
        symbol,
        side: "BUY",
        ordType: "LIMIT",
        ordPrice: price,
        ordQty: quantity,
        timestamp: Date.now(),
      }
    );
    const orderId = data?.ordId ?? data?.order_id;
    if (orderId == null) throw new Error("Coinstore placeOrder: no ordId returned");
    return String(orderId);
  }

  /**
   * Cancel an order. Silently swallows "order not found / already done" errors.
   */
  async cancelOrder(symbol: string, ordId: string): Promise<void> {
    try {
      await this.request<unknown>("POST", "/trade/order/cancel", {}, { symbol, ordId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not.?found|NOT_FOUND|already.?cancel|CANCELED/i.test(msg)) return;
      throw err;
    }
  }

  /**
   * Get order status.
   * ordState: SUBMITTING/SUBMITTED/PARTIAL_FILLED = open; FILLED = filled; CANCELED = canceled.
   */
  async getOrder(ordId: string): Promise<{
    isOpen: boolean;
    reason?: "filled" | "canceled" | "unknown";
    executedQty?: string;
  }> {
    try {
      const data = await this.request<{
        ordState?: string;
        cumQty?: string | number;
      }>("GET", "/trade/order/orderInfo", { ordId });
      const state = (data?.ordState ?? "").toUpperCase();
      const rawExec = data?.cumQty;
      const executedQty = rawExec != null && parseFloat(String(rawExec)) > 0 ? String(rawExec) : undefined;
      if (state === "SUBMITTING" || state === "SUBMITTED" || state === "PARTIAL_FILLED") {
        return { isOpen: true, executedQty };
      }
      if (state === "CANCELED") return { isOpen: false, reason: "canceled", executedQty };
      if (state === "FILLED") return { isOpen: false, reason: "filled", executedQty };
      return { isOpen: false, reason: "unknown", executedQty };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not.?found|NOT_FOUND/i.test(msg)) return { isOpen: false, reason: "unknown" };
      throw err;
    }
  }

  async getOpenOrders(symbol: string): Promise<string[]> {
    try {
      const orders = await this.request<Array<{ ordId: string | number; symbol?: string; side?: string }>>(
        "GET",
        "/trade/order/active"
      );
      if (!Array.isArray(orders)) return [];
      return orders
        .filter((o) => (o.symbol ?? "").toUpperCase() === symbol.toUpperCase())
        .map((o) => String(o.ordId));
    } catch {
      return [];
    }
  }

  /**
   * Cancel all open LIMIT BUY orders for the given symbol (best-effort startup cleanup).
   */
  async cancelAllOpenBuyOrders(symbol: string): Promise<void> {
    try {
      const orders = await this.request<Array<{ ordId: string | number; symbol?: string; side?: string; ordType?: string }>>(
        "GET",
        "/trade/order/active"
      );
      if (!Array.isArray(orders) || orders.length === 0) return;
      const buyOrders = orders.filter(
        (o) =>
          (o.symbol ?? "").toUpperCase() === symbol.toUpperCase() &&
          (o.side ?? "").toUpperCase() === "BUY"
      );
      if (buyOrders.length === 0) return;
      logger.info({ symbol, count: buyOrders.length }, "Coinstore: cancelling stale open buy orders on startup");
      for (const order of buyOrders) {
        try {
          await this.cancelOrder(symbol, String(order.ordId));
        } catch {
          // best effort
        }
      }
    } catch {
      // best effort — startup cleanup, non-fatal
    }
  }

  /**
   * Fetch account balances from Coinstore.
   * type 1 = AVAILABLE, type 4 = FROZEN. Only returns assets with non-zero balance.
   */
  async getBalance(): Promise<Array<{ currency: string; available: string; frozen: string }>> {
    type RawAsset = { currency?: string; balance?: string; type?: number };
    const raw = await this.request<RawAsset[]>("POST", "/spot/accountList", {}, {});
    const list = Array.isArray(raw) ? raw : [];
    const byCurrency = new Map<string, { available: number; frozen: number }>();
    for (const a of list) {
      const currency = String(a.currency ?? "").toUpperCase();
      if (!currency) continue;
      const amt = parseFloat(a.balance ?? "0");
      if (!byCurrency.has(currency)) byCurrency.set(currency, { available: 0, frozen: 0 });
      const entry = byCurrency.get(currency)!;
      if (a.type === 4) entry.frozen += amt;
      else entry.available += amt;
    }
    return Array.from(byCurrency.entries())
      .filter(([, v]) => v.available > 0 || v.frozen > 0)
      .map(([currency, v]) => ({
        currency,
        available: String(v.available),
        frozen: String(v.frozen),
      }));
  }
}
