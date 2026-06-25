import { Router, type IRouter } from "express";
import * as os from "os";
import { GetSystemStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function sampleCpuTimes(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const val of Object.values(cpu.times)) {
      total += val;
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

router.get("/system/stats", async (_req, res): Promise<void> => {
  const before = sampleCpuTimes();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  const after = sampleCpuTimes();

  const idleDelta  = after.idle  - before.idle;
  const totalDelta = after.total - before.total;
  const cpuPercent = totalDelta > 0
    ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10
    : 0;

  const memTotalMb   = Math.round(os.totalmem()  / 1024 / 1024);
  const memFreeMb    = Math.round(os.freemem()   / 1024 / 1024);
  const memUsedMb    = memTotalMb - memFreeMb;
  const memPercent   = Math.round((memUsedMb / memTotalMb) * 1000) / 10;
  const uptimeSeconds = Math.round(os.uptime());
  const [loadAvg1m = 0, loadAvg5m = 0, loadAvg15m = 0] = os.loadavg();

  const heap        = process.memoryUsage();
  const heapUsedMb  = Math.round(heap.heapUsed  / 1024 / 1024);
  const heapTotalMb = Math.round(heap.heapTotal / 1024 / 1024);

  res.json(GetSystemStatsResponse.parse({
    cpuPercent,
    memUsedMb,
    memTotalMb,
    memPercent,
    uptimeSeconds,
    heapUsedMb,
    heapTotalMb,
    loadAvg1m:  Math.round(loadAvg1m  * 100) / 100,
    loadAvg5m:  Math.round(loadAvg5m  * 100) / 100,
    loadAvg15m: Math.round(loadAvg15m * 100) / 100,
  }));
});

export default router;
