import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const distEntry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

// npm links `bin` entries as symlinks, so every documented install path -- npx,
// global installs, and the plugin marketplaces -- reaches this file through a
// path that differs from its real location. Node resolves `import.meta.url` to
// the real path but leaves `process.argv[1]` as the symlink, so an entry-point
// guard that compares the two without resolving exits 0 in silence and never
// starts the server. Every other suite invokes dist/index.js by its real path,
// which is exactly the one case that cannot catch that.
test(
  "the built executable serves stdio when invoked through a bin symlink",
  {
    skip:
      process.platform === "win32"
        ? "npm installs bin entries as cmd shims on Windows, not symlinks"
        : false,
  },
  async () => {
    const linkDir = await mkdtemp(join(tmpdir(), "osrs-wiki-mcp-bin-entry-"));
    const linkPath = join(linkDir, "osrs-wiki-mcp");

    try {
      await symlink(distEntry, linkPath);

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [linkPath],
        stderr: "pipe",
      });
      const client = new Client({
        name: "osrs-wiki-mcp-bin-entry-test",
        version: "1.0.0",
      });

      try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.ok(
          listed.tools.length > 0,
          "the symlinked executable must expose the tool surface",
        );
      } finally {
        await client.close();
      }
    } finally {
      await rm(linkDir, { recursive: true, force: true });
    }
  },
);
