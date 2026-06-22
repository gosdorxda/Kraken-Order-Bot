import { useState, useMemo, useEffect } from "react";
import {
  useGetAllLogs, getGetAllLogsQueryKey,
  useGetAllFills, getGetAllFillsQueryKey,
} from "@workspace/api-client-react";
import {
  ScrollText, RefreshCw, AlertCircle, Info, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, CheckCheck,
} from "lucide-react";

type Level = "all" | "info" | "warn" | "error" | "success";
type Tab   = "activity" | "fills";

function LevelBadge({ level }: { level: string }) {
  switch (level) {
    case "success": return <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" />success</span>;
    case "error":   return <span className="inline-flex items-center gap-1 text-red-400"><AlertCircle className="w-3.5 h-3.5" />error</span>;
    case "warn":    return <span className="inline-flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3.5 h-3.5" />warn</span>;
    default:        return <span className="inline-flex items-center gap-1 text-blue-400"><Info className="w-3.5 h-3.5" />info</span>;
  }
}

function rowBg(level: string) {
  switch (level) {
    case "error":   return "bg-red-950/20 border-red-800/20";
    case "warn":    return "bg-amber-950/20 border-amber-800/20";
    case "success": return "bg-emerald-950/20 border-emerald-800/20";
    default:        return "border-border/40";
  }
}

function fmtTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("id-ID", { hour12: false, dateStyle: "short", timeStyle: "medium" });
}

