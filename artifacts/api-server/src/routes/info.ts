import { Router, type IRouter } from "express";
import { fetchBalance } from "../lib/krakenBot";
import { XtClient } from "../lib/xtClient";
import { MexcClient } from "../lib/mexcClient";
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
  let mexcConnected = false;
  let mexcError: string | null = null;

  const xtClient = new XtClient(
    process.env["XT_API_KEY"] ?? "",
    process.env["XT_API_SECRET"] ?? ""
  );

  const mexcKey = process.env["MEXC_API_KEY"] ?? "";
  const mexcSecret = process.env["MEXC_API_SECRET"] ?? "";
  const mexcClient = new MexcClient(mexcKey, mexcSecret);

  const [ipResult, krakenResult, xtResult, mexcResult] = await Promise.allSettled([
    fetchPublicIp(),
    fetchBalance(),
    xtClient.getBalance(),
    mexcKey && mexcSecret ? mexcClient.getBalance() : Promise.reject(new Error("Kredensial MEXC belum dikonfigurasi")),
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

  if (mexcResult.status === "fulfilled") {
    mexcConnected = true;
  } else {
    mexcError =
      mexcResult.reason instanceof Error
        ? mexcResult.reason.message
        : String(mexcResult.reason);
    req.log.warn({ err: mexcError }, "MEXC connection test failed");
  }

  res.json({
    publicIp, ipError,
    krakenConnected, krakenError,
    xtConnected, xtError,
    mexcConnected, mexcError,
  });
});

export default router;
