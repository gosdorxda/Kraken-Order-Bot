import { useState } from "react";
import {
  useGetAccountBalance, useGetServerInfo, getGetServerInfoQueryKey,
  useGetSettings, useUpdateSettings, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, CheckCircle2, XCircle, Copy, Check, RefreshCw, Loader2, Bell, BellOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Kraken API</p>
              <div className="flex items-center gap-2">
                {info?.krakenConnected ? (
                  <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="text-sm font-medium text-emerald-400">Connected</span></>
                ) : (
                  <><XCircle className="w-4 h-4 text-red-400" /><span className="text-sm font-medium text-red-400">Disconnected</span></>
                )}
              </div>
              {info?.krakenError && <p className="text-[11px] text-red-400 font-mono break-all">{info.krakenError}</p>}
            </div>
            <div className="rounded-lg border border-border bg-background p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Server IP</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-foreground">{info?.publicIp ?? "—"}</span>
                {info?.publicIp && (
                  <button onClick={copyIp} className="text-muted-foreground hover:text-foreground transition-colors">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
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

function TelegramPanel() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() } as any,
  });
  const { mutate: save, isPending } = useUpdateSettings({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetSettingsQueryKey(), data);
        toast.success("Pengaturan notifikasi disimpan");
      },
      onError: () => toast.error("Gagal menyimpan pengaturan"),
    },
  });

  const hasToken = !!(
    typeof window !== "undefined" &&
    (window as any).__telegramConfigured !== false
  );

  const toggle = (key: "fill" | "circuitBreaker" | "botStartStop", value: boolean) => {
    if (!settings) return;
    save({
      data: {
        telegramNotifications: {
          ...settings.telegramNotifications,
          [key]: value,
        },
      },
    });
  };

  const notif = settings?.telegramNotifications;

  const rows: { key: "fill" | "circuitBreaker" | "botStartStop"; label: string; desc: string; emoji: string }[] = [
    { key: "fill",           label: "Order terisi",       desc: "Kirim notif setiap kali order buy berhasil diisi", emoji: "✅" },
    { key: "circuitBreaker", label: "Circuit breaker",    desc: "Kirim notif saat bot berhenti karena terlalu banyak error", emoji: "🚨" },
    { key: "botStartStop",   label: "Bot start / stop",   desc: "Kirim notif saat bot dimulai atau dihentikan secara manual", emoji: "▶️" },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Bell className="w-4 h-4" /> Notifikasi Telegram
        </CardTitle>
        <CardDescription className="text-xs">
          Pilih event yang akan dikirim ke Telegram. Token dikonfigurasi via environment secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasToken && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <BellOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              <strong>TELEGRAM_BOT_TOKEN</strong> dan <strong>TELEGRAM_CHAT_ID</strong> belum dikonfigurasi di Secrets.
              Notifikasi tidak akan dikirim sampai keduanya diset.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {rows.map(({ key, label, desc, emoji }) => (
              <div key={key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <span>{emoji}</span> {label}
                  </p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={notif?.[key] ?? false}
                  onCheckedChange={(v) => toggle(key, v)}
                  disabled={isPending}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { data: balances, isLoading: balLoading } = useGetAccountBalance();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Connection status, security, and account information.</p>
      </header>

      <ConnectionPanel />

      <TelegramPanel />

      {/* Account balances */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Account Balances</CardTitle>
        </CardHeader>
        <CardContent>
          {balLoading ? (
            <div className="flex gap-3"><Skeleton className="h-14 w-28" /><Skeleton className="h-14 w-28" /></div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {balances?.filter((b) => parseFloat(b.balance) > 0).map((a) => (
                <div key={a.asset} className="bg-background border border-border rounded-lg px-4 py-2.5 min-w-[120px]">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{a.asset}</div>
                  <div className="font-mono text-base font-bold">{parseFloat(a.balance).toFixed(4)}</div>
                </div>
              ))}
              {(!balances || balances.filter((b) => parseFloat(b.balance) > 0).length === 0) && (
                <p className="text-sm text-muted-foreground">No balances found.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
