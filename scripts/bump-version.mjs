#!/usr/bin/env node
// Raises the patch version everywhere CONTRIBUTING.md says the release version
// lives. Merging the result to main is what publishes the new version.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pinnedFiles = [
  ".claude-plugin/plugin.json",
  ".mcp.json",
  "README.md",
  "gemini-extension.json",
  "package.json",
  "plugins/osrs-wiki-mcp/.codex-plugin/plugin.json",
  "plugins/osrs-wiki-mcp/.mcp.json",
  "test/integration/release-artifact.test.ts",
  "test/plugin-bundle.test.ts",
];

const packageUrl = new URL("package.json", root);
const current = JSON.parse(await readFile(packageUrl, "utf8")).version;
const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(current);
if (!match) {
  throw new Error(`Cannot bump version "${current}"`);
}
const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;

for (const path of pinnedFiles) {
  const url = new URL(path, root);
  const text = await readFile(url, "utf8");
  if (!text.includes(current)) {
    throw new Error(`${path} does not contain ${current}`);
  }
  await writeFile(url, text.replaceAll(current, next));
}

// Only the root entries: other packages in the lockfile can share this number.
const lockUrl = new URL("package-lock.json", root);
const lock = JSON.parse(await readFile(lockUrl, "utf8"));
lock.version = next;
lock.packages[""].version = next;
await writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`);

console.log(next);
