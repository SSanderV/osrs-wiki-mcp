import assert from "node:assert/strict";
import test from "node:test";

import { ToolFailure } from "../src/errors.ts";
import { Deadline } from "../src/http/deadline.ts";
import {
  JsonHttpClient,
  type JsonEnvelope,
  type JsonRequestOptions,
} from "../src/http/json-http-client.ts";
import {
  WikiClient,
  buildBucketQuery,
  escapeBucketLiteral,
  type JsonRequester,
  type WikiRequestContext,
} from "../src/wiki/wiki-client.ts";
import { FakeClock } from "./helpers/fake-clock.ts";
import { jsonResponse } from "./helpers/fake-fetch.ts";
import {
  SYNTHETIC_FETCHED_AT,
  syntheticBucketEnvelope,
  syntheticBucketRows,
  syntheticParseEnvelope,
  syntheticSearchEnvelope,
} from "./helpers/synthetic-fixtures.ts";

function createContext(clock: FakeClock): WikiRequestContext {
  return { toolDeadline: Deadline.after(clock, 30_000) };
}

test("search builds the MediaWiki request and returns cleaned provenance-bearing rows", async () => {
  const clock = new FakeClock();
  const requested: URL[] = [];
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async (input) => {
        requested.push(new URL(String(input)));
        return jsonResponse(syntheticSearchEnvelope());
      },
    }),
  );

  const result = await client.search("Test sword", 2, 5, createContext(clock));

  assert.equal(requested.length, 1);
  assert.equal(requested[0]?.origin, "https://oldschool.runescape.wiki");
  assert.equal(requested[0]?.pathname, "/api.php");
  assert.deepEqual(Object.fromEntries(requested[0]!.searchParams), {
    action: "query",
    format: "json",
    formatversion: "2",
    list: "search",
    srsearch: "Test sword",
    srlimit: "2",
    sroffset: "5",
    srprop: "size|wordcount|snippet|timestamp",
  });
  assert.equal(result.total, 23);
  assert.equal(result.offset, 5);
  assert.equal(result.nextOffset, 7);
  assert.equal(result.results[0]?.snippet, "A bright test result & companion.");
  assert.equal(result.results[0]?.url, "https://oldschool.runescape.wiki/w/Test_sword");
  assert.deepEqual(result.results[0]?.source, {
    kind: "search",
    title: "Test sword",
    url: "https://oldschool.runescape.wiki/w/Test_sword",
    pageId: 101,
    fetchedAt: SYNTHETIC_FETCHED_AT,
  });
  assert.equal(
    result.results[1]?.url,
    "https://oldschool.runescape.wiki/w/Test_sword/History",
  );
});

test("parse requires and returns exact revision provenance", async () => {
  const clock = new FakeClock();
  const requested: URL[] = [];
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async (input) => {
        requested.push(new URL(String(input)));
        return jsonResponse(syntheticParseEnvelope({ revisionId: 303 }));
      },
    }),
  );

  const result = await client.parsePage(
    "Example quest",
    ["wikitext", "sections"],
    undefined,
    createContext(clock),
  );

  assert.equal(requested[0]?.searchParams.get("action"), "parse");
  assert.equal(requested[0]?.searchParams.get("page"), "Example quest");
  assert.equal(requested[0]?.searchParams.get("prop"), "wikitext|sections|revid");
  assert.equal(result.title, "Example quest");
  assert.equal(result.pageId, 202);
  assert.equal(result.revisionId, 303);
  assert.equal(
    result.revisionUrl,
    "https://oldschool.runescape.wiki/w/index.php?title=Example+quest&oldid=303",
  );
  assert.equal(result.source.revisionId, 303);
  assert.equal(result.source.revisionUrl, result.revisionUrl);
  assert.equal(result.source.fetchedAt, SYNTHETIC_FETCHED_AT);
  assert.equal(result.wikitext, "== Overview ==\nAn invented quest page.");
  assert.equal(result.sections?.[0]?.line, "Overview");
});

test("parse rejects an envelope without the required revision and never caches it", async () => {
  const clock = new FakeClock();
  let fetches = 0;
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async () => {
        fetches += 1;
        return jsonResponse(syntheticParseEnvelope());
      },
    }),
  );

  for (let call = 0; call < 2; call += 1) {
    await assert.rejects(
      client.parsePage(
        "Example quest",
        ["wikitext"],
        undefined,
        createContext(clock),
      ),
      (error: unknown) =>
        error instanceof ToolFailure && error.code === "UPSTREAM_INVALID_RESPONSE",
    );
  }
  assert.equal(fetches, 2);
});

test("Bucket literals are escaped and page queries are constructed exactly", () => {
  assert.equal(escapeBucketLiteral("Tester's \\ sword\n"), "'Tester\\'s \\\\ sword\\n'");
  assert.equal(
    buildBucketQuery(
      {
        bucket: "storeline",
        select: ["page_name", "json"],
        where: [["page_name", "Tester's sword"]],
      },
      500,
      0,
    ),
    "bucket('storeline').select('page_name','json').where('page_name','Tester\\'s sword').limit(500).offset(0).run()",
  );
});

