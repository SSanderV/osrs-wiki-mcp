import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { buildProvenance, type SourceRef } from "../src/contracts.ts";
import { ToolFailure } from "../src/errors.ts";
import { Deadline, systemClock, type Clock } from "../src/http/deadline.ts";
import { JsonHttpClient } from "../src/http/json-http-client.ts";
import { createServer, type WikiClientLike } from "../src/server.ts";
import {
  WikiClient,
  type BucketPage,
  type BucketQuerySpec,
  type BucketScan,
  type ParsedPage,
  type ParseProp,
  type RawBucketRow,
} from "../src/wiki/wiki-client.ts";
import { FakeClock } from "./helpers/fake-clock.ts";
import { deferred } from "./helpers/fake-fetch.ts";

const EXPECTED_TOOLS = [
  "search_wiki",
  "get_wiki_page",
  "get_wiki_sections",
  "get_wiki_section",
  "get_item_info",
  "find_shop",
  "find_drop_sources",
  "get_item_sources",
  "get_quest_requirements",
  "get_monster_info",
] as const;

const source: SourceRef = {
  kind: "search",
  title: "Synthetic result",
  url: "https://oldschool.runescape.wiki/w/Synthetic_result",
  fetchedAt: "2026-07-15T00:00:00.000Z",
};

function pageSource(title: string): SourceRef {
  return {
    kind: "page",
    title,
    url: `https://oldschool.runescape.wiki/w/${title.replaceAll(" ", "_")}`,
    pageId: 1,
    revisionId: 2,
    revisionUrl: `https://oldschool.runescape.wiki/w/index.php?title=${encodeURIComponent(title)}&oldid=2`,
    fetchedAt: source.fetchedAt,
  };
}

function bucketSource(bucket: string, title?: string): SourceRef {
  return {
    kind: "bucket",
    ...(title === undefined ? {} : { title }),
    url: `https://oldschool.runescape.wiki/api.php?action=bucket&query=${bucket}`,
    fetchedAt: source.fetchedAt,
  };
}

function stubWikiClient(overrides: Partial<WikiClientLike> = {}): WikiClientLike {
  const client = {
    async search(_query, _limit, offset) {
      return {
        results: [
          {
            title: "Synthetic result",
            snippet: "A deterministic search result.",
            url: source.url,
            source,
          },
        ],
        total: 1,
        offset,
        fetchedAt: source.fetchedAt,
        source,
      };
    },
    async parsePage(
      title: string,
      props: readonly ParseProp[],
      section: string | undefined,
    ): Promise<ParsedPage> {
      const itemWikitext = `{{Infobox Item
|name=Test sword
|examine=An invented test item.
|members=No
|value=100
}}
An invented item used only by tests.
{{ItemSpawnLine|name=Test sword|location=Test field|100,200|plane=0|mapID=0}}`;
      const wikitext = title === "Test sword" ? itemWikitext : "An invented Wiki page.";
      const exactSource = pageSource(title);
      return {
        title,
        pageId: 1,
        revisionId: 2,
        revisionUrl: exactSource.revisionUrl!,
        ...(props.includes("wikitext") ? { wikitext: `${wikitext}${section === undefined ? "" : `\nSection ${section}`}` } : {}),
        ...(props.includes("sections")
          ? { sections: [{ index: "1", line: "Synthetic section", level: "2" }] }
          : {}),
        source: exactSource,
        fetchedAt: source.fetchedAt,
      };
    },
    async bucketAll(spec: BucketQuerySpec): Promise<BucketScan> {
      let rows: RawBucketRow[] = [];
      if (spec.bucket === "storeline") {
        rows = [{
          data: {
            page_name: "Test shop",
            sold_item: "Test sword",
            sold_item_json: JSON.stringify({
              "Sold by": "Test merchant",
              "Store location": "Test town",
              "Store stock": "5",
              "Store sell price": "100 coins",
            }),
          },
          source: bucketSource(spec.bucket, "Test shop"),
        }];
      } else if (spec.bucket === "dropsline") {
        rows = [{
          data: {
            page_name: "Test beast",
            item_name: "Test sword",
            drop_json: JSON.stringify({
              "Dropped from": "Test beast",
              Level: "10",
              Quantity: "1",
              Rarity: "Always",
            }),
          },
          source: bucketSource(spec.bucket, "Test beast"),
        }];
      } else if (spec.bucket === "recipe") {
        rows = [{
          data: {
            page_name: "Test sword",
            production_json: JSON.stringify({
              materials: [{ name: "Test bar", quantity: 1 }],
              skills: [{ name: "Smithing", level: 1 }],
              output: { name: "Test sword", quantity: 1 },
            }),
          },
          source: bucketSource(spec.bucket, "Test sword"),
        }];
      } else if (spec.bucket === "infobox_monster") {
        rows = [{
          data: {
            page_name: "Test beast",
            page_name_sub: "Test beast#Standard",
            default_version: true,
            name: "Test beast",
            combat_level: 10,
            hitpoints: 20,
          },
          source: bucketSource(spec.bucket, "Test beast"),
        }];
      }
      return {
        rows,
        sources: [bucketSource(spec.bucket)],
        rawRowsExamined: rows.length,
        incomplete: false,
        rawCapReached: false,
      };
    },
    async bucketPage(): Promise<BucketPage> {
      const requestSource = bucketSource("quest");
      return {
        rows: [{
          data: {
            page_name: "Example quest",
            description: "An invented quest.",
            requirements: "* <span data-skill=\"Magic\" data-level=\"1\">1 Magic</span>",
            items_required: "* Test sword",
            json: "{}",
          },
          source: bucketSource("quest", "Example quest"),
        }],
        fetchedAt: source.fetchedAt,
        fromCache: false,
        source: requestSource,
      };
    },
  } satisfies WikiClientLike;
  return Object.assign(client, overrides);
}

