import type { Clock } from "./deadline.ts";
import { Deadline } from "./deadline.ts";

export type RetryRejectionReason = "invalid-retry-after" | "insufficient-budget";

export class RetryRejectedError extends Error {
  readonly reason: RetryRejectionReason;

  constructor(reason: RetryRejectionReason) {
    super(
      reason === "invalid-retry-after"
        ? "The upstream Retry-After value was invalid."
        : "The requested retry delay exceeds the remaining deadline.",
    );
    this.name = "RetryRejectedError";
    this.reason = reason;
  }
}

export function defaultRetryDelay(retryNumber: number, random: number): number {
  if (retryNumber !== 1 && retryNumber !== 2) {
    throw new RangeError("Only retry numbers 1 and 2 are supported.");
  }
  const boundedRandom = Math.min(Math.max(random, 0), 0.999_999_999_999_999_9);
  const minimum = retryNumber === 1 ? 250 : 500;
  return minimum + Math.floor(boundedRandom * 101);
}

export function parseRetryAfter(value: string, wallNow: number): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds * 1_000 : null;
  }

  if (!isHttpDate(trimmed)) return null;

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - wallNow);
}

function isHttpDate(value: string): boolean {
  const weekday = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
  const longWeekday = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
  const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  const time = "\\d{2}:\\d{2}:\\d{2}";
  return (
    new RegExp(`^${weekday}, \\d{2} ${month} \\d{4} ${time} GMT$`).test(value) ||
    new RegExp(`^${longWeekday}, \\d{2}-${month}-\\d{2} ${time} GMT$`).test(value) ||
    new RegExp(`^${weekday} ${month} (?: \\d|\\d{2}) ${time} \\d{4}$`).test(value)
  );
}

export interface WaitForRetryOptions {
  retryNumber: 1 | 2;
  retryAfter?: string;
  clock: Clock;
  requestDeadline: Deadline;
  toolDeadline: Deadline;
  signal?: AbortSignal;
}

export async function waitForRetry({
  retryNumber,
  retryAfter,
  clock,
  requestDeadline,
  toolDeadline,
  signal,
}: WaitForRetryOptions): Promise<void> {
  const delayMilliseconds =
    retryAfter === undefined
      ? defaultRetryDelay(retryNumber, clock.random())
      : parseRetryAfter(retryAfter, clock.wallNow());

  if (delayMilliseconds === null) {
    throw new RetryRejectedError("invalid-retry-after");
  }

  if (
    delayMilliseconds >= requestDeadline.remaining() ||
    delayMilliseconds >= toolDeadline.remaining()
  ) {
    throw new RetryRejectedError("insufficient-budget");
  }

  await clock.sleep(delayMilliseconds, signal);

  if (requestDeadline.expired() || toolDeadline.expired()) {
    throw new RetryRejectedError("insufficient-budget");
  }
}
