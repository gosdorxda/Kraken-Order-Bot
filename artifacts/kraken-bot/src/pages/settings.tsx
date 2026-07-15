import { useState } from "react";
import {
  useGetServerInfo,
  useGetSystemStats,
  useGetTelegramSettings,
  useUpdateTelegramSettings,
  getGetTelegramSettingsQueryKey,
  getGetServerInfoQueryKey,
  getGetSystemStatsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Shield, CheckCircle2, XCircle, Copy, Check, RefreshCw, Loader2, Bell, BellOff, LayoutDashboard, Cpu } from "lucide-react";
import { useEnabledExchanges, type ExchangeId } from "@/lib/preferences";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function ConnectionPanel() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: info, isLoading, isFetching } = useGetServerInfo({
    query: { queryKey: getGetServerInfoQueryKey() },
  });

  const copyIp = () => {
    if (!info?.publicIp) return;
    navigator.clipboard.writeText(info.publicIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetServerInfoQueryKey() });

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Shield className="w-4 h-4" /> Connection &amp; Security
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription className="text-xs">
          Kraken API connection status and server IP for whitelist configuration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Kraken API status */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Kraken API</p>
              {info?.krakenConnected ? (
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Terhubung
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
                  <XCircle className="w-4 h-4" /> Gagal
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {info?.krakenConnected ? "API key valid & terautentikasi" : (info?.krakenError ?? "Periksa kredensial API key")}
              </p>
            </div>

            {/* XT.com API status */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">XT.com API</p>
              {info?.xtConnected ? (
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Terhubung
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
                  <XCircle className="w-4 h-4" /> Gagal
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {info?.xtConnected ? "API key valid & terautentikasi" : (info?.xtError ?? "Periksa kredensial API key")}
              </p>
            </div>

            {/* BitMart API status */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">BitMart API</p>
              {info?.bitmartConnected ? (
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Terhubung
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
                  <XCircle className="w-4 h-4" /> Gagal
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {info?.bitmartConnected ? "API key valid & terautentikasi" : (info?.bitmartError ?? "Periksa kredensial API key")}
              </p>
            </div>

            {/* Server IP */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Server Public IP</p>
              {info?.publicIp ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold">{info.publicIp}</span>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={copyIp}>
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{info?.ipError ?? "Unknown"}</span>
              )}
              <p className="text-[11px] text-muted-foreground">Tambahkan IP ini ke whitelist API key Kraken</p>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Shield className="w-3.5 h-3.5 text-primary" /> How to set up IP whitelist on Kraken
          </p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Open <strong className="text-foreground">Kraken</strong> → Security → API</li>
            <li>Select your API key → Edit</li>
            <li>In <strong className="text-foreground">IP Whitelist</strong>, add the IP above</li>
            <li>Save — only requests from that IP can use the key</li>
          </ol>
          <p className="text-[11px] text-amber-400/80 flex items-start gap-1 mt-2">
            <span className="shrink-0">⚠</span>
            <span>
              The server IP may change on Replit restart or redeploy. If the bot suddenly fails to authenticate,
              click refresh above and update the whitelist in Kraken.
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TelegramNotificationPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetTelegramSettings({
    query: { queryKey: getGetTelegramSettingsQueryKey() },
  });

  const mutation = useUpdateTelegramSettings({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetTelegramSettingsQueryKey(), updated);
        toast.success("Pengaturan notifikasi disimpan");
      },
      onError: () => {
        toast.error("Gagal menyimpan pengaturan notifikasi");
      },
    },
  });

  const handleToggle = (field: "notifyOnFill" | "notifyOnCircuitBreaker" | "notifyOnStartStop", value: boolean) => {
    if (!data) return;
    mutation.mutate({
      data: {
        notifyOnFill: field === "notifyOnFill" ? value : data.notifyOnFill,
        notifyOnCircuitBreaker: field === "notifyOnCircuitBreaker" ? value : data.notifyOnCircuitBreaker,
        notifyOnStartStop: field === "notifyOnStartStop" ? value : data.notifyOnStartStop,
      },
    });
  };

  const isConfigured = data?.configured ?? false;
  const isPending = mutation.isPending;

  const events: {
    key: "notifyOnFill" | "notifyOnCircuitBreaker" | "notifyOnStartStop";
    icon: string;
    label: string;
    description: string;
  }[] = [
    {
      key: "notifyOnFill",
      icon: "✅",
      label: "Order terisi",
      description: "Notifikasi saat order beli berhasil dieksekusi",
    },
    {
      key: "notifyOnCircuitBreaker",
      icon: "🚨",
      label: "Circuit breaker trip",
      description: "Notifikasi saat bot berhenti karena terlalu banyak error",
    },
    {
      key: "notifyOnStartStop",
      icon: "▶️",
      label: "Bot start / stop manual",
      description: "Notifikasi saat bot dinyalakan atau dimatikan secara manual",
    },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          {isConfigured ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          Notifikasi Telegram
        </CardTitle>
        <CardDescription className="text-xs">
          Pilih event mana yang akan mengirim notifikasi ke Telegram.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConfigured && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400 flex items-start gap-2">
            <span className="shrink-0 mt-0.5">ℹ️</span>
            <span>
              Token Telegram belum dikonfigurasi. Set environment variable <code className="font-mono bg-amber-500/20 px-1 rounded">TELEGRAM_BOT_TOKEN</code> dan{" "}
              <code className="font-mono bg-amber-500/20 px-1 rounded">TELEGRAM_CHAT_ID</code> untuk mengaktifkan notifikasi.
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {events.map(({ key, icon, label, description }) => (
              <div
                key={key}
                className={`flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 gap-4 ${!isConfigured ? "opacity-50 pointer-events-none" : ""}`}
              >
                <div className="space-y-0.5">
                  <Label htmlFor={key} className="text-sm font-medium flex items-center gap-1.5 cursor-pointer">
                    <span>{icon}</span> {label}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{description}</p>
                </div>
                <Switch
                  id={key}
                  checked={data?.[key] ?? false}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  disabled={!isConfigured || isPending}
                />
              </div>
            ))}
          </div>
        )}

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Menyimpan...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── System Stats Panel ───────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

function StatBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, percent)}%`, background: color }}
      />
    </div>
  );
}

function SystemStatsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching } = useGetSystemStats({
    query: {
      queryKey: getGetSystemStatsQueryKey(),
      refetchInterval: 5000,
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetSystemStatsQueryKey() });

  const cpuColor  = (data?.cpuPercent ?? 0) > 80 ? "#ef4444" : (data?.cpuPercent ?? 0) > 50 ? "#f59e0b" : "#10b981";
  const memColor  = (data?.memPercent ?? 0) > 80 ? "#ef4444" : (data?.memPercent ?? 0) > 60 ? "#f59e0b" : "#3b82f6";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Cpu className="w-4 h-4" /> Server Load
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription className="text-xs">
          Penggunaan CPU, RAM, dan heap Node.js. Auto-refresh tiap 5 detik.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* CPU */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CPU</p>
              <p className="text-2xl font-bold tabular-nums">{data?.cpuPercent.toFixed(1)}<span className="text-sm font-normal text-muted-foreground">%</span></p>
              <StatBar percent={data?.cpuPercent ?? 0} color={cpuColor} />
              <p className="text-[10px] text-muted-foreground">Load {data?.loadAvg1m.toFixed(2)} / {data?.loadAvg5m.toFixed(2)} / {data?.loadAvg15m.toFixed(2)}</p>
            </div>

            {/* RAM */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">RAM Sistem</p>
              <p className="text-2xl font-bold tabular-nums">{data?.memPercent.toFixed(1)}<span className="text-sm font-normal text-muted-foreground">%</span></p>
              <StatBar percent={data?.memPercent ?? 0} color={memColor} />
              <p className="text-[10px] text-muted-foreground">{data?.memUsedMb} / {data?.memTotalMb} MB</p>
            </div>

            {/* Heap */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Node.js Heap</p>
              <p className="text-2xl font-bold tabular-nums">{data?.heapUsedMb}<span className="text-sm font-normal text-muted-foreground"> MB</span></p>
              <StatBar percent={data ? (data.heapUsedMb / data.heapTotalMb) * 100 : 0} color="#8b5cf6" />
              <p className="text-[10px] text-muted-foreground">Total {data?.heapTotalMb} MB</p>
            </div>

            {/* Uptime */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Uptime Server</p>
              <p className="text-xl font-bold tabular-nums leading-tight">{data ? formatUptime(data.uptimeSeconds) : "—"}</p>
              <p className="text-[10px] text-muted-foreground pt-1">{data ? `${data.uptimeSeconds.toLocaleString()} detik` : ""}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Exchange Visibility Panel ────────────────────────────────────────────────

const EXCHANGE_DEFS: { id: ExchangeId; label: string; color: string; badge: string }[] = [
  { id: "kraken",    label: "Kraken",    color: "#7c3aed", badge: "K"  },
  { id: "xt",        label: "XT.com",    color: "#0ea5e9", badge: "XT" },
  { id: "bitmart",   label: "BitMart",   color: "#1A6FAF", badge: "BM" },
  { id: "coinstore", label: "Coinstore", color: "#16a34a", badge: "CS" },
];

function ExchangeVisibilityPanel() {
  const { isEnabled, toggle } = useEnabledExchanges();

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <LayoutDashboard className="w-4 h-4" /> Tampilan Dashboard
        </CardTitle>
        <CardDescription className="text-xs">
          Sembunyikan exchange dari dashboard. Bot yang dinonaktifkan tetap ada tapi tidak tampil.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {EXCHANGE_DEFS.map(({ id, label, color, badge }) => (
          <div
            key={id}
            className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 gap-4"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 font-black text-[11px] text-white"
                style={{ background: `color-mix(in srgb, ${color} 80%, #000)` }}
              >
                {badge}
              </div>
              <div>
                <Label htmlFor={`ex-${id}`} className="text-sm font-medium cursor-pointer">{label}</Label>
                <p className="text-[11px] text-muted-foreground">
                  {isEnabled(id) ? "Tampil di dashboard" : "Disembunyikan dari dashboard"}
                </p>
              </div>
            </div>
            <Switch
              id={`ex-${id}`}
              checked={isEnabled(id)}
              onCheckedChange={() => toggle(id)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Connection status, security, and account information.</p>
      </header>

      <ConnectionPanel />

      <SystemStatsPanel />

      <TelegramNotificationPanel />

      <ExchangeVisibilityPanel />

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">How the bot works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Bot reads the current <strong className="text-foreground">Top Buy Order</strong> price from Kraken's order book.</p>
          <p>2. Places our order at <strong className="text-foreground">Top Buy + Tick Size</strong> — so we're always first in queue.</p>
          <p>3. Checks every <strong className="text-foreground">Check Interval</strong> milliseconds if we're still at the top.</p>
          <p>4. If outbid: cancels our order and re-places at the new top + tick size.</p>
          <p>5. If target price would exceed <strong className="text-foreground">Max Bid Price</strong>: cancels order and pauses.</p>
        </CardContent>
      </Card>
    </div>
  );
}
