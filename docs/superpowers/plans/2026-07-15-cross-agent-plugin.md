# OSRS Wiki MCP Cross-Agent Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Do not use
> implementation subagents unless the user explicitly authorizes lower-tier
> workers and primary-agent review.

**Goal:** Release a thin, versioned Codex/Claude/Gemini plugin wrapper that
starts the single published OSRS Wiki MCP runtime and teaches agents to select
its ten tools accurately.

**Architecture:** The public repository root is the plugin root. Codex and
Claude share one `.mcp.json` and one lazy `skills/osrs-wiki-research` skill,
while separate native manifests and marketplace catalogs point back to that
root; Gemini repeats only the MCP declaration required by its manifest. MCP
server instructions provide the portable baseline for clients that do not load
the skill.

**Tech Stack:** Node.js 24, TypeScript 7, MCP SDK 1.29, Zod 4, Node test runner,
Codex plugin manifests, Claude Code plugins, Gemini CLI extensions, npm trusted
publishing.

## Global Constraints

- Implement on an isolated feature branch/worktree, never directly on public
  `main`.
- Use strict red-green-refactor for server behavior and bundle contracts.
- Run a no-skill baseline before creating `SKILL.md`; if the baseline exposes
  no meaningful failure, stop and remove the skill from scope instead of
  shipping redundant instructions.
- Use one release version everywhere: `1.1.0`.
- Start exactly `npx --yes osrs-wiki-mcp@1.1.0`; never use `latest`, a range,
  an unpinned global binary, or a second server implementation.
- Require Node.js 24 or newer on every platform.
- Preserve exactly ten read-only Wiki tools and all existing schemas, warnings,
  provenance, reliability budgets, and licensing behavior.
- Add no player state, progression, hiscores, GE price, DPS, hosting, UI,
  telemetry, credentials, hooks, monitors, apps, commands, or persistent data.
- Keep Wiki-derived data out of the repository; eval prompts and fixtures are
  synthetic or procedural only.
- Do not add plugin files to the npm tarball. GitHub distributes the wrapper;
  npm distributes the runtime.
- Re-check current official platform docs immediately before implementation;
  if a manifest contract changed, update the design and this plan before code.
- Native Gemini CLI execution is a third-party-code boundary. Do not execute a
  downloaded CLI without explicit approval; deterministic manifest tests remain
  mandatory regardless.

---

### Task 1: Publish Portable MCP Server Instructions

**Files:**

- Modify: `test/server-contract.test.ts`
- Modify: `src/server.ts`

**Interfaces:**

- Produces: `SERVER_INSTRUCTIONS: string`
- Changes: MCP initialize result gains `instructions`; tools and call results
  remain byte-for-byte contract compatible.

- [ ] **Step 1: Write the failing initialize-contract test**

Add this test after the existing `tools/list` test in
`test/server-contract.test.ts`:

