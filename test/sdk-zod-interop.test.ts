import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

test("the pinned MCP SDK publishes and validates Zod 4 raw-shape schemas", async () => {
  const server = new McpServer({ name: "sdk-zod-spike", version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      inputSchema: {
        value: z.string().min(1),
      },
      outputSchema: {
        echoed: z.string(),
      },
    },
    ({ value }) => {
      const structuredContent = { echoed: value };
      return {
        content: [{ type: "text", text: value }],
        structuredContent,
      };
    },
  );

  const client = new Client({ name: "sdk-zod-spike-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    const tool = listed.tools.find(({ name }) => name === "echo");

    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
    assert.deepEqual(tool.inputSchema.required, ["value"]);
    assert.equal(tool.outputSchema?.type, "object");
    assert.deepEqual(tool.outputSchema?.required, ["echoed"]);

    const result = await client.callTool({ name: "echo", arguments: { value: "ok" } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { echoed: "ok" });
  } finally {
    await client.close();
    await server.close();
  }
});
