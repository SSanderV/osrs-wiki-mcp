import assert from "node:assert/strict";
import test from "node:test";

import type { SourceRef } from "../src/contracts.ts";
import { Deadline } from "../src/http/deadline.ts";
import {
  findDropSources,
  findShop,
  normalizeDropRows,
  normalizeShopRows,
  paginateNormalized,
  type AcquisitionWikiClient,
} from "../src/domain/acquisition.ts";
import type {
  BucketQuerySpec,
  BucketScan,
  RawBucketRow,
  WikiRequestContext,
} from "../src/wiki/wiki-client.ts";
import { FakeClock } from "./helpers/fake-clock.ts";

const fetchedAt = "2026-07-15T00:00:00.000Z";
const requestSource: SourceRef = {
  kind: "bucket",
  url: "https://oldschool.runescape.wiki/api.php?action=bucket&query=synthetic",
  fetchedAt,
};

function pageSource(title: string): SourceRef {
  return {
    kind: "bucket",
    title,
    url: `https://oldschool.runescape.wiki/w/${title.replaceAll(" ", "_")}`,
    fetchedAt,
  };
}

function row(title: string, data: Record<string, unknown>): RawBucketRow {
  return {
    data: { page_name: title, ...data },
    source: pageSource(title),
  };
}

function completeScan(rows: RawBucketRow[]): BucketScan {
  return {
    rows,
    sources: [requestSource],
    rawRowsExamined: rows.length,
    incomplete: false,
    rawCapReached: false,
  };
}

function context(): WikiRequestContext {
  const clock = new FakeClock();
  return { toolDeadline: Deadline.after(clock, 30_000) };
}

function stubClient(
  result: BucketScan,
  capture?: (spec: BucketQuerySpec) => void,
): AcquisitionWikiClient {
  return {
    async bucketAll(spec) {
      capture?.(spec);
      return result;
    },
  };
}

test("shop normalization skips malformed JSON, deduplicates, and sorts stably", () => {
  const normalized = normalizeShopRows([
    row("Shop B", {
      sold_item: "Test sword",
      sold_item_json: JSON.stringify({
        "Sold by": "Beta merchant",
        "Store location": "Beta town",
        "Store stock": "5",
        "Store sell price": "100 coins",
      }),
    }),
    row("Shop B", {
      sold_item: "Test sword",
      sold_item_json: JSON.stringify({
        "Sold by": "Beta merchant",
        "Store location": "Beta town",
        "Store stock": "5",
        "Store sell price": "100 coins",
      }),
    }),
    row("Broken shop", { sold_item_json: "not-json" }),
    row("Shop A", {
      sold_item: "Test sword",
      sold_item_json: JSON.stringify({
        "Sold by": "Alpha merchant",
        "Store location": "Alpha town",
        "Store stock": "2",
        "Store notes": "Members area",
      }),
    }),
  ]);

  assert.equal(normalized.entries.length, 2);
  assert.deepEqual(
    normalized.entries.map((entry) => entry.value.shop),
    ["Alpha merchant", "Beta merchant"],
  );
  assert.equal(normalized.skippedRows, 1);
  assert.deepEqual(normalized.warnings, ["Skipped 1 malformed upstream shop row."]);
});

test("drop normalization skips malformed rows, deduplicates, and sorts stably", () => {
  const normalized = normalizeDropRows([
    row("Test beast B", {
      item_name: "Test sword",
      drop_json: JSON.stringify({
        "Dropped from": "Beta beast",
        Level: "20",
        Quantity: "1–2",
        Rarity: "1/10",
      }),
    }),
    row("Test beast A", {
      item_name: "Test sword",
      drop_json: JSON.stringify({
        "Dropped from": "Alpha beast",
        Level: "10",
        Quantity: "1",
        Rarity: "1/5",
      }),
    }),
    row("Test beast A", {
      item_name: "Test sword",
      drop_json: JSON.stringify({
        "Dropped from": "Alpha beast",
        Level: "10",
        Quantity: "1",
        Rarity: "1/5",
      }),
    }),
    row("Broken beast", { drop_json: "[]" }),
  ]);

  assert.equal(normalized.entries.length, 2);
  assert.deepEqual(
    normalized.entries.map((entry) => entry.value.source),
    ["Alpha beast", "Beta beast"],
  );
  assert.equal(normalized.skippedRows, 1);
  assert.deepEqual(normalized.warnings, ["Skipped 1 malformed upstream drop row."]);
});

