import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

interface BitrueTicker {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

export async function fetchBitrueMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  // GET /api/v1/ticker/24hr → array of 24h ticker stats for every symbol, e.g. { symbol: "BTCUSDT", ... }
  const resp = await fetch("https://openapi.bitrue.com/api/v1/ticker/24hr", {
    signal: AbortSignal.timeout(10_000),
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Bitrue API error: ${resp.status}`);

  const json: unknown = await resp.json();
  const tickers: BitrueTicker[] = Array.isArray(json) ? (json as BitrueTicker[]) : [];
  const usdt = tickers.filter((t) => (t.symbol ?? "").toUpperCase().endsWith("USDT"));

  const result: MarketTicker[] = usdt.map((t) => {
    const sym       = t.symbol.toUpperCase();
    const last      = parseFloat(t.lastPrice ?? "0");
    const bid       = parseFloat(t.bidPrice  ?? "0") || last;
    const ask       = parseFloat(t.askPrice  ?? "0") || last;
    const open      = parseFloat(t.openPrice ?? "0");
    const high      = parseFloat(t.highPrice ?? "0");
    const low       = parseFloat(t.lowPrice  ?? "0");
    const quoteVol  = parseFloat(t.quoteVolume ?? "0");
    const change    = parseFloat(t.priceChangePercent ?? "0");
    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = isNaN(change) ? 0 : change;
    const price     = last || bid || ask;
    const dp        = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const token     = sym.replace("USDT", "");
    const open24h   = open > 0 ? open : (change24h !== 0 ? last / (1 + change24h / 100) : last);

    return {
      pair:        sym,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     open24h.toFixed(dp),
      change24h:   Math.round(change24h * 1000) / 1000,
      spread:      spread.toFixed(dp),
      spreadPct:   Math.round(spreadPct * 100000) / 100000,
      volume24h:   isNaN(quoteVol) ? "0" : quoteVol.toFixed(2),
      high24h:     isNaN(high) ? "0" : high.toFixed(dp),
      low24h:      isNaN(low)  ? "0" : low.toFixed(dp),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
