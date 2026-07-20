# OSRS Wiki MCP Cross-Agent Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Do not use
> implementation subagents unless the user explicitly authorizes lower-tier
> workers and primary-agent review.

**Goal:** Release a thin, versioned Codex/Claude/Gemini plugin wrapper that
starts the single published OSRS Wiki MCP runtime and teaches agents to select
its ten tools accurately.

**Architecture:** The public repository root is the Claude/Gemini extension
root and holds the canonical `.mcp.json` and lazy
`skills/osrs-wiki-research` skill. Because current Codex marketplace resolution
rejects a root source of `./`, Codex uses `plugins/osrs-wiki-mcp/` containing
contract-enforced byte-identical mirrors of those two small resources. Gemini
repeats only the MCP declaration required by its manifest. MCP server
instructions provide the portable baseline for clients that do not load the
skill. Every wrapper starts the same published npm runtime.

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
- Treat bare `npx` as provisional until native Codex and Claude startup tests
  pass on Windows, as does Gemini when its downloaded CLI is explicitly
  approved, and a generic process-launch probe passes on Ubuntu. When Gemini is
  not approved, use its documented deterministic-validation deferral without a
  native-verification claim. Direct Node spawning reproduces `ENOENT` on this
  Windows host; if a tested supported client does the same, revise and re-review
  the launcher architecture before publication.
- Require Node.js 24 or newer on every platform.
- Preserve exactly ten read-only Wiki tools and all existing schemas, warnings,
  provenance, reliability budgets, and licensing behavior.
- Add no player state, progression, hiscores, GE price, DPS, hosting, UI,
  telemetry, credentials, hooks, monitors, apps, commands, or persistent data.
- Keep Wiki-derived data out of the repository; eval prompts and fixtures are
  synthetic or procedural only.
- Do not add plugin files to the npm tarball. GitHub distributes the wrapper;
  npm distributes the runtime.
- Describe the exact pin as a top-level integrity control, not full offline
  reproducibility: `npx` can contact the npm registry/cache and transitive
  ranges can drift. Record the resolved dependency tree during release.
- Bind the npm workflow, Git tag, and GitHub release to one captured commit SHA.
  Staged publishing is not complete until a maintainer inspects and explicitly
  approves the stage with 2FA.
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

### Task 2: Controlled-Evaluate and Author the Canonical Research Skill

**Files:**

- Create: `evals/osrs-wiki-research/stub-server.mjs`
- Create only for the independently reviewed composability condition: `evals/osrs-wiki-research/external-dps-stub-server.mjs`
- Create: `evals/osrs-wiki-research/diagnostic-cases.json`
- Create: `evals/osrs-wiki-research/held-out-cases.json`
- Create only after a failed first held-out gate: `evals/osrs-wiki-research/confirmatory-cases.json`
- Create only after a failed first confirmatory gate: `evals/osrs-wiki-research/confirmatory-v2-cases.json`
- Create only after the independent product-boundary reset: `evals/osrs-wiki-research/product-contract-v2-cases.json`
- Create: `evals/osrs-wiki-research/rubric.json`
- Create only after the independent product-boundary reset: `evals/osrs-wiki-research/rubric-v2.json`
- Create only for the final product-contract run: `evals/osrs-wiki-research/build-product-contract-v2-mcp-config.mjs`
- Create only for the final product-contract run: `evals/osrs-wiki-research/run-product-contract-v2.mjs`
- Create only for the final product-contract run: `evals/osrs-wiki-research/prepare-scoring-v2.mjs`
- Create only for the final product-contract run: `evals/osrs-wiki-research/audit-raw-traces-v2.mjs`
- Create after evaluation: `evals/osrs-wiki-research/results-summary.json`
- Create only after a corrective confirmation: `evals/osrs-wiki-research/results-summary-confirmatory.json`
- Create only after a second corrective confirmation: `evals/osrs-wiki-research/results-summary-confirmatory-v2.json`
- Create only after the final product-contract evaluation: `evals/osrs-wiki-research/results-summary-product-contract-v2.json`
- Create: `skills/osrs-wiki-research/SKILL.md`
- Create: `skills/osrs-wiki-research/agents/openai.yaml`
- Test: `test/integration/eval-stub-contract.test.ts`

**Interfaces:**

- Produces: canonical skill `osrs-wiki-research`
- Exercises: the real `createServer` and ten production tool registrations over
  stdio with a deterministic synthetic `WikiClientLike`
- Does not use: live Wiki access, the full README, copied Wiki facts, user
  settings, or private user context
- Frozen evaluator: Claude Code `2.1.207`, model
  `claude-haiku-4-5-20251001`, low effort. If this exact version is unavailable,
  record and preregister one replacement before observing any outputs; never
  mix versions or use the mutable `haiku` alias within the comparison.

- [ ] **Step 1: Build a deterministic synthetic MCP fixture**

Create `stub-server.mjs` by importing the built `dist/server.js`, constructing
`createServer({ wikiClient: syntheticWikiClient, version: "1.1.0" })`, and
connecting it to `StdioServerTransport`. The synthetic client must:

- expose all response shapes needed by the ten production tools;
- return only invented entities such as `Test sword`, `Example quest`, and
  `Test beast`;
- provide canonical-looking but explicitly synthetic provenance URLs;
- include one bounded acquisition warning with an actionable
  `find_drop_sources` follow-up;
- include one long-page truncation path requiring sections;
- return two distinct monster variants;
- perform no HTTP, filesystem writes, clocks, randomness, or environment reads.

Add `test/integration/eval-stub-contract.test.ts` that consumes an already-built
`dist/`, starts this actual stdio server, and asserts initialize instructions,
exactly ten tools, the warning path, section recovery, two variants, and zero
attempted network calls. The test must never invoke a build itself. Keeping it
under `test/integration/` excludes this process-heavy contract from the default
concurrent `test/*.test.ts` suite. Keep the fixture outside `src/` so it cannot
enter the npm tarball.

- [ ] **Step 2: Prove the stub before evaluating any skill**

Run:

```powershell
npm.cmd run build
node --test --test-concurrency=1 test/integration/eval-stub-contract.test.ts
npm.cmd run pack:check
```

Expected: the synthetic server passes every contract and the tarball inspection
shows no `evals/`, `skills/`, or plugin files.

- [ ] **Step 3: Preregister disjoint cases and the scoring rubric**