test("normalized pagination has defaults, exact totals, and exact next offsets", () => {
  const normalized = normalizeShopRows(
    ["A", "B", "C"].map((name) =>
      row(`Shop ${name}`, {
        sold_item_json: JSON.stringify({ "Sold by": `${name} merchant` }),
      }),
    ),
  );
  const first = paginateNormalized(normalized, 0, 1);
  const second = paginateNormalized(normalized, 1, 50);

  assert.equal(first.total, 3);
  assert.equal(first.totalIsExact, true);
  assert.equal(first.returned, 1);
  assert.equal(first.truncated, true);
  assert.equal(first.nextOffset, 1);
  assert.equal(second.offset, 1);
  assert.equal(second.limit, 50);
  assert.equal(second.returned, 2);
  assert.equal(second.truncated, false);
  assert.equal("nextOffset" in second, false);
  assert.throws(() => paginateNormalized(normalized, 0, 101), /1 through 100/);
});

test("find_shop uses the reviewed query fields and compatibility defaults", async () => {
  let captured: BucketQuerySpec | undefined;
  const result = await findShop(
    stubClient(
      completeScan([
        row("Test shop", {
          sold_item: "Test sword",
          sold_item_json: JSON.stringify({
            "Sold by": "Test merchant",
            "Store location": "Example town",
            "Store currency": "Coins",
          }),
        }),
      ]),
      (spec) => {
        captured = spec;
      },
    ),
    { item: "Test sword" },
    context(),
  );

  assert.deepEqual(captured, {
    bucket: "storeline",
    select: ["page_name", "sold_item", "sold_item_json"],
    where: [["sold_item", "Test sword"]],
  });
  assert.equal(result.offset, 0);
  assert.equal(result.limit, 50);
  assert.equal(result.returned, 1);
  assert.equal(result.shops[0]?.shop, "Test merchant");
  assert.equal(result.provenance.sources.some((source) => source.title === "Test shop"), true);
});

test("find_drop_sources uses the reviewed query fields", async () => {
  let captured: BucketQuerySpec | undefined;
  const result = await findDropSources(
    stubClient(
      completeScan([
        row("Test beast", {
          item_name: "Test sword",
          drop_json: JSON.stringify({
            "Dropped from": "Test beast",
            Quantity: "1",
            Rarity: "1/20",
          }),
        }),
      ]),
      (spec) => {
        captured = spec;
      },
    ),
    { item: "Test sword", limit: 10, offset: 0 },
    context(),
  );

  assert.deepEqual(captured, {
    bucket: "dropsline",
    select: ["page_name", "item_name", "drop_json"],
    where: [["item_name", "Test sword"]],
  });
  assert.equal(result.sources[0]?.source, "Test beast");
  assert.equal(result.limit, 10);
});

test("raw-cap totals are lower bounds and do not invent a continuation", async () => {
  const rows = ["A", "B", "C"].map((name) =>
    row(`Shop ${name}`, {
      sold_item_json: JSON.stringify({ "Sold by": `${name} merchant` }),
    }),
  );
  const result = await findShop(
    stubClient({
      rows,
      sources: [requestSource],
      rawRowsExamined: 10_000,
      incomplete: true,
      rawCapReached: true,
      warning: "Upstream raw-row cap reached after 10,000 raw rows; results are incomplete.",
    }),
    { item: "Test sword", limit: 1, offset: 0 },
    context(),
  );

  assert.equal(result.total, 3);
  assert.equal(result.totalIsExact, false);
  assert.equal(result.incomplete, true);
  assert.equal(result.truncated, true);
  assert.equal("nextOffset" in result, false);
  assert.match(result.warnings.join(" "), /10,000 raw rows/);
});

test("mid-pagination failure keeps rows and the exact retry-same-call warning", async () => {
  const warning =
    "Upstream pagination failed after 500 raw rows; retry the same tool call. Completed upstream pages may be reused from cache.";
  const result = await findDropSources(
    stubClient({
      rows: [
        row("Test beast", {
          drop_json: JSON.stringify({
            "Dropped from": "Test beast",
            Quantity: "1",
            Rarity: "Always",
          }),
        }),
      ],
      sources: [requestSource],
      rawRowsExamined: 500,
      incomplete: true,
      rawCapReached: false,
      failedRawOffset: 500,
      warning,
    }),
    { item: "Test sword" },
    context(),
  );

  assert.equal(result.returned, 1);
  assert.equal(result.incomplete, true);
  assert.equal(result.totalIsExact, false);
  assert.equal(result.warnings.includes(warning), true);
});
