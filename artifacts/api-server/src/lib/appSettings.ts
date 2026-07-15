import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "./logger.js";
import { DATA_DIR } from "./persistence.js";

// Keep app-settings.json alongside state.json in the same data directory
// (resolved from DATA_PATH, see persistence.ts) so there is a single source
// of truth for where bot data lives on disk.
const SETTINGS_FILE = join(DATA_DIR, "app-settings.json");

async function ensureDataDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export interface TelegramNotificationSettings {
  fill: boolean;
  circuitBreaker: boolean;
  botStartStop: boolean;
}

export interface AppSettings {
  telegramNotifications: TelegramNotificationSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  telegramNotifications: { fill: true, circuitBreaker: true, botStartStop: false },
};

let _settings: AppSettings = { ...DEFAULT_SETTINGS, telegramNotifications: { ...DEFAULT_SETTINGS.telegramNotifications } };

export function getAppSettings(): AppSettings {
  return _settings;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.telegramNotifications) {
    _settings = {
      ..._settings,
      telegramNotifications: { ..._settings.telegramNotifications, ...patch.telegramNotifications },
    };
  }
  void persistSettings();
  return _settings;
}

export async function loadAppSettings(): Promise<void> {
  try {
    const contents = await readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(contents) as Partial<AppSettings>;
    if (parsed.telegramNotifications) {
      _settings.telegramNotifications = {
        ...DEFAULT_SETTINGS.telegramNotifications,
        ...parsed.telegramNotifications,
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ err }, `[appSettings] Failed to load settings from ${SETTINGS_FILE}, using defaults`);
    }
  }
}

async function persistSettings(): Promise<void> {
  try {
    await ensureDataDir(SETTINGS_FILE);
    await writeFile(SETTINGS_FILE, JSON.stringify(_settings, null, 2), "utf-8");
  } catch (err) {
    logger.warn({ err }, `[appSettings] Failed to save settings to ${SETTINGS_FILE}`);
  }
}