Create eight diagnostic cases for authoring and eight held-out cases for the
final claim: one diagnostic and one unseen held-out variant for each frozen
design scenario—acquisition overview/recovery, quest requirements, ambiguous
title, long-page sections, monster variants, live-price boundary, player-state
boundary, and DPS boundary. Prompts use only synthetic entity names and never
contain the expected tool names.

Each case declares allowed/required tool traces and required/forbidden answer
behaviors. Create `rubric.json` before running either arm with five two-point
dimensions: narrowest tool selection, warning/recovery behavior, scope safety,
provenance use, and grounding in returned structured content. Predeclare:

- no scope-safety regression is allowed;
- the treatment held-out mean must exceed baseline by at least 1.0/10;
- treatment must satisfy every held-out forbidden-behavior check;
- at least six of eight held-out cases must improve or tie, and at least two
  must improve;
- the primary agent manually verifies every score against the raw tool trace.

Validate unique IDs, schema shape, and zero overlap between diagnostic and
held-out prompt hashes with a small Node assertion.

- [ ] **Step 4: Create two isolated, otherwise identical eval plugins**

Under a disposable directory outside the repository, create `baseline/` and
`treatment/` plugin roots with byte-identical `.claude-plugin/plugin.json`
files and the same plugin name. Create one separate common MCP config pointing
to the same absolute `stub-server.mjs`; pass it to both arms with
`--mcp-config`. Only `treatment/` may receive the target skill later. Run from a
disposable project directory and pass `--setting-sources project`,
`--strict-mcp-config`, and `--no-session-persistence` so user/project MCPs or
skills cannot leak into either arm.

Do **not** pass `--disable-slash-commands`: current Claude Code documents that
flag as disabling all skills, including the treatment. Because
`--strict-mcp-config` ignores plugin-discovered MCPs, the shared synthetic MCP
must be supplied explicitly with `--mcp-config`.

Validate both disposable plugins strictly and record SHA-256 hashes proving
their manifests are identical. List the synthetic server's ten
origin-qualified MCP tool IDs and freeze that exact list for `--allowedTools`.
Restrict built-ins with `--tools Skill`: the treatment needs Claude's built-in
`Skill` tool to invoke the plugin skill, while no unrelated built-in tools are
available in either arm.

- [ ] **Step 5: Run the diagnostic no-skill baseline through real tools**

Confirm `claude --version` is the frozen version. For each diagnostic case, run
one fresh baseline session with the exact model slug and capture verbose
stream-JSON outside the repository:

```powershell
claude -p --model claude-haiku-4-5-20251001 --effort low --plugin-dir $baselinePlugin --mcp-config $evalMcp --strict-mcp-config --setting-sources project --no-session-persistence --tools Skill --allowedTools $frozenEvalToolIds --output-format stream-json --verbose $case.prompt
```

The model receives only the request and normal MCP discovery; do not inject the
README, tool mappings, expected outputs, or rubric. Confirm every trace calls
only the exact shared synthetic MCP configured by `$evalMcp`.

Before scoring, run one synthetic lookup prompt in both arms and one clear
skill-trigger prompt in treatment. Assert from stream-JSON that both arms can
complete an allowed MCP call without a permission denial, and that treatment
invokes the target namespaced `osrs-wiki-research` skill through the `Skill`
tool. Abort the evaluation if either preflight fails. If the baseline has no
meaningful diagnostic miss, stop and remove the skill from scope.

- [ ] **Step 6: Author the minimum skill from diagnostic failures only**

Initialize the skill with the official skill creator, then replace the template
with the shortest guidance that corrects observed diagnostic failures. It may
map research intents to the ten existing tools, require warning/pagination and
section recovery, preserve variants/provenance, and state the player/GE/DPS
boundaries. It must remain under 500 words and contain no Wiki-derived facts.

Set `agents/openai.yaml` to:

```yaml
interface:
  display_name: "OSRS Wiki Research"
  short_description: "Source-backed OSRS Wiki research"
  default_prompt: "Use $osrs-wiki-research to research an OSRS question with Wiki sources."

policy:
  allow_implicit_invocation: true
```

Validate with `quick_validate.py`, copy the skill only into the treatment
plugin, and rerun the diagnostic cases. Refinement may use diagnostic failures
only; do not inspect held-out outputs yet.

- [ ] **Step 7: Freeze the skill and run the held-out comparison**

Record the skill hash, then run each held-out case twice per arm in fresh
sessions, interleaving and randomizing arm order. Use the exact command shape
from Step 5 and change only `--plugin-dir`. Save raw traces outside the
repository with randomized filenames, but do not treat the raw traces as fully
blind: a treatment trace can disclose its arm through the `Skill` invocation.

Verify from each trace that the synthetic MCP—not a global or live server—was
used. Then create a separate scoring view that retains the prompt, MCP calls and
results, and final answer while redacting arm labels, plugin paths/metadata, and
`Skill` invocation events. Randomize scoring-view filenames independently and
show scorers only that view. Score all 32 held-out runs against the
preregistered rubric, then reveal the arm mapping and apply the pass criteria.
The primary agent verifies scores against the unredacted raw traces afterward.
This is partial, not perfect, blinding. Do not change the skill after the
held-out set is opened; a failure requires a new versioned eval set.

- [ ] **Step 8: Record sanitized evidence and commit**

Create `results-summary.json` containing the frozen CLI/model versions, command
flags, case/rubric hashes, skill hash, per-case aggregate scores, pass/fail
result, `"blinding": "partial"`, the redaction policy, and SHA-256 hashes of
both sanitized raw traces and scoring views. Do not commit raw model outputs,
local paths, session IDs, user settings, or credentials. The primary agent
reads every trace and signs off in the summary.

#### Corrective confirmatory addendum (activated 2026-07-16)

The first held-out comparison is an immutable failed result. It used skill hash
`9FF09E0BAE427ED3FF607AB2F3FF8D39C92E5AB48066E63FD7FA7411601BE775`
and held-out-suite hash
`A6E1A578091E4D2E8AD19438D9DBE5F5E54076D899360D988527719E8083618F`.
Its locked blind-score hash is
`1C059878A728B2F128F30509D9369994CF969198F5868F95DD4387AD73B28482`;
baseline scored 7.25/10 and treatment 8.75/10, but one treatment
ambiguous-title run merged two candidates, so the all-forbidden-behaviors gate
failed. `results-summary.json` must record that failure and link to, rather than
be replaced by, any corrective result.

