import { logger } from "./logger";

/**
 * Shared rate limiter for all Kraken API calls.
 *
 * Kraken Starter tier: counter max 15, decays 1 per 3s.
 * We enforce a minimum gap between consecutive calls so total throughput
 * stays well under the limit regardless of how many bots are running.
 *
 * Default: 1 call per 400ms = max 2.5 calls/sec.
 * With 3 bots each making ~3 calls/cycle that's 9 calls per cycle.
 * At 400ms spacing, those 9 calls take 3.6s — safely within Kraken limits.
 *
 * On rate-limit error: gap doubles (backoff), caps at 5s.
 * After 10 consecutive successful calls: gap returns to baseline.
 */

const BASELINE_GAP_MS = 400;
const MAX_GAP_MS = 5000;
const RECOVERY_AFTER = 10; // consecutive successes before reducing gap

class KrakenRateLimiter {
  private gapMs = BASELINE_GAP_MS;
  private lastCallAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private successStreak = 0;

  /**
   * Enqueue a Kraken API call. The call will execute after the previous one
   * finishes + the current gap delay. Returns the call's result (or throws).
   */
  enqueue<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    // Chain onto the existing queue so calls are always sequential.
    const result = this.queue.then(() => this.execute(fn, label));
    // Swallow errors on the shared chain so one failure doesn't stall everything.
    this.queue = result.catch(() => {});
    return result;
  }

  private async execute<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    if (elapsed < this.gapMs) {
      await sleep(this.gapMs - elapsed);
    }

    this.lastCallAt = Date.now();

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (isRateLimitError(err)) {
        this.onRateLimit(label);
        throw err;
      }
      throw err;
    }
  }

  private onSuccess(): void {
    this.successStreak++;
    if (this.gapMs > BASELINE_GAP_MS && this.successStreak >= RECOVERY_AFTER) {
      const prev = this.gapMs;
      this.gapMs = Math.max(BASELINE_GAP_MS, Math.round(this.gapMs / 2));
      this.successStreak = 0;
      if (this.gapMs !== prev) {
        logger.info({ gapMs: this.gapMs }, "Rate limiter: gap reduced after recovery");
      }
    }
  }

  private onRateLimit(label?: string): void {
    this.successStreak = 0;
    const prev = this.gapMs;
    this.gapMs = Math.min(MAX_GAP_MS, this.gapMs * 2);
    logger.warn({ label, prevGapMs: prev, newGapMs: this.gapMs }, "Rate limit hit — backing off");
  }

  getGapMs(): number {
    return this.gapMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return /rate limit|EGeneral:Unknown|EAPI:Rate limit/i.test(err.message);
  }
  return false;
}

export const krakenRateLimiter = new KrakenRateLimiter();
