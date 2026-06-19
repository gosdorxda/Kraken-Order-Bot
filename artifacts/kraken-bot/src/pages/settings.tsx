import { useState } from "react";
import { useGetAccountBalance, useGetServerInfo, getGetServerInfoQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, CheckCircle2, XCircle, Copy, Check, RefreshCw, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

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
              {info?.krakenConnected ? (
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
                  <XCircle className="w-4 h-4" /> Disconnected
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {info?.krakenConnected ? "API key is valid and authenticated" : (info?.krakenError ?? "Check API key credentials")}
              </p>
            </div>

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
              <p className="text-[11px] text-muted-foreground">Add this IP to your Kraken API key whitelist</p>
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

export default function Settings() {
  const { data: balances, isLoading: balLoading } = useGetAccountBalance();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Connection status, security, and account information.</p>
      </header>

      <ConnectionPanel />

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
