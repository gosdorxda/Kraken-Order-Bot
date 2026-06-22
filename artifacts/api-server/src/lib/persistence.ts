import { Storage } from "@google-cloud/storage";
import type { BotConfig, FillRecord, BotLog } from "./krakenBot.js";
import type { TelegramEventConfig } from "./telegram.js";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const BOTS_OBJECT_NAME = "bots.json";

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
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

export async function loadPersistedState(): Promise<PersistedState> {
  try {
    const file = getBucket().file(BOTS_OBJECT_NAME);
    const [exists] = await file.exists();
    if (!exists) return { bots: [] };
    const [contents] = await file.download();
    const parsed = JSON.parse(contents.toString("utf-8")) as {
      bots?: PersistedBot[];
      telegramSettings?: TelegramEventConfig;
    };
    return {
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      telegramSettings: parsed.telegramSettings,
    };
  } catch {
    process.stderr.write("[persistence] Failed to load state from object storage\n");
    return { bots: [] };
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  try {
    const file = getBucket().file(BOTS_OBJECT_NAME);
    await file.save(JSON.stringify(state, null, 2), {
      contentType: "application/json",
    });
  } catch {
    process.stderr.write("[persistence] Failed to save state to object storage\n");
  }
}

export async function loadPersistedBots(): Promise<PersistedBot[]> {
  const state = await loadPersistedState();
  return state.bots;
}

export async function savePersistedBots(bots: PersistedBot[]): Promise<void> {
  await savePersistedState({ bots });
}
