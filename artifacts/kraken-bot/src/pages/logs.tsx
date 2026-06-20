import { useState, useMemo } from "react";
import { useGetAllLogs, getGetAllLogsQueryKey } from "@workspace/api-client-react";
import { ScrollText, RefreshCw, AlertCircle, Info, CheckCircle2, AlertTriangle } from "lucide-react";

type Level = "all" | "info" | "warn" | "error" | "success";

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

export default function Logs() {
  const [level, setLevel]     = useState<Level>("all");
  const [search, setSearch]   = useState("");
  const [botFilter, setBotFilter] = useState("all");

  const { data = [], isFetching, refetch } = useGetAllLogs(
    { limit: 500 },
    { query: { refetchInterval: 5000, queryKey: getGetAllLogsQueryKey({ limit: 500 }) } }
  );

  const bots = useMemo(() => {
    const ids = [...new Set(data.map((l) => l.botId))];
    return ids.sort();
  }, [data]);

  const filtered = useMemo(() => {
    return data.filter((l) => {
      if (level !== "all" && l.level !== level) return false;
      if (botFilter !== "all" && l.botId !== botFilter) return false;
      if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, level, botFilter, search]);

  const levels: Level[] = ["all", "success", "info", "warn", "error"];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Activity Log</h1>
          <span className="text-xs text-muted-foreground ml-1">{filtered.length} entri</span>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Level filter */}
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                level === l
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l === "all" ? "Semua" : l}
            </button>
          ))}
        </div>

        {/* Bot filter */}
        {bots.length > 1 && (
          <select
            value={botFilter}
            onChange={(e) => setBotFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-md bg-muted border border-border text-xs font-mono text-foreground"
          >
            <option value="all">Semua bot</option>
            {bots.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Cari pesan..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-md bg-muted border border-border text-xs text-foreground placeholder:text-muted-foreground min-w-[180px]"
        />
      </div>

      {/* Log table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <ScrollText className="w-8 h-8 opacity-30" />
          <p className="text-sm">Tidak ada log yang cocok</p>
        </div>
      ) : (
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
                {filtered.map((log) => (
                  <tr key={`${log.botId}-${log.id}`} className={`border-b ${rowBg(log.level)}`}>
                    <td className="px-4 py-2 font-mono text-muted-foreground whitespace-nowrap">{fmtTs(log.timestamp)}</td>
                    <td className="px-3 py-2 font-mono text-foreground/70 whitespace-nowrap">{log.botId}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><LevelBadge level={log.level} /></td>
                    <td className="px-3 py-2 text-foreground/90">
                      {log.message}
                      {log.data && (
                        <span className="ml-2 font-mono text-muted-foreground text-[10px]">{log.data}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