async function connectedClient(wikiClient: WikiClientLike, clock: Clock = systemClock) {
  const server = createServer({ wikiClient, clock, version: "1.0.0" });
  const client = new Client({ name: "osrs-wiki-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

test("tools/list exposes exactly ten read-only, open-world tools with input and output schemas", async () => {
  const connection = await connectedClient(stubWikiClient());
  try {
    const listed = await connection.client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      EXPECTED_TOOLS,
    );
    for (const tool of listed.tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.outputSchema?.type, "object", tool.name);
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
      assert.equal(tool.annotations?.openWorldHint, true, tool.name);
      assert.match(tool.description ?? "", /Wiki|wiki/u, tool.name);
    }
    const search = listed.tools.find(({ name }) => name === "search_wiki");
    assert.ok(search);
    assert.deepEqual(search.inputSchema.required, ["query"]);
    assert.deepEqual(Object.keys(search.inputSchema.properties ?? {}), [
      "query",
      "limit",
      "offset",
    ]);
    const searchProperties = search.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    assert.equal(searchProperties.limit?.default, 5);
    assert.equal(searchProperties.offset?.default, 0);
  } finally {
    await connection.close();
  }
});

test("initialize publishes concise Wiki-tool selection instructions", async () => {
  const connection = await connectedClient(stubWikiClient());
  try {
    assert.equal(
      connection.client.getInstructions(),
      [
        "Use the most specific OSRS Wiki tool for the question.",
        "Use get_item_sources for a bounded acquisition overview and find_shop or find_drop_sources for complete paginated listings.",
        "Follow warnings, nextOffset, and section-navigation recovery paths.",
        "Treat results as Wiki facts rather than player-progress evaluation, preserve provenance URLs, and do not invent GE prices, DPS, or account state.",
      ].join(" "),
    );
  } finally {
    await connection.close();
  }
});

test("a successful call has matching readable and schema-validated structured content", async () => {
  const connection = await connectedClient(stubWikiClient());
  try {
    const result = await connection.client.callTool({
      name: "search_wiki",
      arguments: { query: "synthetic" },
    }) as CallToolResult;
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      results: [
        {
          title: "Synthetic result",
          snippet: "A deterministic search result.",
          url: source.url,
        },
      ],
      total: 1,
      offset: 0,
      provenance: buildProvenance([source, source]),
    });
    assert.equal(result.content[0]?.type, "text");
    assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Synthetic result/u);
  } finally {
    await connection.close();
  }
});

