// Tracks when a bot was created or last edited by the user, purely on the
// client, so the dashboard can float freshly-created/edited bots to the top
// of the list. Persisted to localStorage so ordering survives page reloads.

const STORAGE_KEY = "kraken-bot-touch-order";

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Marks a bot as just touched (created or edited) so it sorts to the top. */
export function touchBot(id: string): void {
  try {
    const map = readMap();
    map[id] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable — sorting just falls back gracefully.
  }
}

/** Returns the full touch-order map (botId -> last touched timestamp). */
export function getTouchOrder(): Record<string, number> {
  return readMap();
}
