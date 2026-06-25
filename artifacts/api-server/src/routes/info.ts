import { Router, type IRouter } from "express";
import { fetchBalance } from "../lib/krakenBot";
import { XtClient } from "../lib/xtClient";
import { BitmartClient } from "../lib/bitmartClient";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function fetchPublicIp(): Promise<string> {
  const resp = await fetch("https://api.ipify.org?format=json", {
    signal: AbortSignal.timeout(5000),
  });
  const json = (await resp.json()) as { ip: string };
  return json.ip;
}

router.get("/info", async (req, res): Promise<void> => {
  let publicIp: string | null = null;
  let ipError: string | null = null;
  let krakenConnected = false;
  let krakenError: string | null = null;
  let xtConnected = false;
  let xtError: string | null = null;
  let bitmartConnected = false;
  let bitmartError: string | null = null;

  const xtClient = new XtClient(
    process.env["XT_API_KEY"] ?? "",
    process.env["XT_API_SECRET"] ?? ""
  );

  const bitmartKey = process.env["BITMART_API_KEY"] ?? "";
  const bitmartSecret = process.env["BITMART_API_SECRET"] ?? "";
  const bitmartMemo = process.env["BITMART_MEMO"] ?? "";
  const bitmartClient = new BitmartClient(bitmartKey, bitmartSecret, bitmartMemo);

  const [ipResult, krakenResult, xtResult, bitmartResult] = await Promise.allSettled([
    fetchPublicIp(),
    fetchBalance(),
    xtClient.getBalance(),
    bitmartKey && bitmartSecret ? bitmartClient.getBalance() : Promise.reject(new Error("Kredensial BitMart belum dikonfigurasi")),
  ]);

  if (ipResult.status === "fulfilled") {
    publicIp = ipResult.value;
  } else {
    ipError = ipResult.reason instanceof Error ? ipResult.reason.message : String(ipResult.reason);
    logger.warn({ err: ipError }, "Could not fetch public IP");
  }

  if (krakenResult.status === "fulfilled") {
    krakenConnected = true;
  } else {
    krakenError =
      krakenResult.reason instanceof Error
        ? krakenResult.reason.message
        : String(krakenResult.reason);
    req.log.warn({ err: krakenError }, "Kraken connection test failed");
  }

  if (xtResult.status === "fulfilled") {
    xtConnected = true;
  } else {
    xtError =
      xtResult.reason instanceof Error
        ? xtResult.reason.message
        : String(xtResult.reason);
    req.log.warn({ err: xtError }, "XT connection test failed");
  }

  if (bitmartResult.status === "fulfilled") {
    bitmartConnected = true;
  } else {
    bitmartError =
      bitmartResult.reason instanceof Error
        ? bitmartResult.reason.message
        : String(bitmartResult.reason);
    req.log.warn({ err: bitmartError }, "BitMart connection test failed");
  }

  res.json({ publicIp, ipError, krakenConnected, krakenError, xtConnected, xtError, bitmartConnected, bitmartError });
});

export default router;
