import { useState, useMemo } from "react";
import { useGetMarket, getGetMarketQueryKey } from "@workspace/api-client-react";
import type { MarketTicker } from "@workspace/api-client-react";
import { BarChart2, RefreshCw, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown } from "lucide-react";

type SortKey = keyof Pick<MarketTicker, "displayName" | "last" | "change24h" | "bid" | "ask" | "spread" | "spreadPct" | "volume24h">;
type SortDir = "asc" | "desc";

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
  if (isNaN(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function tokenName(displayName: string) {
  return displayName.split("/")[0] ?? displayName;
}

function tradeUrl(displayName: string) {
  return `https://pro.kraken.com/app/trade/${displayName.toLowerCase().replace("/", "-")}`;
}

const COL_HEADERS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "displayName", label: "Token",          align: "left" },
  { key: "last",        label: "Harga Terakhir", align: "right" },
  { key: "change24h",   label: "24h %",          align: "right" },
  { key: "bid",         label: "Bid",            align: "right" },
  { key: "ask",         label: "Ask",            align: "right" },
  { key: "spread",      label: "Spread ($)",     align: "right" },
  { key: "spreadPct",   label: "Spread %",       align: "right" },
  { key: "volume24h",   label: "Volume 24h",     align: "right" },
];

export default function Market() {
  const [sortKey, setSortKey] = useState<SortKey>("change24h");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch]   = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data = [], isFetching, refetch, dataUpdatedAt } = useGetMarket(
    { query: { refetchInterval: 15000, queryKey: getGetMarketQueryKey() } as any }
  );

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
  };

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
        const an = parseFloat(av);
        const bn = parseFloat(bv);
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Market Kraken</h1>
          <span className="text-xs text-muted-foreground ml-1">
            {sorted.length} pair USD spot
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Update: {lastUpdated}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Cari token (contoh: BTC, ETH, SOL...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-md bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground min-w-[240px]"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Hint */}
      <p className="text-xs text-muted-foreground -mt-1">
        Klik kolom header untuk urutkan · Klik baris untuk buka di Kraken Pro · Auto-refresh tiap 15 detik
      </p>

      {/* Table */}
      {data.length === 0 && !isFetching ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <BarChart2 className="w-8 h-8 opacity-30" />
          <p className="text-sm">Memuat data pasar...</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  {COL_HEADERS.map(({ key, label, align }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors ${
                        align === "right" ? "text-right" : "text-left"
                      }`}
                    >
                      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
                        {label}
                        <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium text-right w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const spreadPctNum = row.spreadPct;
                  const spreadColor =
                    spreadPctNum < 0.05
                      ? "text-emerald-500"
                      : spreadPctNum < 0.15
                      ? "text-amber-500"
                      : "text-red-500";

                  const changePos = row.change24h > 0;
                  const changeNeg = row.change24h < 0;
                  const changeColor = changePos
                    ? "text-emerald-500"
                    : changeNeg
                    ? "text-red-500"
                    : "text-muted-foreground";

                  return (
                    <tr
                      key={row.pair}
                      onClick={() => window.open(tradeUrl(row.displayName), "_blank", "noopener,noreferrer")}
                      className="border-b border-border/40 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      {/* Token name only */}
                      <td className="px-4 py-3">
                        <span className="font-semibold text-foreground">{tokenName(row.displayName)}</span>
                      </td>

                      {/* Last price */}
                      <td className="px-4 py-3 text-right font-mono text-foreground">
                        ${fmtPrice(row.last)}
                      </td>

                      {/* 24h Change */}
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${changeColor}`}>
                        <span className="inline-flex items-center justify-end gap-1">
                          {changePos && <TrendingUp className="w-3 h-3" />}
                          {changeNeg && <TrendingDown className="w-3 h-3" />}
                          {changePos ? "+" : ""}{row.change24h.toFixed(2)}%
                        </span>
                      </td>

                      {/* Bid */}
                      <td className="px-4 py-3 text-right font-mono text-emerald-500/80">
                        ${fmtPrice(row.bid)}
                      </td>

                      {/* Ask */}
                      <td className="px-4 py-3 text-right font-mono text-red-500/80">
                        ${fmtPrice(row.ask)}
                      </td>

                      {/* Spread $ */}
                      <td className={`px-4 py-3 text-right font-mono ${spreadColor}`}>
                        ${row.spread}
                      </td>

                      {/* Spread % */}
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${spreadColor}`}>
                        {row.spreadPct.toFixed(4)}%
                      </td>

                      {/* Volume 24h */}
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {fmt(row.volume24h, 2)}
                      </td>

                      {/* External link icon */}
                      <td className="px-4 py-3 text-right">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 inline" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
