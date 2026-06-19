import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListBots,
  useCreateBot,
  useDeleteBot,
  useStartBot,
  useStopBot,
  useUpdateBotConfig,
  useGetOrderBook,
  useGetAccountBalance,
  useGetBotLogs,
  getListBotsQueryKey,
  getGetOrderBookQueryKey,
  getGetBotLogsQueryKey,
} from "@workspace/api-client-react";
import type { BotInstance } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Square, Plus, Trash2, Settings2, Activity, AlertCircle, CheckCircle2, Info,
  Loader2, TrendingUp, TrendingDown, Target, ArrowUpDown, AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const configSchema = z.object({
  pair: z.string().min(1, "Trading pair is required"),
  orderSize: z.string().min(1, "Order size is required"),
  maxBidPrice: z.string().min(1, "Max bid price is required"),
  tickSize: z.string().min(1, "Tick size is required"),
  checkIntervalMs: z.coerce.number().min(500, "Interval must be at least 500ms"),
});
type ConfigForm = z.infer<typeof configSchema>;

const DEFAULT_VALUES: ConfigForm = {
  pair: "",
  orderSize: "0.001",
  maxBidPrice: "100000",
  tickSize: "0.1",
  checkIntervalMs: 3000,
};

function decimalPlaces(v: string): number {
  const p = v.split(".");
  return p.length > 1 ? p[1]!.length : 0;
}

function calcTarget(topBid: string | null, tick: string): string | null {
  if (!topBid || !tick) return null;
  const b = parseFloat(topBid), t = parseFloat(tick);
  if (isNaN(b) || isNaN(t) || t <= 0) return null;
  return (b + t).toFixed(Math.max(decimalPlaces(topBid), decimalPlaces(tick)));
}

function PositionBadge({ owner }: { owner: "bot" | "other" | "none" }) {
  if (owner === "bot") return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase text-[10px] tracking-wider">At Top</Badge>;
  if (owner === "other") return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase text-[10px] tracking-wider">Outbid</Badge>;
  return <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">No Order</Badge>;
}

function StatusBadge({ running }: { running: boolean }) {
  return running
    ? <Badge className="bg-primary/10 text-primary border border-primary/30 uppercase text-[10px] tracking-wider">Running</Badge>
    : <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">Stopped</Badge>;
}

interface MarketRefProps {
  pair: string;
  tickSize: string;
  maxBidPrice: string;
}

function MarketRef({ pair, tickSize, maxBidPrice }: MarketRefProps) {
  const { data: book, isLoading } = useGetOrderBook(
    { pair },
    { query: { refetchInterval: 2000, enabled: pair.length > 0, queryKey: getGetOrderBookQueryKey({ pair }) } }
  );

  const topBid = book?.bids[0]?.price ?? null;
  const topAsk = book?.asks[0]?.price ?? null;
  const target = calcTarget(topBid, tickSize);
  const exceedsMax = target != null && parseFloat(target) > parseFloat(maxBidPrice);

  if (!pair) return null;
  if (isLoading) return <div className="text-xs text-muted-foreground flex items-center gap-1 mt-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading market data…</div>;
  if (!book) return null;

  return (
    <div className={`rounded-lg border p-3 text-xs space-y-2 mt-2 ${exceedsMax ? "border-red-700/50 bg-red-950/20" : "border-border bg-muted/30"}`}>
      <div className="flex items-center gap-1 text-muted-foreground font-medium uppercase tracking-wider text-[10px]">
        <ArrowUpDown className="w-3 h-3" /> Live Market · {pair}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-[10px]">Top Bid</p>
          <p className="font-mono font-semibold text-emerald-400">{topBid ?? "—"}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-[10px]">Top Ask</p>
          <p className="font-mono font-semibold text-red-400">{topAsk ?? "—"}</p>
        </div>
        <div className="space-y-0.5">
          <p className={`text-[10px] ${exceedsMax ? "text-red-400" : "text-primary"}`}>Our Target</p>
          <p className={`font-mono font-semibold ${exceedsMax ? "text-red-400" : "text-primary"}`}>{target ?? "—"}</p>
        </div>
      </div>
      {exceedsMax && (
        <p className="flex items-center gap-1 text-red-400 text-[10px]">
          <AlertTriangle className="w-3 h-3 shrink-0" /> Target exceeds Max Bid Price — bot will pause immediately
        </p>
      )}
    </div>
  );
}

