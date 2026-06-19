import { Router, type IRouter } from "express";
import { krakenBot } from "../lib/krakenBot";
import { GetAccountBalanceResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/account/balance", async (req, res): Promise<void> => {
  try {
    const balances = await krakenBot.getBalance();
    const result = Object.entries(balances)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([asset, balance]) => ({ asset, balance }));
    res.json(GetAccountBalanceResponse.parse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "Balance fetch error");
    res.status(500).json({ error: msg });
  }
});

export default router;
