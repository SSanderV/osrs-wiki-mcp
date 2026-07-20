import { ToolFailure } from "../errors.ts";
import { ByteLruCache } from "./cache.ts";
import { Deadline, systemClock, type Clock } from "./deadline.ts";
import { RetryRejectedError, waitForRetry } from "./retry.ts";
import { Semaphore } from "./semaphore.ts";
import { SingleFlight } from "./single-flight.ts";

const REQUEST_BUDGET_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "osrs-wiki-mcp/1.0 (+https://github.com/SSanderV/osrs-wiki-mcp)";
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

interface CachedJsonEnvelope {
  data: unknown;
  fetchedAt: string;
  byteLength: number;
}

interface SharedJsonEnvelope {
  envelope: CachedJsonEnvelope;
  fromCache: boolean;
}

export interface JsonEnvelope<T> {
  data: T;
  fetchedAt: string;
  byteLength: number;
  fromCache: boolean;
}

export interface JsonRequestOptions<T> {
  /** Must uniquely identify the canonical URL and upstream envelope type. */
  cacheKey: string;
  toolDeadline: Deadline;
  validate(value: unknown): T;
  /** Optional domain policy applied after envelope validation and before cache admission. */
  admit?(value: T): boolean;
  signal?: AbortSignal;
}

export interface JsonHttpClientOptions {
  fetchImpl?: typeof fetch;
  clock?: Clock;
  maximumResponseBytes?: number;
  userAgent?: string;
  semaphore?: Semaphore;
  cache?: ByteLruCache<string, CachedJsonEnvelope>;
  singleFlight?: SingleFlight<string, SharedJsonEnvelope>;
}

export class JsonHttpClient {
  readonly #fetch: typeof fetch;
  readonly #clock: Clock;
  readonly #maximumResponseBytes: number;
  readonly #userAgent: string;
  readonly #semaphore: Semaphore;
  readonly #cache: ByteLruCache<string, CachedJsonEnvelope>;
  readonly #singleFlight: SingleFlight<string, SharedJsonEnvelope>;

  constructor({
    fetchImpl = fetch,
    clock = systemClock,
    maximumResponseBytes = MAX_RESPONSE_BYTES,
    userAgent = USER_AGENT,
    semaphore = new Semaphore(1),
    cache = new ByteLruCache<string, CachedJsonEnvelope>({ clock }),
    singleFlight = new SingleFlight<string, SharedJsonEnvelope>(),
  }: JsonHttpClientOptions = {}) {
    this.#fetch = fetchImpl;
    this.#clock = clock;
    this.#maximumResponseBytes = maximumResponseBytes;
    this.#userAgent = userAgent;
    this.#semaphore = semaphore;
    this.#cache = cache;
    this.#singleFlight = singleFlight;
  }

  async request<T>(url: string | URL, options: JsonRequestOptions<T>): Promise<JsonEnvelope<T>> {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (options.toolDeadline.expired()) throw timeoutFailure();

    const cached = this.#cache.get(options.cacheKey);
    if (cached) return this.#validatedEnvelope(cached, options.validate, true);

    // Every caller keeps its own 30-second tool budget even when it joins a shared flight.
    const subscriberGuard = createDeadlineGuard(
      this.#clock,
      options.toolDeadline,
      options.signal,
    );
    try {
      const sharedEnvelope = await this.#singleFlight.run(
        options.cacheKey,
        subscriberGuard.signal,
        async (underlyingSignal) => {
          const repeatedCacheHit = this.#cache.get(options.cacheKey);
          if (repeatedCacheHit) return { envelope: repeatedCacheHit, fromCache: true };

          const envelope = await this.#requestNetwork(
            String(url),
            underlyingSignal,
            options.validate,
          );
          const validated = options.validate(envelope.data);
          if (options.admit?.(validated) ?? true) {
            this.#cache.set(options.cacheKey, envelope);
          }
          return { envelope, fromCache: false };
        },
      );

