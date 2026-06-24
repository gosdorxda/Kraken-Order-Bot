import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

export async function fetchBiconomyMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  // GET /api/v1/tickers → {"ticker":[{"buy","sell","last","high","low","deal","vol","change","symbol"},...]}
  const resp = await fetch("https://www.biconomy.com/api/v1/tickers", {
    signal: AbortSignal.timeout(10_000),
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Biconomy API error: ${resp.status}`);

  const json: any = await resp.json();
  const tickers: any[] = Array.isArray(json?.ticker) ? json.ticker : [];
  const usdt = tickers.filter((t: any) => (t.symbol ?? "").toUpperCase().endsWith("_USDT"));

  const result: MarketTicker[] = usdt.map((t: any) => {
    const sym       = (t.symbol as string).toUpperCase();
    const last      = parseFloat(t.last  ?? "0");
    const bid       = parseFloat(t.buy   ?? "0") || last;
    const ask       = parseFloat(t.sell  ?? "0") || last;
    const high      = parseFloat(t.high  ?? "0");
    const low       = parseFloat(t.low   ?? "0");
    const deal      = parseFloat(t.deal  ?? "0");  // turnover (quote volume in USDT)
    const change    = parseFloat(t.change ?? "0"); // already a percentage, e.g. -4.56 means -4.56%
    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = isNaN(change) ? 0 : change;
    const price     = last || bid || ask;
    const dp        = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const token     = sym.replace("_USDT", "");

    return {
      pair:        sym,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     (last / (1 + change24h / 100)).toFixed(dp),
      change24h:   Math.round(change24h * 1000) / 1000,
      spread:      spread.toFixed(dp),
      spreadPct:   Math.round(spreadPct * 100000) / 100000,
      volume24h:   isNaN(deal) ? "0" : deal.toFixed(2),
      high24h:     isNaN(high) ? "0" : high.toFixed(dp),
      low24h:      isNaN(low)  ? "0" : low.toFixed(dp),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