Do not rerun or rescore the original held-out prompts. The single corrective
skill change is the fixture-neutral rule to choose, retrieve, and summarize one
best-matching search result unless comparison is requested. Freeze it at
`B4E24846A9DDD61E1A85C78704335928A676CD63AB5595EC7F0CEC95CDF40F61`.
Run only `confirmatory-cases.json`, frozen at
`500D6F3C59AB50DCB91C6EAC5837BEAB00DB2D5B01A7E297D129CD0E8B4E5539`,
with the same two-runs-per-case, fresh-session, randomized/interleaved,
partial-blinding, scoring, raw-audit, and pass-criteria protocol. The frozen
rubric hash is
`A4C8378F68B4509783F3DF1D3D956E997B09195F1D66849F09DBEF2E71B6B40E`;
the held-out runner hash is
`0584CACB9CCE65CE6CDAFE4DC7D402BFCEE7690CEDF0BA07F0DF484F6544489F`;
both otherwise-identical plugin manifests hash to
`74B4C4E6366DF5842C43D832972F1685788CFE377AF1783A49C8170815089BBE`.

Write the corrected run to `results-summary-confirmatory.json`. That summary
must link back to the failed `results-summary.json`, restate the corrective
change and all preregistered hashes, and never recast the first run as passing.
Only the confirmatory run may qualify the corrected skill, and only if it passes
every original criterion unchanged.

#### Second corrective confirmatory addendum (activated 2026-07-16)

The first confirmatory comparison is also an immutable failed result and is
recorded separately in `results-summary-confirmatory.json`. It used skill hash
`B4E24846A9DDD61E1A85C78704335928A676CD63AB5595EC7F0CEC95CDF40F61`
and suite hash
`500D6F3C59AB50DCB91C6EAC5837BEAB00DB2D5B01A7E297D129CD0E8B4E5539`.
Its locked blind-score hash is
`23BABD01918D109C1B68BD4EFA6EAFE0662D01804DD5E25AC15A440F8C00F419`;
baseline scored 7.625/10 and treatment 9/10, for a 1.375 improvement.
The treatment arm passed every forbidden-behavior check, but one treatment DPS
answer offered a future calculation if the user supplied inputs. That created
a -0.5 case-level scope-safety delta, so the no-scope-safety-regression gate
failed. The primary agent audited all 32 raw traces after reveal and verified
every recorded hash. Do not rerun or rescore either earlier suite.

The single second corrective change is fixture-neutral: for DPS requests, stop
after stating the boundary and never request inputs, list required inputs,
offer a walkthrough, suggest supplying data, or claim later calculation
capability. Freeze the revised skill at
`C8F3A0F2353191A2CCDFB523940B8DFE6A3B1EA00DECC290218F790BF256AEBE`.
Run only `confirmatory-v2-cases.json`, frozen at
`AAA94BCDFA37AA966B27F1065E7DFA739E4E76E6415159C4871C14EC0F260BDE`.
The v2 prompts are disjoint from all 24 earlier prompts and cover the same eight
scenarios once each. Use the unchanged two-runs-per-case, fresh-session,
randomized/interleaved, partial-blinding, scoring, raw-audit, and pass-criteria
protocol. The rubric, runner, and otherwise-identical plugin manifest hashes
remain respectively
`A4C8378F68B4509783F3DF1D3D956E997B09195F1D66849F09DBEF2E71B6B40E`,
`0584CACB9CCE65CE6CDAFE4DC7D402BFCEE7690CEDF0BA07F0DF484F6544489F`,
and
`74B4C4E6366DF5842C43D832972F1685788CFE377AF1783A49C8170815089BBE`.

Write the v2 result to `results-summary-confirmatory-v2.json`. It must link to
both immutable failed summaries, restate every frozen dependency hash, and
never overwrite or recast an earlier result. Under that frozen v2 hypothesis,
only this v2 run could have qualified the then-current skill by passing every
original criterion unchanged. It did not qualify.

#### Product-contract v2 evaluation reset (activated 2026-07-16)

The second corrective comparison is a third immutable failed result, recorded
in `results-summary-confirmatory-v2.json`. It used skill hash
`C8F3A0F2353191A2CCDFB523940B8DFE6A3B1EA00DECC290218F790BF256AEBE`,
suite hash
`AAA94BCDFA37AA966B27F1065E7DFA739E4E76E6415159C4871C14EC0F260BDE`,
and locked blind-score hash
`D96050B460AB705CCA62FBA4202222615D2E865E8CF3D67159A5477B46B9F3BA`.
Baseline scored 7.5/10 and treatment 9.0625/10, for a 1.5625
improvement; seven cases improved and one tied. Both treatment answers
requested player inputs or offered a later DPS calculation, violating the
explicit v2 case check. All 32 raw traces and their hashes were audited after
reveal. Do not rerun, rescore, overwrite, or recast this result.

Independent architecture review found the absolute no-follow-up rule to be an
over-broad restriction on the host rather than a defensible MCP boundary. The
Wiki MCP cannot inspect player state or calculate DPS, and no inferred loadout
or DPS value may be attributed to Wiki/MCP output. A host may nevertheless use
or suggest a clearly identified external capability, request inputs for that
external workflow, and keep its result separate from Wiki facts. Do not promote
the rejected absolute prohibition into `SERVER_INSTRUCTIONS`.

This resets the hypothesis rather than correcting the original comparison.
Keep all three earlier summaries as failed evidence. Freeze the revised skill
at
`683101C90B2B53BBF17AD777CBFEEF8DDD910B347756B3E0A8D9974729050328`
and the composable rubric in `rubric-v2.json` at
`F4998BC7263D8766C63094758458F82A2D51FB06016ADA0F61416ADB4EC870B8`.
The fresh eight-case `product-contract-v2-cases.json` suite hashes to
`077BF3A096466B88B7957D8A917C4E0A8B409102156A816932ADD5C77B7D0D75`;
its prompts are disjoint from all 32 prior prompts. The unchanged Wiki fixture
hash remains
`922C8588B62BBB729277546A246F5527CA1226B2225D3221D0B457C46C4F23FD`.

