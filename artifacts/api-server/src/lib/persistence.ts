import fs from "node:fs";
import path from "node:path";
import type { BotConfig, FillRecord } from "./krakenBot.js";

const DATA_FILE = path.resolve(process.cwd(), "data", "bots.json");

export interface PersistedBot {
  id: string;
  config: BotConfig;
  running: boolean;
  fills: FillRecord[];
  fillIdCounter: number;
}

export function loadPersistedBots(): PersistedBot[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { bots?: PersistedBot[] };
    return Array.isArray(parsed.bots) ? parsed.bots : [];
  } catch {
    return [];
  }
}

export function savePersistedBots(bots: PersistedBot[]): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ bots }, null, 2), "utf-8");
  } catch {
    // non-fatal — log via stderr so we don't import the logger here
    process.stderr.write("[persistence] Failed to save bots.json\n");
  }
}
