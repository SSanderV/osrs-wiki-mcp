import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryPrefixes = ["osrs-wiki-mcp-pack-", "osrs-wiki-mcp-install-"];
const expectedTools = [
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
];

const forbiddenContent = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: "known token prefix", pattern: /\b(?:ghp_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_-]{12,}|npm_[A-Za-z0-9_-]{12,}|pst_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,})\b/u },
  { label: "authorization bearer", pattern: /\bAuthorization\s*:\s*Bearer\s+\S+/iu },
  { label: "credential assignment", pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/iu },
  { label: "credential in URL", pattern: /https?:\/\/[^\s/:]+:[^\s/@]+@/iu },
  { label: "private endpoint", pattern: /\b(?:localhost|127\.0\.0\.1|secure\.runescape\.com)\b/iu },
  { label: "private IPv4 endpoint", pattern: /https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u },
  { label: "default player marker", pattern: /\b(?:DEFAULT_PLAYER|OSRS_PLAYER|PLAYER_NAME|OSRS_USERNAME)\b/u },
  { label: "Windows home path", pattern: /[A-Za-z]:\\Users\\[^\\\s]+\\/u },
  { label: "Unix home path", pattern: /\/(?:Users|home)\/[^/\s]+\//u },
];

function normalizeArchivePath(value) {
  assert.equal(typeof value, "string", "archive paths must be strings");
  const normalized = value.replaceAll("\\", "/");
  assert.equal(normalized.startsWith("/"), false, `absolute archive path: ${value}`);
  assert.equal(/^[A-Za-z]:\//u.test(normalized), false, `absolute archive path: ${value}`);
  assert.equal(normalized.split("/").includes(".."), false, `traversal archive path: ${value}`);
  return normalized.replace(/^\.\//u, "");
}

function allowedPackagePath(value, extracted) {
  const path = extracted ? value.replace(/^package\//u, "") : value;
  return path === "package.json" ||
    path === "README.md" ||
    path === "LICENSE" ||
    path === "THIRD_PARTY_NOTICES.md" ||
    path.startsWith("dist/");
}

export function validateManifestPaths(paths, { extracted = false } = {}) {
  assert.equal(paths.length > 0, true, "package manifest must not be empty");
  for (const rawPath of paths) {
    const path = normalizeArchivePath(rawPath);
    if (extracted && !path.startsWith("package/")) {
      throw new Error(`Unexpected tarball root: ${path}`);
    }
    if (!allowedPackagePath(path, extracted)) {
      throw new Error(`Unexpected package path: ${path}`);
    }
    if (/(?:^|\/)(?:src|test|tests)(?:\/|$)/iu.test(path)) {
      throw new Error(`Source or test path shipped: ${path}`);
    }
    if (/(?:^|\/)\.env(?:\.|$)/iu.test(path) || /credential|secret/iu.test(basename(path))) {
      throw new Error(`Sensitive filename shipped: ${path}`);
    }
  }
}

export function scanTextContent(text, label) {
  for (const candidate of forbiddenContent) {
    if (candidate.pattern.test(text)) {
      throw new Error(`${candidate.label} found in ${label}`);
    }
  }
}

export function runSelfTest() {
  const good = [
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ];
  assert.doesNotThrow(() => validateManifestPaths(good));
  for (const badPath of [
    "src/index.ts",
    "test/server.test.ts",
    ".env",
    "credentials.json",
    "../outside.txt",
    ["C:", "Users", "example", "private.txt"].join("/"),
  ]) {
    assert.throws(() => validateManifestPaths(["package.json", badPath]));
  }
  for (const [label, value] of [
    ["private key", `-----BEGIN ${"PRIVATE"} KEY-----`],
    ["known token", ["ghp", "_", "abcdefghijklmnop1234"].join("")],
    ["credential", ["api", "_key='", "abcdefghijklmnop1234", "'"].join("")],
    ["private endpoint", ["http://", "local", "host:3000/private"].join("")],
    ["default player", ["DEFAULT", "_", "PLAYER = 'Example'"].join("")],
    ["local path", ["C:", "Users", "example", "private.txt"].join("\\")],
  ]) {
    assert.throws(() => scanTextContent(value, label));
  }
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
    windowsHide: true,
    ...options,
  });
}

async function npm(args, options = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  if (process.platform === "win32") {
    const npmCli = join(
      dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    return run(process.execPath, [npmCli, ...args], options);
  }
  return run("npm", args, options);
}

function parsePackJsonDocument(stdout, label) {
  const parsed = JSON.parse(stdout);
  assert.ok(Array.isArray(parsed) && parsed.length === 1, `${label} returned one package`);
  return { document: parsed, entry: parsed[0] };
}

function parsePackJson(stdout, label) {
  return parsePackJsonDocument(stdout, label).entry;
}

async function listFiles(root, prefix = "") {
  const paths = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const archivePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink shipped in tarball: ${archivePath}`);
    if (entry.isDirectory()) paths.push(...await listFiles(root, archivePath));
    else if (entry.isFile()) paths.push(archivePath);
    else throw new Error(`Unsupported tar entry: ${archivePath}`);
  }
  return paths;
}

async function verifyInstalledBinary(installRoot) {
  const serverPath = join(installRoot, "node_modules", "osrs-wiki-mcp", "dist", "index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: installRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "osrs-wiki-mcp-pack-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), expectedTools);
  } finally {
    await client.close();
  }
}

function verifiedTarballPath(filename, directory = repositoryRoot) {
  const base = resolve(directory);
  const path = resolve(base, filename);
  if (dirname(path) !== base || !/^osrs-wiki-mcp-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.tgz$/u.test(basename(path))) {
    throw new Error(`Refusing unsafe tarball path: ${filename}`);
  }
  return path;
}

async function removeVerifiedTemp(path) {
  const name = relative(resolve(tmpdir()), resolve(path));
  if (name.startsWith("..") || name.includes(sep) || !temporaryPrefixes.some((prefix) => name.startsWith(prefix))) {
    throw new Error(`Refusing unsafe temporary cleanup: ${path}`);
  }
  await rm(path, { recursive: true, force: true });
}

async function verifyPackedMetadata(packed, tarballPath) {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  const tarball = await readFile(tarballPath);
  assert.equal(packed.name, packageJson.name, "packed package name");
  assert.equal(packed.version, packageJson.version, "packed package version");
  assert.equal(packed.filename, basename(tarballPath), "packed filename");
  assert.equal(
    packed.shasum,
    createHash("sha1").update(tarball).digest("hex"),
    "packed shasum",
  );
  assert.equal(
    packed.integrity,
    `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    "packed integrity",
  );
  assert.ok(Array.isArray(packed.files), "packed file manifest");
  validateManifestPaths(packed.files.map(({ path }) => path));
  return tarball;
}

async function verifyTarball(packed, tarballPath) {
  const extractRoot = await mkdtemp(join(tmpdir(), "osrs-wiki-mcp-pack-"));
  const installRoot = await mkdtemp(join(tmpdir(), "osrs-wiki-mcp-install-"));

  try {
    const tarball = await verifyPackedMetadata(packed, tarballPath);
    await run("tar", ["-xf", tarballPath, "-C", extractRoot], { cwd: repositoryRoot });
    const extractedPaths = await listFiles(extractRoot);
    validateManifestPaths(extractedPaths, { extracted: true });
    for (const path of extractedPaths) {
      const contents = await readFile(join(extractRoot, ...path.split("/")), "utf8");
      scanTextContent(contents, path);
    }

    await mkdir(installRoot, { recursive: true });
    await writeFile(
      join(installRoot, "package.json"),
      `${JSON.stringify({ name: "osrs-wiki-mcp-pack-check", private: true }, null, 2)}\n`,
      "utf8",
    );
    await npm(
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
      { cwd: installRoot },
    );
    await verifyInstalledBinary(installRoot);
    return tarball;
  } finally {
    await removeVerifiedTemp(extractRoot);
    await removeVerifiedTemp(installRoot);
  }
}

async function inspectPackage() {
  const dryRun = parsePackJson((await npm(["pack", "--dry-run", "--json"])).stdout, "dry run");
  validateManifestPaths(dryRun.files.map(({ path }) => path));

  const packed = parsePackJson((await npm(["pack", "--json"])).stdout, "pack");
  const tarballPath = verifiedTarballPath(packed.filename);
  try {
    await verifyTarball(packed, tarballPath);
  } finally {
    await rm(tarballPath, { force: true });
  }
}

function pathIsWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function verifiedArtifactDirectory(value) {
  assert.equal(typeof value, "string", "artifact directory must be a path");
  const artifactDirectory = await realpath(resolve(value));
  const root = await realpath(repositoryRoot);
  assert.equal(
    pathIsWithin(root, artifactDirectory),
    false,
    "artifact directory must be outside the repository",
  );
  assert.equal(
    (await stat(artifactDirectory)).isDirectory(),
    true,
    "artifact directory must be a directory",
  );
  assert.deepEqual(
    await readdir(artifactDirectory),
    [],
    "artifact directory must be empty",
  );
  return artifactDirectory;
}

function parseInvocation(args) {
  if (args.length === 0) return { mode: "local" };
  if (args.length === 1 && args[0] === "--self-test") {
    return { mode: "self-test" };
  }

  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || options.has(key)) {
      throw new Error(
        "Usage: inspect-pack.mjs [--self-test | --artifact-dir <path> --release-sha <40-hex>]",
      );
    }
    options.set(key, value);
  }
  if (
    options.size !== 2 ||
    !options.has("--artifact-dir") ||
    !options.has("--release-sha")
  ) {
    throw new Error(
      "Release mode requires --artifact-dir and --release-sha",
    );
  }
  const releaseSha = options.get("--release-sha");
  if (!/^[0-9a-f]{40}$/u.test(releaseSha)) {
    throw new Error("release SHA must be 40 lowercase hexadecimal characters");
  }
  return {
    mode: "release",
    artifactDirectory: options.get("--artifact-dir"),
    releaseSha,
  };
}