```ts
test("initialize publishes concise Wiki-tool selection instructions", async () => {
  const connection = await connectedClient(stubWikiClient());
  try {
    assert.equal(
      connection.client.getInstructions(),
      [
        "Use the most specific OSRS Wiki tool for the question.",
        "Use get_item_sources for a bounded acquisition overview and find_shop or find_drop_sources for complete paginated listings.",
        "Follow warnings, nextOffset, and section-navigation recovery paths.",
        "Treat results as Wiki facts rather than player-progress evaluation, preserve provenance URLs, and do not invent GE prices, DPS, or account state.",
      ].join(" "),
    );
  } finally {
    await connection.close();
  }
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```powershell
node --test --test-name-pattern="initialize publishes" test/server-contract.test.ts
```

Expected: one assertion failure showing `actual: undefined`; the server has not
published instructions yet.

- [ ] **Step 3: Add the minimum server implementation**

Add this constant immediately below `TOOL_BUDGET_MS` in `src/server.ts`:

```ts
export const SERVER_INSTRUCTIONS = [
  "Use the most specific OSRS Wiki tool for the question.",
  "Use get_item_sources for a bounded acquisition overview and find_shop or find_drop_sources for complete paginated listings.",
  "Follow warnings, nextOffset, and section-navigation recovery paths.",
  "Treat results as Wiki facts rather than player-progress evaluation, preserve provenance URLs, and do not invent GE prices, DPS, or account state.",
].join(" ");
```

Replace the server construction with:

```ts
const server = new McpServer(
  { name: "osrs-wiki-mcp", version },
  { instructions: SERVER_INSTRUCTIONS },
);
```

- [ ] **Step 4: Verify red-to-green without regressions**

Run:

```powershell
node --test --test-name-pattern="initialize publishes" test/server-contract.test.ts
npm.cmd run typecheck
npm.cmd test
```

Expected: the targeted test passes, typecheck succeeds, and all existing tests
remain green.

- [ ] **Step 5: Commit the behavior change**

```powershell
git add -- src/server.ts test/server-contract.test.ts
git commit -m "feat: publish MCP usage instructions"
```

---

### Task 2: Baseline-Test and Author the Shared Research Skill

**Files:**

- Create: `evals/osrs-wiki-research/cases.json`
- Create: `skills/osrs-wiki-research/SKILL.md`
- Create: `skills/osrs-wiki-research/agents/openai.yaml`

**Interfaces:**

- Produces: skill `osrs-wiki-research`
- Depends on: the ten public tool names and the boundaries documented in
  `README.md`
- Does not depend on: live Wiki access, scripts, copied Wiki facts, or private
  user context

- [ ] **Step 1: Add the neutral evaluation cases**

Create `evals/osrs-wiki-research/cases.json` with this exact content:

```json
{
  "version": 1,
  "catalogSource": "README.md#tools",
  "cases": [
    {
      "id": "item-acquisition",
      "prompt": "Where can an ironman get a rune scimitar? Give a bounded overview, and if the drop list is truncated explain the exact follow-up.",
      "expected": {
        "requiredTools": ["get_item_sources"],
        "optionalTools": ["find_drop_sources"],
        "requiredBehaviors": ["follow actionable truncation warnings", "include provenance URLs"]
      }
    },
    {
      "id": "quest-requirements",
      "prompt": "What are the requirements for Desert Treasure I? Do not assume anything about my account.",
      "expected": {
        "requiredTools": ["get_quest_requirements"],
        "optionalTools": [],
        "requiredBehaviors": ["report requirements without met or missing statuses", "include provenance URLs"]
      }
    },
    {
      "id": "ambiguous-title",
      "prompt": "Research Bandos on the OSRS Wiki, but resolve which page I mean before requesting an exact page.",
      "expected": {
        "requiredTools": ["search_wiki"],
        "optionalTools": ["get_wiki_page"],
        "requiredBehaviors": ["clarify or resolve ambiguity before an exact-title lookup"]
      }
    },
    {
      "id": "long-page",
      "prompt": "Summarize a long OSRS Wiki guide. If the page response is truncated, plan the section calls needed to continue safely.",
      "expected": {
        "requiredTools": ["get_wiki_page"],
        "optionalTools": ["get_wiki_sections", "get_wiki_section"],
        "requiredBehaviors": ["use section metadata before section retrieval", "do not present truncated text as complete"]
      }
    },
    {
      "id": "monster-variants",
      "prompt": "Compare the Wiki facts for every returned Callisto variant without calculating DPS.",
      "expected": {
        "requiredTools": ["get_monster_info"],
        "optionalTools": [],
        "requiredBehaviors": ["keep variants separate", "include provenance URLs"]
      }
    },
    {
      "id": "ge-price-boundary",
      "prompt": "What is the live Grand Exchange price of a twisted bow right now?",
      "expected": {
        "requiredTools": [],
        "optionalTools": [],
        "requiredBehaviors": ["state that live GE prices are outside this server's scope", "do not present item value as a live price"]
      }
    },
    {
      "id": "progression-boundary",
      "prompt": "Using this MCP, tell me whether my account is ready for Recipe for Disaster.",
      "expected": {
        "requiredTools": [],
        "optionalTools": ["get_quest_requirements"],
        "requiredBehaviors": ["state that no player state is available", "do not claim ready, met, missing, or unmet"]
      }
    },
    {
      "id": "dps-boundary",
      "prompt": "Calculate my exact DPS against Vorkath using this MCP.",
      "expected": {
        "requiredTools": [],
        "optionalTools": ["get_monster_info"],
        "requiredBehaviors": ["state that DPS and player loadouts are outside scope", "do not fabricate a calculation"]
      }
    }
  ]
}
```

- [ ] **Step 2: Validate the fixture before using it**

Run:

```powershell
node -e "const f=require('./evals/osrs-wiki-research/cases.json'); if(f.cases.length!==8||new Set(f.cases.map(x=>x.id)).size!==8) process.exit(1)"
```

Expected: exit code 0 and no output.

- [ ] **Step 3: Run the no-skill baseline before creating the skill**

For each case, give a fresh Claude Haiku session only the case's `prompt` and
the `README.md` tool table. Ask it to return a tool plan and answer boundaries,
not to execute tools. Disable all tools and skills. Use this command shape one
case at a time, substituting only `$case.prompt`:

```powershell
$case = (Get-Content evals/osrs-wiki-research/cases.json -Raw | ConvertFrom-Json).cases[0]
$catalog = Get-Content README.md -Raw
$prompt = "Using only the tool catalog below, plan the tool calls and answer boundaries for this request. Do not execute anything. Request: $($case.prompt)`n`nCATALOG:`n$catalog"
claude -p --model haiku --effort low --tools "" --disable-slash-commands --setting-sources project --no-session-persistence --output-format json $prompt
```

Record outputs outside the repository and score them against `expected`. Do not
show the model the `expected` object. At least one case must miss a required
behavior or choose a less suitable tool; otherwise stop and revise the design
to omit the skill.

- [ ] **Step 4: Initialize the skill only after observing a baseline failure**

Run the official initializer:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\init_skill.py" osrs-wiki-research --path skills --interface 'display_name=OSRS Wiki Research' --interface 'short_description=Source-backed OSRS Wiki research' --interface 'default_prompt=Use $osrs-wiki-research to research an OSRS question with Wiki sources.'
```

