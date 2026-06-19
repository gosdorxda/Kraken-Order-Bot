import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetBotConfig,
  useUpdateBotConfig,
  useGetBotStatus,
  useStartBot,
  useStopBot,
  useGetOrderBook,
  useGetServerInfo,
  getGetBotStatusQueryKey,
  getGetBotLogsQueryKey,
  getGetOrderBookQueryKey,
  getGetServerInfoQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Save, Loader2, TrendingUp, TrendingDown, Target, ArrowUpDown, AlertTriangle, CheckCircle2, XCircle, Copy, Check, RefreshCw, Shield } from "lucide-react";
import { useState } from "react";

const configSchema = z.object({
  pair: z.string().min(1, "Trading pair is required"),
  orderSize: z.string().min(1, "Order size is required"),
  maxBidPrice: z.string().min(1, "Max bid price is required"),
  tickSize: z.string().min(1, "Tick size is required"),
  checkIntervalMs: z.coerce.number().min(500, "Interval must be at least 500ms"),
});

type ConfigForm = z.infer<typeof configSchema>;

function decimalPlaces(value: string): number {
  const parts = value.split(".");
  return parts.length > 1 ? parts[1]!.length : 0;
}

function calcTargetPrice(topBid: string | null, tickSize: string): string | null {
  if (!topBid || !tickSize) return null;
  const bidNum = parseFloat(topBid);
  const tickNum = parseFloat(tickSize);
  if (isNaN(bidNum) || isNaN(tickNum) || tickNum <= 0) return null;
  const decimals = Math.max(decimalPlaces(topBid), decimalPlaces(tickSize));
  return (bidNum + tickNum).toFixed(decimals);
}

interface MarketInfoPanelProps {
  pair: string;
  tickSize: string;
  maxBidPrice: string;
  topBid: string | null;
  topAsk: string | null;
  isLoading: boolean;
  targetPrice: string | null;
  targetExceedsMax: boolean;
}