Add the deterministic evaluation-only `external-dps` MCP to both arms. Its
single `mcp__external-dps__calculate_synthetic_dps` tool is never packaged as a
Wiki capability, is permitted only by the DPS capability-separation case, and
comes from `external-dps-stub-server.mjs` at
`F1FB3312145F8BB1C6A0BE3C86C236A15F9EED52B9A00465B6E7441A5482C5E8`.
The config builder and its rendered equal-arm two-server config are frozen at
`2EDC00E7FDC30759930A38B96DC1C1A577A26A18DD824E2E9D987780C2ECB559`
and
`CEB7A912E2BE0764F7DD3BC99D6232BCB65780726EE7A962236FC9B07BACE158`.
The generated JavaScript runtime executed by the Wiki fixture is frozen as a
sorted-path aggregate at
`9A7A64B3C7AEAD5031D93243A35121ED9EDD75BC8EED3FFC0925E91CB8B9153A`;
the runner verifies it before launching any evaluation session.
The product-contract runner, scoring-view builder, and raw-audit helper are
frozen respectively at
`CA479293BC518486AEC43AC3F62BCD8A56EB53746803B2D400CAD712F484BAAC`,
`073E078462CA425D95E84A549121C546795677644583CBAB03E5F22BE862D1E9`,
and
`24DABBE5368508D81F92316E687D1CEDB731A0D507C97D0F1E369958A6F4BA44`.
They include the external tool in the allowed, blinded, and audited MCP call
sets. The otherwise-identical plugin manifests remain frozen at
`74B4C4E6366DF5842C43D832972F1685788CFE377AF1783A49C8170815089BBE`.

The integration contract test is frozen at
`72E808184138F064C63DD2CD8AF0E8FC7C79EB689139982BE2322EA0FE320AF4`.
The three prior failed summaries are anchored by commit `e62a3d6` and hash to
`099706B2DCFE540AE2784C2B0B16FAA46F076B3458E3417BDE957F00E948963B`,
`6D60A12F4038C1CA1A3974C77E78A7F674181A180E1A2027F7BB0C68F5A7E6FB`,
and
`BF8F715189DADBB271D94B1BE45F9595FAE4E842CCE810C0C74FC0007DEE0678`.
For this new contract, treatment must score at least 8.5/10, improve on
baseline by at least 1.0, improve or tie at least seven of eight cases, improve
at least two cases, pass every forbidden-behavior check, and have no
scope-safety regression.

An independent reviewer approved the frozen skill, rubric, suite, fixture
separation, and this addendum before any product-contract-v2 case output was
generated. On 2026-07-20, the user deliberately superseded the planned
32-session Claude Haiku qualification run with a small Luna-low end-to-end
smoke test of the completed plugin bundle. No product-contract-v2 model output
was generated, `results-summary-product-contract-v2.json` must not be created,
and no statistical qualification claim may be made. Keep the frozen harness
and all three earlier failed summaries as immutable evidence; use deterministic
contracts for bundle correctness and Luna low only for representative routing,
recovery, provenance, and capability-boundary smoke coverage after Task 5.

```powershell
git add -- evals/osrs-wiki-research skills/osrs-wiki-research test/integration/eval-stub-contract.test.ts
git commit -m "feat: add evaluated OSRS Wiki research skill"
```

---

### Task 3: Prepare the Version and Add Failing Bundle Contracts

**Files:**

- Create: `test/plugin-bundle.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `package.json`, `package-lock.json`, all three platform manifests,
  two marketplace catalogs, and `.mcp.json`
- Produces: offline drift and secret-surface protection in the existing test
  suite

- [ ] **Step 1: Bump package metadata while the worktree is clean**

After Task 2 is committed, require `git status --short` to be empty, then run:

```powershell
npm.cmd version 1.1.0 --no-git-tag-version
```

Expected: only `package.json` and `package-lock.json` version fields change.
Do not use `--force`; `npm version` deliberately rejects a dirty worktree even
when `--no-git-tag-version` is present.

- [ ] **Step 2: Create the contract test before any manifests**

Create `test/plugin-bundle.test.ts`:

```ts
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
  const packageLock = await loadJson<{ version: string; packages: Record<string, { version?: string }> }>("package-lock.json");
  const codex = await loadJson<PluginManifest>("plugins/osrs-wiki-mcp/.codex-plugin/plugin.json");
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
  assert.equal(
    await loadText("plugins/osrs-wiki-mcp/.mcp.json"),
    await loadText(".mcp.json"),
  );
  assert.equal(
    await loadText("plugins/osrs-wiki-mcp/skills/osrs-wiki-research/SKILL.md"),
    await loadText("skills/osrs-wiki-research/SKILL.md"),
  );
  assert.equal(
    await loadText("plugins/osrs-wiki-mcp/skills/osrs-wiki-research/agents/openai.yaml"),
    await loadText("skills/osrs-wiki-research/agents/openai.yaml"),
  );
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

test("marketplaces expose the supported plugin roots once", async () => {
  const codex = await loadJson<{
    name: string;
    plugins: Array<{ name: string; source: { source: string; path: string }; policy: unknown }>;
  }>(".agents/plugins/marketplace.json");
  const claude = await loadJson<{
    name: string;
    description: string;
    plugins: Array<{ name: string; source: string }>;
  }>(".claude-plugin/marketplace.json");

  assert.equal(codex.name, "sander-virula-osrs");
  assert.deepEqual(codex.plugins.map(({ name }) => name), ["osrs-wiki-mcp"]);
  assert.deepEqual(codex.plugins[0]?.source, {
    source: "local",
    path: "./plugins/osrs-wiki-mcp",
  });
  assert.ok(codex.plugins[0]?.policy);
  assert.equal(claude.name, "sander-virula-osrs");
  assert.equal(claude.description, "OSRS Wiki MCP plugins by SanderVirula.");
  assert.deepEqual(claude.plugins, [{
    name: "osrs-wiki-mcp",
    source: "./",
    description: "Install the stateless OSRS Wiki MCP with source-backed research guidance.",
    category: "research",
    tags: ["osrs", "wiki", "mcp"],
  }]);
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
  const text = (await Promise.all(paths.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");

  const pins = [...text.matchAll(/osrs-wiki-mcp@[A-Za-z0-9*_.~^+-]+/gu)]
    .map(([pin]) => pin);
  assert.ok(pins.length > 0);
  assert.deepEqual([...new Set(pins)], ["osrs-wiki-mcp@1.1.0"]);
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]Users[\\/]/u);
  assert.doesNotMatch(text, /token|secret|password|api[_-]?key/iu);
  assert.doesNotMatch(text, /"(env|hooks|apps|monitors|commands)"\s*:/u);
  assert.doesNotMatch(text, /progression-aware|player-ready|write access/iu);
});

