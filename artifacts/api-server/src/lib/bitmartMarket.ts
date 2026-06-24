import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

export async function fetchBitmartMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const resp = await fetch("https://api-cloud.bitmart.com/spot/quotation/v3/tickers", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`BitMart API error: ${resp.status}`);

  const json: any = await resp.json();
  // API returns {"data": [["SYMBOL","last","base_vol","quote_vol","open","high","low","fluctuation","bid","bid_sz","ask","ask_sz","ts"], ...]}
  const rows: any[][] = Array.isArray(json?.data) ? json.data : [];
  const usdt = rows.filter((r: any[]) => typeof r[0] === "string" && r[0].endsWith("_USDT"));

  const result: MarketTicker[] = usdt.map((r: any[]) => {
    const symbol  = r[0] as string;
    const last    = parseFloat(r[1]  ?? "0");
    const volQ    = parseFloat(r[3]  ?? "0");   // quote volume in USDT
    const open    = parseFloat(r[4]  ?? "0");
    const high    = parseFloat(r[5]  ?? "0");
    const low     = parseFloat(r[6]  ?? "0");
    const flux    = parseFloat(r[7]  ?? "0");   // fluctuation as decimal, e.g. -0.03753
    const bid     = parseFloat(r[8]  ?? "0") || last;
    const ask     = parseFloat(r[10] ?? "0") || last;
    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = isNaN(flux) ? (open > 0 ? ((last - open) / open) * 100 : 0) : flux * 100;
    const price     = last || bid || ask;
    const dp        = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const token     = symbol.replace("_USDT", "");

    return {
      pair:        symbol,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     open.toFixed(dp),
      change24h:   Math.round(change24h * 1000) / 1000,
      spread:      spread.toFixed(dp),
      spreadPct:   Math.round(spreadPct * 100000) / 100000,
      volume24h:   isNaN(volQ) ? "0" : volQ.toFixed(2),
      high24h:     isNaN(high) ? "0" : high.toFixed(dp),
      low24h:      isNaN(low)  ? "0" : low.toFixed(dp),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
