import { logger } from "./logger";

/**
 * Shared rate limiter for XT.com private API calls.
 *
 * XT.com private API limit: ~3 req/s per key.
 * We enforce a minimum 350ms gap between consecutive private calls,
 * giving ~2.85 calls/sec with headroom.
 *
 * On rate-limit error: gap doubles (backoff), caps at 5s.
 * After 10 consecutive successful calls: gap returns to baseline.
 */

const BASELINE_GAP_MS = 350;
const MAX_GAP_MS = 5000;
const RECOVERY_AFTER = 10;

class XtRateLimiter {
  private gapMs = BASELINE_GAP_MS;
  private lastCallAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private successStreak = 0;

  enqueue<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    const result = this.queue.then(() => this.execute(fn, label));
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
        logger.info({ gapMs: this.gapMs }, "XT rate limiter: gap reduced after recovery");
      }
    }
  }

  private onRateLimit(label?: string): void {
    this.successStreak = 0;
    const prev = this.gapMs;
    this.gapMs = Math.min(MAX_GAP_MS, this.gapMs * 2);
    logger.warn({ label, prevGapMs: prev, newGapMs: this.gapMs }, "XT rate limit hit — backing off");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return /rate.?limit|too.?many.?request|429|RATE/i.test(err.message);
  }
  return false;
}

export const xtRateLimiter = new XtRateLimiter();
