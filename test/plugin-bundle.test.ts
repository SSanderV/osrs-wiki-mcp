import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function loadJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8")) as T;
}

async function loadText(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, root), "utf8");
}

type McpConfig = {
  mcpServers: Record<string, { command: string; args: string[] }>;
};

type ManifestIdentity = {
  name: string;
  version: string;
};

type PluginManifest = ManifestIdentity & {
  skills: string;
  mcpServers: string;
};

type GeminiManifest = ManifestIdentity & {
  mcpServers: McpConfig["mcpServers"];
};

test("all plugin manifests share the package version and exact MCP declaration", async () => {
  const packageJson = await loadJson<{ version: string }>("package.json");
  const packageLock = await loadJson<{
    version: string;
    packages: Record<string, { version?: string }>;
  }>("package-lock.json");
  const codex = await loadJson<PluginManifest>(
    "plugins/osrs-wiki-mcp/.codex-plugin/plugin.json",
  );
  const claude = await loadJson<PluginManifest>(
    ".claude-plugin/plugin.json",
  );
  const gemini = await loadJson<GeminiManifest>("gemini-extension.json");
  const mcp = await loadJson<McpConfig>(".mcp.json");

  assert.equal(packageJson.version, "1.1.1");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""]?.version, packageJson.version);
  for (const manifest of [codex, claude, gemini]) {
    assert.equal(manifest.name, "osrs-wiki-mcp");
    assert.equal(manifest.version, packageJson.version);
  }
  assert.equal(codex.skills, "./skills/");
  assert.equal(claude.skills, "./skills/");
  assert.equal(codex.mcpServers, "./.mcp.json");
  assert.equal(claude.mcpServers, "./.mcp.json");
  assert.equal(
    await loadText("plugins/osrs-wiki-mcp/.mcp.json"),
    await loadText(".mcp.json"),
  );
  assert.equal(
    await loadText(
      "plugins/osrs-wiki-mcp/skills/osrs-wiki-research/SKILL.md",
    ),
    await loadText("skills/osrs-wiki-research/SKILL.md"),
  );
  assert.equal(
    await loadText(
      "plugins/osrs-wiki-mcp/skills/osrs-wiki-research/agents/openai.yaml",
    ),
    await loadText("skills/osrs-wiki-research/agents/openai.yaml"),
  );
  assert.deepEqual(gemini.mcpServers, mcp.mcpServers);
  assert.deepEqual(mcp, {
    mcpServers: {
      "osrs-wiki": {
        command: "npx",
        args: ["--yes", "osrs-wiki-mcp@1.1.1"],
      },
    },
  });
});

test("marketplaces expose the supported plugin roots once", async () => {
  const codex = await loadJson<{
    name: string;
    plugins: Array<{
      name: string;
      source: { source: string; path: string };
      policy: unknown;
    }>;
  }>(".agents/plugins/marketplace.json");
  const claude = await loadJson<{
    name: string;
    description: string;
    plugins: Array<{ name: string; source: string }>;
  }>(".claude-plugin/marketplace.json");

  assert.equal(codex.name, "ssanderv-osrs");
  assert.deepEqual(
    codex.plugins.map(({ name }) => name),
    ["osrs-wiki-mcp"],
  );
  assert.deepEqual(codex.plugins[0]?.source, {
    source: "local",
    path: "./plugins/osrs-wiki-mcp",
  });
  assert.ok(codex.plugins[0]?.policy);
  assert.equal(claude.name, "ssanderv-osrs");
  assert.equal(
    claude.description,
    "OSRS Wiki MCP plugins by SSanderV.",
  );
  assert.deepEqual(claude.plugins, [
    {
      name: "osrs-wiki-mcp",
      source: "./",
      description:
        "Install the stateless OSRS Wiki MCP with source-backed research guidance.",
      category: "research",
      tags: ["osrs", "wiki", "mcp"],
    },
  ]);
});

