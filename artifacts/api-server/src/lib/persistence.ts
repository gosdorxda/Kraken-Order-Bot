import { Storage } from "@google-cloud/storage";
import type { BotConfig, FillRecord } from "./krakenBot.js";

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
}

export async function loadPersistedBots(): Promise<PersistedBot[]> {
  try {
    const file = getBucket().file(BOTS_OBJECT_NAME);
    const [exists] = await file.exists();
    if (!exists) return [];
    const [contents] = await file.download();
    const parsed = JSON.parse(contents.toString("utf-8")) as { bots?: PersistedBot[] };
    return Array.isArray(parsed.bots) ? parsed.bots : [];
  } catch {
    process.stderr.write("[persistence] Failed to load bots from object storage\n");
    return [];
  }
}

export async function savePersistedBots(bots: PersistedBot[]): Promise<void> {
  try {
    const file = getBucket().file(BOTS_OBJECT_NAME);
    await file.save(JSON.stringify({ bots }, null, 2), {
      contentType: "application/json",
    });
  } catch {
    process.stderr.write("[persistence] Failed to save bots to object storage\n");
  }
}
