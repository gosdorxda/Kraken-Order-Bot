import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetBotConfig, useUpdateBotConfig, useGetBotStatus, useStartBot, useStopBot, getGetBotStatusQueryKey, getGetBotLogsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Save, Loader2 } from "lucide-react";

const configSchema = z.object({
  pair: z.string().min(1, "Trading pair is required"),
  orderSize: z.string().min(1, "Order size is required"),
  maxBidPrice: z.string().min(1, "Max bid price is required"),
  tickSize: z.string().min(1, "Tick size is required"),
  checkIntervalMs: z.coerce.number().min(500, "Interval must be at least 500ms"),
});

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: status, isLoading: statusLoading } = useGetBotStatus({ query: { refetchInterval: 2000 } });
  const { data: config, isLoading: configLoading } = useGetBotConfig();
  
  const updateConfig = useUpdateBotConfig();
  const startBot = useStartBot();
  const stopBot = useStopBot();

  const form = useForm<z.infer<typeof configSchema>>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      pair: "XXBTZUSD",
      orderSize: "0.001",
      maxBidPrice: "100000",
      tickSize: "0.1",
      checkIntervalMs: 2000,
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        pair: config.pair,
        orderSize: config.orderSize,
        maxBidPrice: config.maxBidPrice,
        tickSize: config.tickSize,
        checkIntervalMs: config.checkIntervalMs || 2000,
      });
    }
  }, [config, form]);

  const onSubmit = (values: z.infer<typeof configSchema>) => {
    updateConfig.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Configuration saved", description: "Bot settings have been updated successfully." });
      },
      onError: (error: any) => {
        toast({ variant: "destructive", title: "Failed to save", description: error.message || "An error occurred." });
      }
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
      onError: (error: any) => {
        toast({ variant: "destructive", title: "Failed to start", description: error.message || "An error occurred." });
      }
    });
  };

  const handleStop = () => {
    stopBot.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Bot stopped", description: "The trading bot has been stopped." });
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBotLogsQueryKey() });
      },
      onError: (error: any) => {
        toast({ variant: "destructive", title: "Failed to stop", description: error.message || "An error occurred." });
      }
    });
  };

  const isRunning = status?.running;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
          <p className="text-muted-foreground mt-1">Manage trading pair and bot parameters.</p>
        </div>
        <div className="flex items-center gap-4">
          {isRunning ? (
            <Button onClick={handleStop} disabled={stopBot.isPending} variant="destructive" size="lg" className="font-bold shadow-lg shadow-destructive/20">
              {stopBot.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Square className="w-4 h-4 mr-2" />}
              STOP BOT
            </Button>
          ) : (
            <Button onClick={handleStart} disabled={startBot.isPending || statusLoading} size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold shadow-lg shadow-primary/20">
              {startBot.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              START BOT
            </Button>
          )}
        </div>
      </header>

      <Card className="bg-card border-card-border shadow-lg">
        <CardHeader>
          <CardTitle>Trading Parameters</CardTitle>
          <CardDescription>Update settings carefully. These changes dictate live trading behavior.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="pair"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trading Pair</FormLabel>
                      <FormControl>
                        <Input placeholder="XXBTZUSD" className="font-mono bg-background" disabled={isRunning} {...field} />
                      </FormControl>
                      <FormDescription>Kraken symbol (e.g. XXBTZUSD, XETHZUSD)</FormDescription>
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
                        <Input placeholder="0.001" className="font-mono bg-background" disabled={isRunning} {...field} />
                      </FormControl>
                      <FormDescription>Amount to buy per order</FormDescription>
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
                        <Input placeholder="100000" className="font-mono bg-background" disabled={isRunning} {...field} />
                      </FormControl>
                      <FormDescription>Highest price you are willing to bid</FormDescription>
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
                        <Input placeholder="0.1" className="font-mono bg-background" disabled={isRunning} {...field} />
                      </FormControl>
                      <FormDescription>Minimum price increment</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="checkIntervalMs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Check Interval (ms)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="2000" className="font-mono bg-background" disabled={isRunning} {...field} />
                      </FormControl>
                      <FormDescription>How frequently to poll order book</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-4 border-t border-border flex justify-end">
                <Button type="submit" disabled={isRunning || updateConfig.isPending} variant="secondary" className="font-medium">
                  {updateConfig.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Configuration
                </Button>
              </div>
              {isRunning && (
                <p className="text-sm text-amber-500 font-medium text-right mt-2">
                  Bot must be stopped to modify settings.
                </p>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