test("the Codex plugin exposes transparent in-root icon assets", async () => {
  const codex = await loadJson<{
    interface: {
      brandColor: string;
      composerIcon: string;
      logo: string;
    };
  }>("plugins/osrs-wiki-mcp/.codex-plugin/plugin.json");

  assert.deepEqual(
    {
      brandColor: codex.interface.brandColor,
      composerIcon: codex.interface.composerIcon,
      logo: codex.interface.logo,
    },
    {
      brandColor: "#155837",
      composerIcon: "./assets/icon-small.png",
      logo: "./assets/icon.png",
    },
  );

  for (const [path, expectedSize] of [
    ["plugins/osrs-wiki-mcp/assets/icon.png", 512],
    ["plugins/osrs-wiki-mcp/assets/icon-small.png", 128],
  ] as const) {
    const png = await readFile(new URL(path, root));
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.equal(png.readUInt32BE(16), expectedSize);
    assert.equal(png.readUInt32BE(20), expectedSize);
    assert.equal(png[25], 6, `${path} must use RGBA color`);
  }
});

test("public plugin metadata uses the canonical GitHub identity", async () => {
  const publicMetadata = (
    await Promise.all(
      [
        ".agents/plugins/marketplace.json",
        ".claude-plugin/marketplace.json",
        ".claude-plugin/plugin.json",
        "package.json",
        "plugins/osrs-wiki-mcp/.codex-plugin/plugin.json",
        "README.md",
        "src/http/json-http-client.ts",
        "src/index.ts",
      ].map((path) => readFile(new URL(path, root), "utf8")),
    )
  ).join("\n");

  assert.match(publicMetadata, /github\.com\/SSanderV\/osrs-wiki-mcp/u);
  const repositoryOwners = [...publicMetadata.matchAll(/github\.com\/([^/"#\s]+)\/osrs-wiki-mcp/gu)]
    .map(([, owner]) => owner);
  assert.ok(repositoryOwners.length > 0);
  assert.deepEqual([...new Set(repositoryOwners)], ["SSanderV"]);
});

test("plugin configuration contains only the exact runtime pin and no secrets, writes, or personal paths", async () => {
  const paths = [
    ".mcp.json",
    "plugins/osrs-wiki-mcp/.mcp.json",
    "plugins/osrs-wiki-mcp/.codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    "gemini-extension.json",
  ];
  const text = (
    await Promise.all(
      paths.map((path) => readFile(new URL(path, root), "utf8")),
    )
  ).join("\n");

  const pins = [...text.matchAll(/osrs-wiki-mcp@[A-Za-z0-9*_.~^+-]+/gu)].map(
    ([pin]) => pin,
  );
  assert.ok(pins.length > 0);
  assert.deepEqual([...new Set(pins)], ["osrs-wiki-mcp@1.1.1"]);
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]Users[\\/]/u);
  assert.doesNotMatch(text, /token|secret|password|api[_-]?key/iu);
  assert.doesNotMatch(text, /"(env|hooks|apps|monitors|commands)"\s*:/u);
  assert.doesNotMatch(
    text,
    /progression-aware|player-ready|write access/iu,
  );
});

test("trusted staged publishing pins tooling and publishes the verified artifact", async () => {
  const workflow = await loadText(".github/workflows/publish.yml");
  const ci = await loadText(".github/workflows/ci.yml");
  assert.match(workflow, /npm install --global npm@11\.16\.0/u);
  assert.match(
    workflow,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u,
  );
  assert.match(workflow, /id:\s*release-pack/u);
  assert.match(
    workflow,
    /node scripts\/inspect-pack\.mjs --artifact-dir "\$RUNNER_TEMP\/npm-release" --release-sha "\$\{\{ github\.sha \}\}"/u,
  );
  assert.match(
    workflow,
    /echo "tarball=\$RUNNER_TEMP\/npm-release\/\$TARBALL" >> "\$GITHUB_OUTPUT"/u,
  );
  assert.match(
    workflow,
    /npm stage publish "\$\{\{ steps\.release-pack\.outputs\.tarball \}\}"/u,
  );
  for (const testWorkflow of [ci, workflow]) {
    assert.match(
      testWorkflow,
      /node --test --test-concurrency=1 test\/integration\/eval-stub-contract\.test\.ts test\/integration\/release-artifact\.test\.ts/u,
    );
  }
});