test("every registered tool returns content and structured content through the MCP boundary", async () => {
  const connection = await connectedClient(stubWikiClient());
  const calls = [
    { name: "search_wiki", arguments: { query: "synthetic" } },
    { name: "get_wiki_page", arguments: { title: "Test sword" } },
    { name: "get_wiki_sections", arguments: { title: "Test sword" } },
    { name: "get_wiki_section", arguments: { title: "Test sword", section: 1 } },
    { name: "get_item_info", arguments: { item: "Test sword" } },
    { name: "find_shop", arguments: { item: "Test sword" } },
    { name: "find_drop_sources", arguments: { item: "Test sword" } },
    { name: "get_item_sources", arguments: { item: "Test sword" } },
    { name: "get_quest_requirements", arguments: { quest: "Example quest" } },
    { name: "get_monster_info", arguments: { monster: "Test beast" } },
  ] as const;

  try {
    for (const call of calls) {
      const result = await connection.client.callTool(call) as CallToolResult;
      assert.equal(result.isError, undefined, call.name);
      assert.ok(result.structuredContent, call.name);
      assert.equal(result.content[0]?.type, "text", call.name);
    }
  } finally {
    await connection.close();
  }
});

test("valid-call failures are in-band while invalid input and unknown tools are protocol errors", async () => {
  const failingClient = stubWikiClient({
    async search() {
      throw new ToolFailure("UPSTREAM_UNAVAILABLE", "Synthetic upstream failure.");
    },
  });
  const connection = await connectedClient(failingClient);
  try {
    const failure = await connection.client.callTool({
      name: "search_wiki",
      arguments: { query: "synthetic" },
    }) as CallToolResult;
    assert.equal(failure.isError, true);
    assert.equal(failure.structuredContent, undefined);
    assert.match(failure.content[0]?.type === "text" ? failure.content[0].text : "", /UPSTREAM_UNAVAILABLE/u);

    await assert.rejects(
      connection.client.callTool({ name: "search_wiki", arguments: { query: "" } }),
    );
    await assert.rejects(
      connection.client.callTool({ name: "not_a_tool", arguments: {} }),
    );
  } finally {
    await connection.close();
  }
});

test("MCP cancellation reaches the underlying fetch and does not deliver a tool result", async () => {
  const requestStarted = deferred<AbortSignal>();
  const fetchImpl: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    requestStarted.resolve(signal);
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const wikiClient = new WikiClient(new JsonHttpClient({ fetchImpl }));
  const connection = await connectedClient(wikiClient);
  const cancellation = new AbortController();

  try {
    const result = connection.client.callTool(
      { name: "search_wiki", arguments: { query: "synthetic" } },
      undefined,
      { signal: cancellation.signal },
    );
    const fetchSignal = await requestStarted.promise;
    cancellation.abort(new DOMException("Cancelled by test", "AbortError"));

    await assert.rejects(result, (error: unknown) =>
      error instanceof Error && /AbortError: Cancelled by test/u.test(error.message),
    );
    assert.equal(fetchSignal.aborted, true);
  } finally {
    await connection.close();
  }
});

test("an elapsed tool deadline becomes an in-band UPSTREAM_TIMEOUT without client cancellation", async () => {
  const clock = new FakeClock();
  const requestStarted = deferred<void>();
  const fetchImpl: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    requestStarted.resolve();
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const wikiClient = new WikiClient(new JsonHttpClient({ fetchImpl, clock }));
  const connection = await connectedClient(wikiClient, clock);

  try {
    const result = connection.client.callTool({
      name: "search_wiki",
      arguments: { query: "synthetic" },
    });
    await requestStarted.promise;
    clock.advance(30_001);

    const failure = await result as CallToolResult;
    assert.equal(failure.isError, true);
    assert.equal(failure.structuredContent, undefined);
    assert.match(failure.content[0]?.type === "text" ? failure.content[0].text : "", /UPSTREAM_TIMEOUT/u);
  } finally {
    await connection.close();
  }
});
