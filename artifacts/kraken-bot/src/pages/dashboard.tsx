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
  useGetBotFills,
  getListBotsQueryKey,
  getGetOrderBookQueryKey,
  getGetBotLogsQueryKey,
  getGetBotFillsQueryKey,
} from "@workspace/api-client-react";
import type { BotInstance } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Square, Plus, Trash2, Settings2, AlertCircle, CheckCircle2, Info,
  Loader2, TrendingUp, ArrowUpDown, AlertTriangle, ChevronDown, ChevronUp,
  ShieldAlert,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Config form schema ───────────────────────────────────────────────────────

const configSchema = z.object({
  pair: z.string().min(1, "Trading pair is required"),
  orderSize: z.string().min(1, "Order size is required"),
  maxBidPrice: z.string().min(1, "Max bid price is required"),
  tickSize: z.string().min(1, "Tick size is required"),
  checkIntervalMs: z.coerce.number().min(500, "Interval minimal 500ms"),
  oneShotMode: z.boolean().default(false),
  maxConsecutiveErrors: z.coerce.number().min(1).max(20).default(5),
  orderSizeMode: z.enum(["fixed", "percent"]).default("fixed"),
  orderSizePercent: z.string().default("10"),
});
type ConfigForm = z.infer<typeof configSchema>;