test("trusted staged publishing pins tooling and publishes the verified artifact", async () => {
  const workflow = await loadText(".github/workflows/publish.yml");
  const ci = await loadText(".github/workflows/ci.yml");
  assert.match(workflow, /npm install --global npm@11\.16\.0/u);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.match(workflow, /id:\s*release-pack/u);
  assert.match(workflow, /node scripts\/inspect-pack\.mjs --artifact-dir "\$RUNNER_TEMP\/npm-release" --release-sha "\$\{\{ github\.sha \}\}"/u);
  assert.match(workflow, /echo "tarball=\$RUNNER_TEMP\/npm-release\/\$TARBALL" >> "\$GITHUB_OUTPUT"/u);
  assert.match(workflow, /npm stage publish "\$\{\{ steps\.release-pack\.outputs\.tarball \}\}"/u);
  for (const testWorkflow of [ci, workflow]) {
    assert.match(
      testWorkflow,
      /node --test --test-concurrency=1 test\/integration\/eval-stub-contract\.test\.ts test\/integration\/release-artifact\.test\.ts/u,
    );
  }
});
```

- [ ] **Step 3: Run the test and verify it fails for missing manifests**

Run:

```powershell
node --test test/plugin-bundle.test.ts
```

Expected: failure opening
`plugins/osrs-wiki-mcp/.codex-plugin/plugin.json` or another missing plugin
file. Do not create production manifests before observing this failure.

- [ ] **Step 4: Commit only after Task 4 turns the contract green**

Do not commit this task separately while red. Carry the test into Task 4.

---

### Task 4: Create the Version-Synchronized Platform Bundle

**Files:**

- Create: `.mcp.json`
- Create: `plugins/osrs-wiki-mcp/.codex-plugin/plugin.json`
- Create: `plugins/osrs-wiki-mcp/.mcp.json`
- Create: `plugins/osrs-wiki-mcp/skills/osrs-wiki-research/SKILL.md`
- Create: `plugins/osrs-wiki-mcp/skills/osrs-wiki-research/agents/openai.yaml`
- Create: `.claude-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `gemini-extension.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `scripts/inspect-pack.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/plugin-bundle.test.ts`
- Create: `test/integration/release-artifact.test.ts`

**Interfaces:**

- MCP server key: `osrs-wiki`
- Plugin identifier: `osrs-wiki-mcp`
- Marketplace identifier: `sander-virula-osrs`
- Release version and npm pin: `1.1.0`

- [ ] **Step 1: Create the canonical MCP declaration and Codex mirror**

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

Copy that file byte-for-byte to `plugins/osrs-wiki-mcp/.mcp.json`. Copy the
canonical `skills/osrs-wiki-research/` directory byte-for-byte to
`plugins/osrs-wiki-mcp/skills/osrs-wiki-research/`. Do not use symlinks; the
bundle contract is the drift guard and works consistently on Windows and in
plugin caches.

- [ ] **Step 2: Create the Codex manifest and marketplace**

Create `plugins/osrs-wiki-mcp/.codex-plugin/plugin.json`:

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
        "path": "./plugins/osrs-wiki-mcp"
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

- [ ] **Step 3: Create the Claude manifest and marketplace**

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
  "description": "OSRS Wiki MCP plugins by SanderVirula.",
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

- [ ] **Step 4: Create the Gemini extension manifest**

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
The current official Gemini extension schema does not document repository,
homepage, or license fields, so do not invent unsupported manifest keys. The
Git install source and README provide that metadata. Recheck the current
official schema during implementation and change this decision only with
schema evidence.

- [ ] **Step 5: Add a tested exact-release-artifact mode**

First create `test/integration/release-artifact.test.ts`. In an OS temporary
directory, run `scripts/inspect-pack.mjs --artifact-dir <temp> --release-sha
<40-hex fixture>` and assert it produces exactly one `.tgz`, `npm-pack.json`,
`SHA256SUMS`, and `RELEASE_SHA`; the SHA-256 file matches the tarball; the JSON
filename, package/version, npm shasum, and integrity match the tarball; the
release SHA matches the argument; and no `.tgz` is left in the repository. This
process-heavy test performs pack, clean-install, and stdio work, so keep it out
of the default concurrent `test/*.test.ts` suite and run it serially only after
`dist/` has been built. Run the test and observe the missing-option failure
before implementation.

Refactor `scripts/inspect-pack.mjs` so its default local mode remains unchanged,
but release-artifact mode:

- accepts only an existing verified directory outside the repository and a
  40-hex release SHA;
- runs `npm pack --json --pack-destination <artifact-dir>` once;
- applies the existing allowlist, traversal, content-secret scan, clean-install,
  and ten-tool stdio smoke to that exact tarball;
- writes the unmodified npm pack JSON plus `SHA256SUMS` and `RELEASE_SHA`;
- preserves that verified tarball only in the caller-supplied artifact directory.

Turn the targeted test green and rerun `npm run pack:check` to prove default
cleanup behavior did not regress.

- [ ] **Step 6: Pin npm and persist the exact tarball in the publish workflow**

In `.github/workflows/publish.yml`, immediately after `actions/setup-node`, add
an explicit `npm install --global npm@11.16.0` step and a step that asserts
`npm --version` is exactly `11.16.0`. In both `.github/workflows/ci.yml` and the
publish workflow, build `dist/` first and then run the two process-heavy
integration contracts serially with this exact command:

```yaml
- name: Run process-heavy integration contracts serially
  run: node --test --test-concurrency=1 test/integration/eval-stub-contract.test.ts test/integration/release-artifact.test.ts
```

Keep `npm test` as the concurrent lightweight `test/*.test.ts` suite. After
normal verification in the publish workflow, create the exact release artifact
and output with this contract:

```yaml
- name: Prepare exact release tarball
  id: release-pack
  shell: bash
  run: |
    mkdir -p "$RUNNER_TEMP/npm-release"
    node scripts/inspect-pack.mjs --artifact-dir "$RUNNER_TEMP/npm-release" --release-sha "${{ github.sha }}"
    TARBALL="$(node -e 'const fs = require("node:fs"); const [entry] = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (!entry?.filename) process.exit(1); process.stdout.write(entry.filename);' "$RUNNER_TEMP/npm-release/npm-pack.json")"
    echo "tarball=$RUNNER_TEMP/npm-release/$TARBALL" >> "$GITHUB_OUTPUT"

- name: Upload verified release tarball
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
  with:
    name: npm-release-${{ github.sha }}
    path: ${{ runner.temp }}/npm-release/
    if-no-files-found: error
    retention-days: 7
```

This passes the workflow commit explicitly as `--release-sha` and writes the
tarball path through the `release-pack` step's `$GITHUB_OUTPUT`. Upload the whole
directory as `npm-release-${{ github.sha }}` using commit-pinned
`actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
(`v7.0.1`), `if-no-files-found: error`, and seven-day retention.

The final staged action must be:

```yaml
- name: Submit the verified tarball as a staged release
  if: inputs.release_mode == 'staged'
  run: npm stage publish "${{ steps.release-pack.outputs.tarball }}"
```

This publishes the exact scanned and uploaded `.tgz`, not a freshly repacked
directory. Recheck the official staged-publishing minimum and upload-artifact
commit immediately before implementation; changing either pin requires review.

- [ ] **Step 7: Turn the bundle tests green**

Run:

```powershell
node --test test/plugin-bundle.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --test --test-concurrency=1 test/integration/eval-stub-contract.test.ts test/integration/release-artifact.test.ts
```

Expected: bundle tests pass and the complete suite remains green. The Codex
source path must remain non-root and both compatibility mirrors must be
byte-identical to their canonical files.

- [ ] **Step 8: Run native validators and an actual Codex install smoke**

Run:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins/osrs-wiki-mcp
claude plugin validate --strict .
```

The Codex validator does not validate the marketplace catalog. Therefore also
set a disposable `CODEX_HOME`, add the repository path as a local marketplace,
run `codex plugin list --available --json`, install
`osrs-wiki-mcp@sander-virula-osrs`, and confirm the cached plugin root is
`plugins/osrs-wiki-mcp` with one MCP and one skill. Remove the disposable home
afterward.

Expected: both validators pass with no warnings and the real Codex
marketplace/install flow succeeds. Treat an evolving platform schema mismatch
as a design change, not a reason to suppress validation.

- [ ] **Step 9: Commit the complete bundle**

```powershell
git add -- package.json package-lock.json test/plugin-bundle.test.ts test/integration/release-artifact.test.ts scripts/inspect-pack.mjs .mcp.json plugins/osrs-wiki-mcp .claude-plugin .agents gemini-extension.json .github/workflows/ci.yml .github/workflows/publish.yml
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
claude plugin marketplace add SanderVirula/osrs-wiki-mcp@v1.1.0 --scope user
claude plugin install osrs-wiki-mcp@sander-virula-osrs --scope user
```

Gemini CLI:

```powershell
gemini extensions install https://github.com/SanderVirula/osrs-wiki-mcp --ref v1.1.0
```

All three start the exact top-level npm runtime `osrs-wiki-mcp@1.1.0`. Node.js 24 or newer and `npx` must be available on `PATH`. The launcher may use the npm registry and local npm cache, and transitive dependencies are verified at release time but are not claimed to be fully reproducible offline.

If `osrs-wiki` is already configured directly, validate the plugin in an isolated profile first. Then follow the platform-specific removal steps below, start a fresh session, and confirm exactly one plugin-owned `osrs-wiki` server with ten tools. A same-name Gemini user setting can override the extension server, so merely seeing one server is not enough—verify its origin.

The raw MCP configuration below remains the smallest option for other clients.
````

When applying the text, use a four-backtick outer fence in the Markdown source or separate the platform
snippets so nested fences render correctly. Add verified, exact removal commands
and config locations for the existing direct registration in Codex, Claude,
and Gemini; test those removal/migration procedures in disposable profiles
before documenting them. At this pre-release stage, validate the install
commands and manifest structures without pretending that Git tag `v1.1.0` or
npm package `1.1.0` is already public. The real tagged installs are deferred to
Task 7 Step 6.

- [ ] **Step 2: Update the raw MCP pin**

Change the existing raw config from `osrs-wiki-mcp@1.0.0` to
`osrs-wiki-mcp@1.1.0` and leave the rest of the example unchanged.

- [ ] **Step 3: Add the synchronized-release rule to CONTRIBUTING**

Append this section to `CONTRIBUTING.md`:

````markdown
## Plugin bundle changes

The repository, npm runtime, Codex plugin, Claude plugin, and Gemini extension use one release version. When the version changes, update `package.json`, `package-lock.json`, `plugins/osrs-wiki-mcp/.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `gemini-extension.json`, both `.mcp.json` copies, and every documented exact pin together. Keep the canonical and Codex-mirrored skill/MCP files byte-identical.

Before submitting a plugin change, run the normal verification commands plus:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins/osrs-wiki-mcp
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
$selectorFiles = @('README.md', 'CONTRIBUTING.md', '.mcp.json', 'plugins/osrs-wiki-mcp/.mcp.json', 'gemini-extension.json')
$selectorText = ($selectorFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n"
$selectors = @([regex]::Matches($selectorText, 'osrs-wiki-mcp@[A-Za-z0-9*_.~^+-]+').Value | Sort-Object -Unique)
$expectedSelectors = @('osrs-wiki-mcp@1.1.0', 'osrs-wiki-mcp@v1.1.0', 'osrs-wiki-mcp@sander-virula-osrs')
if (@(Compare-Object $selectors $expectedSelectors).Count -ne 0) { throw "Unexpected npm, Git, or marketplace selector; found: $($selectors -join ', ')" }
$readme = Get-Content -LiteralPath README.md -Raw
$requiredInstallLines = @(
  'codex plugin marketplace add SanderVirula/osrs-wiki-mcp --ref v1.1.0',
  'codex plugin add osrs-wiki-mcp@sander-virula-osrs',
  'claude plugin marketplace add SanderVirula/osrs-wiki-mcp@v1.1.0 --scope user',
  'claude plugin install osrs-wiki-mcp@sander-virula-osrs --scope user',
  'gemini extensions install https://github.com/SanderVirula/osrs-wiki-mcp --ref v1.1.0'
)
foreach ($line in $requiredInstallLines) {
  if (-not $readme.Contains($line)) { throw "Missing exact immutable install line: $line" }
}
```

Also scan the rendered install section for unpinned Git sources and verify the
three platform-specific removal/migration procedures in disposable profiles.
Do not claim that the tagged install snippets were executed until the
post-publication native smokes in Task 7.

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

**Files:**

- Modify: `README.md` only to record the exact Claude Code version proven by
  the native smoke.
- Modify any other file only when required by a verified finding.

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
node --test --test-concurrency=1 test/integration/eval-stub-contract.test.ts test/integration/release-artifact.test.ts
npm.cmd run smoke:stdio
npm.cmd run pack:check
npm.cmd audit --omit=dev --audit-level=high
npm.cmd audit signatures
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins/osrs-wiki-mcp
claude plugin validate --strict .
git diff --check origin/main...HEAD
git status --short
```

Expected: all commands pass. `npm test` contains only the lightweight
`test/*.test.ts` suite, including initialize and plugin-bundle contracts; the
explicit serial command passes both process-heavy integration contracts. The
frozen evaluation artifacts remain internally consistent, the three historical
failures remain immutable, and only intentional feature files are changed.
`git diff --check origin/main...HEAD` covers committed feature changes rather
than only the current worktree. Confirm CI and publish workflows run the same
serial integration command only after building `dist/`.

Before review, use disposable native Codex and Claude profiles on Windows to
prove marketplace discovery and bare-`npx` startup against the currently
published `osrs-wiki-mcp@1.0.0` in a disposable copy of the wrapper; this tests
the launcher without pretending unpublished `1.1.0` exists. Run the generic
launcher probe on Ubuntu CI. If any supported host cannot start bare `npx`, stop
and revise and re-review the launcher design before publication. Record the
exact Claude Code CLI version that passes and add it to the README as a
"verified with" baseline—not an inferred minimum—before review. Commit that
documentation-only change and rerun `git diff --check origin/main...HEAD` plus
`git status --short`. Run the equivalent pinned Gemini smoke only after explicit
approval to execute its downloaded CLI. If approval is unavailable, run the
deterministic Gemini manifest/schema and install-layout contracts, record the
native-smoke deferral, and do not claim native Gemini verification; that
fallback satisfies the pre-release Gemini gate.

After the deterministic contracts pass, run a small representative Luna-low
smoke against the actual Codex plugin surface. This is a qualitative weak-model
usability check, not a replacement A/B study or qualification claim. Keep it
bounded to the completed bundle and preserve only sanitized pass/fail evidence.

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
gh pr create --draft --title "Add cross-agent OSRS Wiki plugin" --body "Adds portable MCP instructions, one canonical research skill with a contract-enforced Codex compatibility mirror, and native Codex, Claude, and Gemini distribution manifests pinned to osrs-wiki-mcp@1.1.0."
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

Run Steps 1 through 3 on the same maintainer machine and, normally, in the same
PowerShell session. Persist the non-secret release context under the OS temp
directory so an interrupted shell can reload and revalidate it rather than
reconstructing timestamps, SHAs, run IDs, or artifact paths by hand:

```powershell
$releaseContextPath = Join-Path $env:TEMP 'osrs-wiki-mcp-1.1.0-release-context.json'
```

- [ ] **Step 1: Return to the primary checkout and capture the release SHA**

Do not try to `git switch main` inside the feature worktree when `main` is
already checked out elsewhere. Leave the feature worktree and run these commands
in the primary checkout:

```powershell
git switch main
git pull --ff-only
git status --short
$releaseSha = git rev-parse HEAD
git rev-parse origin/main
```

Expected: the worktree is clean and `$releaseSha` equals `origin/main`. Record
the value in the release log; every subsequent workflow, tag, and release check
must match it.

- [ ] **Step 2: Trigger and bind the trusted staged-publish workflow**

Confirm the workflow uses Node 24 and npm CLI exactly `11.16.0`, then trigger
it:

```powershell
$dispatchStartedAt = (Get-Date).ToUniversalTime()
gh workflow run publish.yml -f release_mode=staged --ref main
$matchingRun = $null
for ($attempt = 0; $attempt -lt 30 -and $null -eq $matchingRun; $attempt++) {
  $runs = gh run list --workflow publish.yml --event workflow_dispatch --commit $releaseSha --limit 10 --json databaseId,headSha,event,createdAt | ConvertFrom-Json
  $matchingRun = $runs |
    Where-Object { ([datetime]$_.createdAt).ToUniversalTime() -ge $dispatchStartedAt } |
    Sort-Object createdAt -Descending |
    Select-Object -First 1
  if ($null -eq $matchingRun) { Start-Sleep -Seconds 2 }
}
if ($null -eq $matchingRun) { throw 'No matching release workflow appeared' }
$runId = $matchingRun.databaseId
gh run watch $runId --exit-status
$run = gh run view $runId --json headSha,event,conclusion | ConvertFrom-Json
if ($run.headSha -ne $releaseSha -or $run.event -ne 'workflow_dispatch' -or $run.conclusion -ne 'success') { throw 'Release workflow is not bound to the captured SHA' }
```

The workflow must stop after `npm stage publish`; a successful workflow means a
private stage exists, not that the package is public. Do not use a bootstrap
token. Download the commit-named artifact before touching the npm stage:

```powershell
$workflowArtifactDir = Join-Path $env:TEMP "osrs-wiki-mcp-$releaseSha-workflow"
gh run download $runId --name "npm-release-$releaseSha" --dir $workflowArtifactDir
if ((Get-Content (Join-Path $workflowArtifactDir 'RELEASE_SHA') -Raw).Trim() -ne $releaseSha) { throw 'Workflow artifact SHA mismatch' }
[ordered]@{
  releaseSha = $releaseSha
  dispatchStartedAt = $dispatchStartedAt.ToString('o')
  runId = $runId
  workflowArtifactDir = $workflowArtifactDir
} | ConvertTo-Json | Set-Content -LiteralPath $releaseContextPath -Encoding utf8
```

- [ ] **Step 3: Inspect and explicitly approve the npm stage**

Before release day, verify the staged-publishing JSON field names below against
the current official npm documentation and the pinned npm CLI `11.16.0`. If the
CLI schema differs, stop and update the reviewed release contract; do not guess
aliases or continue with missing fields. Reload the persisted context even when
the original shell survived, revalidate its artifact binding, require npm CLI
exactly `11.16.0`, and identify the stage for exactly
`osrs-wiki-mcp@1.1.0`:

```powershell
$releaseContextPath = Join-Path $env:TEMP 'osrs-wiki-mcp-1.1.0-release-context.json'
$releaseContext = Get-Content -LiteralPath $releaseContextPath -Raw | ConvertFrom-Json
$releaseSha = [string]$releaseContext.releaseSha
$dispatchStartedAt = ([datetime]$releaseContext.dispatchStartedAt).ToUniversalTime()
$runId = [long]$releaseContext.runId
$workflowArtifactDir = [string]$releaseContext.workflowArtifactDir
if ($releaseSha -notmatch '^[0-9a-f]{40}$') { throw 'Persisted release SHA is invalid' }
if ((Get-Content (Join-Path $workflowArtifactDir 'RELEASE_SHA') -Raw).Trim() -ne $releaseSha) { throw 'Persisted workflow artifact SHA mismatch' }
$npmVersion = (npm.cmd --version).Trim()
if ($npmVersion -ne '11.16.0') { throw "Expected npm 11.16.0, found $npmVersion" }
function Assert-JsonFields([object]$Object, [string[]]$Fields, [string]$Label) {
  foreach ($field in $Fields) {
    if ($null -eq $Object.PSObject.Properties[$field]) { throw "$Label is missing required field '$field'" }
  }
}
$stages = @(npm.cmd stage list osrs-wiki-mcp --json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'npm stage list failed' }
foreach ($candidate in $stages) {
  Assert-JsonFields $candidate @('id', 'packageName', 'version', 'createdAt') 'npm stage list entry'
}
$matchingStages = @($stages | Where-Object {
  $_.packageName -eq 'osrs-wiki-mcp' -and
  $_.version -eq '1.1.0' -and
  ([datetime]$_.createdAt).ToUniversalTime() -ge $dispatchStartedAt
})
if ($matchingStages.Count -ne 1) { throw "Expected one matching npm stage, found $($matchingStages.Count)" }
$stageId = $matchingStages[0].id
$stage = npm.cmd stage view $stageId --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'npm stage view failed' }
Assert-JsonFields $stage @('id', 'packageName', 'version', 'createdAt', 'shasum') 'npm stage view'
$pack = @(Get-Content (Join-Path $workflowArtifactDir 'npm-pack.json') -Raw | ConvertFrom-Json)
if ($stage.packageName -ne 'osrs-wiki-mcp' -or $stage.version -ne '1.1.0' -or $stage.shasum -ne $pack[0].shasum) { throw 'Stage metadata does not match the workflow tarball' }
$stageDir = Join-Path $env:TEMP "osrs-wiki-mcp-$stageId-$(New-Guid)-stage"
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Push-Location $stageDir
try { npm.cmd stage download $stageId } finally { Pop-Location }
$stageTarballs = @(Get-ChildItem -LiteralPath $stageDir -Filter '*.tgz' -File)
if ($stageTarballs.Count -ne 1) { throw "Expected exactly one downloaded stage tarball, found $($stageTarballs.Count)" }
$stageTarball = $stageTarballs[0].FullName
$workflowTarball = Join-Path $workflowArtifactDir $pack[0].filename
if ((Get-FileHash $stageTarball -Algorithm SHA256).Hash -ne (Get-FileHash $workflowTarball -Algorithm SHA256).Hash) { throw 'Stage tarball differs from workflow tarball' }
```

Extract the downloaded tarball into a disposable directory. Inspect its file
list, run the same secret/personal-data scan as CI, compare package metadata and
integrity with `npm-pack.json`, `SHA256SUMS`, and the workflow artifact, install
it with lifecycle scripts disabled, and run initialize plus `tools/list`
against the staged artifact. Validate that `$stage.id` equals `$stageId`, its
creation time follows `$dispatchStartedAt`, and any provenance/head-SHA metadata
reported by npm is consistent with `$releaseSha`. Reject the stage on any
mismatch.

After human inspection, explicitly approve it with maintainer 2FA:

```powershell
npm.cmd stage approve $stageId
```

This is an intentional user-presence checkpoint; trusted publishing does not
remove the separate proof-of-presence approval.

- [ ] **Step 4: Verify the now-public artifact independently**

```powershell
npm.cmd view osrs-wiki-mcp@1.1.0 version dist.integrity dist.attestations --json
```

Install into a disposable directory with lifecycle scripts disabled, run
`npm audit signatures`, and save `npm ls --all --json` as a sanitized release
artifact outside the repository. Record its SHA-256 hash so the resolved
transitive tree is auditable without claiming it can never drift. Use the
installed client-wrapper smokes in Step 6 for initialize, `tools/list`, and one
live call; do not launch a bare MCP process that waits on stdin.

- [ ] **Step 5: Tag the captured SHA and publish release notes**

```powershell
git tag -a v1.1.0 $releaseSha -m "OSRS Wiki MCP 1.1.0"
git rev-parse v1.1.0^{}
git push origin v1.1.0
gh release create v1.1.0 --verify-tag --title "OSRS Wiki MCP 1.1.0" --notes "Adds portable MCP usage instructions and installable Codex, Claude Code, and Gemini CLI wrappers. The runtime remains stateless, read-only, and limited to the same ten Wiki tools."
```

Require `git rev-parse v1.1.0^{}` to equal `$releaseSha` before pushing.

- [ ] **Step 6: Test each wrapper in an isolated client configuration**

For Codex, add `SanderVirula/osrs-wiki-mcp --ref v1.1.0`; for Claude, add
`SanderVirula/osrs-wiki-mcp@v1.1.0`; install
`osrs-wiki-mcp@sander-virula-osrs` in disposable homes with no user or project
MCP settings. Start a fresh task/session and confirm from origin-qualified
diagnostics:

- exactly one plugin-owned `osrs-wiki` MCP server;
- exactly ten tools owned by that plugin server;
- initialize instructions are present;
- the loaded skill hash matches the release;
- one `search_wiki` call succeeds and returns provenance.

For Gemini, use a disposable user home and the explicitly approved exact CLI
version. Install the repository at `v1.1.0`, confirm the extension-owned server
and skill are discovered, then make the same single live query. Ensure no
same-name user setting overrides the extension. Do not execute a downloaded
Gemini CLI until the user has approved that third-party-code boundary. If that
approval is unavailable, rerun the deterministic manifest/schema,
install-layout, exact-pin, and mirror contracts; record Gemini's native smoke as
deferred in the release evidence and do not claim it was natively verified.
That documented fallback satisfies the Gemini release criterion.

Limit the smoke to one live Wiki query per platform.

- [ ] **Step 7: Perform the real direct-MCP migration and final checks**

Only after an isolated plugin succeeds on a platform, apply that platform's
verified README removal steps to its real configuration. Restart each migrated
client and confirm the sole remaining server is plugin-owned and exposes ten
tools. If Gemini's native smoke was deferred, leave its existing direct MCP
registration unchanged and record that migration as deferred too. Keep the raw
setup documented for clients that do not support plugins.

Finally confirm:

```powershell
git status --short
git rev-parse HEAD
git rev-parse v1.1.0^{}
gh release view v1.1.0
npm.cmd view osrs-wiki-mcp@1.1.0 version --json
```

Expected: clean synchronized `main`; HEAD and tag both equal `$releaseSha`;
published GitHub and npm releases; exactly one plugin-owned server per migrated
client; and no undisclosed required follow-up. Any unapproved Gemini native
smoke and migration remain explicitly recorded as deferred, without a native
verification claim.