Expected: `skills/osrs-wiki-research/SKILL.md` and
`skills/osrs-wiki-research/agents/openai.yaml` are created with no extra
resource directories.

- [ ] **Step 5: Replace the template with the minimum skill**

Set `skills/osrs-wiki-research/SKILL.md` to:

```markdown
---
name: osrs-wiki-research
description: Use when researching Old School RuneScape Wiki pages, item acquisition, quest requirements, monster variants, shops, drops, or source-backed OSRS facts through the osrs-wiki MCP.
---

# OSRS Wiki Research

Use the connected `osrs-wiki` tools as the factual source. Select the narrowest semantic tool:

- item facts → `get_item_info`
- bounded acquisition overview → `get_item_sources`
- complete paginated shops or drops → `find_shop` or `find_drop_sources`
- quest requirements → `get_quest_requirements`
- monster facts and variants → `get_monster_info`
- general or ambiguous topic → `search_wiki`, then an exact page tool

For long pages, call `get_wiki_sections` before `get_wiki_section`. Follow every warning and `nextOffset`; never describe truncated or incomplete results as complete.

Keep returned monster variants separate. Treat quest requirements as Wiki facts, not account readiness. This server has no player state, progression evaluation, live GE prices, or DPS calculation. State that boundary when a request depends on one of them.

Synthesize only supported facts and include the canonical URLs from `provenance` in the answer.
```

Set `skills/osrs-wiki-research/agents/openai.yaml` to:

```yaml
interface:
  display_name: "OSRS Wiki Research"
  short_description: "Source-backed OSRS Wiki research"
  default_prompt: "Use $osrs-wiki-research to research an OSRS question with Wiki sources."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 6: Validate shape and token cost**

Run:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" skills/osrs-wiki-research
(Get-Content skills/osrs-wiki-research/SKILL.md -Raw | Measure-Object -Word).Words
```

Expected: validation passes and the word count is below 500.

- [ ] **Step 7: Rerun the eight cases with the skill loaded**

Copy only the skill into a disposable plugin folder so the production MCP does
not start during the offline evaluation:

```powershell
$evalPlugin = Join-Path $env:TEMP 'osrs-wiki-research-eval-plugin'
New-Item -ItemType Directory -Force -Path "$evalPlugin\.claude-plugin" | Out-Null
New-Item -ItemType Directory -Force -Path "$evalPlugin\skills" | Out-Null
Copy-Item -Recurse -Force skills/osrs-wiki-research "$evalPlugin\skills\osrs-wiki-research"
Set-Content -LiteralPath "$evalPlugin\.claude-plugin\plugin.json" -Encoding utf8 -Value '{"name":"osrs-wiki-research-eval","version":"1.0.0","description":"Temporary offline skill evaluation"}'
```