test("Bucket pages retain malformed rows for domain-level warnings", async () => {
  const clock = new FakeClock();
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async () =>
        jsonResponse(
          syntheticBucketEnvelope([
            null,
            "malformed",
            { page_name: "Test beast", json: "{}", harmless_future_field: true },
          ]),
        ),
    }),
  );
  const query = "bucket('dropsline').select('page_name','json').limit(500).offset(0).run()";

  const page = await client.bucketPage(query, createContext(clock));

  assert.deepEqual(
    page.rows.map((row) => row.data),
    [null, "malformed", { page_name: "Test beast", json: "{}", harmless_future_field: true }],
  );
  assert.equal(page.rows[2]?.source.title, "Test beast");
  assert.equal(
    page.rows[2]?.source.url,
    "https://oldschool.runescape.wiki/w/Test_beast",
  );
});

test("Bucket pagination uses pages of 500 and cache replay preserves fetch age", async () => {
  const clock = new FakeClock();
  let fetches = 0;
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async () => {
        fetches += 1;
        return jsonResponse(
          syntheticBucketEnvelope(
            fetches === 1 ? syntheticBucketRows(500) : syntheticBucketRows(2, 500),
          ),
        );
      },
    }),
  );
  const spec = { bucket: "dropsline", select: ["page_name", "json"] } as const;

  const first = await client.bucketAll(spec, createContext(clock));
  const second = await client.bucketAll(spec, createContext(clock));

  assert.equal(fetches, 2);
  assert.equal(first.rows.length, 502);
  assert.equal(first.rawRowsExamined, 502);
  assert.equal(first.incomplete, false);
  assert.equal(first.rawCapReached, false);
  assert.equal(second.rows.length, 502);
  assert.equal(second.rows[0]?.source.fetchedAt, first.rows[0]?.source.fetchedAt);
});

test("Bucket pagination stops at the 10,000 raw-row cap", async () => {
  const clock = new FakeClock();
  let fetches = 0;
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async () => {
        const offset = fetches * 500;
        fetches += 1;
        return jsonResponse(syntheticBucketEnvelope(syntheticBucketRows(500, offset)));
      },
    }),
  );

  const result = await client.bucketAll(
    { bucket: "dropsline", select: ["page_name", "json"] },
    createContext(clock),
  );

  assert.equal(fetches, 20);
  assert.equal(result.rows.length, 10_000);
  assert.equal(result.rawRowsExamined, 10_000);
  assert.equal(result.incomplete, true);
  assert.equal(result.rawCapReached, true);
  assert.match(result.warning ?? "", /10,000 raw rows/);
  assert.equal("failedRawOffset" in result, false);
});

test("a later Bucket page failure returns earlier rows with the exact recovery warning", async () => {
  const clock = new FakeClock();
  let fetches = 0;
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async () => {
        fetches += 1;
        return fetches === 1
          ? jsonResponse(syntheticBucketEnvelope(syntheticBucketRows(500)))
          : jsonResponse({}, { status: 400 });
      },
    }),
  );

  const result = await client.bucketAll(
    { bucket: "dropsline", select: ["page_name", "json"] },
    createContext(clock),
  );

  assert.equal(result.rows.length, 500);
  assert.equal(result.incomplete, true);
  assert.equal(result.failedRawOffset, 500);
  assert.equal(
    result.warning,
    "Upstream pagination failed after 500 raw rows; retry the same tool call. Completed upstream pages may be reused from cache.",
  );
});

test("a first Bucket page failure throws instead of returning an empty-looking success", async () => {
  const clock = new FakeClock();
  const client = new WikiClient(
    new JsonHttpClient({
      clock,
      fetchImpl: async () => jsonResponse({}, { status: 400 }),
    }),
  );

  await assert.rejects(
    client.bucketAll(
      { bucket: "dropsline", select: ["page_name", "json"] },
      createContext(clock),
    ),
    (error: unknown) =>
      error instanceof ToolFailure && error.code === "UPSTREAM_UNAVAILABLE",
  );
});

test("tool-budget exhaustion after a Bucket page follows the partial-result path", async () => {
  const clock = new FakeClock();
  let requests = 0;
  const requester: JsonRequester = {
    async request<T>(
      _url: string | URL,
      options: JsonRequestOptions<T>,
    ): Promise<JsonEnvelope<T>> {
      requests += 1;
      const data = options.validate(
        syntheticBucketEnvelope(syntheticBucketRows(500)),
      );
      queueMicrotask(() => clock.advance(30_001));
      return {
        data,
        fetchedAt: SYNTHETIC_FETCHED_AT,
        byteLength: 1,
        fromCache: false,
      };
    },
  };
  const client = new WikiClient(requester);

  const result = await client.bucketAll(
    { bucket: "dropsline", select: ["page_name", "json"] },
    createContext(clock),
  );

  assert.equal(requests, 1);
  assert.equal(result.rows.length, 500);
  assert.equal(result.incomplete, true);
  assert.equal(result.failedRawOffset, 500);
  assert.equal(
    result.warning,
    "Upstream pagination failed after 500 raw rows; retry the same tool call. Completed upstream pages may be reused from cache.",
  );
});
