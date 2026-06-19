import { Router, type IRouter } from "express";
import { krakenBot, type BotConfig } from "../lib/krakenBot";
import {
  GetBotStatusResponse,
  StartBotBody,
  StartBotResponse,
  StopBotResponse,
  GetBotConfigResponse,
  UpdateBotConfigBody,
  UpdateBotConfigResponse,
  GetBotLogsQueryParams,
  GetBotLogsResponse,
  GetOrderBookResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/bot/status", async (_req, res): Promise<void> => {
  const status = krakenBot.getStatus();
  res.json(GetBotStatusResponse.parse(status));
});

router.post("/bot/start", async (req, res): Promise<void> => {
  const parsed = StartBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const config: BotConfig = {
    pair: parsed.data.pair,
    orderSize: parsed.data.orderSize,
    maxBidPrice: parsed.data.maxBidPrice,
    tickSize: parsed.data.tickSize,
    checkIntervalMs: parsed.data.checkIntervalMs ?? 3000,
  };

  krakenBot.start(config).catch((err: unknown) => {
    req.log.error({ err }, "Bot start error");
  });

  const status = krakenBot.getStatus();
  res.json(StartBotResponse.parse(status));
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  await krakenBot.stop();
  const status = krakenBot.getStatus();
  res.json(StopBotResponse.parse(status));
});

router.get("/bot/config", async (_req, res): Promise<void> => {
  const config = krakenBot.getConfig();
  res.json(GetBotConfigResponse.parse(config));
});

router.put("/bot/config", async (req, res): Promise<void> => {
  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const config: BotConfig = {
    pair: parsed.data.pair,
    orderSize: parsed.data.orderSize,
    maxBidPrice: parsed.data.maxBidPrice,
    tickSize: parsed.data.tickSize,
    checkIntervalMs: parsed.data.checkIntervalMs ?? 3000,
  };

  krakenBot.setConfig(config);
  res.json(UpdateBotConfigResponse.parse(config));
});

router.get("/bot/logs", async (req, res): Promise<void> => {
  const queryParsed = GetBotLogsQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 50) : 50;
  const logs = krakenBot.getLogs(limit);
  res.json(GetBotLogsResponse.parse(logs));
});

router.get("/bot/orderbook", async (req, res): Promise<void> => {
  const config = krakenBot.getConfig();
  if (!config.pair) {
    res.status(400).json({ error: "No pair configured" });
    return;
  }

  try {
    const book = await krakenBot.getOrderBook(config.pair);
    res.json(
      GetOrderBookResponse.parse({
        pair: config.pair,
        bids: book.bids,
        asks: book.asks,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
