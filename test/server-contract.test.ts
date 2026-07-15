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
import { WikiClient } from "../src/wiki/wiki-client.ts";
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

function stubWikiClient(overrides: Partial<WikiClientLike> = {}): WikiClientLike {
  return {
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
        source,
      };
    },
    async parsePage(title, props, section) {
      const requestedProps = props as readonly string[];
      return {
        title,
        pageId: 1,
        revisionId: 2,
        ...(requestedProps.includes("wikitext") ? { wikitext: `Synthetic content ${section ?? ""}` } : {}),
        ...(requestedProps.includes("sections")
          ? { sections: [{ index: "1", line: "Synthetic section", level: "2" }] }
          : {}),
        source: { ...source, kind: "page", title },
      };
    },
    async bucketAll() {
      return {
        rows: [],
        rawRowsExamined: 0,
        hitSafetyCap: false,
        incomplete: false,
        warnings: [],
        requestSources: [{ ...source, kind: "bucket" }],
      };
    },
    async bucketPage() {
      return {
        rows: [],
        rawRowsExamined: 0,
        source: { ...source, kind: "bucket" },
      };
    },
    ...overrides,
  } as WikiClientLike;
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