function truncateId(id: string, maxLen = 14): string {
  return id.length > maxLen ? `${id.slice(0, maxLen)}…` : id;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

// ─── Activity Log tab ────────────────────────────────────────────────────────
function ActivityLog() {
  const [level, setLevel]         = useState<Level>("all");
  const [search, setSearch]       = useState("");
  const [botFilter, setBotFilter] = useState("all");
  const [pageSize, setPageSize]   = useState<number>(50);
  const [page, setPage]           = useState(1);

  const { data = [], isFetching, refetch } = useGetAllLogs(
    { limit: 500 },
    { query: { refetchInterval: 5000, queryKey: getGetAllLogsQueryKey({ limit: 500 }) } }
  );

  const bots = useMemo(() => [...new Set(data.map((l) => l.botId))].sort(), [data]);

  const filtered = useMemo(() => data.filter((l) => {
    if (level !== "all" && l.level !== level) return false;
    if (botFilter !== "all" && l.botId !== botFilter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [data, level, botFilter, search]);

  useEffect(() => { setPage(1); }, [level, search, botFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const levels: Level[] = ["all", "success", "info", "warn", "error"];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
            {levels.map((l) => (
              <button key={l} onClick={() => setLevel(l)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${level === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {l === "all" ? "Semua" : l}
              </button>
            ))}
          </div>
          {data.length > 0 && (
            <select value={botFilter} onChange={(e) => setBotFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-md bg-muted border border-border text-xs font-mono text-foreground">
              <option value="all">Semua bot</option>
              {bots.map((b) => <option key={b} value={b} title={b}>{truncateId(b)}</option>)}
            </select>
          )}
          <input type="text" placeholder="Cari pesan..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-muted border border-border text-xs text-foreground placeholder:text-muted-foreground min-w-[180px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Baris/hal:</span>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1.5 rounded-md bg-muted border border-border text-xs text-foreground">
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <ScrollText className="w-8 h-8 opacity-30" />
          <p className="text-sm">Tidak ada log yang cocok</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="text-left px-4 py-2.5 font-medium w-[140px]">Waktu</th>
                    <th className="text-left px-3 py-2.5 font-medium w-[110px]">Bot</th>
                    <th className="text-left px-3 py-2.5 font-medium w-[90px]">Level</th>
                    <th className="text-left px-3 py-2.5 font-medium">Pesan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {paginated.map((log) => (
                    <tr key={`${log.botId}-${log.id}`} className={`border-b ${rowBg(log.level)}`}>
                      <td className="px-4 py-2 font-mono text-muted-foreground whitespace-nowrap">{fmtTs(log.timestamp)}</td>
                      <td className="px-3 py-2 font-mono text-foreground/70 whitespace-nowrap" title={log.botId}>{truncateId(log.botId)}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><LevelBadge level={log.level} /></td>
                      <td className="px-3 py-2 text-foreground/90">
                        {log.message}
                        {log.data && <span className="ml-2 font-mono text-muted-foreground text-[10px]">{log.data}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={setPage} total={filtered.length} />
        </>
      )}
    </div>
  );
}

// ─── Fill History tab ─────────────────────────────────────────────────────────
function FillHistory() {
  const [botFilter, setBotFilter] = useState("all");
  const [search, setSearch]       = useState("");
  const [pageSize, setPageSize]   = useState<number>(50);
  const [page, setPage]           = useState(1);

  const { data: fills = [], isFetching, refetch } = useGetAllFills(
    { limit: 500 },
    { query: { refetchInterval: 10000, queryKey: getGetAllFillsQueryKey({ limit: 500 }) } } as any
  );

  const bots = useMemo(() => [...new Set(fills.map((f) => f.botId).filter(Boolean))].sort() as string[], [fills]);

  const filtered = useMemo(() => fills.filter((f) => {
    if (botFilter !== "all" && f.botId !== botFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!f.pair.toLowerCase().includes(q) && !f.orderId.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [fills, botFilter, search]);

  useEffect(() => { setPage(1); }, [botFilter, search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totalValue = useMemo(() =>
    filtered.reduce((sum, f) => sum + parseFloat(f.price) * parseFloat(f.volume), 0),
  [filtered]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          {bots.length > 0 && (
            <select value={botFilter} onChange={(e) => setBotFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-md bg-muted border border-border text-xs font-mono text-foreground">
              <option value="all">Semua bot</option>
              {bots.map((b) => <option key={b} value={b} title={b}>{truncateId(b)}</option>)}
            </select>
          )}
          <input type="text" placeholder="Cari pair / order ID..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-muted border border-border text-xs text-foreground placeholder:text-muted-foreground min-w-[180px]" />
        </div>
        <div className="flex items-center gap-3">
          {filtered.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Total nilai: <span className="font-mono text-foreground font-medium">${totalValue.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Baris/hal:</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2 py-1.5 rounded-md bg-muted border border-border text-xs text-foreground">
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <CheckCheck className="w-8 h-8 opacity-30" />
          <p className="text-sm">{fills.length === 0 ? "Belum ada order yang terisi." : "Tidak ada fill yang cocok."}</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="text-left px-4 py-2.5 font-medium w-[140px]">Waktu</th>
                    <th className="text-left px-3 py-2.5 font-medium w-[100px]">Bot</th>
                    <th className="text-left px-3 py-2.5 font-medium w-[90px]">Pair</th>
                    <th className="text-right px-3 py-2.5 font-medium w-[110px]">Harga</th>
                    <th className="text-right px-3 py-2.5 font-medium w-[100px]">Volume</th>
                    <th className="text-right px-3 py-2.5 font-medium w-[110px]">Nilai ($)</th>
                    <th className="text-left px-3 py-2.5 font-medium">Order ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {paginated.map((f) => {
                    const nilai = parseFloat(f.price) * parseFloat(f.volume);
                    return (
                      <tr key={`${f.botId ?? ""}-${f.id}`} className="border-b border-border/40 bg-emerald-950/10">
                        <td className="px-4 py-2 font-mono text-muted-foreground whitespace-nowrap">{fmtTs(f.timestamp)}</td>
                        <td className="px-3 py-2 font-mono text-foreground/70 whitespace-nowrap" title={f.botId ?? ""}>{truncateId(f.botId ?? "-")}</td>
                        <td className="px-3 py-2 font-mono font-medium text-foreground whitespace-nowrap">{f.pair}</td>
                        <td className="px-3 py-2 font-mono text-right whitespace-nowrap">${parseFloat(f.price).toLocaleString("id-ID", { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 font-mono text-right whitespace-nowrap">{parseFloat(f.volume).toFixed(6)}</td>
                        <td className="px-3 py-2 font-mono text-right whitespace-nowrap text-emerald-400 font-medium">${nilai.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground" title={f.orderId}>{truncateId(f.orderId, 18)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={setPage} total={filtered.length} />
        </>
      )}
    </div>
  );
}

// ─── Shared pagination ────────────────────────────────────────────────────────
function Pagination({ page, totalPages, onPage, total }: { page: number; totalPages: number; onPage: (p: number) => void; total: number }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">
        Halaman {page} dari {totalPages} · {total} entri
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronLeft className="w-3.5 h-3.5" /> Prev
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
          .reduce<(number | "…")[]>((acc, p, i, arr) => {
            if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
            ) : (
              <button key={p} onClick={() => onPage(p)}
                className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${p === page ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                {p}
              </button>
            )
          )}
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────
export default function Logs() {
  const [tab, setTab] = useState<Tab>("activity");

  const { data: logs = [], isFetching: logsFetching, refetch: refetchLogs } = useGetAllLogs(
    { limit: 500 },
    { query: { refetchInterval: 5000, queryKey: getGetAllLogsQueryKey({ limit: 500 }) } }
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Log</h1>
        </div>
        <button
          onClick={() => { if (tab === "activity") refetchLogs(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${logsFetching && tab === "activity" ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        <button onClick={() => setTab("activity")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${tab === "activity" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          <ScrollText className="w-3.5 h-3.5" />
          Activity Log
          <span className="text-[10px] bg-muted rounded px-1">{logs.length}</span>
        </button>
        <button onClick={() => setTab("fills")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${tab === "fills" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          <CheckCheck className="w-3.5 h-3.5" />
          Fill History
        </button>
      </div>

      {/* Tab content */}
      {tab === "activity" ? <ActivityLog /> : <FillHistory />}
    </div>
  );
}