Run each prompt with the same catalog and no tools, changing only the invocation
to load the disposable plugin:

```powershell
claude -p --model haiku --effort low --plugin-dir $evalPlugin --tools "" --setting-sources project --no-session-persistence --output-format json $prompt
```

Expected: every plugin-arm output satisfies its `expected` behaviors and the
skill fixes at least one observed baseline failure. The primary agent must read
all sixteen outputs; do not rely on automated keyword counts alone. Remove the
temporary folder after scoring.

- [ ] **Step 8: Commit the validated skill and cases**

```powershell
git add -- evals/osrs-wiki-research/cases.json skills/osrs-wiki-research
git commit -m "feat: add OSRS Wiki research skill"
```

---

### Task 3: Add Failing Cross-Agent Bundle Contracts

**Files:**

- Create: `test/plugin-bundle.test.ts`

**Interfaces:**

- Consumes: `package.json`, `package-lock.json`, all three platform manifests,
  two marketplace catalogs, and `.mcp.json`
- Produces: offline drift and secret-surface protection in the existing test
  suite

- [ ] **Step 1: Create the contract test before any manifests**

Create `test/plugin-bundle.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function loadJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8")) as T;
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
  const packageLock = await loadJson<{ version: string; packages: Record<string, { version?: string }> }>("package-lock.json");
  const codex = await loadJson<PluginManifest>(".codex-plugin/plugin.json");
  const claude = await loadJson<PluginManifest>(".claude-plugin/plugin.json");
  const gemini = await loadJson<GeminiManifest>("gemini-extension.json");
  const mcp = await loadJson<McpConfig>(".mcp.json");

  assert.equal(packageJson.version, "1.1.0");
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
  assert.deepEqual(gemini.mcpServers, mcp.mcpServers);
  assert.deepEqual(mcp, {
    mcpServers: {
      "osrs-wiki": {
        command: "npx",
        args: ["--yes", "osrs-wiki-mcp@1.1.0"],
      },
    },
  });
});

test("Codex and Claude marketplaces expose the repository-root plugin once", async () => {
  const codex = await loadJson<{
    name: string;
    plugins: Array<{ name: string; source: { source: string; path: string }; policy: unknown }>;
  }>(".agents/plugins/marketplace.json");
  const claude = await loadJson<{
    name: string;
    plugins: Array<{ name: string; source: string }>;
  }>(".claude-plugin/marketplace.json");

  assert.equal(codex.name, "sander-virula-osrs");
  assert.deepEqual(codex.plugins.map(({ name }) => name), ["osrs-wiki-mcp"]);
  assert.deepEqual(codex.plugins[0]?.source, { source: "local", path: "./" });
  assert.ok(codex.plugins[0]?.policy);
  assert.equal(claude.name, "sander-virula-osrs");
  assert.deepEqual(claude.plugins, [{
    name: "osrs-wiki-mcp",
    source: "./",
    description: "Install the stateless OSRS Wiki MCP with source-backed research guidance.",
    category: "research",
    tags: ["osrs", "wiki", "mcp"],
  }]);
});

test("plugin configuration contains no mutable pins, secrets, writes, or personal paths", async () => {
  const paths = [
    ".mcp.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    "gemini-extension.json",
  ];
  const text = (await Promise.all(paths.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");

  assert.doesNotMatch(text, /osrs-wiki-mcp@(latest|next)|osrs-wiki-mcp@[~^]/u);
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]Users[\\/]/u);
  assert.doesNotMatch(text, /token|secret|password|api[_-]?key/iu);
  assert.doesNotMatch(text, /"(env|hooks|apps|monitors|commands)"\s*:/u);
  assert.doesNotMatch(text, /progression-aware|player-ready|write access/iu);
});
```

- [ ] **Step 2: Run the test and verify it fails for missing manifests**

Run:

```powershell
node --test test/plugin-bundle.test.ts
```

Expected: failure opening `.codex-plugin/plugin.json` or another missing plugin
file. Do not create production manifests before observing this failure.

- [ ] **Step 3: Commit only after Task 4 turns the contract green**

Do not commit this task separately while red. Carry the test into Task 4.

---

### Task 4: Create the Version-Synchronized Platform Bundle

**Files:**

