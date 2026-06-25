import { createHmac } from "crypto";
import { logger } from "./logger";
import { xtRateLimiter } from "./xtRateLimiter";

const BASE_URL = "https://sapi.xt.com";

/** Legacy signing for sapi.xt.com (spot trading endpoints) */
function signMessage(secret: string, timestamp: number, params: Record<string, string>): string {
  const sortedPairs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]!}`)
    .join("&");
  const message = sortedPairs
    ? `request_time=${timestamp}&${sortedPairs}`
    : `request_time=${timestamp}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * New signing for api.xt.com (account/user center endpoints).
 * Format: {sorted_headers}#{METHOD}#{path}[#{query}][#{body}]
 * Docs: https://doc.xt.com/docs/user-center/Access%20Description/SignatureGeneration
 */
function signMessageAccount(
  apiKey: string,
  secret: string,
  method: string,
  path: string,
  timestamp: number,
  queryParams: Record<string, string> = {},
  bodyJson?: string
): string {
  const recvWindow = "5000";
  const algorithm = "HmacSHA256";

  // Header part (X): sorted alphabetically by key, joined with &
  const headerPart = [
    `validate-algorithms=${algorithm}`,
    `validate-appkey=${apiKey}`,
    `validate-recvwindow=${recvWindow}`,
    `validate-timestamp=${timestamp}`,
  ].join("&");

  // Data part (Y): #METHOD#path + optional #query + optional #body
  let dataPart = `#${method.toUpperCase()}#${path}`;

  const hasQuery = Object.keys(queryParams).length > 0;
  const hasBody = bodyJson && bodyJson !== "{}";

  if (hasQuery) {
    const sortedQuery = Object.keys(queryParams)
      .sort()
      .map((k) => `${k}=${queryParams[k]!}`)
      .join("&");
    dataPart += `#${sortedQuery}`;
  }
  if (hasBody) {
    dataPart += `#${bodyJson}`;
  }

  const message = headerPart + dataPart;
  return createHmac("sha256", secret).update(message).digest("hex");
}

export interface XtOrderBookLevel {
  price: string;
  volume: string;
}

