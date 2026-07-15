#!/usr/bin/env node

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { JsonHttpClient } from "./http/json-http-client.ts";
import { createServer } from "./server.ts";
import { WikiClient } from "./wiki/wiki-client.ts";

const REPOSITORY_URL = "https://github.com/SanderVirula/osrs-wiki-mcp";
const NODE_UPGRADE_MESSAGE = "osrs-wiki-mcp requires Node.js 24 or newer.\n";

interface PackageJson {
  version: string;
}

export function assertSupportedNodeVersion(version: string): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isInteger(major) || major < 24) {
    throw new Error("osrs-wiki-mcp requires Node.js 24 or newer.");
  }
}

export function createUserAgent(version: string): string {
  return `osrs-wiki-mcp/${version} (+${REPOSITORY_URL})`;
}

export function writeFatalStartupError(
  _error: unknown,
  write: (value: string) => void = (value) => process.stderr.write(value),
): void {
  write("osrs-wiki-mcp failed to start.\n");
}

export async function runExecutable({
  nodeVersion,
  start,
  write = (value) => process.stderr.write(value),
}: {
  nodeVersion: string;
  start(): Promise<void>;
  write?: (value: string) => void;
}): Promise<0 | 1> {
  try {
    assertSupportedNodeVersion(nodeVersion);
  } catch {
    write(NODE_UPGRADE_MESSAGE);
    return 1;
  }

  try {
    await start();
    return 0;
  } catch (error) {
    writeFatalStartupError(error, write);
    return 1;
  }
}

export async function main(): Promise<void> {
  assertSupportedNodeVersion(process.versions.node);
  const packageJson = createRequire(import.meta.url)("../package.json") as PackageJson;
  const httpClient = new JsonHttpClient({ userAgent: createUserAgent(packageJson.version) });
  const wikiClient = new WikiClient(httpClient);
  const server = createServer({ wikiClient, version: packageJson.version });
  await server.connect(new StdioServerTransport());
}

const isExecutable =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isExecutable) {
  void runExecutable({
    nodeVersion: process.versions.node,
    start: main,
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