interface BotDialogProps {
  open: boolean;
  onClose: () => void;
  editBot?: BotInstance | null;
}

function BotDialog({ open, onClose, editBot }: BotDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBot = useCreateBot();
  const updateConfig = useUpdateBotConfig();
  const isEdit = !!editBot;

  const form = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    values: isEdit
      ? {
          pair: editBot.config.pair,
          orderSize: editBot.config.orderSize,
          maxBidPrice: editBot.config.maxBidPrice,
          tickSize: editBot.config.tickSize,
          checkIntervalMs: editBot.config.checkIntervalMs ?? 3000,
        }
      : DEFAULT_VALUES,
  });

  const watchPair = form.watch("pair");
  const watchTick = form.watch("tickSize");
  const watchMax = form.watch("maxBidPrice");

  const isPending = createBot.isPending || updateConfig.isPending;

  const onSubmit = (values: ConfigForm) => {
    if (isEdit) {
      updateConfig.mutate(
        { botId: editBot.id, data: values },
        {
          onSuccess: () => {
            toast({ title: "Config updated" });
            queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
            onClose();
          },
          onError: (err) => {
            toast({ variant: "destructive", title: "Failed to update", description: err instanceof Error ? err.message : "Error" });
          },
        }
      );
    } else {
      createBot.mutate(
        { data: values },
        {
          onSuccess: () => {
            toast({ title: `Bot created for ${values.pair}` });
            queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
            form.reset(DEFAULT_VALUES);
            onClose();
          },
          onError: (err) => {
            toast({ variant: "destructive", title: "Failed to create", description: err instanceof Error ? err.message : "Error" });
          },
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Bot — ${editBot.config.pair}` : "Add New Bot"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update configuration for this bot. Stop the bot first to apply changes."
              : "Configure a new top-of-book buy bot for a trading pair."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="pair"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trading Pair</FormLabel>
                    <FormControl>
                      <Input placeholder="XXBTZUSD" className="font-mono" disabled={isEdit} {...field} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      e.g. <span className="font-mono">XXBTZUSD</span>, <span className="font-mono">SOLUSD</span>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="orderSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Size</FormLabel>
                    <FormControl>
                      <Input placeholder="0.001" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Volume per order</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxBidPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Bid Price</FormLabel>
                    <FormControl>
                      <Input placeholder="100000" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Bot stops if exceeded</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tickSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tick Size</FormLabel>
                    <FormControl>
                      <Input placeholder="0.1" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Outbid increment (e.g. <span className="font-mono">0.000001</span>)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="checkIntervalMs"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Check Interval (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="3000" className="font-mono max-w-[160px]" {...field} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Min 500ms, recommended 2000–5000ms</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <MarketRef pair={watchPair} tickSize={watchTick} maxBidPrice={watchMax} />

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isEdit ? "Save Changes" : "Create Bot"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface BotCardProps {
  bot: BotInstance;
  onEdit: (bot: BotInstance) => void;
}

function BotCard({ bot, onEdit }: BotCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const deleteBot = useDeleteBot();
  const [showLogs, setShowLogs] = useState(false);

  const { id, config, status } = bot;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });

  const handleStart = () => {
    startBot.mutate(
      { botId: id },
      {
        onSuccess: () => { toast({ title: `${id} started` }); invalidate(); },
        onError: (err) => toast({ variant: "destructive", title: "Start failed", description: err instanceof Error ? err.message : "Error" }),
      }
    );
  };

  const handleStop = () => {
    stopBot.mutate(
      { botId: id },
      {
        onSuccess: () => { toast({ title: `${id} stopped` }); invalidate(); },
        onError: (err) => toast({ variant: "destructive", title: "Stop failed", description: err instanceof Error ? err.message : "Error" }),
      }
    );
  };

  const handleDelete = () => {
    if (!confirm(`Remove bot for ${id}? This will cancel any open orders.`)) return;
    deleteBot.mutate(
      { botId: id },
      {
        onSuccess: () => { toast({ title: `${id} removed` }); invalidate(); },
        onError: (err) => toast({ variant: "destructive", title: "Delete failed", description: err instanceof Error ? err.message : "Error" }),
      }
    );
  };

  const isBusy = startBot.isPending || stopBot.isPending || deleteBot.isPending;

  return (
    <Card className="bg-card border-border shadow-md flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-mono text-lg font-bold tracking-tight">{id}</h3>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge running={status.running} />
              <PositionBadge owner={status.topBidOwner} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => onEdit(bot)}
              disabled={status.running || isBusy}
              title="Edit config"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={isBusy}
              title="Remove bot"
            >
              {deleteBot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {/* Order info */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <div className="text-muted-foreground text-xs">Order Price</div>
          <div className="font-mono text-xs font-semibold text-primary text-right">{status.currentOrderPrice ?? "—"}</div>
          <div className="text-muted-foreground text-xs">Volume</div>
          <div className="font-mono text-xs text-right">{status.currentOrderVolume ?? "—"}</div>
          <div className="text-muted-foreground text-xs">Top Bid</div>
          <div className="font-mono text-xs text-right text-emerald-400">{status.topBidPrice ?? "—"}</div>
          <div className="text-muted-foreground text-xs">Max Price</div>
          <div className="font-mono text-xs text-right">{config.maxBidPrice}</div>
          <div className="text-muted-foreground text-xs">Cycles</div>
          <div className="font-mono text-xs text-right">{status.cycleCount}</div>
        </div>

        {status.lastAction && (
          <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1 truncate" title={status.lastAction}>
            {status.lastAction}
          </p>
        )}

        {/* Logs toggle */}
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Activity className="w-3 h-3" />
          {showLogs ? "Hide" : "Show"} activity log
        </button>

        {showLogs && <BotLogList botId={id} />}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {status.running ? (
            <Button
              onClick={handleStop}
              disabled={isBusy}
              variant="destructive"
              size="sm"
              className="flex-1 font-semibold"
            >
              {stopBot.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Square className="w-3 h-3 mr-1.5" />}
              Stop
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={isBusy}
              size="sm"
              className="flex-1 font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {startBot.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Play className="w-3 h-3 mr-1.5" />}
              Start
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BotLogList({ botId }: { botId: string }) {
  const { data: logs, isLoading } = useGetBotLogsInline(botId);

  if (isLoading) return <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;
  if (!logs?.length) return <div className="text-xs text-muted-foreground">No activity yet.</div>;

  return (
    <div className="space-y-1 max-h-40 overflow-y-auto text-xs">
      {logs.slice(0, 20).map((log) => {
        let Icon = Info;
        let color = "text-blue-400";
        if (log.level === "success") { Icon = CheckCircle2; color = "text-emerald-400"; }
        else if (log.level === "warn") { Icon = AlertCircle; color = "text-amber-400"; }
        else if (log.level === "error") { Icon = AlertCircle; color = "text-red-400"; }

        return (
          <div key={log.id} className="flex items-start gap-1.5 font-mono">
            <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} />
            <span className="text-muted-foreground text-[10px] shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className="text-foreground/80 truncate">{log.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function useGetBotLogsInline(botId: string) {
  return useGetBotLogs(botId, { limit: 20 }, { query: { refetchInterval: 3000, queryKey: getGetBotLogsQueryKey(botId, { limit: 20 }) } });
}

export default function Dashboard() {
  const { data: bots, isLoading } = useListBots({
    query: { refetchInterval: 2000, queryKey: getListBotsQueryKey() },
  });
  const { data: balances } = useGetAccountBalance();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBot, setEditBot] = useState<BotInstance | null>(null);

  const openAdd = () => { setEditBot(null); setDialogOpen(true); };
  const openEdit = (bot: BotInstance) => { setEditBot(bot); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditBot(null); };

  const runningCount = bots?.filter((b) => b.status.running).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            {bots?.length
              ? `${bots.length} bot${bots.length !== 1 ? "s" : ""} configured · ${runningCount} running`
              : "No bots configured yet"}
          </p>
        </div>
        <Button onClick={openAdd} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold shrink-0">
          <Plus className="w-4 h-4 mr-2" /> Add Bot
        </Button>
      </header>

      {/* Account balances */}
      {balances && balances.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {balances.filter((b) => parseFloat(b.balance) > 0).map((a) => (
            <div key={a.asset} className="bg-card border border-border rounded-lg px-4 py-2.5 min-w-[120px]">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{a.asset}</div>
              <div className="font-mono text-base font-bold">{parseFloat(a.balance).toFixed(4)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bot cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      ) : !bots?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4 border border-dashed border-border rounded-xl">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">No bots yet</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-xs">
              Create your first bot to start top-of-book bidding on a Kraken trading pair.
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" /> Add Bot
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} onEdit={openEdit} />
          ))}
        </div>
      )}

      <BotDialog open={dialogOpen} onClose={closeDialog} editBot={editBot} />
    </div>
  );
}
