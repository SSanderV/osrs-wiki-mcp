import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe",
});
const client = new Client({ name: "osrs-wiki-mcp-live-smoke", version: "1.0.0" });
const earliestFetch = Date.now() - 60_000;

function object(value, label) {
  assert.equal(typeof value, "object", label);
  assert.notEqual(value, null, label);
  assert.equal(Array.isArray(value), false, label);
  return value;
}

function assertProvenance(value, { requireRevision }) {
  const provenance = object(value, "provenance");
  assert.equal(provenance.attribution, "Old School RuneScape Wiki contributors");
  assert.equal(provenance.license, "CC BY-NC-SA 3.0");
  assert.equal(
    provenance.licenseUrl,
    "https://creativecommons.org/licenses/by-nc-sa/3.0/",
  );
  const fetchedAt = Date.parse(provenance.fetchedAt);
  assert.equal(Number.isFinite(fetchedAt), true);
  assert.equal(fetchedAt >= earliestFetch, true, "fetchedAt must be from this live process");
  assert.equal(fetchedAt <= Date.now() + 5_000, true);
  assert.ok(Array.isArray(provenance.sources));
  assert.equal(provenance.sources.length >= 1, true);
  for (const rawSource of provenance.sources) {
    const source = object(rawSource, "provenance source");
    const url = new URL(source.url);
    assert.equal(url.origin, "https://oldschool.runescape.wiki");
  }
  if (requireRevision) {
    const pageSource = provenance.sources.find((candidate) => candidate?.kind === "page");
    assert.ok(pageSource, "parsed page provenance is required");
    assert.equal(Number.isInteger(pageSource.revisionId) && pageSource.revisionId > 0, true);
    assert.equal(new URL(pageSource.revisionUrl).origin, "https://oldschool.runescape.wiki");
  }
}

try {
  await client.connect(transport);

  const search = await client.callTool({
    name: "search_wiki",
    arguments: { query: "Abyssal whip", limit: 2 },
  });
  assert.equal(search.isError, undefined);
  const searchOutput = object(search.structuredContent, "search structuredContent");
  assert.ok(Array.isArray(searchOutput.results));
  assert.equal(searchOutput.results.length >= 1 && searchOutput.results.length <= 2, true);
  assertProvenance(searchOutput.provenance, { requireRevision: false });

  const item = await client.callTool({
    name: "get_item_info",
    arguments: { item: "Abyssal whip" },
  });
  assert.equal(item.isError, undefined);
  const itemOutput = object(item.structuredContent, "item structuredContent");
  assert.equal(itemOutput.title, "Abyssal whip");
  assert.equal(typeof itemOutput.description, "string");
  assert.equal([...itemOutput.description].length <= 16_000, true);
  assertProvenance(itemOutput.provenance, { requireRevision: true });

  process.stdout.write("live smoke passed\n");
} finally {
  await client.close();
}
