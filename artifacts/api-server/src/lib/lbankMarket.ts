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

interface LBankDepth {
  data?: {
    bids?: [string, string][];
    asks?: [string, string][];
  };
}

/** Fetch top-of-book depth for a single symbol. Returns [bid, ask] or null on failure. */
async function fetchDepth(symbol: string): Promise<[number, number] | null> {
  try {
    const resp = await fetch(
      `https://api.lbkex.com/v2/depth.do?symbol=${encodeURIComponent(symbol)}&size=1`,
      { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } }
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as LBankDepth;
    const bid = parseFloat(json.data?.bids?.[0]?.[0] ?? "0");
    const ask = parseFloat(json.data?.asks?.[0]?.[0] ?? "0");
    if (bid > 0 && ask > 0) return [bid, ask];
    return null;
  } catch {
    return null;
  }
}

/** Run an array of async tasks with at most `concurrency` in-flight at once. */
async function pooled<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      try {
        results[idx] = { status: "fulfilled", value: await tasks[idx]!() };
      } catch (err) {
        results[idx] = { status: "rejected", reason: err };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export async function fetchLBankMarket(): Promise<MarketTicker[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  // 1. Bulk tickers — last price, high, low, volume, change
  const resp = await fetch("https://api.lbkex.com/v2/ticker/24hr.do?symbol=all", {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`LBank API error: ${resp.status}`);

  const json: unknown = await resp.json();
  const raw: LBankTicker[] = Array.isArray((json as { data?: unknown })?.data)
    ? (json as { data: LBankTicker[] }).data
    : [];

  // Filter USDT pairs only
  const usdt = raw.filter((t) => (t.symbol ?? "").toLowerCase().endsWith("_usdt"));

  // 2. Fetch top-of-book depth for every USDT pair, max 20 concurrent requests
  const depthTasks = usdt.map((t) => () => fetchDepth(t.symbol));
  const depthResults = await pooled(depthTasks, 20);

  // 3. Merge depth bid/ask into ticker data
  const result: MarketTicker[] = usdt.map((t, i) => {
    const sym   = t.symbol.toUpperCase().replace("_", "");
    const token = t.symbol.split("_")[0]?.toUpperCase() ?? sym;

    const last     = parseFloat(t.ticker.latest   ?? "0");
    const high     = parseFloat(t.ticker.high     ?? "0");
    const low      = parseFloat(t.ticker.low      ?? "0");
    const baseVol  = parseFloat(t.ticker.vol      ?? "0");
    const quoteVol = parseFloat(t.ticker.turnover ?? "0");
    const changePct = parseFloat(t.ticker.change  ?? "0");

    // Use real bid/ask from depth if available, else fallback to last
    const depthResult = depthResults[i];
    const bidAsk =
      depthResult?.status === "fulfilled" && depthResult.value !== null
        ? depthResult.value
        : null;

    const bid = bidAsk ? bidAsk[0] : last;
    const ask = bidAsk ? bidAsk[1] : last;

    const price = last;
    const dp    = price >= 1000 ? 2 : price >= 1 ? 4 : 6;

    const spread    = ask > bid ? ask - bid : 0;
    const mid       = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;

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
      spread:      spread.toFixed(dp),
      spreadPct:   Math.round(spreadPct * 100000) / 100000,
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
