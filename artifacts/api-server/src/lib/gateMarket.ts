import type { MarketTicker } from "./krakenBot.js";

const GATE_CACHE_TTL_MS = 10_000;
let gateCache: { data: MarketTicker[]; fetchedAt: number } | null = null;

interface GateTicker {
  currency_pair: string;
  last: string;
  lowest_ask: string;
  highest_bid: string;
  change_percentage: string;
  base_volume: string;
  high_24h: string;
  low_24h: string;
}

export async function fetchGateMarket(): Promise<MarketTicker[]> {
  if (gateCache && Date.now() - gateCache.fetchedAt < GATE_CACHE_TTL_MS) {
    return gateCache.data;
  }

  const resp = await fetch("https://api.gateio.ws/api/v4/spot/tickers");
  if (!resp.ok) throw new Error(`Gate.io API error: ${resp.status}`);

  const all: GateTicker[] = await resp.json() as GateTicker[];
  const usdt = all.filter((t) => t.currency_pair.endsWith("_USDT"));

  const result: MarketTicker[] = usdt.map((t) => {
    const bid    = parseFloat(t.highest_bid);
    const ask    = parseFloat(t.lowest_ask);
    const last   = parseFloat(t.last);
    const spread = isNaN(ask) || isNaN(bid) ? 0 : ask - bid;
    const mid    = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const change24h = parseFloat(t.change_percentage);
    const dp = last >= 1000 ? 2 : last >= 1 ? 4 : 6;
    const open24h = !isNaN(change24h) && change24h !== 0
      ? last / (1 + change24h / 100)
      : last;

    const token = t.currency_pair.replace("_USDT", "");

    return {
      pair:       t.currency_pair,
      displayName: `${token}/USDT`,
      bid:        isNaN(bid) ? "0" : t.highest_bid,
      ask:        isNaN(ask) ? "0" : t.lowest_ask,
      last:       t.last,
      open24h:    open24h.toFixed(dp),
      change24h:  Math.round((isNaN(change24h) ? 0 : change24h) * 1000) / 1000,
      spread:     spread.toFixed(dp),
      spreadPct:  Math.round(spreadPct * 100000) / 100000,
      volume24h:  t.base_volume,
      high24h:    t.high_24h,
      low24h:     t.low_24h,
    };
  });

  gateCache = { data: result, fetchedAt: Date.now() };
  return result;
}
