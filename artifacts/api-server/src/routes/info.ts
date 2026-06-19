import { Router, type IRouter } from "express";
import { fetchBalance } from "../lib/krakenBot";
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

  const [ipResult, krakenResult] = await Promise.allSettled([
    fetchPublicIp(),
    fetchBalance(),
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

  res.json({ publicIp, ipError, krakenConnected, krakenError });
});

export default router;
