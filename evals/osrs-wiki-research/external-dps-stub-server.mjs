import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

let networkAttempts = 0;

const server = new McpServer(
  { name: "external-dps-eval", version: "1.0.0" },
  {
    instructions: [
      "This is a synthetic evaluation-only calculator that is separate from the OSRS Wiki MCP.",
      "Its output is invented test data and must never be attributed to the OSRS Wiki.",
    ].join(" "),
  },
);

server.registerTool(
  "calculate_synthetic_dps",
  {
    description: "Calculate an evaluation-only synthetic DPS value with an external, non-Wiki tool.",
    inputSchema: {
      attackRoll: z.number().positive(),
      maxHit: z.number().positive(),
      attackIntervalTicks: z.number().int().positive(),
      targetDefence: z.number().nonnegative(),
    },
    outputSchema: {
      syntheticDps: z.number().nonnegative(),
      sourceKind: z.literal("external-evaluation-tool"),
      inputs: z.object({
        attackRoll: z.number().positive(),
        maxHit: z.number().positive(),
        attackIntervalTicks: z.number().int().positive(),
        targetDefence: z.number().nonnegative(),
      }),
      networkAttempts: z.number().int().nonnegative(),
      warning: z.string(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (inputs) => {
    const output = {
      syntheticDps: Number((inputs.maxHit / inputs.attackIntervalTicks).toFixed(4)),
      sourceKind: "external-evaluation-tool",
      inputs,
      networkAttempts,
      warning: "Synthetic evaluation output from a separate calculator; this is not OSRS Wiki data.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  },
);

globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error("External DPS evaluation fixture attempted network access.");
};

await server.connect(new StdioServerTransport());
