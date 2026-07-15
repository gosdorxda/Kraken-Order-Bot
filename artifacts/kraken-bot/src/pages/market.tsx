import { useState, useMemo } from "react";
import {
  useGetMarket, getGetMarketQueryKey,
  useGetMarketXt, getGetMarketXtQueryKey,
  useGetMarketBitmart, getGetMarketBitmartQueryKey,
  useGetMarketBiconomy, getGetMarketBiconomyQueryKey,
  useGetMarketBitrue, getGetMarketBitrueQueryKey,
  useGetMarketCoinstore, getGetMarketCoinstoreQueryKey,
} from "@workspace/api-client-react";
import type { MarketTicker } from "@workspace/api-client-react";
import {
  BarChart2, RefreshCw, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown,
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight,
} from "lucide-react";

type SortKey = keyof Pick<MarketTicker, "displayName" | "last" | "change24h" | "bid" | "ask" | "spread" | "spreadPct" | "volume24h">;
type SortDir = "asc" | "desc";
type Exchange = "kraken" | "xt" | "bitmart" | "biconomy" | "bitrue" | "coinstore";

const PAGE_SIZE = 50;

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp className="w-3 h-3 text-primary" />
    : <ArrowDown className="w-3 h-3 text-primary" />;
}

function fmt(n: string | number, decimals = 2) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(decimals);
}

function fmtPrice(n: string) {
  const v = parseFloat(n);
  if (isNaN(v) || v === 0) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function tokenName(displayName: string) {
  return displayName.split("/")[0] ?? displayName;
}

function tradeUrl(exchange: Exchange, pair: string, displayName: string) {
  if (exchange === "xt")       return `https://www.xt.com/en/trade/${pair.toLowerCase()}`;
  if (exchange === "bitmart")  return `https://www.bitmart.com/trade/en-US?symbol=${pair}`;
  if (exchange === "biconomy") return `https://www.biconomy.com/exchange/${pair}`;
  if (exchange === "bitrue")   return `https://www.bitrue.com/trade/${pair.replace(/USDT$/i, "").toLowerCase()}_usdt`;
  if (exchange === "coinstore") return `https://www.coinstore.com/spot/${pair}`;
  return `https://pro.kraken.com/app/trade/${displayName.toLowerCase().replace("/", "-")}`;
}

const COL_HEADERS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "displayName", label: "Token",            align: "left" },
  { key: "last",        label: "Harga Terakhir",   align: "right" },
  { key: "change24h",   label: "24h %",            align: "right" },
  { key: "bid",         label: "Bid",              align: "right" },
  { key: "ask",         label: "Ask",              align: "right" },
  { key: "spreadPct",   label: "Spread %",         align: "right" },
  { key: "volume24h",   label: "Turnover 24h ($)", align: "right" },
];

function ExchangeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-primary/10 text-primary border border-primary/30"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function MarketTable({
  exchange,
  data,
  isFetching,
  isIdle,
  refetch,
  dataUpdatedAt,
}: {
  exchange: Exchange;
  data: MarketTicker[];
  isFetching: boolean;
  isIdle: boolean;
  refetch: () => void;
  dataUpdatedAt: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("volume24h");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID", { hour12: false })
    : null;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "displayName" ? "asc" : "desc");
    }
    setPage(1);
  };

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  const sorted = useMemo(() => {
    let rows = [...data];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.displayName.toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      let av: number | string = a[sortKey];
      let bv: number | string = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        const an = parseFloat(av); const bn = parseFloat(bv);
        av = isNaN(an) ? av : an;
        bv = isNaN(bn) ? bv : bn;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [data, sortKey, sortDir, search]);

  const totalPages  = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const paged       = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const quoteLabel  = exchange === "kraken" ? "USD" : "USDT";

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {!isIdle && (
            <span className="text-xs text-muted-foreground">
              {sorted.length} pair {quoteLabel} spot
              {lastUpdated && <span className="hidden sm:inline"> · Update: {lastUpdated}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Memuat..." : "Muat Data"}
          </button>
        </div>
      </div>

      {/* Search */}
      {!isIdle && data.length > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={`Cari token (contoh: BTC, ETH, SOL...)`}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground min-w-[240px]"
          />
          {search && (
            <button
              onClick={() => handleSearch("")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* State: idle / loading / empty */}
      {isIdle ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3 border border-dashed border-border rounded-xl">
          <BarChart2 className="w-8 h-8 opacity-30" />
          <p className="text-sm">Klik <span className="font-semibold text-foreground">Muat Data</span> untuk memuat harga pasar</p>
        </div>
      ) : isFetching && data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <RefreshCw className="w-6 h-6 animate-spin opacity-40" />
          <p className="text-sm">Mengambil data dari exchange...</p>
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <BarChart2 className="w-8 h-8 opacity-30" />
          <p className="text-sm">Tidak ada data.</p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium text-left text-xs w-10">#</th>
                    {COL_HEADERS.map(({ key, label, align }) => {
                      return (
                        <th
                          key={key}
                          onClick={() => handleSort(key)}
                          className={`px-4 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors text-xs ${
                            align === "right" ? "text-right" : "text-left"
                          }`}
                        >
                          <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
                            {label}
                            <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                          </span>
                        </th>
                      );
                    })}
                    <th className="px-4 py-2.5 font-medium text-right w-8 text-xs" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, idx) => {
                    const spreadPctNum = row.spreadPct;
                    const spreadColor =
                      spreadPctNum < 0.05 ? "text-emerald-500"
                      : spreadPctNum < 0.15 ? "text-amber-500"
                      : "text-red-500";
                    const changePos = row.change24h > 0;
                    const changeNeg = row.change24h < 0;
                    const changeColor = changePos ? "text-emerald-500"
                      : changeNeg ? "text-red-500"
                      : "text-muted-foreground";
                    const rowNum = (safePage - 1) * PAGE_SIZE + idx + 1;

                    return (
                      <tr
                        key={row.pair}
                        onClick={() => window.open(tradeUrl(exchange, row.pair, row.displayName), "_blank", "noopener,noreferrer")}
                        className="border-b border-border/40 hover:bg-primary/10 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2.5 text-xs text-muted-foreground/50 font-mono tabular-nums">{rowNum}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-foreground">{tokenName(row.displayName)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground text-xs">
                          ${fmtPrice(row.last)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold text-xs ${changeColor}`}>
                          <span className="inline-flex items-center justify-end gap-1">
                            {changePos && <TrendingUp className="w-3 h-3" />}
                            {changeNeg && <TrendingDown className="w-3 h-3" />}
                            {changePos ? "+" : ""}{row.change24h.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-500/80 text-xs">
                          ${fmtPrice(row.bid)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-red-500/80 text-xs">
                          ${fmtPrice(row.ask)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold text-xs ${spreadColor}`}>
                          {row.spreadPct.toFixed(4)}%
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground text-xs">
                          {fmt(row.volume24h, 2)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <ExternalLink className="w-3 h-3 text-muted-foreground/50 inline" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                Halaman {safePage} / {totalPages} · {sorted.length} pair
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={safePage === 1}
                  className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  «
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 7) {
                    p = i + 1;
                  } else if (safePage <= 4) {
                    p = i + 1;
                  } else if (safePage >= totalPages - 3) {
                    p = totalPages - 6 + i;
                  } else {
                    p = safePage - 3 + i;
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`min-w-[28px] px-2 py-1 rounded text-xs transition-colors ${
                        p === safePage
                          ? "bg-primary/10 text-primary border border-primary/30 font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={safePage === totalPages}
                  className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Market() {
  const [exchange, setExchange] = useState<Exchange>("kraken");

  const queryOpts = { enabled: false, staleTime: Infinity } as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kraken   = useGetMarket({ query: { ...queryOpts, queryKey: getGetMarketQueryKey() } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xt       = useGetMarketXt({ query: { ...queryOpts, queryKey: getGetMarketXtQueryKey() } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bitmart  = useGetMarketBitmart({ query: { ...queryOpts, queryKey: getGetMarketBitmartQueryKey() } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const biconomy = useGetMarketBiconomy({ query: { ...queryOpts, queryKey: getGetMarketBiconomyQueryKey() } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bitrue   = useGetMarketBitrue({ query: { ...queryOpts, queryKey: getGetMarketBitrueQueryKey() } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coinstore = useGetMarketCoinstore({ query: { ...queryOpts, queryKey: getGetMarketCoinstoreQueryKey() } as any });

  const active = exchange === "kraken"   ? kraken
    : exchange === "xt"       ? xt
    : exchange === "bitmart"  ? bitmart
    : exchange === "biconomy" ? biconomy
    : exchange === "bitrue"   ? bitrue
    : coinstore;

  const isIdle = !active.isFetching && active.dataUpdatedAt === 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart2 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Market</h1>
      </div>

      {/* Exchange tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <ExchangeTab active={exchange === "kraken"} onClick={() => setExchange("kraken")}>
          Kraken <span className="text-xs opacity-60 ml-1">USD</span>
        </ExchangeTab>
        <ExchangeTab active={exchange === "xt"} onClick={() => setExchange("xt")}>
          XT.com <span className="text-xs opacity-60 ml-1">USDT</span>
        </ExchangeTab>
        <ExchangeTab active={exchange === "bitmart"} onClick={() => setExchange("bitmart")}>
          BitMart <span className="text-xs opacity-60 ml-1">USDT</span>
        </ExchangeTab>
        <ExchangeTab active={exchange === "biconomy"} onClick={() => setExchange("biconomy")}>
          Biconomy <span className="text-xs opacity-60 ml-1">USDT</span>
        </ExchangeTab>
        <ExchangeTab active={exchange === "bitrue"} onClick={() => setExchange("bitrue")}>
          Bitrue <span className="text-xs opacity-60 ml-1">USDT</span>
        </ExchangeTab>
        <ExchangeTab active={exchange === "coinstore"} onClick={() => setExchange("coinstore")}>
          Coinstore <span className="text-xs opacity-60 ml-1">USDT</span>
        </ExchangeTab>
      </div>

      <p className="text-xs text-muted-foreground">
        Klik kolom header untuk urutkan · Klik baris untuk buka di exchange · Data tidak auto-refresh
      </p>

      <MarketTable
        key={exchange}
        exchange={exchange}
        data={active.data ?? []}
        isFetching={active.isFetching}
        isIdle={isIdle}
        refetch={active.refetch}
        dataUpdatedAt={active.dataUpdatedAt}
      />
    </div>
  );
}