export async function fetchXtOrderBook(
  symbol: string,
  limit = 10
): Promise<{ bids: XtOrderBookLevel[]; asks: XtOrderBookLevel[] }> {
  const url = `${BASE_URL}/v4/public/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`XT depth API error ${resp.status}: ${text}`);
  }
  const json = (await resp.json()) as any;
  if (!json.result) throw new Error("XT depth API: missing result");
  const raw = json.result as { bids?: [string, string][]; asks?: [string, string][]; b?: [string, string][]; a?: [string, string][] };
  const bidsRaw = raw.bids ?? raw.b ?? [];
  const asksRaw = raw.asks ?? raw.a ?? [];
  return {
    bids: bidsRaw.map(([price, volume]) => ({ price, volume })),
    asks: asksRaw.map(([price, volume]) => ({ price, volume })),
  };
}

/**
 * Fetch price and quantity precision for a symbol from XT public API.
 * Returns decimal places for price and quantity formatting.
 * Falls back to {pricePrecision: 8, quantityPrecision: 8} on error.
 */
export async function fetchXtSymbolPrecision(
  symbol: string
): Promise<{ pricePrecision: number; quantityPrecision: number }> {
  try {
    const url = `${BASE_URL}/v4/public/symbol?symbol=${encodeURIComponent(symbol)}`;
    const resp = await fetch(url);
    if (!resp.ok) return { pricePrecision: 8, quantityPrecision: 8 };
    const json = (await resp.json()) as any;
    const s = json.result?.symbols?.[0] ?? json.result;
    return {
      pricePrecision: typeof s?.pricePrecision === "number" ? s.pricePrecision : 8,
      quantityPrecision: typeof s?.quantityPrecision === "number" ? s.quantityPrecision : 8,
    };
  } catch {
    return { pricePrecision: 8, quantityPrecision: 8 };
  }
}

export class XtClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async rawRequest<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    queryParams: Record<string, string> = {},
    bodyParams: Record<string, unknown> = {},
    baseUrl: string = BASE_URL
  ): Promise<T> {
    const timestamp = Date.now();
    const paramsToSign =
      method === "POST"
        ? Object.keys(bodyParams).length > 0
          ? Object.fromEntries(Object.entries(bodyParams).map(([k, v]) => [k, String(v)]))
          : {}
        : queryParams;
    const signature = signMessage(this.apiSecret, timestamp, paramsToSign);

    const headers: Record<string, string> = {
      "X-XT-APIKEY": this.apiKey,
      "X-XT-TIMESTAMP": String(timestamp),
      "X-XT-SIGN": signature,
      "Content-Type": "application/json",
    };

    let url = `${baseUrl}${path}`;
    if (Object.keys(queryParams).length > 0) {
      url += `?${new URLSearchParams(queryParams).toString()}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(bodyParams) : undefined,
    });

    const text = await resp.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`XT API non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
    }

    if (!resp.ok || (json.rc !== undefined && json.rc !== 0)) {
      const msg = json.mc ?? json.msg ?? text.slice(0, 200);
      throw new Error(`XT API error (rc=${json.rc ?? resp.status}): ${msg}`);
    }

    return json.result as T;
  }

  /** All private API calls go through the shared rate limiter. */
  private request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    queryParams?: Record<string, string>,
    bodyParams?: Record<string, unknown>,
    baseUrl?: string
  ): Promise<T> {
    return xtRateLimiter.enqueue(
      () => this.rawRequest<T>(method, path, queryParams, bodyParams, baseUrl),
      `${method} ${path}`
    );
  }

  /**
   * Signed request to api.xt.com (user center / account endpoints).
   * Uses the validate-* header scheme and the new signature format.
   */
  private async rawRequestAccount<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    queryParams: Record<string, string> = {},
    bodyParams: Record<string, unknown> = {}
  ): Promise<T> {
    const timestamp = Date.now();
    const bodyJson = method !== "GET" && Object.keys(bodyParams).length > 0
      ? JSON.stringify(bodyParams)
      : undefined;

    const signature = signMessageAccount(
      this.apiKey,
      this.apiSecret,
      method,
      path,
      timestamp,
      queryParams,
      bodyJson
    );

    const headers: Record<string, string> = {
      "validate-algorithms": "HmacSHA256",
      "validate-appkey": this.apiKey,
      "validate-recvwindow": "5000",
      "validate-timestamp": String(timestamp),
      "validate-signature": signature,
      "Content-Type": "application/json",
    };

    let url = `${BASE_URL}${path}`;
    if (Object.keys(queryParams).length > 0) {
      url += `?${new URLSearchParams(queryParams).toString()}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: bodyJson,
    });

    const text = await resp.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`XT Account API non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
    }

    if (!resp.ok || (json.rc !== undefined && json.rc !== 0)) {
      const msg = json.mc ?? json.msg ?? text.slice(0, 200);
      throw new Error(`XT API error (rc=${json.rc ?? resp.status}): ${msg}`);
    }

    return json.result as T;
  }

  private requestAccount<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    queryParams?: Record<string, string>,
    bodyParams?: Record<string, unknown>
  ): Promise<T> {
    return xtRateLimiter.enqueue(
      () => this.rawRequestAccount<T>(method, path, queryParams, bodyParams),
      `ACCOUNT ${method} ${path}`
    );
  }

  async placeOrder(symbol: string, price: string, quantity: string): Promise<string> {
    const result = await this.requestAccount<{ orderId: string }>(
      "POST",
      "/v4/order",
      {},
      { symbol, side: "BUY", type: "LIMIT", price: parseFloat(price), quantity: parseFloat(quantity), timeInForce: "GTC", bizType: "SPOT" }
    );
    if (!result.orderId) throw new Error("XT placeOrder: no orderId returned");
    return String(result.orderId);
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.requestAccount<unknown>("DELETE", `/v4/order/${orderId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ORDER_NOT_FOUND|not.?found|CANCELLED|ORDER_005/i.test(msg)) return;
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<{
    isOpen: boolean;
    reason?: "filled" | "canceled" | "unknown";
    executedQty?: string;
  }> {
    try {
      const result = await this.requestAccount<{
        state: string;
        executedQty?: string | number;
        filledQty?: string | number;
      }>("GET", `/v4/order/${orderId}`);
      const state = (result.state ?? "").toUpperCase();
      const rawExec = result.executedQty ?? result.filledQty;
      const executedQty = rawExec != null && parseFloat(String(rawExec)) > 0 ? String(rawExec) : undefined;
      if (state === "NEW" || state === "PARTIALLY_FILLED") return { isOpen: true, executedQty };
      if (state === "CANCELED") return { isOpen: false, reason: "canceled", executedQty };
      if (state === "CLOSED" || state === "FILLED") return { isOpen: false, reason: "filled", executedQty };
      return { isOpen: false, reason: "unknown", executedQty };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ORDER_NOT_FOUND|not.?found|ORDER_005/i.test(msg)) return { isOpen: false, reason: "unknown" };
      throw err;
    }
  }

  async getOpenOrders(symbol: string): Promise<string[]> {
    try {
      const orders = await this.requestAccount<Array<{ orderId: string | number; side?: string; type?: string }>>(
        "GET",
        "/v4/order",
        { symbol, state: "NEW" }
      );
      if (!Array.isArray(orders)) return [];
      return orders.map((o) => String(o.orderId));
    } catch {
      return [];
    }
  }

  /**
   * Cancel all open LIMIT BUY orders for the given symbol.
   * Mirrors Kraken's cancelAllOpenBuyOrders — only buy-side, to avoid
   * accidentally cancelling user sell orders on the same pair.
   */
  async cancelAllOpenBuyOrders(symbol: string): Promise<void> {
    try {
      const orders = await this.requestAccount<Array<{ orderId: string | number; side?: string; type?: string }>>(
        "GET",
        "/v4/order",
        { symbol, state: "NEW" }
      );
      if (!Array.isArray(orders) || orders.length === 0) return;
      const buyOrders = orders.filter(
        (o) => (o.side ?? "").toUpperCase() === "BUY" && (o.type ?? "LIMIT").toUpperCase() === "LIMIT"
      );
      if (buyOrders.length === 0) return;
      logger.info({ symbol, count: buyOrders.length }, "XT: cancelling stale open buy orders on startup");
      for (const order of buyOrders) {
        try {
          await this.cancelOrder(String(order.orderId));
        } catch {
          // best effort
        }
      }
    } catch {
      // best effort — startup cleanup, non-fatal
    }
  }

  /** @deprecated use cancelAllOpenBuyOrders — this method cancels all sides */
  async cancelAllOpenOrders(symbol: string): Promise<void> {
    return this.cancelAllOpenBuyOrders(symbol);
  }

  /**
   * Fetch account balances from XT.com.
   * Only returns assets with non-zero balance.
   */
  async getBalance(): Promise<Array<{ currency: string; available: string; frozen: string }>> {
    type RawAsset = { currency?: string; asset?: string; availableAmount?: string; available?: string; frozenAmount?: string; frozen?: string };
    const result = await this.requestAccount<{ assets?: RawAsset[] } | RawAsset[]>(
      "GET",
      "/v4/balances"
    );
    const assets: RawAsset[] = Array.isArray(result)
      ? result
      : (result as { assets?: RawAsset[] }).assets ?? [];
    return assets
      .filter((a) => parseFloat(a.availableAmount ?? a.available ?? "0") > 0 || parseFloat(a.frozenAmount ?? a.frozen ?? "0") > 0)
      .map((a) => ({
        currency: String(a.currency ?? a.asset ?? "").toUpperCase(),
        available: a.availableAmount ?? a.available ?? "0",
        frozen: a.frozenAmount ?? a.frozen ?? "0",
      }));
  }
}
