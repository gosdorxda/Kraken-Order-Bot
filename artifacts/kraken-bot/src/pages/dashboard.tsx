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
  useGetXtBalance,
  useGetBitmartBalance,
  useGetCoinstoreBalance,
  useGetBotLogs,
  useGetBotFills,
  getListBotsQueryKey,
  getGetOrderBookQueryKey,
  getGetBotLogsQueryKey,
  getGetBotFillsQueryKey,
  getGetAccountBalanceQueryKey,
  getGetXtBalanceQueryKey,
  getGetBitmartBalanceQueryKey,
  getGetCoinstoreBalanceQueryKey,
} from "@workspace/api-client-react";
import type { BotInstance } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Play, Square, Plus, Trash2, Settings2, AlertCircle, CheckCircle2, Info,
  Loader2, TrendingUp, ArrowUpDown, AlertTriangle, ChevronDown, ChevronUp,
  ShieldAlert, OctagonX, Search, X,
} from "lucide-react";
import { useEnabledExchanges } from "@/lib/preferences";
import { touchBot, getTouchOrder } from "@/lib/botOrder";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Config form schema ───────────────────────────────────────────────────────

const PAIR_RULES: Record<string, { pattern: RegExp; hint: string }> = {
  kraken:    { pattern: /^[A-Z0-9]{4,12}$/, hint: "Huruf besar tanpa pemisah, mis. XXBTZUSD" },
  xt:        { pattern: /^[a-z0-9]+_[a-z0-9]+$/, hint: "Huruf kecil dengan garis bawah, mis. btc_usdt" },
  bitmart:   { pattern: /^[A-Z0-9]+_[A-Z0-9]+$/, hint: "Huruf besar dengan garis bawah, mis. BTC_USDT" },
  coinstore: { pattern: /^[A-Z0-9]{4,20}$/, hint: "Huruf besar tanpa pemisah, mis. BTCUSDT" },
};

const configSchema = z.object({
  exchange: z.enum(["kraken", "xt", "bitmart", "coinstore"]).default("kraken"),
  pair: z.string().min(1, "Trading pair wajib diisi"),
  orderSize: z.string().min(1, "Order size is required"),
  maxBidPrice: z.string().min(1, "Max bid price is required"),
  tickSize: z.string().min(1, "Tick size is required"),
  checkIntervalMs: z.coerce.number().min(500, "Interval minimal 500ms"),
  oneShotMode: z.boolean().default(false),
  holdAtMax: z.boolean().default(false),
  maxConsecutiveErrors: z.coerce.number().min(1).max(20).default(5),
}).superRefine((data, ctx) => {
  if (!data.pair) return;
  const rule = PAIR_RULES[data.exchange];
  if (rule && !rule.pattern.test(data.pair)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.hint, path: ["pair"] });
  }
});
type ConfigForm = z.infer<typeof configSchema>;

const DEFAULT_VALUES: ConfigForm = {
  exchange: "kraken",
  pair: "",
  orderSize: "0.001",
  maxBidPrice: "100000",
  tickSize: "0.1",
  checkIntervalMs: 3000,
  oneShotMode: false,
  holdAtMax: false,
  maxConsecutiveErrors: 5,
};

