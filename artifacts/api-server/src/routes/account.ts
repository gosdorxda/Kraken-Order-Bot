import { Router, type IRouter } from "express";
import { fetchBalance, fetchLockedZusd } from "../lib/krakenBot";
import { XtClient } from "../lib/xtClient";
import { BitmartClient } from "../lib/bitmartClient";
import { GetAccountBalanceResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/account/balance", async (req, res): Promise<void> => {
  try {
    const [balances, lockedZusd] = await Promise.all([fetchBalance(), fetchLockedZusd()]);
    const usedNum = parseFloat(lockedZusd);

    const result = Object.entries(balances)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([asset, balance]) => {
        if (asset === "ZUSD") {
          const total = parseFloat(balance);
          const free  = Math.max(0, total - usedNum);
          return {
            asset,
            balance,
            used: usedNum.toFixed(4),
            free: free.toFixed(4),
          };
        }
        return { asset, balance };
      });

    res.json(GetAccountBalanceResponse.parse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "Balance fetch error");
    res.status(500).json({ error: msg });
  }
});

router.get("/account/xt-balance", async (req, res): Promise<void> => {
  try {
    const xtClient = new XtClient(
      process.env["XT_API_KEY"] ?? "",
      process.env["XT_API_SECRET"] ?? ""
    );
    const balances = await xtClient.getBalance();
    res.json(balances);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err: msg }, "XT balance fetch failed (returning empty)");
    res.json([]);
  }
});

router.get("/account/bitmart-balance", async (req, res): Promise<void> => {
  try {
    const bitmartClient = new BitmartClient(
      process.env["BITMART_API_KEY"] ?? "",
      process.env["BITMART_API_SECRET"] ?? "",
      process.env["BITMART_MEMO"] ?? ""
    );
    const balances = await bitmartClient.getBalance();
    res.json(balances);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err: msg }, "BitMart balance fetch failed (returning empty)");
    res.json([]);
  }
});

export default router;