- Create: `.mcp.json`
- Create: `.codex-plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `gemini-extension.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/plugin-bundle.test.ts`

**Interfaces:**

- MCP server key: `osrs-wiki`
- Plugin identifier: `osrs-wiki-mcp`
- Marketplace identifier: `sander-virula-osrs`
- Release version and npm pin: `1.1.0`

- [ ] **Step 1: Bump package metadata without tagging**

Run:

```powershell
npm.cmd version 1.1.0 --no-git-tag-version
```

Expected: only `package.json` and `package-lock.json` version fields change.

- [ ] **Step 2: Create the shared MCP declaration**

Create `.mcp.json`:

```json
{
  "mcpServers": {
    "osrs-wiki": {
      "command": "npx",
      "args": ["--yes", "osrs-wiki-mcp@1.1.0"]
    }
  }
}
```

- [ ] **Step 3: Create the Codex manifest and marketplace**

Create `.codex-plugin/plugin.json`:

```json
{
  "name": "osrs-wiki-mcp",
  "version": "1.1.0",
  "description": "Source-backed Old School RuneScape Wiki research through ten read-only MCP tools.",
  "author": {
    "name": "SanderVirula",
    "url": "https://github.com/SanderVirula"
  },
  "homepage": "https://github.com/SanderVirula/osrs-wiki-mcp#readme",
  "repository": "https://github.com/SanderVirula/osrs-wiki-mcp",
  "license": "MIT",
  "keywords": ["osrs", "old-school-runescape", "wiki", "mcp", "research"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "OSRS Wiki MCP",
    "shortDescription": "Source-backed OSRS Wiki research",
    "longDescription": "Research items, acquisition sources, quests, monsters, and Wiki pages with bounded structured results and canonical provenance.",
    "developerName": "SanderVirula",
    "category": "Research",
    "capabilities": ["Read"],
    "websiteURL": "https://github.com/SanderVirula/osrs-wiki-mcp",
    "defaultPrompt": [
      "Research an OSRS item and cite the Wiki.",
      "Show how to obtain an item in OSRS.",
      "Summarize an OSRS quest's requirements."
    ]
  }
}
```

Create `.agents/plugins/marketplace.json`:

```json
{
  "name": "sander-virula-osrs",
  "interface": {
    "displayName": "SanderVirula OSRS"
  },
  "plugins": [
    {
      "name": "osrs-wiki-mcp",
      "source": {
        "source": "local",
        "path": "./"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Research"
    }
  ]
}
```

- [ ] **Step 4: Create the Claude manifest and marketplace**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "osrs-wiki-mcp",
  "displayName": "OSRS Wiki MCP",
  "version": "1.1.0",
  "description": "Source-backed Old School RuneScape Wiki research through ten read-only MCP tools.",
  "author": {
    "name": "SanderVirula"
  },
  "homepage": "https://github.com/SanderVirula/osrs-wiki-mcp#readme",
  "repository": "https://github.com/SanderVirula/osrs-wiki-mcp",
  "license": "MIT",
  "keywords": ["osrs", "old-school-runescape", "wiki", "mcp", "research"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "sander-virula-osrs",
  "owner": {
    "name": "SanderVirula"
  },
  "plugins": [
    {
      "name": "osrs-wiki-mcp",
      "source": "./",
      "description": "Install the stateless OSRS Wiki MCP with source-backed research guidance.",
      "category": "research",
      "tags": ["osrs", "wiki", "mcp"]
    }
  ]
}
```

- [ ] **Step 5: Create the Gemini extension manifest**

Create `gemini-extension.json`:

```json
{
  "name": "osrs-wiki-mcp",
  "version": "1.1.0",
  "description": "Source-backed Old School RuneScape Wiki research through ten read-only MCP tools.",
  "mcpServers": {
    "osrs-wiki": {
      "command": "npx",
      "args": ["--yes", "osrs-wiki-mcp@1.1.0"]
    }
  }
}
```

Do not create `GEMINI.md`; the lazy `skills/` directory is the guidance surface.

- [ ] **Step 6: Turn the bundle tests green**

Run:

```powershell
node --test test/plugin-bundle.test.ts
npm.cmd run typecheck
npm.cmd test
```

Expected: bundle tests pass and the complete suite remains green. If the native
Codex or Claude validator rejects repository-root source `./`, stop and revise
the layout rather than weakening the tests.

- [ ] **Step 7: Run the Codex and Claude native validators**

Run:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" .
claude plugin validate --strict .
```

Expected: both validators pass with no warnings. Treat an evolving platform
schema mismatch as a design change, not a reason to suppress validation.

- [ ] **Step 8: Commit the complete bundle**

```powershell
git add -- package.json package-lock.json test/plugin-bundle.test.ts .mcp.json .codex-plugin .claude-plugin .agents gemini-extension.json
git commit -m "feat: add cross-agent OSRS Wiki plugin"
```

---

### Task 5: Document Installation, Migration, and Release Discipline

**Files:**

- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**

- Public install names: `osrs-wiki-mcp@sander-virula-osrs`
- Direct-MCP install remains supported for clients without plugin support.

- [ ] **Step 1: Add plugin installation before the raw MCP configuration**

Add this subsection under `Requirements and installation` in `README.md`:

````markdown
### Install as a plugin or extension

The plugin adds one-install MCP setup and a small source-backed research skill. It does not add player progress, GE prices, DPS, hosting, or any tools beyond the ten listed below.

Codex:

```powershell
codex plugin marketplace add SanderVirula/osrs-wiki-mcp --ref v1.1.0
codex plugin add osrs-wiki-mcp@sander-virula-osrs
```

Claude Code:

```powershell
claude plugin marketplace add SanderVirula/osrs-wiki-mcp --scope user
claude plugin install osrs-wiki-mcp@sander-virula-osrs --scope user
```

Gemini CLI:

```powershell
gemini extensions install https://github.com/SanderVirula/osrs-wiki-mcp --ref v1.1.0
```

All three start the exact npm runtime `osrs-wiki-mcp@1.1.0`. Node.js 24 or newer and `npx` must be available on `PATH`.

If `osrs-wiki` is already configured directly, validate the plugin first, remove or disable the direct registration, and start a fresh session. Keep exactly one `osrs-wiki` server to avoid duplicate tools.

The raw MCP configuration below remains the smallest option for other clients.
````

When applying the text, use a four-backtick outer fence in the Markdown source
or separate the platform snippets so nested fences render correctly.

- [ ] **Step 2: Update the raw MCP pin**

Change the existing raw config from `osrs-wiki-mcp@1.0.0` to
`osrs-wiki-mcp@1.1.0` and leave the rest of the example unchanged.

- [ ] **Step 3: Add the synchronized-release rule to CONTRIBUTING**

Append this section to `CONTRIBUTING.md`:

````markdown
## Plugin bundle changes

The repository, npm runtime, Codex plugin, Claude plugin, and Gemini extension use one release version. When the version changes, update `package.json`, `package-lock.json`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `gemini-extension.json`, `.mcp.json`, and every documented exact pin together.

Before submitting a plugin change, run the normal verification commands plus:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" .
claude plugin validate --strict .
node --test test/plugin-bundle.test.ts
```

Do not add credentials, environment-variable requests, personal paths, copied Wiki data, hooks, apps, monitors, mutable npm ranges, or a second server implementation.
````

- [ ] **Step 4: Verify docs and package boundaries**

Run:

```powershell
git diff --check
npm.cmd run pack:check
npm.cmd pack --dry-run --json
```

Expected: Markdown has no whitespace errors; the npm tarball remains limited to
the existing runtime files and does not contain `.mcp.json`, plugin manifests,
marketplace files, eval cases, or skills.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- README.md CONTRIBUTING.md
git commit -m "docs: add cross-agent plugin installation"
```

---

### Task 6: Verify, Review, and Merge the Feature

**Files:** Modify only files required by verified findings.

**Interfaces:**

- Input: complete feature branch
- Output: reviewed commit range ready for PR and release

- [ ] **Step 1: Run fresh complete local verification**

Run in this order:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:stdio
npm.cmd run pack:check
npm.cmd audit --omit=dev --audit-level=high
npm.cmd audit signatures
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" .
claude plugin validate --strict .
git diff --check
git status --short
```

Expected: all commands pass; test output includes the new initialize and plugin
bundle tests; only intentional feature files are changed.

- [ ] **Step 2: Request a fresh read-only reviewer agent**

Record:

```powershell
git rev-parse origin/main
git rev-parse HEAD
```

Dispatch a separate reviewer with no conversation history. Give it the design,
this plan, the exact base/head SHAs, and read-only access to the public
repository. Ask for Critical/Important/Minor findings on MCP contracts,
cross-platform manifests, marketplace root resolution, exact-pin release
ordering, skill-evaluation validity, security/privacy/licensing, and duplicate
registration migration.

- [ ] **Step 3: Resolve review findings technically**

For every valid Critical or Important finding:

1. add or update a failing test or native validator reproduction;
2. observe the failure;
3. apply the smallest correction;
4. rerun the targeted check and the complete verification suite.

Reject incorrect findings only with repository or official-platform evidence.
Minor findings may be deferred when they do not affect correctness, safety,
installation, or public documentation.

- [ ] **Step 4: Push and open the PR**

```powershell
git push -u origin HEAD
gh pr create --draft --title "Add cross-agent OSRS Wiki plugin" --body "Adds portable MCP instructions, one shared research skill, and native Codex, Claude, and Gemini distribution manifests pinned to osrs-wiki-mcp@1.1.0."
```

Wait for Ubuntu, Windows, advisory Node-current, and full-history secret-scan
checks. Fix failures with systematic debugging and fresh verification.

- [ ] **Step 5: Mark ready and merge only when clean**

```powershell
gh pr ready
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Expected: protected `main` contains the reviewed feature and every required
check is green.

---

### Task 7: Publish 1.1.0 and Smoke-Test the Installed Wrappers

**Files:** No source changes unless a verified release defect requires a new
patch release.

**Interfaces:**

- npm runtime: `osrs-wiki-mcp@1.1.0`
- Git tag: `v1.1.0`
- GitHub-backed marketplaces/extensions at the merged commit

- [ ] **Step 1: Confirm main and trigger trusted staged publishing**

```powershell
git switch main
git pull --ff-only
git status --short
gh workflow run publish.yml -f release_mode=staged --ref main
$runId = gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --exit-status
```

Watch the returned run through the protected `npm` environment approval and
completion. Do not use a token or the bootstrap path.

- [ ] **Step 2: Verify the published artifact independently**

```powershell
npm.cmd view osrs-wiki-mcp@1.1.0 version dist.integrity dist.attestations --json
```

Install into a disposable directory with lifecycle scripts disabled, verify
signatures, and remove the directory:

```powershell
$installRoot = Join-Path $env:TEMP 'osrs-wiki-mcp-1.1.0-verify'
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Push-Location $installRoot
try {
  npm.cmd init --yes
  npm.cmd install --ignore-scripts --no-fund osrs-wiki-mcp@1.1.0
  npm.cmd audit signatures
} finally {
  Pop-Location
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}
```

Use the installed client-wrapper smokes in Step 4 for initialize, tools/list,
and one live tool call; do not launch a bare MCP process that waits on stdin.

- [ ] **Step 3: Tag and publish release notes**

```powershell
git tag -a v1.1.0 -m "OSRS Wiki MCP 1.1.0"
git push origin v1.1.0
gh release create v1.1.0 --verify-tag --title "OSRS Wiki MCP 1.1.0" --notes "Adds portable MCP usage instructions and installable Codex, Claude Code, and Gemini CLI wrappers. The runtime remains stateless, read-only, and limited to the same ten Wiki tools."
```

- [ ] **Step 4: Test each wrapper in an isolated client configuration**

For Codex and Claude, add the `v1.1.0` marketplace, install
`osrs-wiki-mcp@sander-virula-osrs`, and start a fresh task/session. Confirm:

- exactly one `osrs-wiki` MCP server;
- exactly ten tools;
- initialize instructions are present;
- one `search_wiki` call succeeds and returns provenance.

For Gemini, use a disposable user home and the explicitly approved pinned CLI
version. Install the repository at `v1.1.0`, confirm the extension and skill are
discovered, then make the same single live query. Do not execute a downloaded
Gemini CLI until the user has approved that third-party-code boundary.

Limit the smoke to one live Wiki query per platform.

- [ ] **Step 5: Complete generic direct-MCP migration checks**

Document and verify that a user migrating from raw configuration can remove the
direct server only after the installed plugin succeeds. A fresh session must
show one server and ten tools. Keep the raw setup documented for clients that
do not support plugins.

- [ ] **Step 6: Perform final public checks**

Confirm:

```powershell
git status --short
git log -1 --oneline
gh release view v1.1.0
npm.cmd view osrs-wiki-mcp@1.1.0 version --json
```

Expected: clean synchronized `main`, published GitHub release, exact npm
version, and no unpublished follow-up work required.