const EXCHANGE_HINTS: Record<string, { pairExample: string; pairPlaceholder: string }> = {
  kraken:    { pairExample: "XXBTZUSD, SOLUSD",   pairPlaceholder: "XXBTZUSD" },
  xt:        { pairExample: "btc_usdt, sol_usdt",  pairPlaceholder: "btc_usdt" },
  bitmart:   { pairExample: "BTC_USDT, SOL_USDT",  pairPlaceholder: "BTC_USDT" },
  coinstore: { pairExample: "BTCUSDT, SOLUSDT",  pairPlaceholder: "BTCUSDT" },
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

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 5) return "baru saja";
  if (s < 60) return `${s}d lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  const d = Math.floor(h / 24);
  return `${d}h lalu`;
}

const EXCHANGE_STYLE: Record<string, { label: string; bg: string }> = {
  kraken:    { label: "K",  bg: "color-mix(in srgb, #7c3aed 80%, #4f46e5)" },
  xt:        { label: "XT", bg: "color-mix(in srgb, #0ea5e9 85%, #0284c7)" },
  bitmart:   { label: "BM", bg: "color-mix(in srgb, #1A6FAF 85%, #1250a0)" },
  coinstore: { label: "CS", bg: "color-mix(in srgb, #16a34a 85%, #15803d)" },
};

function isHoldingAtMax(bot: BotInstance): boolean {
  return (
    bot.status.running &&
    bot.status.topBidOwner === "other" &&
    bot.status.currentOrderId !== null &&
    (bot.config.holdAtMax ?? false)
  );
}

// ─── Position chip ────────────────────────────────────────────────────────────

function PositionChip({ bot }: { bot: BotInstance }) {
  const paused = isPausedAtMax(bot);
  const holding = isHoldingAtMax(bot);
  const cb = bot.status.circuitBreakerTripped;
  const { running, topBidOwner } = bot.status;

  const base = "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border";
  if (cb)               return <span className={`${base} bg-red-500/15 border-red-500/40 text-red-400`}>🔌 Circuit Breaker</span>;
  if (!running)         return <span className={`${base} bg-muted/60 border-border text-muted-foreground`}>⏹ Stopped</span>;
  if (paused)           return <span className={`${base} bg-orange-500/15 border-orange-500/40 text-orange-400`}>⏸ Batas Maks</span>;
  if (holding)          return <span className={`${base} bg-blue-500/15 border-blue-500/40 text-blue-400`}>📌 Hold at Max</span>;
  if (topBidOwner === "bot")   return <span className={`${base} bg-emerald-500/15 border-emerald-500/40 text-emerald-400`}>🏆 At Top</span>;
  if (topBidOwner === "other") return <span className={`${base} bg-amber-500/15 border-amber-500/40 text-amber-400`}>📉 Outbid</span>;
  return <span className={`${base} bg-blue-500/15 border-blue-500/40 text-blue-400`}>⏳ No Order</span>;
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

function MarketRef({ pair, exchange, tickSize, maxBidPrice, holdAtMax }: { pair: string; exchange: "kraken" | "xt" | "bitmart" | "coinstore"; tickSize: string; maxBidPrice: string; holdAtMax?: boolean }) {
  const { data: book, isLoading } = useGetOrderBook(
    { pair, exchange },
    { query: { refetchInterval: 2000, enabled: pair.length > 0, queryKey: getGetOrderBookQueryKey({ pair, exchange }) } }
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
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {holdAtMax
            ? "Target melebihi Max Bid — bot akan hold order di harga maks"
            : "Target melebihi Max Bid — bot akan langsung pause"}
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
    mode: "onChange",
    reValidateMode: "onChange",
    values: isEdit
      ? {
          exchange: (editBot.config.exchange as "kraken" | "xt" | "bitmart" | "coinstore") ?? "kraken",
          pair: editBot.config.pair,
          orderSize: editBot.config.orderSize,
          maxBidPrice: editBot.config.maxBidPrice,
          tickSize: editBot.config.tickSize,
          checkIntervalMs: editBot.config.checkIntervalMs ?? 3000,
          oneShotMode: editBot.config.oneShotMode ?? false,
          holdAtMax: editBot.config.holdAtMax ?? false,
          maxConsecutiveErrors: editBot.config.maxConsecutiveErrors ?? 5,
        }
      : DEFAULT_VALUES,
  });

  const watchPair = form.watch("pair");
  const watchTick = form.watch("tickSize");
  const watchMax = form.watch("maxBidPrice");
  const watchExchange = form.watch("exchange");
  const exchangeHint = EXCHANGE_HINTS[watchExchange] ?? EXCHANGE_HINTS["kraken"]!;
  const isKraken = watchExchange === "kraken";
  const isPending = createBot.isPending || updateConfig.isPending;

  const onSubmit = (values: ConfigForm) => {
    const payload = { ...values };
    if (isEdit) {
      updateConfig.mutate(
        { botId: editBot.id, data: payload },
        {
          onSuccess: () => { touchBot(editBot.id); toast({ title: "Config updated" }); queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() }); onClose(); },
          onError: (err) => toast({ variant: "destructive", title: "Gagal update", description: err instanceof Error ? err.message : "Error" }),
        }
      );
    } else {
      createBot.mutate(
        { data: payload },
        {
          onSuccess: () => { touchBot(values.pair); toast({ title: `Bot ${values.pair} dibuat` }); queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() }); form.reset(DEFAULT_VALUES); onClose(); },
          onError: (err) => toast({ variant: "destructive", title: "Gagal buat bot", description: err instanceof Error ? err.message : "Error" }),
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Bot — ${editBot.config.pair}` : "Tambah Bot Baru"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update konfigurasi. Stop bot dulu sebelum edit." : "Konfigurasi bot top-of-book baru."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* Exchange selector */}
            <FormField control={form.control} name="exchange" render={({ field }) => (
              <FormItem>
                <FormLabel>Exchange</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={isEdit}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih exchange" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="kraken">Kraken</SelectItem>
                    <SelectItem value="xt">XT.com</SelectItem>
                    <SelectItem value="bitmart">BitMart</SelectItem>
                    <SelectItem value="coinstore">Coinstore</SelectItem>
                  </SelectContent>
                </Select>
                {isEdit && <FormDescription className="text-[11px]">Exchange tidak bisa diubah setelah bot dibuat.</FormDescription>}
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="pair" render={({ field }) => (
                <FormItem>
                  <FormLabel>Trading Pair</FormLabel>
                  <FormControl><Input placeholder={exchangeHint.pairPlaceholder} className="font-mono" disabled={isEdit} {...field} /></FormControl>
                  <FormDescription className="text-[11px]">e.g. <span className="font-mono">{exchangeHint.pairExample}</span></FormDescription>
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

            <FormField control={form.control} name="orderSize" render={({ field }) => (
              <FormItem>
                <FormLabel>Jumlah Coin per Order</FormLabel>
                <FormControl><Input placeholder="0.001" className="font-mono" {...field} /></FormControl>
                <FormDescription className="text-[11px]">Volume aset yang dibeli per order, misal <span className="font-mono">0.001</span> BTC</FormDescription>
                <FormMessage />
              </FormItem>
            )} />

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

              <FormField control={form.control} name="holdAtMax" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                    <div>
                      <FormLabel className="text-sm font-medium cursor-pointer">📌 Tetap di Harga Maks</FormLabel>
                      <FormDescription className="text-[11px]">Tetap pasang order di harga maks saat saingan outbid (tidak pause)</FormDescription>
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

            <MarketRef pair={watchPair} exchange={watchExchange} tickSize={watchTick} maxBidPrice={watchMax} holdAtMax={form.watch("holdAtMax")} />

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
    { limit: 100 },
    { query: { refetchInterval: 3000, queryKey: getGetBotLogsQueryKey(botId, { limit: 100 }) } }
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

// ─── Bot card ─────────────────────────────────────────────────────────────────

type ExpandPanel = "logs" | "fills" | null;

function BotCard({ bot, onEdit }: { bot: BotInstance; onEdit: (bot: BotInstance) => void }) {
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

  const exchangeStyle = EXCHANGE_STYLE[config.exchange ?? "kraken"] ?? EXCHANGE_STYLE["kraken"]!;
  const lastActivity = timeAgo(status.lastActionAt);

  const lockedUsd = (() => {
    if (!status.running || status.currentOrderPrice == null) return null;
    const price = parseFloat(status.currentOrderPrice);
    const size = parseFloat(status.currentOrderVolume ?? config.orderSize);
    if (isNaN(price) || isNaN(size)) return null;
    return (price * size).toFixed(2);
  })();

  return (
    <div className={`group border rounded-xl overflow-hidden transition-all duration-200 flex flex-col hover:shadow-lg hover:shadow-black/5 ${borderClass}`}>
      {/* Card header: pair + exchange + dot + icon actions */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 font-black text-[11px] text-white"
            style={{ background: exchangeStyle.bg }}
          >
            {exchangeStyle.label}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-extrabold text-base tracking-tight truncate">{id}</span>
              <RunningDot running={status.running} />
            </div>
            {lastActivity && (
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Aktivitas {lastActivity}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => togglePanel("fills")} className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${panel === "fills" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Fill history">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => togglePanel("logs")} className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${panel === "logs" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Activity log">
            {panel === "logs" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onEdit(bot)} disabled={status.running || isBusy} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Edit config">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleDelete} disabled={isBusy} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40" title="Hapus bot">
            {deleteBot.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Status chip */}
      <div className="px-4 pb-3">
        <PositionChip bot={bot} />
      </div>

      {/* Stats grid */}
      <div className="mx-4 mb-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg bg-muted/30 border border-border/40 px-3 py-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 font-medium">Order</p>
          <p className="font-mono text-sm font-bold text-primary leading-tight">{status.currentOrderPrice ?? "—"}</p>
          <p className="font-mono text-[11px] text-muted-foreground">× {status.currentOrderVolume ?? config.orderSize}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 font-medium">Top Bid</p>
          <p className="font-mono text-sm font-bold text-emerald-400 leading-tight">{status.topBidPrice ?? "—"}</p>
          <p className="font-mono text-[11px] text-muted-foreground">max {config.maxBidPrice}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 font-medium">Siklus</p>
          <p className="font-mono text-sm font-semibold leading-tight">{status.cycleCount}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 font-medium">Terkunci</p>
          <p className="font-mono text-sm font-semibold text-amber-400/80 leading-tight">{lockedUsd != null ? `~${lockedUsd}` : "—"}</p>
        </div>
      </div>

      {/* Last action */}
      {status.lastAction && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1" title={status.lastAction}>
            <span className="text-muted-foreground/50">→</span>{status.lastAction}
          </p>
        </div>
      )}

      {/* Badges row */}
      {(config.oneShotMode || config.holdAtMax || cb) && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {config.oneShotMode && <span className="px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/40 text-[11px] font-semibold">🎯 one-shot</span>}
          {config.holdAtMax && <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/40 text-[11px] font-semibold">📌 hold-at-max</span>}
          {cb && <span className="px-2 py-0.5 rounded-md bg-red-500/15 text-red-300 border border-red-500/40 text-[11px] font-semibold">🔌 {status.consecutiveErrors} err</span>}
        </div>
      )}

      {/* Circuit breaker banner */}
      {cb && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-950/30 border-t border-red-700/30 text-xs text-red-300">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
          <span>Circuit breaker aktif — <span className="font-semibold">{status.consecutiveErrors}x error</span>. Start ulang setelah masalah teratasi.</span>
        </div>
      )}

      {/* Max-price paused banner */}
      {paused && !cb && (
        <div className="flex items-start gap-2 px-4 py-2 bg-orange-950/30 border-t border-orange-700/30 text-xs text-orange-300">
          <span className="shrink-0 mt-0.5">⏸</span>
          <span>Pause — target melebihi <span className="font-mono font-semibold">{config.maxBidPrice}</span>.</span>
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

      {/* Start / Stop — full-width footer */}
      <div className="mt-auto border-t border-border/40 px-4 py-3">
        {status.running ? (
          <Button onClick={handleStop} disabled={isBusy} variant="destructive" size="sm" className="w-full font-semibold">
            {stopBot.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Square className="w-3 h-3 mr-1.5 fill-current" />}Stop
          </Button>
        ) : (
          <Button onClick={handleStart} disabled={isBusy} size="sm" className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
            {startBot.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Play className="w-3 h-3 mr-1.5 fill-current" />}Start
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: bots, isLoading } = useListBots({
    query: { refetchInterval: 2000, queryKey: getListBotsQueryKey() },
  });
  const { data: krakenBalances } = useGetAccountBalance({ query: { refetchInterval: 30000, queryKey: getGetAccountBalanceQueryKey() } });
  const { data: xtBalances } = useGetXtBalance({ query: { refetchInterval: 300000, retry: false, queryKey: getGetXtBalanceQueryKey() } });
  const { data: bitmartBalances } = useGetBitmartBalance({ query: { refetchInterval: 300000, retry: false, queryKey: getGetBitmartBalanceQueryKey() } });
  const { data: coinstoreBalances } = useGetCoinstoreBalance({ query: { refetchInterval: 300000, retry: false, queryKey: getGetCoinstoreBalanceQueryKey() } });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { isEnabled } = useEnabledExchanges();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBot, setEditBot] = useState<BotInstance | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [krakenOpen, setKrakenOpen] = useState(false);
  const [xtOpen, setXtOpen] = useState(false);
  const [bitmartOpen, setBitmartOpen] = useState(false);
  const [coinstoreOpen, setCoinstoreOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const [exchangeFilter, setExchangeFilter] = useState<"all" | "kraken" | "xt" | "bitmart" | "coinstore">("all");

  const openAdd = () => { setEditBot(null); setDialogOpen(true); };
  const openEdit = (bot: BotInstance) => { setEditBot(bot); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditBot(null); };

  const handleEmergencyStop = async () => {
    setEmergencyBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/emergency-stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json() as { botsTopped: number; krakenCancelled: number; xtCancelled: number; bitmartCancelled: number; coinstoreCancelled: number; errors: string[] };
      queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
      const parts: string[] = [];
      if (data.botsTopped > 0) parts.push(`${data.botsTopped} bot dihentikan`);
      if (data.krakenCancelled > 0) parts.push(`${data.krakenCancelled} order Kraken dibatalkan`);
      if (data.xtCancelled > 0) parts.push(`${data.xtCancelled} pair XT dibersihkan`);
      if (data.bitmartCancelled > 0) parts.push(`${data.bitmartCancelled} pair BitMart dibersihkan`);
      if (data.coinstoreCancelled > 0) parts.push(`${data.coinstoreCancelled} pair Coinstore dibersihkan`);
      toast({
        title: "Emergency Stop selesai",
        description: parts.length > 0 ? parts.join(" · ") : "Tidak ada order aktif yang ditemukan",
      });
      if (data.errors.length > 0) {
        toast({ title: "Beberapa error terjadi", description: data.errors.join(", "), variant: "destructive" });
      }
    } catch {
      toast({ title: "Gagal menjalankan Emergency Stop", description: "Cek koneksi ke server", variant: "destructive" });
    } finally {
      setEmergencyBusy(false);
      setEmergencyOpen(false);
    }
  };

  const runningCount = bots?.filter((b) => b.status.running).length ?? 0;
  const pausedCount = bots?.filter(isPausedAtMax).length ?? 0;
  const cbCount = bots?.filter((b) => b.status.circuitBreakerTripped).length ?? 0;

  const visibleBots = (bots ?? []).filter((b) => {
    const exc = (b.config.exchange ?? "kraken") as "kraken" | "xt" | "bitmart" | "coinstore";
    if (!isEnabled(exc)) return false;
    if (exchangeFilter !== "all" && exc !== exchangeFilter) return false;
    if (statusFilter === "running" && !b.status.running) return false;
    if (statusFilter === "stopped" && b.status.running) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!b.id.toLowerCase().includes(q) && !(b.config.pair ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilter = search.trim() !== "" || statusFilter !== "all" || exchangeFilter !== "all";

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
          <Button
            variant="outline"
            onClick={() => setEmergencyOpen(true)}
            disabled={emergencyBusy}
            className="border-red-700 text-red-400 hover:bg-red-950/50 hover:text-red-300 shrink-0"
          >
            <OctagonX className="w-4 h-4 mr-1.5" />
            Stop Semua
          </Button>
          <Button onClick={openAdd} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold shrink-0">
            <Plus className="w-4 h-4 mr-1.5" /> Add Bot
          </Button>
        </div>
      </div>

      {/* Filter + Search bar */}
      {(bots?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Cari bot atau pair…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-7 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status filter */}
          {(["all", "running", "stopped"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                statusFilter === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {v === "all" ? "Semua" : v === "running" ? "Running" : "Stopped"}
            </button>
          ))}

          {/* Exchange filter */}
          <div className="w-px h-5 bg-border/60 hidden sm:block" />
          {(["all", "kraken", "xt", "bitmart", "coinstore"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setExchangeFilter(v)}
              className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                exchangeFilter === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {v === "all" ? "Exchange" : v === "kraken" ? "Kraken" : v === "xt" ? "XT" : v === "bitmart" ? "BitMart" : "Coinstore"}
            </button>
          ))}

          {/* Clear */}
          {hasFilter && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); setExchangeFilter("all"); }}
              className="h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      )}

      {/* Balance cards — Kraken, XT, BitMart & Coinstore collapsible */}
      {(krakenBalances?.length || xtBalances?.length || bitmartBalances?.length || coinstoreBalances?.length) ? (
        <div className={`grid grid-cols-1 gap-3 ${
          [
            isEnabled("kraken") && krakenBalances && krakenBalances.length > 0,
            isEnabled("xt") && xtBalances && xtBalances.length > 0,
            isEnabled("bitmart") && bitmartBalances && bitmartBalances.length > 0,
            isEnabled("coinstore") && coinstoreBalances && coinstoreBalances.length > 0,
          ].filter(Boolean).length > 1
            ? "sm:grid-cols-2"
            : ""
        }`}>

          {/* ── Kraken ── */}
          {isEnabled("kraken") && krakenBalances && krakenBalances.length > 0 && (() => {
            const usd   = krakenBalances.find((a) => a.asset === "ZUSD");
            const free  = usd?.free  != null ? parseFloat(usd.free)    : null;
            const used  = usd?.used  != null ? parseFloat(usd.used)    : null;
            const total = usd ? parseFloat(usd.balance) : null;
            const freePct = (total && total > 0 && free != null) ? (free / total) * 100 : 100;
            return (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Clickable header */}
                <button
                  type="button"
                  onClick={() => setKrakenOpen((v) => !v)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: "color-mix(in srgb, #7c3aed 6%, transparent)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-black text-sm text-white" style={{ background: "color-mix(in srgb, #7c3aed 80%, #4f46e5)" }}>K</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-none">Kraken</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Saldo akun</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {total != null && (
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          <span className="text-[10px] text-muted-foreground">$</span>
                          {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_1px_#34d39980]" />
                      {krakenOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  {/* Progress bar — always visible */}
                  {total != null && (
                    <div className="px-4 pb-3 pt-1" style={{ background: "color-mix(in srgb, #7c3aed 6%, transparent)" }}>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${freePct}%` }} />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-emerald-500 font-medium">bebas {free != null ? `$${free.toFixed(2)}` : "—"}</span>
                        {used != null && used > 0 && (
                          <><span className="text-[10px] text-muted-foreground/50">·</span>
                          <span className="text-[10px] text-amber-500 font-medium">pakai ${used.toFixed(2)}</span></>
                        )}
                      </div>
                    </div>
                  )}
                </button>
                {/* Collapsible detail */}
                {krakenOpen && (
                  <div className="divide-y divide-border/50 border-t border-border">
                    {krakenBalances.map((a) => {
                      const isUSD = a.asset === "ZUSD";
                      const label = isUSD ? "USD" : a.asset.replace(/^X/, "").replace(/^Z/, "");
                      const bal   = parseFloat(a.balance);
                      const dp    = isUSD ? 2 : bal < 0.01 ? 6 : 4;
                      return (
                        <div key={a.asset} className="flex items-center justify-between px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                              <span className="text-[9px] font-bold text-muted-foreground">{label.slice(0, 3)}</span>
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">{label}</span>
                          </div>
                          <p className="font-mono text-sm font-semibold tabular-nums">
                            {isUSD ? <span className="text-[10px] text-muted-foreground mr-0.5">$</span> : null}
                            {bal.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── XT.com ── */}
          {isEnabled("xt") && xtBalances && xtBalances.length > 0 && (() => {
            const usdt    = xtBalances.find((a) => a.currency.toUpperCase() === "USDT");
            const avail   = usdt ? parseFloat(usdt.available) : null;
            const frozen  = usdt ? parseFloat(usdt.frozen)    : null;
            const total   = avail != null && frozen != null ? avail + frozen : null;
            const freePct = (total && total > 0 && avail != null) ? (avail / total) * 100 : 100;
            return (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Clickable header */}
                <button
                  type="button"
                  onClick={() => setXtOpen((v) => !v)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: "color-mix(in srgb, #0ea5e9 6%, transparent)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-black text-sm text-white" style={{ background: "color-mix(in srgb, #0ea5e9 85%, #0284c7)" }}>XT</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-none">XT.com</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Saldo akun</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {total != null && (
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          <span className="text-[10px] text-muted-foreground">$</span>
                          {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_1px_#34d39980]" />
                      {xtOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  {/* Progress bar — always visible */}
                  {total != null && (
                    <div className="px-4 pb-3 pt-1" style={{ background: "color-mix(in srgb, #0ea5e9 6%, transparent)" }}>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${freePct}%` }} />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-emerald-500 font-medium">bebas {avail != null ? `$${avail.toFixed(2)}` : "—"}</span>
                        {frozen != null && frozen > 0 && (
                          <><span className="text-[10px] text-muted-foreground/50">·</span>
                          <span className="text-[10px] text-amber-500 font-medium">frozen ${frozen.toFixed(2)}</span></>
                        )}
                      </div>
                    </div>
                  )}
                </button>
                {/* Collapsible detail */}
                {xtOpen && (
                  <div className="divide-y divide-border/50 border-t border-border">
                    {xtBalances.map((a) => {
                      const isUSDT  = a.currency.toUpperCase() === "USDT";
                      const av      = parseFloat(a.available);
                      const fr      = parseFloat(a.frozen);
                      const tot     = av + fr;
                      const dp      = isUSDT ? 2 : tot < 0.01 ? 6 : 4;
                      const label   = a.currency.toUpperCase();
                      return (
                        <div key={a.currency} className="flex items-center justify-between px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                              <span className="text-[9px] font-bold text-muted-foreground">{label.slice(0, 3)}</span>
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">{label}</span>
                          </div>
                          <p className="font-mono text-sm font-semibold tabular-nums">
                            {isUSDT ? <span className="text-[10px] text-muted-foreground mr-0.5">$</span> : null}
                            {tot.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── BitMart ── */}
          {isEnabled("bitmart") && bitmartBalances && bitmartBalances.length > 0 && (() => {
            const usdt    = bitmartBalances.find((a) => a.currency.toUpperCase() === "USDT");
            const avail   = usdt ? parseFloat(usdt.available) : null;
            const frozen  = usdt ? parseFloat(usdt.frozen)    : null;
            const total   = avail != null && frozen != null ? avail + frozen : null;
            const freePct = (total && total > 0 && avail != null) ? (avail / total) * 100 : 100;
            return (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setBitmartOpen((v) => !v)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: "color-mix(in srgb, #1A6FAF 6%, transparent)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-black text-sm text-white" style={{ background: "color-mix(in srgb, #1A6FAF 85%, #1250a0)" }}>BM</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-none">BitMart</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Saldo akun</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {total != null && (
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          <span className="text-[10px] text-muted-foreground">$</span>
                          {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_1px_#34d39980]" />
                      {bitmartOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  {total != null && (
                    <div className="px-4 pb-3 pt-1" style={{ background: "color-mix(in srgb, #1A6FAF 6%, transparent)" }}>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${freePct}%` }} />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-emerald-500 font-medium">bebas {avail != null ? `$${avail.toFixed(2)}` : "—"}</span>
                        {frozen != null && frozen > 0 && (
                          <><span className="text-[10px] text-muted-foreground/50">·</span>
                          <span className="text-[10px] text-amber-500 font-medium">frozen ${frozen.toFixed(2)}</span></>
                        )}
                      </div>
                    </div>
                  )}
                </button>
                {bitmartOpen && (
                  <div className="divide-y divide-border/50 border-t border-border">
                    {bitmartBalances.map((a) => {
                      const isUSDT  = a.currency.toUpperCase() === "USDT";
                      const av      = parseFloat(a.available);
                      const fr      = parseFloat(a.frozen);
                      const tot     = av + fr;
                      const dp      = isUSDT ? 2 : tot < 0.01 ? 6 : 4;
                      const label   = a.currency.toUpperCase();
                      return (
                        <div key={a.currency} className="flex items-center justify-between px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                              <span className="text-[9px] font-bold text-muted-foreground">{label.slice(0, 3)}</span>
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">{label}</span>
                          </div>
                          <p className="font-mono text-sm font-semibold tabular-nums">
                            {isUSDT ? <span className="text-[10px] text-muted-foreground mr-0.5">$</span> : null}
                            {tot.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Coinstore ── */}
          {isEnabled("coinstore") && coinstoreBalances && coinstoreBalances.length > 0 && (() => {
            const usdt    = coinstoreBalances.find((a) => a.currency.toUpperCase() === "USDT");
            const avail   = usdt ? parseFloat(usdt.available) : null;
            const frozen  = usdt ? parseFloat(usdt.frozen)    : null;
            const total   = avail != null && frozen != null ? avail + frozen : null;
            const freePct = (total && total > 0 && avail != null) ? (avail / total) * 100 : 100;
            return (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCoinstoreOpen((v) => !v)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: "color-mix(in srgb, #16a34a 6%, transparent)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-black text-sm text-white" style={{ background: "color-mix(in srgb, #16a34a 85%, #15803d)" }}>CS</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-none">Coinstore</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Saldo akun</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {total != null && (
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          <span className="text-[10px] text-muted-foreground">$</span>
                          {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_1px_#34d39980]" />
                      {coinstoreOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  {total != null && (
                    <div className="px-4 pb-3 pt-1" style={{ background: "color-mix(in srgb, #16a34a 6%, transparent)" }}>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${freePct}%` }} />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-emerald-500 font-medium">bebas {avail != null ? `${avail.toFixed(2)}` : "—"}</span>
                        {frozen != null && frozen > 0 && (
                          <><span className="text-[10px] text-muted-foreground/50">·</span>
                          <span className="text-[10px] text-amber-500 font-medium">frozen ${frozen.toFixed(2)}</span></>
                        )}
                      </div>
                    </div>
                  )}
                </button>
                {coinstoreOpen && (
                  <div className="divide-y divide-border/50 border-t border-border">
                    {coinstoreBalances.map((a) => {
                      const isUSDT  = a.currency.toUpperCase() === "USDT";
                      const av      = parseFloat(a.available);
                      const fr      = parseFloat(a.frozen);
                      const tot     = av + fr;
                      const dp      = isUSDT ? 2 : tot < 0.01 ? 6 : 4;
                      const label   = a.currency.toUpperCase();
                      return (
                        <div key={a.currency} className="flex items-center justify-between px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                              <span className="text-[9px] font-bold text-muted-foreground">{label.slice(0, 3)}</span>
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">{label}</span>
                          </div>
                          <p className="font-mono text-sm font-semibold tabular-nums">
                            {isUSDT ? <span className="text-[10px] text-muted-foreground mr-0.5">$</span> : null}
                            {tot.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      ) : null}

      {/* Bot list */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-56 w-full rounded-xl" />)}</div>
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
      ) : visibleBots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 border border-dashed border-border rounded-xl">
          <Search className="w-8 h-8 text-muted-foreground/40" />
          <div>
            <h3 className="font-semibold">Tidak ada bot yang cocok</h3>
            <p className="text-muted-foreground text-sm mt-1">Coba ubah filter atau kata kunci pencarian.</p>
          </div>
          <button
            onClick={() => { setSearch(""); setStatusFilter("all"); setExchangeFilter("all"); }}
            className="text-sm text-primary hover:underline"
          >
            Reset filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(() => {
            const touchOrder = getTouchOrder();
            const statusScore = (bot: BotInstance) => {
              if (bot.status.circuitBreakerTripped) return 2;
              if (bot.status.running) return 0;
              return 1;
            };
            return visibleBots
              .map((bot, index) => ({ bot, index }))
              .sort((a, b) => {
                // 1) Freshly created/edited bots (touched by the user) float to the top.
                const ta = touchOrder[a.bot.id] ?? 0;
                const tb = touchOrder[b.bot.id] ?? 0;
                if (ta !== tb) return tb - ta;
                // 2) Among untouched bots, running bots rank above stopped/tripped ones.
                const sa = statusScore(a.bot);
                const sb = statusScore(b.bot);
                if (sa !== sb) return sa - sb;
                // 3) Fall back to most-recently-created first.
                return b.index - a.index;
              })
              .map(({ bot }) => <BotCard key={bot.id} bot={bot} onEdit={openEdit} />);
          })()}
        </div>
      )}

      <BotDialog open={dialogOpen} onClose={closeDialog} editBot={editBot} />

      <AlertDialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <OctagonX className="w-5 h-5" /> Emergency Stop
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Ini akan melakukan <span className="font-semibold text-foreground">dua hal sekaligus</span>:</p>
                <div className="pl-3 border-l-2 border-border space-y-1">
                  <p>— Menghentikan semua bot yang sedang berjalan</p>
                  <p>— Membatalkan semua order beli terbuka di semua exchange (Kraken, XT &amp; BitMart)</p>
                </div>
                <p className="text-amber-400 font-medium">Bot tidak dihapus — kamu bisa start ulang kapan saja.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emergencyBusy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleEmergencyStop(); }}
              disabled={emergencyBusy}
              className="bg-red-700 hover:bg-red-600 text-white"
            >
              {emergencyBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Memproses…</> : <><OctagonX className="w-4 h-4 mr-2" /> Ya, Stop Semua</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
