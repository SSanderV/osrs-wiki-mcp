import type { Clock } from "./deadline.ts";

const DEFAULT_TTL_MS = 300_000;
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
  bytes: number;
}

export interface ByteLruCacheOptions<V> {
  clock: Pick<Clock, "now">;
  ttlMs?: number;
  maxEntries?: number;
  maxBytes?: number;
  sizeOf?: (value: V) => number;
  isCacheable?: (value: V) => boolean;
}

export class ByteLruCache<K, V> {
  readonly #clock: Pick<Clock, "now">;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #sizeOf: (value: V) => number;
  readonly #isCacheable: (value: V) => boolean;
  readonly #entries = new Map<K, CacheEntry<V>>();
  #byteSize = 0;

  constructor({
    clock,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
    sizeOf = serializedSize,
    isCacheable = () => true,
  }: ByteLruCacheOptions<V>) {
    assertPositiveLimit(ttlMs, "Cache TTL");
    assertPositiveLimit(maxEntries, "Cache entry limit");
    assertPositiveLimit(maxBytes, "Cache byte limit");
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
    this.#sizeOf = sizeOf;
    this.#isCacheable = isCacheable;
  }

  get size(): number {
    this.#pruneExpired();
    return this.#entries.size;
  }

  get byteSize(): number {
    this.#pruneExpired();
    return this.#byteSize;
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.#clock.now()) {
      this.#delete(key, entry);
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): boolean {
    if (!this.#isCacheable(value)) return false;

    const bytes = this.#sizeOf(value);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#maxBytes) return false;

    this.#pruneExpired();
    const current = this.#entries.get(key);
    if (current) this.#delete(key, current);

    while (
      this.#entries.size >= this.#maxEntries ||
      this.#byteSize + bytes > this.#maxBytes
    ) {
      const oldest = this.#entries.entries().next().value as [K, CacheEntry<V>] | undefined;
      if (!oldest) break;
      this.#delete(oldest[0], oldest[1]);
    }

    this.#entries.set(key, {
      value,
      bytes,
      expiresAt: this.#clock.now() + this.#ttlMs,
    });
    this.#byteSize += bytes;
    return true;
  }

  delete(key: K): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#delete(key, entry);
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#byteSize = 0;
  }

  #delete(key: K, entry: CacheEntry<V>): void {
    if (!this.#entries.delete(key)) return;
    this.#byteSize -= entry.bytes;
  }

  #pruneExpired(): void {
    const now = this.#clock.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#delete(key, entry);
    }
  }
}

function serializedSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(serialized, "utf8");
}

function assertPositiveLimit(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
}
