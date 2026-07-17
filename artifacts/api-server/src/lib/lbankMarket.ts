import type { MarketTicker } from "./krakenBot.js";

const CACHE_TTL_MS = 10_000;
let cache: { data: MarketTicker[]; fetchedAt: number } | null = null;

interface LBankTicker {
  symbol: string; // e.g. "eth_usdt"
  ticker: {
    latest:   string; // last price
    high:     string;
    low:      string;
    vol:      string; // base volume
    turnover: string; // quote volume (USDT)
    change:   string; // 24h change % as a string, e.g. "-2.96"
  };
}

export async function fetchLBankMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  // GET /v2/ticker/24hr.do?symbol=all → {"result":"true","data":[{symbol, ticker:{latest,high,low,vol,turnover,change}},...]}
  const resp = await fetch("https://api.lbkex.com/v2/ticker/24hr.do?symbol=all", {
    signal: AbortSignal.timeout(10_000),
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`LBank API error: ${resp.status}`);

  const json: unknown = await resp.json();
  const raw: LBankTicker[] = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: LBankTicker[] }).data)
    : [];

  // Filter USDT pairs only
  const usdt = raw.filter((t) => (t.symbol ?? "").toLowerCase().endsWith("_usdt"));

  const result: MarketTicker[] = usdt.map((t) => {
    // LBank symbol format: "eth_usdt" → pair "ETHUSDT", token "ETH"
    const sym    = t.symbol.toUpperCase().replace("_", "");
    const token  = t.symbol.split("_")[0]?.toUpperCase() ?? sym;

    const last      = parseFloat(t.ticker.latest   ?? "0");
    const high      = parseFloat(t.ticker.high     ?? "0");
    const low       = parseFloat(t.ticker.low      ?? "0");
    const baseVol   = parseFloat(t.ticker.vol      ?? "0");
    const quoteVol  = parseFloat(t.ticker.turnover ?? "0");
    const changePct = parseFloat(t.ticker.change   ?? "0"); // already a percentage

    // LBank bulk ticker has no bid/ask — use last as both
    const bid = last;
    const ask = last;

    const price = last;
    const dp    = price >= 1000 ? 2 : price >= 1 ? 4 : 6;

    // Reconstruct open24h from change%: open = last / (1 + change/100)
    const open = changePct !== -100 ? last / (1 + changePct / 100) : last;

    return {
      pair:        sym,
      displayName: `${token}/USDT`,
      bid:         bid.toFixed(dp),
      ask:         ask.toFixed(dp),
      last:        last.toFixed(dp),
      open24h:     open.toFixed(dp),
      change24h:   Math.round(changePct * 1000) / 1000,
      spread:      (0).toFixed(dp),
      spreadPct:   0,
      volume24h:   isNaN(quoteVol) || quoteVol === 0
                     ? (isNaN(baseVol) ? "0" : (baseVol * last).toFixed(2))
                     : quoteVol.toFixed(2),
      high24h:     isNaN(high) ? "0" : high.toFixed(dp),
      low24h:      isNaN(low)  ? "0" : low.toFixed(dp),
    };
  });

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
