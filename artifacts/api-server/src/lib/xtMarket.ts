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
  const tickers: any[] = Array.isArray(json.result?.tickers) ? json.result.tickers
    : Array.isArray(json.result) ? json.result
    : [];

  const usdt = tickers.filter((t: any) => {
    const sym: string = t.s ?? t.symbol ?? "";
    return sym.endsWith("_usdt");
  });

  const result: MarketTicker[] = usdt.map((t: any) => {
    const sym    = (t.s ?? t.symbol ?? "") as string;
    const last   = parseFloat(t.c ?? t.last ?? "0");
    const bid    = parseFloat(t.b ?? t.bid ?? "0") || last;
    const ask    = parseFloat(t.a ?? t.ask ?? "0") || last;
    const spread = isNaN(ask) || isNaN(bid) ? 0 : ask - bid;
    const mid    = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = parseFloat(t.P ?? t.change ?? "0");
    const price  = last || bid || ask;
    const dp     = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
    const vol    = parseFloat(t.qv ?? t.quoteVolume ?? t.v ?? "0");
    const open24h = change24h !== 0 ? last / (1 + change24h / 100) : last;
    const token  = sym.replace("_usdt", "").toUpperCase();

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
      volume24h:   isNaN(vol) ? "0" : vol.toFixed(2),
      high24h:     (t.h ?? t.high ?? "0").toString(),
      low24h:      (t.l ?? t.low  ?? "0").toString(),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
