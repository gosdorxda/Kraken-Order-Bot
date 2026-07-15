import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BotConfig, FillRecord, BotLog } from "./krakenBot.js";
import type { TelegramEventConfig } from "./telegram.js";

const DATA_DIR = process.env["DATA_DIR"] ?? join(process.cwd(), "data");
const STATE_FILE = join(DATA_DIR, "state.json");

export interface PersistedBot {
  id: string;
  config: BotConfig;
  running: boolean;
  fills: FillRecord[];
  fillIdCounter: number;
  logs: BotLog[];
  logIdCounter: number;
}

export interface PersistedState {
  bots: PersistedBot[];
  telegramSettings?: TelegramEventConfig;
}

async function ensureDataDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function loadPersistedState(): Promise<PersistedState> {
  try {
    const contents = await readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(contents) as {
      bots?: PersistedBot[];
      telegramSettings?: TelegramEventConfig;
    };
    return {
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      telegramSettings: parsed.telegramSettings,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`[persistence] Failed to load state from ${STATE_FILE}: ${err}\n`);
    }
    return { bots: [] };
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  try {
    await ensureDataDir(STATE_FILE);
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    process.stderr.write(`[persistence] Failed to save state to ${STATE_FILE}: ${err}\n`);
  }
}

export async function loadPersistedBots(): Promise<PersistedBot[]> {
  const state = await loadPersistedState();
  return state.bots;
}

export async function savePersistedBots(bots: PersistedBot[]): Promise<void> {
  await savePersistedState({ bots });
}
