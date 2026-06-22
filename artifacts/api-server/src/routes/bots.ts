import { Router, type IRouter } from "express";
import { botManager } from "../lib/botManager";
import { fetchOrderBook, fetchMarket } from "../lib/krakenBot";
import { fetchGateMarket } from "../lib/gateMarket";
import { fetchLbankMarket } from "../lib/lbankMarket";
import { fetchAscendexMarket } from "../lib/ascendexMarket";
import { fetchXtMarket } from "../lib/xtMarket";
import {
  CreateBotBody,
  UpdateBotConfigBody,
  ListBotsResponse,
  GetBotResponse,
  StartBotResponse,
  StopBotResponse,
  UpdateBotConfigResponse,
  GetBotLogsQueryParams,
  GetBotLogsResponse,
  GetBotFillsQueryParams,
  GetBotFillsResponse,
  GetAllFillsQueryParams,
  GetAllFillsResponse,
  GetBotOrderBookResponse,
  GetOrderBookQueryParams,
  GetOrderBookResponse,
  GetAllLogsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/bots", async (_req, res): Promise<void> => {
  const instances = botManager.list();
  res.json(ListBotsResponse.parse(instances));
});

router.post("/bots", async (req, res): Promise<void> => {
  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const config = {
    pair: parsed.data.pair,
    orderSize: parsed.data.orderSize,
    maxBidPrice: parsed.data.maxBidPrice,
    tickSize: parsed.data.tickSize,
    checkIntervalMs: parsed.data.checkIntervalMs ?? 3000,
    oneShotMode: parsed.data.oneShotMode ?? false,
    maxConsecutiveErrors: parsed.data.maxConsecutiveErrors ?? 5,
    exchange: (parsed.data as any).exchange as "kraken" | "xt" | undefined,
  };

  try {
    const bot = botManager.create(config);
    const instance = botManager.toInstance(bot.id)!;
    res.status(201).json(GetBotResponse.parse(instance));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: msg });
  }
});

router.get("/bots/:botId", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const instance = botManager.toInstance(botId);
  if (!instance) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  res.json(GetBotResponse.parse(instance));
});

router.delete("/bots/:botId", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const removed = await botManager.remove(botId);
  if (!removed) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  res.sendStatus(204);
});

router.post("/bots/:botId/start", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const bot = botManager.get(botId);
  if (!bot) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  bot.start().then(() => botManager.persist()).catch((err: unknown) => {
    req.log.error({ err, botId }, "Bot start error");
  });
  botManager.persist();
  const instance = botManager.toInstance(botId)!;
  res.json(StartBotResponse.parse(instance));
});

router.post("/bots/:botId/stop", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const bot = botManager.get(botId);
  if (!bot) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  await bot.stop();
  botManager.persist();
  const instance = botManager.toInstance(botId)!;
  res.json(StopBotResponse.parse(instance));
});

router.put("/bots/:botId/config", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const bot = botManager.get(botId);
  if (!bot) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }

  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  bot.setConfig({
    pair: parsed.data.pair,
    orderSize: parsed.data.orderSize,
    maxBidPrice: parsed.data.maxBidPrice,
    tickSize: parsed.data.tickSize,
    checkIntervalMs: parsed.data.checkIntervalMs ?? 3000,
    oneShotMode: parsed.data.oneShotMode ?? false,
    maxConsecutiveErrors: parsed.data.maxConsecutiveErrors ?? 5,
    exchange: (parsed.data as any).exchange as "kraken" | "xt" | undefined,
  });
  botManager.persist();

  const instance = botManager.toInstance(botId)!;
  res.json(UpdateBotConfigResponse.parse(instance));
});

router.get("/bots/:botId/logs", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const bot = botManager.get(botId);
  if (!bot) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  const qp = GetBotLogsQueryParams.safeParse(req.query);
  const limit = qp.success ? (qp.data.limit ?? 50) : 50;
  res.json(GetBotLogsResponse.parse(bot.getLogs(limit)));
});

router.get("/bots/fills", async (req, res): Promise<void> => {
  const qp = GetAllFillsQueryParams.safeParse(req.query);
  const limit = qp.success ? (qp.data.limit ?? 200) : 200;
  const allFills = botManager.list()
    .flatMap(({ id }) => {
      const bot = botManager.get(id);
      if (!bot) return [];
      return bot.getFills(limit).map((f) => ({ ...f, botId: id }));
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
  res.json(GetAllFillsResponse.parse(allFills));
});

router.get("/bots/:botId/fills", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const bot = botManager.get(botId);
  if (!bot) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  const qp = GetBotFillsQueryParams.safeParse(req.query);
  const limit = qp.success ? (qp.data.limit ?? 50) : 50;
  res.json(GetBotFillsResponse.parse(bot.getFills(limit)));
});

router.get("/bots/:botId/orderbook", async (req, res): Promise<void> => {
  const botId = req.params["botId"] as string;
  const bot = botManager.get(botId);
  if (!bot) {
    res.status(404).json({ error: `Bot ${botId} not found` });
    return;
  }
  try {
    const pair = bot.getConfig().pair;
    const book = await fetchOrderBook(pair);
    res.json(
      GetBotOrderBookResponse.parse({
        pair,
        bids: book.bids,
        asks: book.asks,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/orderbook", async (req, res): Promise<void> => {
  const qp = GetOrderBookQueryParams.safeParse(req.query);
  if (!qp.success || !qp.data.pair) {
    res.status(400).json({ error: "pair query param required" });
    return;
  }
  try {
    const book = await fetchOrderBook(qp.data.pair);
    res.json(
      GetOrderBookResponse.parse({
        pair: qp.data.pair,
        bids: book.bids,
        asks: book.asks,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/logs", (req, res): void => {
  const qp = GetAllLogsQueryParams.safeParse(req.query);
  const limit = qp.success ? (qp.data.limit ?? 500) : 500;
  const allLogs = botManager
    .list()
    .flatMap((b) => {
      const bot = botManager.get(b.id);
      return bot ? bot.getLogs(limit).map((log) => ({ ...log, botId: b.id })) : [];
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
  res.json(allLogs);
});

router.get("/market", async (_req, res): Promise<void> => {
  try {
    const tickers = await fetchMarket();
    res.json(tickers);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/market/gate", async (_req, res): Promise<void> => {
  try {
    const tickers = await fetchGateMarket();
    res.json(tickers);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/market/lbank", async (_req, res): Promise<void> => {
  try {
    const tickers = await fetchLbankMarket();
    res.json(tickers);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/market/ascendex", async (_req, res): Promise<void> => {
  try {
    const tickers = await fetchAscendexMarket();
    res.json(tickers);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/market/xt", async (_req, res): Promise<void> => {
  try {
    const tickers = await fetchXtMarket();
    res.json(tickers);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
