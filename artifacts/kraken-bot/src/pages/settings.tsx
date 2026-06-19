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
  getGetBotStatusQueryKey,
  getGetBotLogsQueryKey,
  getGetOrderBookQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Save, Loader2, TrendingUp, TrendingDown, Target, ArrowUpDown } from "lucide-react";

const configSchema = z.object({
  pair: z.string().min(1, "Trading pair is required"),
  orderSize: z.string().min(1, "Order size is required"),
  maxBidPrice: z.string().min(1, "Max bid price is required"),
  tickSize: z.string().min(1, "Tick size is required"),
  checkIntervalMs: z.coerce.number().min(500, "Interval must be at least 500ms"),
});

type ConfigForm = z.infer<typeof configSchema>;

function MarketInfoPanel({ pair, tickSize }: { pair: string; tickSize: string }) {
  const { data: book, isLoading } = useGetOrderBook({
    query: {
      refetchInterval: 2000,
      queryKey: getGetOrderBookQueryKey(),
    },
  });

  const topBid = book?.bids[0]?.price ?? null;
  const topAsk = book?.asks[0]?.price ?? null;

  const calcTarget = () => {
    if (!topBid || !tickSize) return null;
    const bidNum = parseFloat(topBid);
    const tickNum = parseFloat(tickSize);
    if (isNaN(bidNum) || isNaN(tickNum) || tickNum <= 0) return null;
    const target = bidNum + tickNum;
    const decimals = (tickSize.split(".")[1] ?? "").length;
    return target.toFixed(decimals);
  };

  const target = calcTarget();

  const midPrice = topBid && topAsk
    ? ((parseFloat(topBid) + parseFloat(topAsk)) / 2).toFixed(
        Math.max(
          (topBid.split(".")[1] ?? "").length,
          (topAsk.split(".")[1] ?? "").length
        )
      )
    : null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4" />
          Live Market Reference
          {pair && <span className="font-mono text-primary ml-1">{pair}</span>}
        </CardTitle>
        <CardDescription className="text-xs">
          Real-time data to guide your configuration. Your bot order will be placed at <strong className="text-foreground">Top Buy + Tick Size</strong>, automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading market data...
          </div>
        ) : (
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

            <div className="rounded-lg bg-background border border-primary/40 p-3 space-y-1">
              <p className="text-xs text-primary flex items-center gap-1">
                <Target className="w-3 h-3" /> Our Target Price
              </p>
              <p className="font-mono text-sm font-bold text-primary" data-testid="market-target-price">
                {target ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">Top Buy + Tick Size</p>
            </div>
          </div>
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

  const onSubmit = (values: ConfigForm) => {
    updateConfig.mutate({ data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOrderBookQueryKey() });
        toast({ title: "Configuration saved", description: "Bot settings have been updated." });
      },
      onError: (error: unknown) => {
        const msg = error instanceof Error ? error.message : "An error occurred.";
        toast({ variant: "destructive", title: "Failed to save", description: msg });
      },
    });
  };

  const handleStart = () => {
    const values = form.getValues();
    startBot.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Bot started", description: "The trading bot is now running." });
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBotLogsQueryKey() });
      },
      onError: (error: unknown) => {
        const msg = error instanceof Error ? error.message : "An error occurred.";
        toast({ variant: "destructive", title: "Failed to start", description: msg });
      },
    });
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
  const watchPair = form.watch("pair");
  const watchTick = form.watch("tickSize");

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
              {stopBot.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Square className="w-4 h-4 mr-2" />}
              STOP BOT
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={startBot.isPending}
              size="lg"
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold shadow-lg shadow-primary/20"
              data-testid="button-start-bot"
            >
              {startBot.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Play className="w-4 h-4 mr-2" />}
              START BOT
            </Button>
          )}
        </div>
      </header>

      <MarketInfoPanel pair={watchPair} tickSize={watchTick} />

      <Card className="bg-card border-border shadow-lg">
        <CardHeader>
          <CardTitle>Trading Parameters</CardTitle>
          <CardDescription>
            The bot will place a buy order at <strong>Top Buy Order + Tick Size</strong>, and automatically re-place if outbid, staying below Max Bid Price.
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
                          disabled={isRunning}
                          data-testid="input-pair"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Kraken internal symbol. Examples: <span className="font-mono text-foreground">XXBTZUSD</span>, <span className="font-mono text-foreground">XETHZUSD</span>, <span className="font-mono text-foreground">SOLUSD</span>
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
                          disabled={isRunning}
                          data-testid="input-order-size"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>Volume per order (e.g. <span className="font-mono text-foreground">0.001</span> BTC or <span className="font-mono text-foreground">100</span> tokens)</FormDescription>
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
                          placeholder="0.090"
                          className="font-mono bg-background border-amber-900/50 focus-visible:ring-amber-500/50"
                          disabled={isRunning}
                          data-testid="input-max-bid-price"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Bot will <strong className="text-foreground">stop bidding</strong> if market top bid + tick exceeds this price
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
                          placeholder="0.001"
                          className="font-mono bg-background"
                          disabled={isRunning}
                          data-testid="input-tick-size"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        How much to outbid by. For low-price pairs use e.g. <span className="font-mono text-foreground">0.00001</span>
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
                          disabled={isRunning}
                          data-testid="input-check-interval"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>How often to poll the order book. Min 500ms, recommended 2000–5000ms.</FormDescription>
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
                  disabled={isRunning || updateConfig.isPending}
                  variant="secondary"
                  className="font-medium"
                  data-testid="button-save-config"
                >
                  {updateConfig.isPending
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Save className="w-4 h-4 mr-2" />}
                  Save Configuration
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">How the bot works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Bot reads the current <strong className="text-foreground">Top Buy Order</strong> price from Kraken's order book.</p>
          <p>2. Places our order at <strong className="text-foreground">Top Buy + Tick Size</strong> — so we're always first in the queue.</p>
          <p>3. If someone places a higher bid, bot cancels our order and re-places at the new top + tick.</p>
          <p>4. If the required price would exceed <strong className="text-amber-400">Max Bid Price</strong>, bot cancels our order and pauses — it will not chase the price further.</p>
        </CardContent>
      </Card>
    </div>
  );
}