      return this.#validatedEnvelope(
        sharedEnvelope.envelope,
        options.validate,
        sharedEnvelope.fromCache,
      );
    } finally {
      subscriberGuard.dispose();
    }
  }

  #validatedEnvelope<T>(
    envelope: CachedJsonEnvelope,
    validate: (value: unknown) => T,
    fromCache: boolean,
  ): JsonEnvelope<T> {
    let data: T;
    try {
      data = validate(envelope.data);
    } catch (error) {
      throw new ToolFailure(
        "UPSTREAM_INVALID_RESPONSE",
        "The Wiki returned data in an unexpected format.",
        { cause: error },
      );
    }
    return { data, fetchedAt: envelope.fetchedAt, byteLength: envelope.byteLength, fromCache };
  }

  async #requestNetwork<T>(
    url: string,
    signal: AbortSignal,
    validate: (value: unknown) => T,
  ): Promise<CachedJsonEnvelope> {
    const release = await this.#semaphore.acquire(signal);
    // Serialized queueing consumes subscriber tool budgets. The outbound request's
    // separate 20-second budget begins only once its upstream slot is acquired.
    const requestDeadline = Deadline.after(this.#clock, REQUEST_BUDGET_MS);
    const requestGuard = createDeadlineGuard(this.#clock, requestDeadline, signal);
    const requestSignal = requestGuard.signal;
    try {
      // Keep the slot across bounded retry waits so Retry-After acts as a
      // process-wide upstream backoff instead of allowing another request through.
      if (requestDeadline.expired()) throw timeoutFailure();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (requestSignal.aborted) throw abortReason(requestSignal);
        if (requestDeadline.expired()) throw timeoutFailure();

        let response: Response;
        try {
          response = await raceWithAbort(
            this.#fetch(url, {
              headers: {
                accept: "application/json",
                "user-agent": this.#userAgent,
              },
              signal: requestSignal,
            }),
            requestSignal,
          );
        } catch (error) {
          if (requestSignal.aborted) throw abortReason(requestSignal);
          if (error instanceof TypeError && attempt < 2) {
            await this.#wait(
              retryNumberForAttempt(attempt),
              undefined,
              requestDeadline,
              requestSignal,
            );
            continue;
          }
          throw new ToolFailure("UPSTREAM_UNAVAILABLE", "The Wiki request failed.", {
            cause: error,
          });
        }

        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status)) {
            await cancelBody(response);
            if (attempt < 2) {
              try {
                await this.#wait(
                  retryNumberForAttempt(attempt),
                  response.headers.get("retry-after") ?? undefined,
                  requestDeadline,
                  requestSignal,
                );
              } catch (error) {
                if (
                  response.status === 429 &&
                  error instanceof ToolFailure &&
                  (error.code === "UPSTREAM_TIMEOUT" ||
                    error.code === "UPSTREAM_INVALID_RESPONSE")
                ) {
                  throw new ToolFailure(
                    "UPSTREAM_RATE_LIMITED",
                    "The Wiki rate-limit response could not be retried safely.",
                    { cause: error },
                  );
                }
                throw error;
              }
              continue;
            }
            throw statusFailure(response.status);
          }
          await cancelBody(response);
          throw new ToolFailure(
            "UPSTREAM_UNAVAILABLE",
            `The Wiki request failed with HTTP ${response.status}.`,
          );
        }

        const body = await readJsonBody(
          response,
          this.#maximumResponseBytes,
          requestSignal,
        );
        if (isMaxlag(body.data)) {
          if (attempt < 2) {
            await this.#wait(
              retryNumberForAttempt(attempt),
              response.headers.get("retry-after") ?? undefined,
              requestDeadline,
              requestSignal,
            );
            continue;
          }
          throw new ToolFailure(
            "UPSTREAM_UNAVAILABLE",
            "The Wiki remained overloaded after bounded retries.",
          );
        }

        try {
          validate(body.data);
        } catch (error) {
          throw new ToolFailure(
            "UPSTREAM_INVALID_RESPONSE",
            "The Wiki returned data in an unexpected format.",
            { cause: error },
          );
        }

        return {
          data: body.data,
          byteLength: body.byteLength,
          fetchedAt: new Date(this.#clock.wallNow()).toISOString(),
        };
      }

      throw new ToolFailure("UPSTREAM_UNAVAILABLE", "The Wiki request failed.");
    } finally {
      requestGuard.dispose();
      release();
    }
  }

  async #wait(
    retryNumber: 1 | 2,
    retryAfter: string | undefined,
    requestDeadline: Deadline,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await waitForRetry({
        retryNumber,
        ...(retryAfter === undefined ? {} : { retryAfter }),
        clock: this.#clock,
        requestDeadline,
        toolDeadline: requestDeadline,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      if (error instanceof RetryRejectedError && error.reason === "insufficient-budget") {
        throw timeoutFailure(error);
      }
      if (error instanceof RetryRejectedError && error.reason === "invalid-retry-after") {
        throw new ToolFailure(
          "UPSTREAM_INVALID_RESPONSE",
          "The Wiki returned an invalid Retry-After header.",
          { cause: error },
        );
      }
      throw error;
    }
  }
}

