import { createHmac } from "crypto";
import { logger } from "./logger";

const BASE_URL = "https://sapi.xt.com";

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
  return {
    bids: (json.result.b as [string, string][]).map(([price, volume]) => ({ price, volume })),
    asks: (json.result.a as [string, string][]).map(([price, volume]) => ({ price, volume })),
  };
}

export class XtClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    queryParams: Record<string, string> = {},
    bodyParams: Record<string, unknown> = {}
  ): Promise<T> {
    const timestamp = Date.now();
    const paramsToSign =
      method === "POST" ? (Object.keys(bodyParams).length > 0 ? Object.fromEntries(
        Object.entries(bodyParams).map(([k, v]) => [k, String(v)])
      ) : {}) : queryParams;
    const signature = signMessage(this.apiSecret, timestamp, paramsToSign);

    const headers: Record<string, string> = {
      "X-XT-APIKEY": this.apiKey,
      "X-XT-TIMESTAMP": String(timestamp),
      "X-XT-SIGN": signature,
      "Content-Type": "application/json",
    };

    let url = `${BASE_URL}${path}`;
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

  async placeOrder(symbol: string, price: string, quantity: string): Promise<string> {
    const result = await this.request<{ orderId: string }>(
      "POST",
      "/v4/order",
      {},
      { symbol, side: "BUY", type: "LIMIT", price, quantity, timeInForce: "GTC" }
    );
    if (!result.orderId) throw new Error("XT placeOrder: no orderId returned");
    return String(result.orderId);
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.request<unknown>("DELETE", "/v4/order", { orderId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ORDER_NOT_FOUND|not.?found|CANCELLED/i.test(msg)) return;
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<{
    isOpen: boolean;
    reason?: "filled" | "canceled" | "unknown";
  }> {
    try {
      const result = await this.request<{ state: string }>("GET", "/v4/order", { orderId });
      const state = (result.state ?? "").toUpperCase();
      if (state === "NEW" || state === "PARTIALLY_FILLED") return { isOpen: true };
      if (state === "CANCELED") return { isOpen: false, reason: "canceled" };
      if (state === "CLOSED" || state === "FILLED") return { isOpen: false, reason: "filled" };
      return { isOpen: false, reason: "unknown" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ORDER_NOT_FOUND|not.?found/i.test(msg)) return { isOpen: false, reason: "unknown" };
      throw err;
    }
  }

  async cancelAllOpenOrders(symbol: string): Promise<void> {
    try {
      const orders = await this.request<Array<{ orderId: string }>>(
        "GET",
        "/v4/order/open-orders",
        { symbol }
      );
      if (!Array.isArray(orders) || orders.length === 0) return;
      logger.info({ symbol, count: orders.length }, "XT: cancelling stale open orders on startup");
      for (const order of orders) {
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
}
