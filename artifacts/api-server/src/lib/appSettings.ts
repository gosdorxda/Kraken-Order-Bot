import { logger } from "./logger.js";
import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const SETTINGS_OBJECT_NAME = "app-settings.json";

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function getBucket() {
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return gcs.bucket(bucketId);
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
    const file = getBucket().file(SETTINGS_OBJECT_NAME);
    const [exists] = await file.exists();
    if (!exists) return;
    const [contents] = await file.download();
    const parsed = JSON.parse(contents.toString("utf-8")) as Partial<AppSettings>;
    if (parsed.telegramNotifications) {
      _settings.telegramNotifications = {
        ...DEFAULT_SETTINGS.telegramNotifications,
        ...parsed.telegramNotifications,
      };
    }
  } catch (err) {
    logger.warn({ err }, "[appSettings] Failed to load settings from GCS, using defaults");
  }
}

async function persistSettings(): Promise<void> {
  try {
    const file = getBucket().file(SETTINGS_OBJECT_NAME);
    await file.save(JSON.stringify(_settings, null, 2), { contentType: "application/json" });
  } catch (err) {
    logger.warn({ err }, "[appSettings] Failed to save settings to GCS");
  }
}
