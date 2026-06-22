import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

export async function fetchLbankMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const resp = await fetch("https://api.lbkex.com/v2/ticker/24hr.do?symbol=all", {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`LBank API error: ${resp.status}`);

  const json: any = await resp.json();
  const tickers: any[] = Array.isArray(json.data) ? json.data : [];

  const usdt = tickers.filter((t: any) => {
    const sym: string = t.symbol ?? "";
    return sym.endsWith("_usdt");
  });

  const result: MarketTicker[] = usdt.map((t: any) => {
    const ticker = t.ticker ?? {};
    const last   = parseFloat(ticker.latest ?? "0");
    const bid    = parseFloat(ticker.best_bid ?? "0") || last;
    const ask    = parseFloat(ticker.best_ask ?? "0") || last;
    const spread = isNaN(ask) || isNaN(bid) ? 0 : ask - bid;
    const mid    = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = parseFloat(ticker.change ?? "0") * 100;
    const vol24h = parseFloat(ticker.vol ?? "0");
    const price  = last || bid || ask;
    const dp     = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const open24h = change24h !== 0 ? last / (1 + change24h / 100) : last;
    const token  = (t.symbol as string).replace("_usdt", "").toUpperCase();

    return {
      pair:        t.symbol as string,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     open24h.toFixed(dp),
      change24h:   Math.round(change24h * 1000) / 1000,
      spread:      spread.toFixed(dp),
      spreadPct:   Math.round(spreadPct * 100000) / 100000,
      volume24h:   (vol24h * last).toFixed(2),
      high24h:     (ticker.high ?? "0").toString(),
      low24h:      (ticker.low  ?? "0").toString(),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
