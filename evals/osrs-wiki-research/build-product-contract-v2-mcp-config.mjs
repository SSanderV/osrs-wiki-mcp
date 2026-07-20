import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [outputPath] = process.argv.slice(2);
if (!outputPath) {
  throw new Error("Usage: build-product-contract-v2-mcp-config.mjs <output-path>");
}

const config = {
  mcpServers: {
    "osrs-wiki": {
      command: process.execPath,
      args: [fileURLToPath(new URL("stub-server.mjs", import.meta.url))],
    },
    "external-dps": {
      command: process.execPath,
      args: [fileURLToPath(new URL("external-dps-stub-server.mjs", import.meta.url))],
    },
  },
};

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
