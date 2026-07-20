import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const releaseSha = "0123456789abcdef0123456789abcdef01234567";

test("release mode preserves one fully described verified tarball outside the repository", async () => {
  const artifactDir = await mkdtemp(
    join(tmpdir(), "osrs-wiki-mcp-release-artifact-"),
  );

  try {
    await execFileAsync(
      process.execPath,
      [
        "scripts/inspect-pack.mjs",
        "--artifact-dir",
        artifactDir,
        "--release-sha",
        releaseSha,
      ],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
      },
    );

    const entries = (await readdir(artifactDir)).sort();
    const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
    assert.equal(tarballs.length, 1);
    assert.deepEqual(
      entries,
      ["RELEASE_SHA", "SHA256SUMS", "npm-pack.json", tarballs[0]].sort(),
    );

    const tarballName = tarballs[0]!;
    const tarball = await readFile(join(artifactDir, tarballName));
    const packJsonText = await readFile(
      join(artifactDir, "npm-pack.json"),
      "utf8",
    );
    const pack = JSON.parse(packJsonText) as Array<{
      filename: string;
      name: string;
      version: string;
      shasum: string;
      integrity: string;
    }>;

    assert.equal(pack.length, 1);
    assert.equal(pack[0]?.filename, tarballName);
    assert.equal(pack[0]?.name, "osrs-wiki-mcp");
    assert.equal(pack[0]?.version, "1.1.1");
    assert.equal(
      pack[0]?.shasum,
      createHash("sha1").update(tarball).digest("hex"),
    );
    assert.equal(
      pack[0]?.integrity,
      `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    );

    const sha256 = createHash("sha256").update(tarball).digest("hex");
    assert.equal(
      await readFile(join(artifactDir, "SHA256SUMS"), "utf8"),
      `${sha256}  ${tarballName}\n`,
    );
    assert.equal(
      await readFile(join(artifactDir, "RELEASE_SHA"), "utf8"),
      `${releaseSha}\n`,
    );
    assert.equal(
      (await readdir(root)).some(
        (entry) =>
          entry.endsWith(".tgz") && basename(entry).startsWith("osrs-wiki-mcp-"),
      ),
      false,
    );
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
});
