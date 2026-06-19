import { useGetBotStatus, useGetOrderBook, useGetAccountBalance, useGetBotLogs, useStartBot, useStopBot, getGetBotStatusQueryKey, getGetBotLogsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Activity, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } = useGetBotStatus({ query: { refetchInterval: 2000 } });
  const { data: orderBook, isLoading: obLoading } = useGetOrderBook({ query: { refetchInterval: 2000 } });
  const { data: balances, isLoading: balLoading } = useGetAccountBalance();
  const { data: logs, isLoading: logsLoading } = useGetBotLogs({ limit: 50 }, { query: { refetchInterval: 3000 } });

  const startBot = useStartBot();
  const stopBot = useStopBot();

  const handleStart = () => {
    // Requires config, but for quick start we might need default config.
    // The requirement says start/stop from settings too, but here we can just use an empty object if the backend allows, 
    // but the API requires BotConfigInput. We should get it from useGetBotConfig if needed.
    // Assuming startBot from dashboard uses existing config if we can't fetch it here easily, but let's just make it a button that goes to settings if no config, or we fetch config first.
    // Actually the requirement says "Start/Stop button: big, prominent... On settings page... Save config and start/stop the bot from here too."
    // Let's implement stop first, and if we start, maybe we need the config. For now we will fetch config.
  };

  const handleStop = () => {
    stopBot.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBotLogsQueryKey() });
      }
    });
  };

  // We should fetch config to be able to start the bot from here
  // But let's build the UI first.

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Real-time market data and bot performance.</p>
        </div>
        <div className="flex items-center gap-3">
          {statusLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : status?.running ? (
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10 px-3 py-1 font-mono text-sm uppercase">Running</Badge>
              <Button onClick={handleStop} disabled={stopBot.isPending} variant="destructive" className="font-bold">
                <Square className="w-4 h-4 mr-2" /> Stop Bot
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-muted text-muted-foreground bg-secondary px-3 py-1 font-mono text-sm uppercase">Stopped</Badge>
              <Button onClick={() => window.location.href="/settings"} className="font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                <Play className="w-4 h-4 mr-2" /> Configure & Start
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Card */}
        <Card className="lg:col-span-1 bg-card border-card-border shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Current Order Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-2/3" /></div>
            ) : status ? (
              <div className="space-y-4">
                <div className="flex justify-between items-baseline border-b border-border pb-3">
                  <span className="text-sm text-muted-foreground">Pair</span>
                  <span className="font-mono font-bold text-lg">{status.pair || "—"}</span>
                </div>
                <div className="flex justify-between items-baseline border-b border-border pb-3">
                  <span className="text-sm text-muted-foreground">Price</span>
                  <span className="font-mono font-bold text-lg text-primary">{status.currentOrderPrice || "—"}</span>
                </div>
                <div className="flex justify-between items-baseline border-b border-border pb-3">
                  <span className="text-sm text-muted-foreground">Volume</span>
                  <span className="font-mono text-lg">{status.currentOrderVolume || "—"}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm text-muted-foreground">Position</span>
                  {status.topBidOwner === "bot" ? (
                    <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20 uppercase">At Top</Badge>
                  ) : status.topBidOwner === "other" ? (
                    <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20 uppercase">Outbid</Badge>
                  ) : (
                    <Badge variant="secondary" className="uppercase">No Order</Badge>
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Account Balances */}
        <Card className="lg:col-span-2 bg-card border-card-border shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Asset Balances</CardTitle>
          </CardHeader>
          <CardContent>
            {balLoading ? (
              <div className="flex gap-4"><Skeleton className="h-16 w-32" /><Skeleton className="h-16 w-32" /></div>
            ) : (
              <div className="flex flex-wrap gap-4">
                {balances?.filter(b => parseFloat(b.balance) > 0).map((asset) => (
                  <div key={asset.asset} className="bg-secondary rounded-md p-4 min-w-[140px] border border-border">
                    <div className="text-xs text-muted-foreground mb-1 font-medium">{asset.asset}</div>
                    <div className="font-mono text-xl font-bold">{parseFloat(asset.balance).toFixed(4)}</div>
                  </div>
                ))}
                {(!balances || balances.filter(b => parseFloat(b.balance) > 0).length === 0) && (
                  <div className="text-muted-foreground text-sm py-4">No balances found.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[500px]">
        {/* Order Book */}
        <Card className="flex flex-col overflow-hidden bg-card border-card-border shadow-md h-full">
          <CardHeader className="pb-2 shrink-0 border-b border-border">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex justify-between">
              <span>Order Book {orderBook?.pair && `(${orderBook.pair})`}</span>
            </CardTitle>
          </CardHeader>
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            <div className="flex-1 overflow-y-auto border-r border-border bg-[#09090b]">
              <div className="sticky top-0 bg-[#111113] border-b border-border px-3 py-1.5 flex justify-between text-[10px] uppercase text-muted-foreground font-semibold">
                <span>Bid Vol</span>
                <span>Bid Price</span>
              </div>
              {obLoading ? (
                <div className="p-3 space-y-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-full" /></div>
              ) : (
                <div className="px-1 py-1 font-mono text-xs">
                  {orderBook?.bids.slice(0, 15).map((bid, i) => {
                    const isOurBid = status?.topBidOwner === "bot" && bid.price === status.topBidPrice;
                    return (
                      <div key={i} className={`flex justify-between px-2 py-1 rounded-sm ${isOurBid ? "bg-primary/20 text-primary font-bold border border-primary/30" : "text-emerald-400 hover:bg-secondary"}`}>
                        <span>{parseFloat(bid.volume).toFixed(4)}</span>
                        <span>{parseFloat(bid.price).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto bg-[#09090b]">
              <div className="sticky top-0 bg-[#111113] border-b border-border px-3 py-1.5 flex justify-between text-[10px] uppercase text-muted-foreground font-semibold">
                <span>Ask Price</span>
                <span>Ask Vol</span>
              </div>
              {obLoading ? (
                <div className="p-3 space-y-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-full" /></div>
              ) : (
                <div className="px-1 py-1 font-mono text-xs">
                  {orderBook?.asks.slice(0, 15).map((ask, i) => (
                    <div key={i} className="flex justify-between px-2 py-1 rounded-sm text-red-400 hover:bg-secondary">
                      <span>{parseFloat(ask.price).toFixed(2)}</span>
                      <span>{parseFloat(ask.volume).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Activity Log */}
        <Card className="flex flex-col overflow-hidden bg-card border-card-border shadow-md h-full">
          <CardHeader className="pb-2 shrink-0 border-b border-border">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Activity Log</CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1 p-0">
            {logsLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="divide-y divide-border/50">
                {logs.map((log) => {
                  let Icon = Info;
                  let colorClass = "text-blue-400";
                  let bgClass = "bg-blue-400/10";
                  
                  if (log.level === "success") {
                    Icon = CheckCircle2;
                    colorClass = "text-emerald-500";
                    bgClass = "bg-emerald-500/10";
                  } else if (log.level === "warn") {
                    Icon = AlertCircle;
                    colorClass = "text-amber-500";
                    bgClass = "bg-amber-500/10";
                  } else if (log.level === "error") {
                    Icon = AlertCircle;
                    colorClass = "text-red-500";
                    bgClass = "bg-red-500/10";
                  }

                  return (
                    <div key={log.id} className="p-3 flex items-start gap-3 hover:bg-secondary/50 transition-colors">
                      <div className={`p-1.5 rounded-md shrink-0 mt-0.5 ${bgClass} ${colorClass}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className={`text-sm font-medium capitalize ${colorClass}`}>{log.level}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-sm text-foreground/90">{log.message}</p>
                        {log.data && (
                          <div className="mt-1 text-xs font-mono text-muted-foreground bg-black/40 p-1.5 rounded truncate overflow-hidden">
                            {log.data}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No activity logs yet.
              </div>
            )}
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
