import { Router, type IRouter } from "express";
import { getAppSettings, updateAppSettings } from "../lib/appSettings.js";
import { GetSettingsResponse, UpdateSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/settings", (_req, res): void => {
  res.json(GetSettingsResponse.parse(getAppSettings()));
});

router.patch("/settings", (req, res): void => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = updateAppSettings(parsed.data);
  res.json(GetSettingsResponse.parse(updated));
});

export default router;
