import { Router, type IRouter } from "express";
import { botManager } from "../lib/botManager";
import { fetchOrderBook } from "../lib/krakenBot";
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
  GetBotOrderBookResponse,
  GetOrderBookQueryParams,
  GetOrderBookResponse,
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
  bot.start().catch((err: unknown) => {
    req.log.error({ err, botId }, "Bot start error");
  });
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
  });

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

// Generic order book — no bot required (used in settings for live market reference)
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

export default router;
