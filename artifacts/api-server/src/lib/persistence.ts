import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BotConfig, FillRecord, BotLog } from "./krakenBot.js";
import type { TelegramEventConfig } from "./telegram.js";

// State path: honor DATA_PATH (full path to state.json) if set, otherwise
// fall back to the standard VPS location. Never hardcode secrets here.
export const STATE_FILE = process.env["DATA_PATH"] ?? "/var/lib/krkn-bot/data/state.json";
export const DATA_DIR = dirname(STATE_FILE);

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

function ensureDataDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
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
    ensureDataDir(STATE_FILE);
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