function MarketInfoPanel({
  pair,
  tickSize,
  topBid,
  topAsk,
  isLoading,
  targetPrice,
  targetExceedsMax,
}: MarketInfoPanelProps) {
  const midPrice =
    topBid && topAsk
      ? ((parseFloat(topBid) + parseFloat(topAsk)) / 2).toFixed(
          Math.max(decimalPlaces(topBid), decimalPlaces(topAsk))
        )
      : null;

  return (
    <Card className={`border ${targetExceedsMax ? "border-red-700/60 bg-red-950/10" : "bg-card border-border"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4" />
          Live Market Reference
          {pair && <span className="font-mono text-primary ml-1">{pair}</span>}
        </CardTitle>
        <CardDescription className="text-xs">
          Real-time data. Bot order will be placed at{" "}
          <strong className="text-foreground">Top Buy + Tick Size</strong> automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading market data...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-background border border-border p-3 space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <ArrowUpDown className="w-3 h-3" /> Mid Price
                </p>
                <p className="font-mono text-sm font-semibold text-foreground" data-testid="market-mid-price">
                  {midPrice ?? "—"}
                </p>
              </div>

              <div className="rounded-lg bg-background border border-green-900/50 p-3 space-y-1">
                <p className="text-xs text-green-500 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Top Buy Order
                </p>
                <p className="font-mono text-sm font-semibold text-green-400" data-testid="market-top-bid">
                  {topBid ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">Highest bid in book</p>
              </div>

              <div className="rounded-lg bg-background border border-red-900/50 p-3 space-y-1">
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Top Sell Order
                </p>
                <p className="font-mono text-sm font-semibold text-red-400" data-testid="market-top-ask">
                  {topAsk ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">Lowest ask in book</p>
              </div>

              <div
                className={`rounded-lg bg-background p-3 space-y-1 border ${
                  targetExceedsMax ? "border-red-500/70" : "border-primary/40"
                }`}
              >
                <p
                  className={`text-xs flex items-center gap-1 ${
                    targetExceedsMax ? "text-red-400" : "text-primary"
                  }`}
                >
                  <Target className="w-3 h-3" /> Our Target Price
                </p>
                <p
                  className={`font-mono text-sm font-bold ${
                    targetExceedsMax ? "text-red-400" : "text-primary"
                  }`}
                  data-testid="market-target-price"
                >
                  {targetPrice ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {topBid && tickSize
                    ? `${topBid} + ${tickSize}`
                    : "Top Buy + Tick Size"}
                </p>
              </div>
            </div>

            {targetExceedsMax && targetPrice && (
              <div
                className="flex items-start gap-3 rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3"
                data-testid="warning-target-exceeds-max"
              >
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="text-red-300 font-semibold">
                    Target price exceeds Max Bid Price — bot cannot place orders
                  </p>
                  <p className="text-red-400/80">
                    Our target{" "}
                    <span className="font-mono font-bold">{targetPrice}</span> is already above your
                    max limit. Lower your{" "}
                    <strong>Tick Size</strong> so that{" "}
                    <span className="font-mono">
                      {topBid} + tickSize
                    </span>{" "}
                    stays below Max Bid Price.
                  </p>
                  {topBid && (
                    <p className="text-red-400/60 text-xs font-mono">
                      Suggested tick: &le;{" "}
                      {(
                        parseFloat(
                          (() => {
                            const maxNum = parseFloat(
                              document.querySelector<HTMLInputElement>('[data-testid="input-max-bid-price"]')
                                ?.value ?? "0"
                            );
                            return (maxNum - parseFloat(topBid)).toFixed(
                              Math.max(decimalPlaces(topBid), 8)
                            );
                          })()
                        ) || 0
                      ).toFixed(Math.max(decimalPlaces(topBid), 8))}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useGetBotStatus({
    query: { refetchInterval: 2000, queryKey: getGetBotStatusQueryKey() },
  });
  const { data: config, isLoading: configLoading } = useGetBotConfig();
  const { data: book, isLoading: bookLoading } = useGetOrderBook({
    query: { refetchInterval: 2000, queryKey: getGetOrderBookQueryKey() },
  });

  const updateConfig = useUpdateBotConfig();
  const startBot = useStartBot();
  const stopBot = useStopBot();

  const form = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      pair: "XXBTZUSD",
      orderSize: "0.001",
      maxBidPrice: "100000",
      tickSize: "0.1",
      checkIntervalMs: 3000,
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        pair: config.pair,
        orderSize: config.orderSize,
        maxBidPrice: config.maxBidPrice,
        tickSize: config.tickSize,
        checkIntervalMs: config.checkIntervalMs ?? 3000,
      });
    }
  }, [config, form]);

  const watchTickSize = form.watch("tickSize");
  const watchMaxBidPrice = form.watch("maxBidPrice");
  const watchPair = form.watch("pair");

  const topBid = book?.bids[0]?.price ?? null;
  const topAsk = book?.asks[0]?.price ?? null;
  const targetPrice = calcTargetPrice(topBid, watchTickSize);

  const targetExceedsMax =
    targetPrice != null &&
    watchMaxBidPrice != null &&
    parseFloat(targetPrice) > parseFloat(watchMaxBidPrice);

  const suggestedMaxTick =
    topBid && watchMaxBidPrice
      ? (() => {
          const room = parseFloat(watchMaxBidPrice) - parseFloat(topBid);
          if (room <= 0) return null;
          const decimals = Math.max(decimalPlaces(topBid), decimalPlaces(watchMaxBidPrice), 8);
          return room.toFixed(decimals);
        })()
      : null;

  const onSubmit = (values: ConfigForm) => {
    updateConfig.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderBookQueryKey() });
          toast({ title: "Configuration saved", description: "Bot settings have been updated." });
        },
        onError: (error: unknown) => {
          const msg = error instanceof Error ? error.message : "An error occurred.";
          toast({ variant: "destructive", title: "Failed to save", description: msg });
        },
      }
    );
  };

  const handleStart = () => {
    const values = form.getValues();
    startBot.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({ title: "Bot started", description: "The trading bot is now running." });
          queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBotLogsQueryKey() });
        },
        onError: (error: unknown) => {
          const msg = error instanceof Error ? error.message : "An error occurred.";
          toast({ variant: "destructive", title: "Failed to start", description: msg });
        },
      }
    );
  };

  const handleStop = () => {
    stopBot.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Bot stopped", description: "The trading bot has been stopped." });
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBotLogsQueryKey() });
      },
      onError: (error: unknown) => {
        const msg = error instanceof Error ? error.message : "An error occurred.";
        toast({ variant: "destructive", title: "Failed to stop", description: msg });
      },
    });
  };

  const isRunning = status?.running;
  const canStart = !isRunning && !targetExceedsMax && !startBot.isPending;

  if (configLoading || statusLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading configuration...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
          <p className="text-muted-foreground mt-1">Set trading pair and bot parameters.</p>
        </div>
        <div className="flex items-center gap-3">
          {isRunning ? (
            <Button
              onClick={handleStop}
              disabled={stopBot.isPending}
              variant="destructive"
              size="lg"
              className="font-bold shadow-lg shadow-destructive/20"
              data-testid="button-stop-bot"
            >
              {stopBot.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Square className="w-4 h-4 mr-2" />
              )}
              STOP BOT
            </Button>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={handleStart}
                disabled={!canStart}
                size="lg"
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold shadow-lg shadow-primary/20 disabled:opacity-40"
                data-testid="button-start-bot"
              >
                {startBot.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                START BOT
              </Button>
              {targetExceedsMax && (
                <p className="text-xs text-red-400 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Fix config to enable start
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      <MarketInfoPanel
        pair={watchPair}
        tickSize={watchTickSize}
        maxBidPrice={watchMaxBidPrice}
        topBid={topBid}
        topAsk={topAsk}
        isLoading={bookLoading}
        targetPrice={targetPrice}
        targetExceedsMax={targetExceedsMax}
      />

      <Card className="bg-card border-border shadow-lg">
        <CardHeader>
          <CardTitle>Trading Parameters</CardTitle>
          <CardDescription>
            Bot places a buy order at{" "}
            <strong>Top Buy Order + Tick Size</strong>, re-places automatically if outbid,
            and stops when target would exceed Max Bid Price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="pair"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trading Pair</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="XXBTZUSD"
                          className="font-mono bg-background"
                          disabled={!!isRunning}
                          data-testid="input-pair"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Kraken internal symbol. Examples:{" "}
                        <span className="font-mono text-foreground">XXBTZUSD</span>,{" "}
                        <span className="font-mono text-foreground">XETHZUSD</span>,{" "}
                        <span className="font-mono text-foreground">SOLUSD</span>
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
                        <Input
                          placeholder="0.001"
                          className="font-mono bg-background"
                          disabled={!!isRunning}
                          data-testid="input-order-size"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Volume per order (e.g.{" "}
                        <span className="font-mono text-foreground">0.001</span> BTC or{" "}
                        <span className="font-mono text-foreground">1000</span> tokens)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxBidPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Bid Price (Batas Maks)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0.00018"
                          className={`font-mono bg-background ${
                            targetExceedsMax
                              ? "border-red-500 focus-visible:ring-red-500/50"
                              : "border-amber-900/50 focus-visible:ring-amber-500/50"
                          }`}
                          disabled={!!isRunning}
                          data-testid="input-max-bid-price"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Bot will <strong className="text-foreground">stop bidding</strong> if
                        target price would exceed this
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tickSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tick Size (Kenaikan Per Tick)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0.000001"
                          className={`font-mono bg-background ${
                            targetExceedsMax ? "border-red-500 focus-visible:ring-red-500/50" : ""
                          }`}
                          disabled={!!isRunning}
                          data-testid="input-tick-size"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {targetExceedsMax && suggestedMaxTick ? (
                          <span className="text-amber-400">
                            Tick too large — try{" "}
                            <button
                              type="button"
                              className="font-mono text-primary underline underline-offset-2 cursor-pointer"
                              onClick={() => form.setValue("tickSize", suggestedMaxTick)}
                            >
                              {suggestedMaxTick}
                            </button>{" "}
                            or smaller
                          </span>
                        ) : (
                          <span>
                            How much to outbid by. For low-price pairs use e.g.{" "}
                            <span className="font-mono text-foreground">0.000001</span>
                          </span>
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="checkIntervalMs"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Check Interval (ms)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="3000"
                          className="font-mono bg-background max-w-xs"
                          disabled={!!isRunning}
                          data-testid="input-check-interval"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        How often to poll the order book. Min 500ms, recommended 2000–5000ms.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                {isRunning ? (
                  <p className="text-sm text-amber-500 font-medium">
                    Bot must be stopped to modify settings.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Save config, then click Start Bot above.
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={!!isRunning || updateConfig.isPending}
                  variant="secondary"
                  className="font-medium"
                  data-testid="button-save-config"
                >
                  {updateConfig.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Configuration
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <ConnectionPanel />

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">
            How the bot works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            1. Bot reads the current{" "}
            <strong className="text-foreground">Top Buy Order</strong> price from Kraken's order book.
          </p>
          <p>
            2. Places our order at{" "}
            <strong className="text-foreground">Top Buy + Tick Size</strong> — so we're always
            first in queue.
          </p>
          <p>
            3. If someone places a higher bid, bot cancels and re-places at the new top + tick.
          </p>
          <p>
            4. If required price would exceed{" "}
            <strong className="text-amber-400">Max Bid Price</strong>, bot pauses and will not
            chase the price further.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectionPanel() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isFetching, refetch } = useGetServerInfo({
    query: { queryKey: getGetServerInfoQueryKey() },
  });

  const copyIp = () => {
    if (!data?.publicIp) return;
    navigator.clipboard.writeText(data.publicIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetServerInfoQueryKey() });
    refetch();
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Connection & Security
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="h-7 px-2 text-muted-foreground"
            data-testid="button-refresh-connection"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription className="text-xs">
          Kraken API connection status and server IP for whitelist configuration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking connection...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Kraken API Status */}
              <div className={`rounded-lg bg-background border p-4 space-y-2 ${data?.krakenConnected ? "border-green-900/50" : "border-red-900/50"}`}>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Kraken API
                </p>
                <div className="flex items-center gap-2">
                  {data?.krakenConnected ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <span className="text-green-400 font-semibold text-sm">Connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-5 h-5 text-red-400" />
                      <span className="text-red-400 font-semibold text-sm">Failed</span>
                    </>
                  )}
                </div>
                {data?.krakenError && (
                  <p className="text-xs text-red-400/80 font-mono break-all">{data.krakenError}</p>
                )}
                {data?.krakenConnected && (
                  <p className="text-xs text-muted-foreground">API key is valid and authenticated</p>
                )}
              </div>

              {/* Server IP */}
              <div className="rounded-lg bg-background border border-border p-4 space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Server Public IP
                </p>
                {data?.publicIp ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground" data-testid="text-server-ip">
                        {data.publicIp}
                      </span>
                      <button
                        onClick={copyIp}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-copy-ip"
                        title="Copy IP"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Add this IP to your Kraken API key whitelist</p>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">Could not resolve</span>
                    {data?.ipError && (
                      <p className="text-xs text-red-400/80 font-mono">{data.ipError}</p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Whitelist instructions */}
            <div className="rounded-lg border border-border bg-background/50 px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-primary" />
                How to set up IP whitelist on Kraken
              </p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Buka <strong className="text-foreground">Kraken</strong> → Security → API</li>
                <li>Pilih API key kamu → Edit</li>
                <li>Di field <strong className="text-foreground">IP Whitelist</strong>, masukkan IP di atas</li>
                <li>Simpan — hanya request dari IP itu yang bisa pakai key tersebut</li>
              </ol>
              <p className="text-xs text-amber-400/80 flex items-start gap-1.5 pt-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  Catatan: IP server Replit bisa berubah saat restart atau redeploy. Kalau bot tiba-tiba gagal autentikasi, tekan tombol refresh di atas dan update whitelist di Kraken.
                </span>
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