async function readJsonBody(
  response: Response,
  maximumResponseBytes: number,
  signal: AbortSignal,
): Promise<{ data: unknown; byteLength: number }> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    await cancelBody(response);
    throw new ToolFailure("RESPONSE_TOO_LARGE", "The Wiki response exceeded 5 MiB.");
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await raceWithAbort(reader.read(), signal);
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > maximumResponseBytes) {
          void reader.cancel().catch(() => {
            // The size failure is authoritative even if stream cancellation fails.
          });
          throw new ToolFailure("RESPONSE_TOO_LARGE", "The Wiki response exceeded 5 MiB.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (signal.aborted) {
        void reader.cancel().catch(() => {
          // The deadline or cancellation reason remains authoritative.
        });
        throw abortReason(signal);
      }
      throw error;
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ToolFailure("UPSTREAM_INVALID_RESPONSE", "The Wiki returned invalid text.", {
      cause: error,
    });
  }

  try {
    return { data: JSON.parse(text) as unknown, byteLength };
  } catch (error) {
    throw new ToolFailure("UPSTREAM_INVALID_RESPONSE", "The Wiki returned invalid JSON.", {
      cause: error,
    });
  }
}

function isMaxlag(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "maxlag"
  );
}

function statusFailure(status: number): ToolFailure {
  return status === 429
    ? new ToolFailure("UPSTREAM_RATE_LIMITED", "The Wiki rate limit persisted after retries.")
    : new ToolFailure("UPSTREAM_UNAVAILABLE", `The Wiki returned HTTP ${status} after retries.`);
}

function timeoutFailure(cause?: unknown): ToolFailure {
  return new ToolFailure("UPSTREAM_TIMEOUT", "The Wiki request exceeded its time budget.", {
    cause,
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function cancelBody(response: Response): void {
  void response.body?.cancel().catch(() => {
    // Discard failures must not replace the actual HTTP error.
  });
}

function retryNumberForAttempt(attempt: number): 1 | 2 {
  if (attempt === 0) return 1;
  if (attempt === 1) return 2;
  throw new RangeError("No retry is available after the third attempt.");
}

interface DeadlineGuard {
  signal: AbortSignal;
  dispose(): void;
}

function createDeadlineGuard(
  clock: Clock,
  deadline: Deadline,
  parentSignal?: AbortSignal,
): DeadlineGuard {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(abortReason(parentSignal!));
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const cancelTimer = clock.schedule(deadline.remaining(), () => {
    controller.abort(timeoutFailure());
  });

  return {
    signal: controller.signal,
    dispose() {
      cancelTimer();
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => finish(() => reject(abortReason(signal)));
    let finished = false;
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