const DEFAULT_VALUES: ConfigForm = {
  pair: "",
  orderSize: "0.001",
  maxBidPrice: "100000",
  tickSize: "0.1",
  checkIntervalMs: 3000,
  oneShotMode: false,
  maxConsecutiveErrors: 5,
  orderSizeMode: "fixed",
  orderSizePercent: "10",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function isPausedAtMax(bot: BotInstance): boolean {
  return (
    bot.status.running &&
    bot.status.topBidOwner === "other" &&
    bot.status.currentOrderId === null
  );
}

// ─── Position chip ────────────────────────────────────────────────────────────

function PositionChip({ bot }: { bot: BotInstance }) {
  const paused = isPausedAtMax(bot);
  const cb = bot.status.circuitBreakerTripped;
  const { running, topBidOwner } = bot.status;

  if (cb) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400">🔌 Circuit Breaker</span>;
  if (!running) return <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">⏹ Stopped</span>;
  if (paused) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-400">⏸ Batas Maks</span>;
  if (topBidOwner === "bot") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">🏆 At Top</span>;
  if (topBidOwner === "other") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">📉 Outbid</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-400">⏳ No Order</span>;
}

function RunningDot({ running }: { running: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {running && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${running ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
    </span>
  );
}

// ─── Live market reference ────────────────────────────────────────────────────

function MarketRef({ pair, tickSize, maxBidPrice }: { pair: string; tickSize: string; maxBidPrice: string }) {
  const { data: book, isLoading } = useGetOrderBook(
    { pair },
    { query: { refetchInterval: 2000, enabled: pair.length > 0, queryKey: getGetOrderBookQueryKey({ pair }) } }
  );

  const topBid = book?.bids[0]?.price ?? null;
  const topAsk = book?.asks[0]?.price ?? null;
  const target = calcTarget(topBid, tickSize);
  const exceedsMax = target != null && parseFloat(target) > parseFloat(maxBidPrice);

  if (!pair) return null;
  if (isLoading) return <div className="text-xs text-muted-foreground flex items-center gap-1 mt-2"><Loader2 className="w-3 h-3 animate-spin" /> Memuat data pasar…</div>;
  if (!book) return null;

  return (
    <div className={`rounded-lg border p-3 text-xs space-y-2 mt-1 ${exceedsMax ? "border-red-700/50 bg-red-950/20" : "border-border bg-muted/30"}`}>
      <div className="flex items-center gap-1 text-muted-foreground font-medium uppercase tracking-wider text-[10px]">
        <ArrowUpDown className="w-3 h-3" /> Live Market · {pair}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><p className="text-muted-foreground text-[10px]">Top Bid</p><p className="font-mono font-semibold text-emerald-400">{topBid ?? "—"}</p></div>
        <div><p className="text-muted-foreground text-[10px]">Top Ask</p><p className="font-mono font-semibold text-red-400">{topAsk ?? "—"}</p></div>
        <div>
          <p className={`text-[10px] ${exceedsMax ? "text-red-400" : "text-primary"}`}>Target Kita</p>
          <p className={`font-mono font-semibold ${exceedsMax ? "text-red-400" : "text-primary"}`}>{target ?? "—"}</p>
        </div>
      </div>
      {exceedsMax && (
        <p className="flex items-center gap-1 text-red-400 text-[10px]">
          <AlertTriangle className="w-3 h-3 shrink-0" /> Target melebihi Max Bid — bot akan langsung pause
        </p>
      )}
    </div>
  );
}

// ─── Add / Edit dialog ────────────────────────────────────────────────────────

function BotDialog({ open, onClose, editBot }: { open: boolean; onClose: () => void; editBot?: BotInstance | null }) {
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
          oneShotMode: editBot.config.oneShotMode ?? false,
          maxConsecutiveErrors: editBot.config.maxConsecutiveErrors ?? 5,
          orderSizeMode: (editBot.config.orderSizeMode ?? "fixed") as "fixed" | "percent",
          orderSizePercent: editBot.config.orderSizePercent ?? "10",
        }
      : DEFAULT_VALUES,
  });

  const watchPair = form.watch("pair");
  const watchTick = form.watch("tickSize");
  const watchMax = form.watch("maxBidPrice");
  const watchSizeMode = form.watch("orderSizeMode");
  const isPending = createBot.isPending || updateConfig.isPending;

  const onSubmit = (values: ConfigForm) => {
    const payload = { ...values, orderSizeMode: values.orderSizeMode as "fixed" | "percent" };
    if (isEdit) {
      updateConfig.mutate(
        { botId: editBot.id, data: payload },
        {
          onSuccess: () => { toast({ title: "Config updated" }); queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() }); onClose(); },
          onError: (err) => toast({ variant: "destructive", title: "Gagal update", description: err instanceof Error ? err.message : "Error" }),
        }
      );
    } else {
      createBot.mutate(
        { data: payload },
        {
          onSuccess: () => { toast({ title: `Bot ${values.pair} dibuat` }); queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() }); form.reset(DEFAULT_VALUES); onClose(); },
          onError: (err) => toast({ variant: "destructive", title: "Gagal buat bot", description: err instanceof Error ? err.message : "Error" }),
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Bot — ${editBot.config.pair}` : "Tambah Bot Baru"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update konfigurasi. Stop bot dulu sebelum edit." : "Konfigurasi bot top-of-book baru."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="pair" render={({ field }) => (
                <FormItem>
                  <FormLabel>Trading Pair</FormLabel>
                  <FormControl><Input placeholder="XXBTZUSD" className="font-mono" disabled={isEdit} {...field} /></FormControl>
                  <FormDescription className="text-[11px]">e.g. <span className="font-mono">XXBTZUSD</span>, <span className="font-mono">SOLUSD</span></FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="maxBidPrice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Bid Price</FormLabel>
                  <FormControl><Input placeholder="100000" className="font-mono" {...field} /></FormControl>
                  <FormDescription className="text-[11px]">Bot pause jika terlampaui</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="tickSize" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tick Size</FormLabel>
                  <FormControl><Input placeholder="0.1" className="font-mono" {...field} /></FormControl>
                  <FormDescription className="text-[11px]">Kenaikan per outbid</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="checkIntervalMs" render={({ field }) => (
                <FormItem>
                  <FormLabel>Interval (ms)</FormLabel>
                  <FormControl><Input type="number" placeholder="3000" className="font-mono" {...field} /></FormControl>
                  <FormDescription className="text-[11px]">Min 500ms</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Order size section */}
            <div className="rounded-lg border border-border p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Order Size</p>
              <FormField control={form.control} name="orderSizeMode" render={({ field }) => (
                <FormItem>
                  <div className="flex gap-2">
                    {(["fixed", "percent"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => field.onChange(m)}
                        className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${field.value === m ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        {m === "fixed" ? "Fixed Volume" : "% Balance"}
                      </button>
                    ))}
                  </div>
                </FormItem>
              )} />

              {watchSizeMode === "fixed" ? (
                <FormField control={form.control} name="orderSize" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Volume per Order</FormLabel>
                    <FormControl><Input placeholder="0.001" className="font-mono" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="orderSizePercent" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">% dari Balance ZUSD</FormLabel>
                      <div className="relative">
                        <FormControl><Input placeholder="10" className="font-mono pr-6" {...field} /></FormControl>
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                      <FormDescription className="text-[11px]">e.g. 10 = pakai 10% ZUSD</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="orderSize" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Fallback Volume</FormLabel>
                      <FormControl><Input placeholder="0.001" className="font-mono" {...field} /></FormControl>
                      <FormDescription className="text-[11px]">Jika balance fetch gagal</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}
            </div>

            {/* Advanced toggles */}
            <div className="space-y-2">
              <FormField control={form.control} name="oneShotMode" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                    <div>
                      <FormLabel className="text-sm font-medium cursor-pointer">🎯 One-Shot Mode</FormLabel>
                      <FormDescription className="text-[11px]">Berhenti otomatis setelah order pertama terisi</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </div>
                </FormItem>
              )} />

              <FormField control={form.control} name="maxConsecutiveErrors" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                    <div>
                      <FormLabel className="text-sm font-medium">🔌 Circuit Breaker</FormLabel>
                      <FormDescription className="text-[11px]">Stop otomatis setelah N error berturut-turut</FormDescription>
                    </div>
                    <FormControl>
                      <Input type="number" min={1} max={20} className="font-mono w-16 text-center" {...field} />
                    </FormControl>
                  </div>
                </FormItem>
              )} />
            </div>

            <MarketRef pair={watchPair} tickSize={watchTick} maxBidPrice={watchMax} />

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Batal</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isEdit ? "Simpan" : "Buat Bot"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fill history panel ───────────────────────────────────────────────────────

function BotFillList({ botId }: { botId: string }) {
  const { data: fills, isLoading } = useGetBotFills(
    botId,
    { limit: 50 },
    { query: { refetchInterval: 5000, queryKey: getGetBotFillsQueryKey(botId, { limit: 50 }) } }
  );

  if (isLoading) return <div className="text-xs text-muted-foreground flex items-center gap-1 py-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;
  if (!fills?.length) return <div className="text-xs text-muted-foreground py-2">Belum ada order terisi.</div>;

  return (
    <div className="space-y-0 max-h-44 overflow-y-auto pr-1">
      <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider pb-1 border-b border-border/50">
        <span>Waktu</span><span>Harga</span><span>Volume</span><span className="truncate">Order ID</span>
      </div>
      {fills.map((f) => (
        <div key={f.id} className="grid grid-cols-4 gap-2 text-xs py-1 border-b border-border/20">
          <span className="text-muted-foreground text-[10px] tabular-nums">{new Date(f.timestamp).toLocaleTimeString()}</span>
          <span className="font-mono text-emerald-400 font-semibold">{f.price}</span>
          <span className="font-mono">{f.volume}</span>
          <span className="font-mono text-muted-foreground text-[10px] truncate" title={f.orderId}>{f.orderId}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Inline activity log ──────────────────────────────────────────────────────

function BotLogList({ botId }: { botId: string }) {
  const { data: logs, isLoading } = useGetBotLogs(
    botId,
    { limit: 20 },
    { query: { refetchInterval: 3000, queryKey: getGetBotLogsQueryKey(botId, { limit: 20 }) } }
  );

  if (isLoading) return <div className="text-xs text-muted-foreground flex items-center gap-1 py-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;
  if (!logs?.length) return <div className="text-xs text-muted-foreground py-2">Belum ada aktivitas.</div>;

  return (
    <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
      {logs.map((log) => {
        let Icon = Info;
        let color = "text-blue-400";
        if (log.level === "success") { Icon = CheckCircle2; color = "text-emerald-400"; }
        else if (log.level === "warn") { Icon = AlertCircle; color = "text-amber-400"; }
        else if (log.level === "error") { Icon = AlertCircle; color = "text-red-400"; }
        return (
          <div key={log.id} className="flex items-start gap-2 font-mono text-xs py-0.5">
            <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} />
            <span className="text-muted-foreground text-[10px] shrink-0 tabular-nums">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className="text-foreground/80 min-w-0 break-words">{log.message}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Bot list row ─────────────────────────────────────────────────────────────

type ExpandPanel = "logs" | "fills" | null;

function BotRow({ bot, onEdit }: { bot: BotInstance; onEdit: (bot: BotInstance) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const deleteBot = useDeleteBot();
  const [panel, setPanel] = useState<ExpandPanel>(null);

  const { id, config, status } = bot;
  const paused = isPausedAtMax(bot);
  const cb = status.circuitBreakerTripped;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
  const isBusy = startBot.isPending || stopBot.isPending || deleteBot.isPending;

  const togglePanel = (p: ExpandPanel) => setPanel((prev) => prev === p ? null : p);

  const handleStart = () => startBot.mutate({ botId: id }, {
    onSuccess: () => { toast({ title: `▶ ${id} started` }); invalidate(); },
    onError: (err) => toast({ variant: "destructive", title: "Start failed", description: err instanceof Error ? err.message : "Error" }),
  });

  const handleStop = () => stopBot.mutate({ botId: id }, {
    onSuccess: () => { toast({ title: `⏹ ${id} stopped` }); invalidate(); },
    onError: (err) => toast({ variant: "destructive", title: "Stop failed", description: err instanceof Error ? err.message : "Error" }),
  });

  const handleDelete = () => {
    if (!confirm(`Hapus bot ${id}? Order terbuka akan dibatalkan.`)) return;
    deleteBot.mutate({ botId: id }, {
      onSuccess: () => { toast({ title: `🗑 ${id} dihapus` }); invalidate(); },
      onError: (err) => toast({ variant: "destructive", title: "Delete failed", description: err instanceof Error ? err.message : "Error" }),
    });
  };

  const borderClass = cb
    ? "border-red-700/50 bg-red-950/10"
    : paused
    ? "border-orange-700/50 bg-orange-950/10"
    : "border-border bg-card";

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${borderClass}`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap md:flex-nowrap">
        {/* Pair + dot */}
        <div className="flex items-center gap-2.5 min-w-[140px]">
          <RunningDot running={status.running} />
          <span className="font-mono font-bold text-base tracking-tight">{id}</span>
        </div>

        {/* Position chip */}
        <div className="min-w-[130px]">
          <PositionChip bot={bot} />
        </div>

        {/* Order details */}
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            <span className="text-muted-foreground">Order</span>
            <span className="font-mono text-primary font-semibold">{status.currentOrderPrice ?? "—"}</span>
            <span className="text-muted-foreground">×</span>
            <span className="font-mono">{status.currentOrderVolume ?? config.orderSize}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs mt-0.5">
            <span className="text-muted-foreground">Top bid</span>
            <span className="font-mono text-emerald-400">{status.topBidPrice ?? "—"}</span>
            <span className="text-muted-foreground">Max</span>
            <span className="font-mono text-muted-foreground">{config.maxBidPrice}</span>
          </div>
        </div>

        {/* Config pills */}
        <div className="hidden lg:flex flex-wrap gap-1.5 text-[10px] min-w-[200px]">
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">tick {config.tickSize}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
            {config.orderSizeMode === "percent" ? `${config.orderSizePercent}% bal` : `sz ${config.orderSize}`}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{config.checkIntervalMs}ms</span>
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{status.cycleCount} cycles</span>
          {config.oneShotMode && <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 font-medium">🎯 one-shot</span>}
          {cb && <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 font-medium">🔌 {status.consecutiveErrors} err</span>}
        </div>

        {/* Last action */}
        <div className="hidden xl:block flex-1 min-w-0">
          {status.lastAction && <p className="text-[11px] text-muted-foreground truncate" title={status.lastAction}>{status.lastAction}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button onClick={() => togglePanel("fills")} className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors ${panel === "fills" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Fill history">
            <CheckCircle2 className="w-4 h-4" />
          </button>
          <button onClick={() => togglePanel("logs")} className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors ${panel === "logs" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Activity log">
            {panel === "logs" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button onClick={() => onEdit(bot)} disabled={status.running || isBusy} className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Edit config">
            <Settings2 className="w-4 h-4" />
          </button>
          <button onClick={handleDelete} disabled={isBusy} className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40" title="Hapus bot">
            {deleteBot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
          {status.running ? (
            <Button onClick={handleStop} disabled={isBusy} variant="destructive" size="sm" className="ml-1 min-w-[76px] font-semibold">
              {stopBot.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Square className="w-3 h-3 mr-1.5 fill-current" />}Stop
            </Button>
          ) : (
            <Button onClick={handleStart} disabled={isBusy} size="sm" className="ml-1 min-w-[76px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
              {startBot.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Play className="w-3 h-3 mr-1.5 fill-current" />}Start
            </Button>
          )}
        </div>
      </div>

      {/* Circuit breaker banner */}
      {cb && (
        <div className="flex items-center gap-2.5 px-4 py-2 bg-red-950/30 border-t border-red-700/30 text-xs text-red-300">
          <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
          <span>
            🔌 Circuit breaker aktif — <span className="font-semibold">{status.consecutiveErrors} error berturut-turut</span>. Bot dihentikan otomatis. Start ulang setelah masalah teratasi.
          </span>
        </div>
      )}

      {/* Max-price paused banner */}
      {paused && !cb && (
        <div className="flex items-center gap-2.5 px-4 py-2 bg-orange-950/30 border-t border-orange-700/30 text-xs text-orange-300">
          <span className="text-base leading-none">⏸</span>
          <span>Bot di-pause — target harga melebihi <span className="font-mono font-semibold">{config.maxBidPrice}</span>. Naikkan Max Bid Price atau tunggu harga pasar turun.</span>
        </div>
      )}

      {/* Expandable panels */}
      {panel === "fills" && (
        <div className="px-4 pb-3 pt-2 border-t border-border/60 bg-background/40">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Fill History</p>
          <BotFillList botId={id} />
        </div>
      )}
      {panel === "logs" && (
        <div className="px-4 pb-3 pt-2 border-t border-border/60 bg-background/40">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Activity Log</p>
          <BotLogList botId={id} />
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

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
  const pausedCount = bots?.filter(isPausedAtMax).length ?? 0;
  const cbCount = bots?.filter((b) => b.status.circuitBreakerTripped).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {bots?.length
              ? [
                  `${bots.length} bot`,
                  `${runningCount} running`,
                  pausedCount > 0 && `${pausedCount} ⏸ paused`,
                  cbCount > 0 && `${cbCount} 🔌 tripped`,
                ].filter(Boolean).join(" · ")
              : "Belum ada bot"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {balances?.filter((b) => parseFloat(b.balance) > 0).map((a) => (
            <div key={a.asset} className="bg-card border border-border rounded-lg px-3 py-1.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1.5">{a.asset}</span>
              <span className="font-mono text-sm font-bold">{parseFloat(a.balance).toFixed(4)}</span>
            </div>
          ))}
          <Button onClick={openAdd} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold shrink-0">
            <Plus className="w-4 h-4 mr-1.5" /> Add Bot
          </Button>
        </div>
      </div>

      {/* Bot list */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : !bots?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4 border border-dashed border-border rounded-xl">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Belum ada bot</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-xs">Buat bot pertama untuk mulai top-of-book bidding di Kraken.</p>
          </div>
          <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Bot</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map((bot) => <BotRow key={bot.id} bot={bot} onEdit={openEdit} />)}
        </div>
      )}

      <BotDialog open={dialogOpen} onClose={closeDialog} editBot={editBot} />
    </div>
  );
}