async function inspectReleaseArtifact(artifactDirectoryValue, releaseSha) {
  const artifactDirectory = await verifiedArtifactDirectory(
    artifactDirectoryValue,
  );
  let tarballPath;
  try {
    const packResult = await npm([
      "pack",
      "--json",
      "--pack-destination",
      artifactDirectory,
    ]);
    const { entry: packed } = parsePackJsonDocument(packResult.stdout, "pack");
    tarballPath = verifiedTarballPath(packed.filename, artifactDirectory);
    const tarball = await verifyTarball(packed, tarballPath);
    const sha256 = createHash("sha256").update(tarball).digest("hex");

    await writeFile(
      join(artifactDirectory, "npm-pack.json"),
      packResult.stdout,
      "utf8",
    );
    await writeFile(
      join(artifactDirectory, "SHA256SUMS"),
      `${sha256}  ${packed.filename}\n`,
      "utf8",
    );
    await writeFile(
      join(artifactDirectory, "RELEASE_SHA"),
      `${releaseSha}\n`,
      "utf8",
    );
  } catch (error) {
    if (tarballPath !== undefined) await rm(tarballPath, { force: true });
    await Promise.all(
      ["npm-pack.json", "SHA256SUMS", "RELEASE_SHA"].map((name) =>
        rm(join(artifactDirectory, name), { force: true })
      ),
    );
    throw error;
  }
}

const invocation = parseInvocation(process.argv.slice(2));
runSelfTest();
if (invocation.mode === "self-test") {
  process.stdout.write("pack inspection self-test passed\n");
} else if (invocation.mode === "release") {
  await inspectReleaseArtifact(
    invocation.artifactDirectory,
    invocation.releaseSha,
  );
  process.stdout.write("release package inspection passed\n");
} else {
  await inspectPackage();
  process.stdout.write("package inspection passed\n");
}
