import { Router, type IRouter } from "express";
import { botManager } from "../lib/botManager";
import { isTelegramConfigured } from "../lib/telegram";
import { UpdateTelegramSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/telegram/settings", (_req, res): void => {
  const settings = botManager.getTelegramSettings();
  res.json({
    configured: isTelegramConfigured(),
    ...settings,
  });
});

router.put("/telegram/settings", (req, res): void => {
  const parsed = UpdateTelegramSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  botManager.updateTelegramSettings(parsed.data);
  const settings = botManager.getTelegramSettings();
  res.json({
    configured: isTelegramConfigured(),
    ...settings,
  });
});

export default router;
