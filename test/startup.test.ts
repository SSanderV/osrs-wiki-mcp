import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSupportedNodeVersion,
  createUserAgent,
  runExecutable,
  writeFatalStartupError,
} from "../src/index.ts";

test("startup enforces the declared Node 24 baseline", () => {
  assert.doesNotThrow(() => assertSupportedNodeVersion("24.0.0"));
  assert.doesNotThrow(() => assertSupportedNodeVersion("25.1.0"));
  assert.throws(
    () => assertSupportedNodeVersion("23.11.0"),
    /Node\.js 24 or newer/u,
  );
});

test("the executable prints the static upgrade message before attempting startup", async () => {
  let stderr = "";
  let started = false;
  const exitCode = await runExecutable({
    nodeVersion: "23.11.0",
    async start() {
      started = true;
    },
    write(value) {
      stderr += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(started, false);
  assert.equal(stderr, "osrs-wiki-mcp requires Node.js 24 or newer.\n");
});

test("the Wiki User-Agent is derived from the package version and public repository", () => {
  assert.equal(
    createUserAgent("1.2.3"),
    "osrs-wiki-mcp/1.2.3 (+https://github.com/SanderVirula/osrs-wiki-mcp)",
  );
});

test("fatal startup reporting does not echo exception details or secrets", () => {
  let stderr = "";
  writeFatalStartupError(new Error("token=pst_should_never_be_printed"), (value) => {
    stderr += value;
  });
  assert.equal(stderr, "osrs-wiki-mcp failed to start.\n");
});

test("the executable source retains its Node shebang", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.equal(source.startsWith("#!/usr/bin/env node\n"), true);
});
