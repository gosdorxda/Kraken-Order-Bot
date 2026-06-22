import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

export async function fetchAscendexMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const resp = await fetch("https://ascendex.com/api/pro/v1/ticker", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`AscendEX API error: ${resp.status}`);

  const json: any = await resp.json();
  const tickers: any[] = Array.isArray(json.data) ? json.data : [];
  const usdt = tickers.filter((t: any) => (t.symbol ?? "").endsWith("/USDT"));

  const result: MarketTicker[] = usdt.map((t: any) => {
    const last   = parseFloat(t.close ?? "0");
    const open   = parseFloat(t.open  ?? "0");
    const high   = parseFloat(t.high  ?? "0");
    const low    = parseFloat(t.low   ?? "0");
    const vol    = parseFloat(t.volume ?? "0");
    const bid    = parseFloat(Array.isArray(t.bid) ? t.bid[0] : (t.bid ?? "0")) || last;
    const ask    = parseFloat(Array.isArray(t.ask) ? t.ask[0] : (t.ask ?? "0")) || last;
    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = open > 0 ? ((last - open) / open) * 100 : 0;
    const price     = last || bid || ask;
    const dp        = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const token     = (t.symbol as string).replace("/USDT", "");

    return {
      pair:        t.symbol as string,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     open.toFixed(dp),
      change24h:   Math.round(change24h * 1000) / 1000,
      spread:      spread.toFixed(dp),
      spreadPct:   Math.round(spreadPct * 100000) / 100000,
      volume24h:   (vol * last).toFixed(2),
      high24h:     isNaN(high) ? "0" : high.toFixed(dp),
      low24h:      isNaN(low)  ? "0" : low.toFixed(dp),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
