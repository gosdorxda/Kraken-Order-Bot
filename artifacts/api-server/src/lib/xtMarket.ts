import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

export async function fetchXtMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const resp = await fetch("https://sapi.xt.com/v4/public/ticker", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`XT.com API error: ${resp.status}`);

  const json: any = await resp.json();
  const tickers: any[] =
    Array.isArray(json.result?.tickers) ? json.result.tickers
    : Array.isArray(json.result) ? json.result
    : [];

  const usdt = tickers.filter((t: any) => (t.s ?? "").endsWith("_usdt"));

  const result: MarketTicker[] = usdt.map((t: any) => {
    const last      = parseFloat(t.c ?? "0");
    const open      = parseFloat(t.o ?? "0");
    const high      = parseFloat(t.h ?? "0");
    const low       = parseFloat(t.l ?? "0");
    const bid       = parseFloat(t.bp ?? "0") || last;
    const ask       = parseFloat(t.ap ?? "0") || last;
    const quoteVol  = parseFloat(t.q ?? "0");
    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = parseFloat(t.cr ?? "0");
    const price     = last || bid || ask;
    const dp        = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const open24h   = open > 0 ? open : (change24h !== 0 ? last / (1 + change24h / 100) : last);
    const token     = (t.s as string).replace("_usdt", "").toUpperCase();

    return {
      pair:        t.s as string,
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
