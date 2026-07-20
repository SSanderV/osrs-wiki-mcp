import assert from "node:assert/strict";
import test from "node:test";

import type { SourceRef } from "../src/contracts.ts";
import { ToolFailure } from "../src/errors.ts";
import { Deadline } from "../src/http/deadline.ts";
import {
  findDropSources,
  getItemSources,
  findShop,
  normalizeDropRows,
  normalizeGroundSpawns,
  normalizeRecipeRows,
  normalizeShopRows,
  paginateNormalized,
  type AcquisitionWikiClient,
  type ItemSourcesWikiClient,
} from "../src/domain/acquisition.ts";
import type {
  BucketQuerySpec,
  BucketScan,
  RawBucketRow,
  ParsedPage,
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

test("shop rows that differ only by restock time remain distinct", () => {
  const normalized = normalizeShopRows([
    row("Test shop", {
      sold_item_json: JSON.stringify({
        "Sold by": "Test merchant",
        "Restock time": "10 ticks",
      }),
    }),
    row("Test shop", {
      sold_item_json: JSON.stringify({
        "Sold by": "Test merchant",
        "Restock time": "20 ticks",
      }),
    }),
  ]);

  assert.deepEqual(
    normalized.entries.map(({ value }) => value.restock),
    ["10 ticks", "20 ticks"],
  );
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

test("recipe normalization keeps only exact requested-item outputs", () => {
  const normalized = normalizeRecipeRows(
    [
      row("Test dart", {
        production_json: JSON.stringify({
          ticks: 2,
          members: true,
          materials: [
            { name: "Test dart tip", quantity: 10 },
            { name: "Feather", quantity: "10" },
          ],
          skills: [{ name: "Fletching", level: 20, experience: "5" }],
          output: { name: "Test dart", quantity: 10 },
        }),
      }),
      row("Test dart", {
        production_json: JSON.stringify({
          materials: [{ name: "Poison", quantity: 1 }],
          skills: [],
          output: { name: "Test dart(p)", quantity: 10 },
        }),
      }),
    ],
    "test DART",
  );

  assert.equal(normalized.entries.length, 1);
  assert.equal(normalized.entries[0]?.value.output.name, "Test dart");
  assert.deepEqual(normalized.entries[0]?.value.materials, [
    { name: "Test dart tip", quantity: "10" },
    { name: "Feather", quantity: "10" },
  ]);
  assert.equal(normalized.skippedRows, 0);
});

test("ground-spawn normalization keeps matching items and warns on bad coordinates", () => {
  const page: ParsedPage = {
    title: "Test sword",
    pageId: 100,
    revisionId: 200,
    revisionUrl:
      "https://oldschool.runescape.wiki/w/index.php?title=Test+sword&oldid=200",
    wikitext: `{{ItemSpawnLine
|name=Test sword
|location=[[Alpha field]]
|members=Yes
|100,200
|101,201
|plane=1
|mapID=2
|leagueRegion=North
}}
{{ItemSpawnLine|name=Test sword|location=Broken field|not-a-coordinate}}
{{ItemSpawnLine|name=Other sword|location=Elsewhere|1,2}}`,
    source: pageSource("Test sword"),
    fetchedAt,
  };

  const normalized = normalizeGroundSpawns(page, "Test sword");

  assert.equal(normalized.entries.length, 2);
  assert.deepEqual(normalized.entries[0]?.value, {
    item: "Test sword",
    location: "Alpha field",
    members: true,
    x: 100,
    y: 200,
    plane: 1,
    mapId: 2,
    leagueRegion: "North",
  });
  assert.equal(normalized.entries[1]?.value.x, 101);
  assert.equal(normalized.skippedRows, 1);
  assert.deepEqual(normalized.warnings, [
    "Skipped 1 malformed ground-spawn coordinate.",
  ]);
});

function parsedItemPage(wikitext = "No ground spawns."): ParsedPage {
  return {
    title: "Test sword",
    pageId: 100,
    revisionId: 200,
    revisionUrl:
      "https://oldschool.runescape.wiki/w/index.php?title=Test+sword&oldid=200",
    wikitext,
    source: pageSource("Test sword"),
    fetchedAt,
  };
}

function itemSourcesClient(options: {
  scans?: Partial<Record<"dropsline" | "storeline" | "recipe", BucketScan>>;
  failures?: ReadonlySet<string>;
  page?: ParsedPage;
  order?: string[];
} = {}): ItemSourcesWikiClient {
  return {
    async bucketAll(spec) {
      options.order?.push(spec.bucket);
      if (options.failures?.has(spec.bucket)) {
        throw new ToolFailure("UPSTREAM_UNAVAILABLE", "synthetic failure");
      }
      return options.scans?.[spec.bucket as "dropsline" | "storeline" | "recipe"] ??
        completeScan([]);
    },
    async parsePage() {
      options.order?.push("ground_spawns");
      if (options.failures?.has("ground_spawns")) {
        throw new ToolFailure("UPSTREAM_UNAVAILABLE", "synthetic failure");
      }
      return options.page ?? parsedItemPage();
    },
  };
}

test("get_item_sources validates per-category limits and runs categories sequentially", async () => {
  const order: string[] = [];
  const result = await getItemSources(
    itemSourcesClient({ order }),
    { item: "Test sword" },
    context(),
  );

  assert.deepEqual(order, ["dropsline", "storeline", "recipe", "ground_spawns"]);
  assert.equal(result.perCategoryLimit, 20);
  assert.deepEqual(result.coverage, ["drops", "shops", "recipes", "ground_spawns"]);

  await assert.rejects(
    getItemSources(
      itemSourcesClient(),
      { item: "Test sword", perCategoryLimit: 0 },
      context(),
    ),
    /1 through 100/,
  );
  await assert.rejects(
    getItemSources(
      itemSourcesClient(),
      { item: "Test sword", perCategoryLimit: 101 },
      context(),
    ),
    /1 through 100/,
  );
});

test("complete overview truncation names specialized tools and exact offsets", async () => {
  const dropRows = ["A", "B", "C"].map((name) =>
    row(`Beast ${name}`, {
      drop_json: JSON.stringify({ "Dropped from": `${name} beast`, Rarity: "1/10" }),
    }),
  );
  const shopRows = ["A", "B", "C"].map((name) =>
    row(`Shop ${name}`, {
      sold_item_json: JSON.stringify({ "Sold by": `${name} merchant` }),
    }),
  );
  const result = await getItemSources(
    itemSourcesClient({
      scans: {
        dropsline: completeScan(dropRows),
        storeline: completeScan(shopRows),
      },
    }),
    { item: "Test sword", perCategoryLimit: 2 },
    context(),
  );

  assert.equal(result.drops.total, 3);
  assert.equal(result.drops.totalIsExact, true);
  assert.equal(result.drops.nextOffset, 2);
  assert.match(result.drops.warnings.join(" "), /find_drop_sources with offset 2/);
  assert.equal(result.shops.nextOffset, 2);
  assert.match(result.shops.warnings.join(" "), /find_shop with offset 2/);
});

test("incomplete overview totals stay lower bounds and direct recovery from offset zero", async () => {
  const warning =
    "Upstream pagination failed after 500 raw rows; retry the same tool call. Completed upstream pages may be reused from cache.";
  const drops = {
    rows: [
      row("Test beast", {
        drop_json: JSON.stringify({ "Dropped from": "Test beast", Rarity: "1/10" }),
      }),
    ],
    sources: [requestSource],
    rawRowsExamined: 500,
    incomplete: true,
    rawCapReached: false,
    failedRawOffset: 500,
    warning,
  } satisfies BucketScan;
  const result = await getItemSources(
    itemSourcesClient({ scans: { dropsline: drops } }),
    { item: "Test sword", perCategoryLimit: 1 },
    context(),
  );

  assert.equal(result.drops.total, 1);
  assert.equal(result.drops.totalIsExact, false);
  assert.equal(result.drops.incomplete, true);
  assert.equal("nextOffset" in result.drops, false);
  assert.match(result.drops.warnings.join(" "), /find_drop_sources with offset 0/);
  assert.match(result.drops.warnings.join(" "), /retry/i);
});

test("one failed category degrades to warnings while successful categories remain", async () => {
  const result = await getItemSources(
    itemSourcesClient({ failures: new Set(["dropsline"]) }),
    { item: "Test sword" },
    context(),
  );

  assert.equal(result.drops.incomplete, true);
  assert.equal(result.drops.totalIsExact, false);
  assert.match(result.drops.warnings.join(" "), /unavailable/i);
  assert.equal(result.shops.incomplete, false);
  assert.deepEqual(result.coverage, ["shops", "recipes", "ground_spawns"]);
  assert.equal(result.provenance.sources.length >= 1, true);
});

test("all category failures produce a tool error instead of an empty success", async () => {
  await assert.rejects(
    getItemSources(
      itemSourcesClient({
        failures: new Set(["dropsline", "storeline", "recipe", "ground_spawns"]),
      }),
      { item: "Test sword" },
      context(),
    ),
    (error: unknown) =>
      error instanceof ToolFailure && error.code === "UPSTREAM_UNAVAILABLE",
  );
});

test("all category timeouts preserve the UPSTREAM_TIMEOUT code", async () => {
  const timeout = new ToolFailure("UPSTREAM_TIMEOUT", "synthetic timeout");
  const timedOutClient: ItemSourcesWikiClient = {
    async bucketAll() {
      throw timeout;
    },
    async parsePage() {
      throw timeout;
    },
  };

  await assert.rejects(
    getItemSources(timedOutClient, { item: "Test sword" }, context()),
    (error: unknown) =>
      error instanceof ToolFailure && error.code === "UPSTREAM_TIMEOUT",
  );
});

test("maximum recipe overview truncation does not suggest increasing the limit", async () => {
  const recipeRows = Array.from({ length: 101 }, (_unused, index) =>
    row(`Test recipe ${index}`, {
      page_name: "Test sword",
      production_json: JSON.stringify({
        materials: [{ name: `Test material ${index}`, quantity: 1 }],
        skills: [],
        output: { name: "Test sword", quantity: 1 },
      }),
    }),
  );
  const result = await getItemSources(
    itemSourcesClient({ scans: { recipe: completeScan(recipeRows) } }),
    { item: "Test sword", perCategoryLimit: 100 },
    context(),
  );

  assert.equal(result.recipes.truncated, true);
  assert.doesNotMatch(result.recipes.warnings.join(" "), /increase perCategoryLimit/iu);
  assert.match(result.recipes.warnings.join(" "), /maximum/iu);
});

test("caller cancellation escapes instead of degrading into category warnings", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  controller.abort(cancellation);
  const cancelledClient: ItemSourcesWikiClient = {
    async bucketAll() {
      throw cancellation;
    },
    async parsePage() {
      throw cancellation;
    },
  };
  const clock = new FakeClock();

  await assert.rejects(
    getItemSources(
      cancelledClient,
      { item: "Test sword" },
      {
        toolDeadline: Deadline.after(clock, 30_000),
        signal: controller.signal,
      },
    ),
    (error: unknown) => error === cancellation,
  );
});
