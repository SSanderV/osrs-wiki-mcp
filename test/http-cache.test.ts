import assert from "node:assert/strict";
import test from "node:test";

import { ByteLruCache } from "../src/http/cache.ts";
import { FakeClock } from "./helpers/fake-clock.ts";

interface CacheValue {
  value: string;
  fetchedAt: string;
  bytes: number;
  valid?: boolean;
}

const firstFetch = "2026-07-15T00:00:00.000Z";

function value(name: string, bytes = 1, valid = true): CacheValue {
  return { value: name, fetchedAt: firstFetch, bytes, valid };
}

test("cache entries expire after 300 seconds of monotonic time", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({ clock });
  cache.set("a", value("a"));

  clock.advance(299_999);
  assert.equal(cache.get("a")?.value, "a");

  clock.advance(2);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 0);
});

test("reading an entry refreshes its LRU position", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({ clock, maxEntries: 2 });
  cache.set("a", value("a"));
  cache.set("b", value("b"));

  assert.equal(cache.get("a")?.value, "a");
  cache.set("c", value("c"));

  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a")?.value, "a");
  assert.equal(cache.get("c")?.value, "c");
});

test("the default cache evicts above 256 entries", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({ clock });

  for (let index = 0; index < 257; index += 1) {
    cache.set(String(index), value(String(index)));
  }

  assert.equal(cache.size, 256);
  assert.equal(cache.get("0"), undefined);
  assert.equal(cache.get("256")?.value, "256");
});

test("the default cache evicts above 32 MiB of serialized JSON", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({
    clock,
    sizeOf: (entry) => entry.bytes,
  });

  cache.set("a", value("a", 20 * 1024 * 1024));
  cache.set("b", value("b", 20 * 1024 * 1024));

  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b")?.value, "b");
  assert.equal(cache.byteSize, 20 * 1024 * 1024);
});

test("one oversize candidate is skipped without evicting healthy entries", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({
    clock,
    maxBytes: 10,
    sizeOf: (entry) => entry.bytes,
  });
  cache.set("healthy", value("healthy", 5));

  assert.equal(cache.set("oversize", value("oversize", 11)), false);
  assert.equal(cache.get("healthy")?.value, "healthy");
  assert.equal(cache.get("oversize"), undefined);
});

test("cache hits preserve the original fetchedAt", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({ clock });
  cache.set("a", value("a"));

  clock.advance(60_000);
  assert.equal(cache.get("a")?.fetchedAt, firstFetch);
});

test("the admission predicate rejects invalid, error, and aborted values", () => {
  const clock = new FakeClock();
  const cache = new ByteLruCache<string, CacheValue>({
    clock,
    isCacheable: (entry) => entry.valid === true,
  });

  assert.equal(cache.set("valid", value("valid")), true);
  assert.equal(cache.set("invalid", value("invalid", 1, false)), false);
  assert.equal(cache.get("valid")?.value, "valid");
  assert.equal(cache.get("invalid"), undefined);
});
