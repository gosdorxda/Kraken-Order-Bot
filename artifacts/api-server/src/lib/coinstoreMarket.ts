import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

interface CoinstoreTicker {
  symbol: string;
  close: string;
  open: string;
  high: string;
  low: string;
  amount: string; // quote volume (turnover in USDT)
  volume: string; // base volume
  bid: string;
  ask: string;
}

export async function fetchCoinstoreMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  // GET /api/v1/market/tickers → {"data":[{"symbol","close","open","high","low","amount","volume","bid","ask",...},...]}
  const resp = await fetch("https://api.coinstore.com/api/v1/market/tickers", {
    signal: AbortSignal.timeout(10_000),
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Coinstore API error: ${resp.status}`);

  const json: unknown = await resp.json();
  const tickers: CoinstoreTicker[] = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: CoinstoreTicker[] }).data)
    : [];
  const usdt = tickers.filter((t) => (t.symbol ?? "").toUpperCase().endsWith("USDT"));

  const result: MarketTicker[] = usdt.map((t) => {
    const sym       = t.symbol.toUpperCase();
    const last      = parseFloat(t.close ?? "0");
    const bid       = parseFloat(t.bid   ?? "0") || last;
    const ask       = parseFloat(t.ask   ?? "0") || last;
    const open      = parseFloat(t.open  ?? "0");
    const high      = parseFloat(t.high  ?? "0");
    const low       = parseFloat(t.low   ?? "0");
    const quoteVol  = parseFloat(t.amount ?? "0");
    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = open > 0 ? ((last - open) / open) * 100 : 0;
    const price     = last || bid || ask;
    const dp        = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const token     = sym.replace("USDT", "");

    return {
      pair:        sym,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     (open > 0 ? open : last).toFixed(dp),
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
