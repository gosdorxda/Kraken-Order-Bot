import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

export async function fetchLbankMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const resp = await fetch("https://api.lbkex.com/v2/ticker/24hr.do?symbol=all", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`LBank API error: ${resp.status}`);

  const json: any = await resp.json();
  const tickers: any[] = Array.isArray(json.data) ? json.data : [];
  const usdt = tickers.filter((t: any) => (t.symbol ?? "").endsWith("_usdt"));

  const result: MarketTicker[] = usdt.map((t: any) => {
    const ticker   = t.ticker ?? {};
    const last     = parseFloat(ticker.latest ?? "0");
    const change24h = parseFloat(ticker.change ?? "0");
    const high     = parseFloat(ticker.high ?? "0");
    const low      = parseFloat(ticker.low ?? "0");
    const turnover = parseFloat(ticker.turnover ?? "0");
    const price    = last;
    const dp       = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const open24h  = change24h !== 0 ? last / (1 + change24h / 100) : last;
    const token    = (t.symbol as string).replace("_usdt", "").toUpperCase();

    return {
      pair:        t.symbol as string,
      displayName: `${token}/USDT`,
      bid:         last.toFixed(dp),
      ask:         last.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     open24h.toFixed(dp),
      change24h:   Math.round(change24h * 1000) / 1000,
      spread:      "0",
      spreadPct:   0,
      volume24h:   isNaN(turnover) ? "0" : turnover.toFixed(2),
      high24h:     isNaN(high) ? "0" : high.toFixed(dp),
      low24h:      isNaN(low)  ? "0" : low.toFixed(dp),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
