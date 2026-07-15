# OSRS Wiki MCP Cross-Agent Plugin Design

**Status:** Approved for implementation by an independent reviewer agent
**Date:** 2026-07-15
**Repository:** `SanderVirula/osrs-wiki-mcp`

## Purpose

Package the existing public, stateless OSRS Wiki MCP as a thin installable
extension for Codex, Claude Code, and Gemini CLI. The plugin must improve
discovery, one-install setup, and tool-selection behavior without creating a
second server implementation, adding player state, or changing the product
into a hosted service.

The MCP remains the product and the only data-access implementation. Platform
manifests and one canonical skill are distribution and guidance layers over the
published npm executable. A byte-identical Codex compatibility mirror exists
only because the current Codex marketplace resolver rejects a plugin source at
the repository root.

## Goals

- Let users install the MCP and its usage guidance as one versioned bundle.
- Keep `skills/osrs-wiki-research/SKILL.md` as the canonical skill used by
  Claude Code and Gemini CLI, with a contract-enforced byte-identical Codex
  mirror.
- Keep root `.mcp.json` canonical for Claude Code; mirror it byte-for-byte in
  the Codex plugin and keep Gemini's required inline declaration mechanically
  identical.
- Add concise MCP server-level instructions so clients benefit even when they
  ignore or do not support the plugin skill.
- Keep the npm runtime pinned exactly and preserve the existing read-only,
  stateless, low-volume request model.
- Prevent duplicate global and plugin-provided registrations during migration.
- Keep releases version-pinned, testable, and free of secrets or personal
  configuration; document the remaining npm registry/cache and transitive
  dependency boundary instead of claiming complete reproducibility.

## Non-goals

- No player account, hiscores, progression, GE price, DPS, or advisor tools.
- No hosted or remote MCP endpoint, ChatGPT app, custom UI, OAuth, billing, or
  telemetry.
- No hooks, background monitors, commands, subagents, persistent state, or
  platform-specific server forks.
- No duplicated Wiki reference tables inside the skill or plugin.
- No public Plugins Directory submission in this release. A local stdio server
  cannot satisfy the hosted production MCP URL and domain-verification gates.
- No separate plugin repository or npm package.

## Considered Approaches

### A. Canonical root plus Codex compatibility wrapper — selected

Keep the Claude and Gemini extension surfaces, canonical MCP config, and
canonical skill at the repository root. Put the Codex plugin in
`plugins/osrs-wiki-mcp/`, because current Codex source resolution strips `./`
and rejects the resulting empty path. All wrappers start the exact published
`osrs-wiki-mcp` version.

This gives each platform its native install surface while keeping one runtime
and one canonical set of behavioral guidance. The unavoidable duplication is
limited to Gemini's inline MCP declaration plus byte-identical Codex mirrors of
the tiny MCP config and skill. Contract tests prevent drift; symlinks are not
used because Windows and plugin caches do not handle them consistently.

### B. One platform-specific wrapper directory per agent

Create `plugins/codex`, `plugins/claude`, and `plugins/gemini`, each with its own
skill and MCP configuration. This is easy to reason about per platform but
duplicates the most important behavior and creates drift across releases.

### C. MCP instructions only

Add server-level instructions but no manifests, marketplaces, or skill. This is
the smallest change and improves every client that consumes MCP instructions,
but it provides no one-install setup, discovery metadata, starter prompts, or
agent-skill workflow. It leaves most of the proposed adoption value unrealized.

## Architecture

The repository root is the Claude/Gemini extension root and contains a nested
Codex plugin root:

```text
osrs-wiki-mcp/
├── .agents/plugins/marketplace.json       # Codex marketplace catalog
├── .claude-plugin/
│   ├── marketplace.json                   # Claude marketplace catalog
│   └── plugin.json                        # Claude plugin manifest
├── .mcp.json                              # Canonical Claude MCP declaration
├── gemini-extension.json                  # Gemini manifest + matching MCP entry
├── skills/osrs-wiki-research/
│   ├── SKILL.md                           # Canonical lazy-loaded workflow
│   └── agents/openai.yaml                 # Codex skill UI metadata
├── plugins/osrs-wiki-mcp/                 # Codex compatibility plugin root
│   ├── .codex-plugin/plugin.json
│   ├── .mcp.json                          # Byte-identical canonical mirror
│   └── skills/osrs-wiki-research/         # Byte-identical canonical mirror
│       ├── SKILL.md
│       └── agents/openai.yaml
├── src/server.ts                          # Server instructions and tools
├── test/plugin-bundle.test.ts             # Cross-file/version contracts
└── test/server-contract.test.ts           # MCP initialize contract
```

Only the Codex compatibility root contains `.codex-plugin/plugin.json`. Only
the repository root contains the Claude manifest and marketplace. Claude and
Gemini discover the canonical root `skills/` directory. Codex discovers the
mirrored files relative to `plugins/osrs-wiki-mcp/`. Bundle tests compare both
copies byte-for-byte.

Codex and Claude use separate marketplace files because their catalog schemas
are incompatible. Both catalogs identify `osrs-wiki-mcp`; Claude uses the
repository root (`./`) while Codex uses `./plugins/osrs-wiki-mcp`. Their
marketplace name is `sander-virula-osrs`.

## Component Contracts

### MCP server instructions

`createServer` passes a concise, exported `SERVER_INSTRUCTIONS` string as the
second argument to `McpServer`. The instructions are returned in the MCP
initialize result and communicate only durable, universal behavior:

- use the most specific semantic tool for the question;
- use `get_item_sources` for a bounded overview and the paginated `find_*`
  tools for complete shop or drop listings;
- follow warnings, pagination, and section-navigation recovery paths;
- treat results as Wiki facts, not player-progress evaluation;
- retain provenance links and do not invent DPS, prices, or account state.

The instructions do not repeat all ten schemas or contain platform-specific
syntax. Tool descriptions remain the authoritative per-tool selection surface.

### Shared research skill

`skills/osrs-wiki-research/SKILL.md` is a concise technique skill, not a Wiki
knowledge dump. Its trigger covers OSRS Wiki research, item acquisition, quest
requirements, monster variants, and source-backed page lookup. The body gives a
small positive decision recipe:

1. Select the narrowest semantic tool.
2. Resolve ambiguous names through `search_wiki` before exact-title tools.
3. Follow explicit warnings, `nextOffset`, and section-navigation guidance.
4. Synthesize only supported Wiki facts and preserve important variant or
   uncertainty distinctions.
5. Include canonical provenance URLs in the answer.

The skill states that quest requirements are not player-readiness checks and
that the server does not provide progression, GE prices, or DPS. It contains no
scripts, assets, copied Wiki data, or extra reference files. The target is under
500 words, with the frontmatter description carrying all trigger conditions.

`agents/openai.yaml` contains the Codex display name, short description,
starter prompt, and implicit-invocation policy derived from the skill. Other
clients ignore it. The Codex copy is byte-identical to the canonical file.

### MCP process declaration

The shared MCP server name is `osrs-wiki`. Claude reads the canonical root
declaration and Codex reads its byte-identical compatibility mirror:

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

Gemini embeds the same server object under its required `mcpServers` field.
The intended portable declaration uses `npx`, but Codex and Claude must prove it
through native client launchers on Windows, as must Gemini when its downloaded
CLI is explicitly approved. A generic process-launch probe must pass on Ubuntu
before release. A direct Node `child_process.spawn("npx")` call fails with
`ENOENT` on this Windows host even though `npx.cmd` exists. If a tested supported
client behaves the same way, stop and revise and re-review the launcher
architecture. There are no environment variables, credentials, writable data
paths, or unpinned top-level package selectors.

The plugin requires Node.js 24 or newer, matching the executable's enforced
runtime floor. Startup failures remain sanitized on stderr and stdout remains
reserved for MCP protocol traffic.

### Platform manifests

All manifests use the stable identifier `osrs-wiki-mcp`, version `1.1.0`, and
accurate read-only capability copy. Repository and MIT-license metadata are
included wherever the platform schema supports them.

- Codex: `plugins/osrs-wiki-mcp/.codex-plugin/plugin.json` points to its local
  byte-identical `./skills/` and `./.mcp.json` mirrors and includes concise
  interface metadata and up to three realistic starter prompts. It declares no
  app because there is no hosted MCP or ChatGPT app.
- Claude: `.claude-plugin/plugin.json` declares the canonical root skill and MCP
  paths.
  `.claude-plugin/marketplace.json` publishes the repository-root plugin with
  strict manifest ownership.
- Gemini: `gemini-extension.json` declares the same name, version,
  description, and MCP server. It relies on lazy agent-skill discovery and does
  not define a `GEMINI.md`, avoiding permanent context cost. The current
  documented Gemini extension schema has no repository, homepage, or license
  fields, so the manifest does not invent them; the install source and README
  carry that metadata. Recheck the schema when implementing the manifest.

No manifest advertises player awareness, account advice, write access, or a
hosted service.

## Data and Control Flow

1. The user installs the repository-backed plugin or extension.
2. The client loads the canonical skill (or its byte-identical Codex mirror)
   lazily and starts the pinned npm package
   as a local stdio MCP server.
3. MCP initialization returns the server instructions and ten read-only tools.
4. For a matching OSRS question, the skill and tool descriptions guide the
   model to the narrowest tool sequence.
5. The existing server performs bounded Wiki requests and returns validated
   structured content, warnings, and provenance.
6. The model synthesizes a source-backed answer without adding player state or
   unsupported calculations.

The wrapper never receives, transforms, caches, or forwards Wiki data itself.

## Versioning and Distribution

The first wrapper release uses a single repository release train at `1.1.0`:

- `package.json` and `package-lock.json` version: `1.1.0`;
- Codex, Claude, and Gemini manifest versions: `1.1.0`;
- every plugin MCP declaration: exact `osrs-wiki-mcp@1.1.0`;
- Git tag and GitHub release: `v1.1.0`.

A minor version communicates the addition of a new distribution surface and
server guidance while preserving all ten tool contracts. Contract tests fail
if any version or MCP declaration drifts.

The npm tarball remains the runtime artifact and keeps its existing files
allowlist; it does not need to contain Git-hosted marketplace files. The GitHub
repository is the wrapper/marketplace source. The release records one verified
commit SHA. The bound workflow packs once, applies the full tarball scan and
smoke test to that exact file, uploads the tarball plus npm metadata, SHA-256,
and release SHA as an immutable short-lived workflow artifact, then submits the
same tarball to npm staging. A maintainer downloads both copies, verifies exact
hash/metadata equality, inspects the private stage, explicitly approves it with
2FA, and tags that exact SHA. Marketplace install smokes follow only after npm
makes the version public. This ordering ensures every artifact derives from the
same commit and the exact package pin exists before an installed wrapper starts
it.

## Migration and Duplicate Prevention

Installing the plugin while a direct global `osrs-wiki` MCP registration is
still enabled can expose duplicate tools or a server-name conflict. The README
must therefore include a migration note:

1. Install and validate the plugin in a disposable profile containing no global
   direct MCP registration.
2. Confirm the observed server and tools are plugin-owned, not inherited from a
   user or project config.
3. Remove or disable the old direct registration from each real client using
   platform-specific documented steps; Gemini's same-name user setting can
   otherwise override the extension server.
4. Start a fresh client session and confirm exactly one plugin-owned
   `osrs-wiki` server and ten tools are present.

## Reliability, Security, Privacy, and Licensing

- The wrapper adds no new Wiki data destination. `npx` may contact the npm
  registry and use the local npm cache before the runtime contacts the
  documented OSRS Wiki endpoints; installation documentation discloses both.
- Exact top-level npm pinning, npm provenance, dependency-signature verification, the
  existing tarball allowlist, and repository/history secret scans remain
  release gates. The release records the resolved dependency tree because
  transitive semver ranges can still resolve differently over time; full
  offline reproducibility is not claimed.
- Manifests request no credentials or environment variables and include no
  personal paths, usernames, player names, endpoints, or tokens.
- Plugin metadata describes the server as read-only and open-world. It does not
  overstate safety: upstream Wiki access can still fail, rate-limit, truncate,
  or return incomplete data, and the model must honor warnings.
- Wiki content remains CC BY-NC-SA 3.0 with the existing per-response
  provenance. Plugin and skill text remain MIT with the repository code.
- The plugin has no telemetry, user-account access, or persistent storage, so
  no new privacy data flow is introduced.

## Error Handling and Compatibility

- Missing Node.js 24 or `npx` produces installation/startup guidance; it never
  falls back to an unpinned global executable.
- A failed MCP start leaves the plugin installed but unavailable. Client docs
  direct the user to the platform's plugin/MCP diagnostic view.
- Wiki failures retain the server's existing stable error codes and in-band
  error contract.
- A truncated or incomplete response must lead to the exact recovery path in
  `warnings`; the skill must not silently present it as complete.
- Plugin updates require a manifest version bump and a new exact npm pin. No
  `latest`, caret, or mutable dist-tag is accepted.
- Claude and Codex are locally available for native validation. Gemini is not
  installed on this workstation, so its manifest receives deterministic
  contract validation and, only with explicit user approval, a clean pinned
  temporary-CLI install smoke before release. If that approval is unavailable,
  deterministic manifest/schema validation plus a recorded native-smoke
  deferral satisfies the release gate, but the release must not claim native
  Gemini verification. All approved native smokes run on Windows; CI or a
  disposable runner covers only the generic Ubuntu launcher behavior.

## Testing Strategy

### Server behavior

Use TDD to add an MCP boundary assertion that `Client.getInstructions()`
equals the exported instruction string after initialization. Existing tool
list, call, cancellation, and reliability tests must remain unchanged and pass.

### Bundle contracts

Add offline Node tests that parse every JSON manifest and assert:

- names and versions are synchronized;
- the canonical and Codex-mirrored `.mcp.json`, `SKILL.md`, and `openai.yaml`
  files are byte-identical;
- Gemini's MCP declaration deep-equals the shared declaration;
- the server is exactly `npx --yes osrs-wiki-mcp@1.1.0`;
- no declaration contains `env`, secrets, absolute personal paths, progression
  claims, mutable package ranges, hooks, apps, monitors, or a second server;
- the Claude marketplace resolves to the repository root, the Codex marketplace
  resolves to the non-root compatibility directory, and each identifies the
  same plugin exactly once.

Run the official Codex plugin validator and `claude plugin validate --strict .`
in addition to the repository tests. Validate the Gemini manifest against the
current documented schema. Exercise a temporary local extension install only
when the downloaded CLI is explicitly approved; otherwise record the native
smoke as deferred without claiming native verification.

### Skill behavior

Skill development follows a controlled baseline-first evaluation:

- use one deterministic synthetic stdio MCP in both arms, with no live Wiki;
- run fresh lower-tier agent sessions with identical plugin configurations that
  differ only by the presence of the target skill;
- record tool-selection or answer-shape failures;
- write the minimum skill that addresses observed failures;
- use diagnostic cases only for authoring, then freeze the skill and evaluate
  separate held-out cases with multiple runs per arm;
- pin and record the exact model slug and CLI version, preregister the rubric,
  compare actual tool traces/results, and hash sanitized evidence;
- have the primary agent inspect every result rather than accepting an
  automated score alone.

The synthetic evaluation set contains one diagnostic and one held-out variant
of each of five positive scenarios and three negative or boundary scenarios:

1. bounded item acquisition overview with recovery to complete drops;
2. exact quest requirements without player-readiness claims;
3. ambiguous page title resolved through search;
4. truncated long page recovered through sections;
5. monster variants kept separate with provenance;
6. request for GE price identified as outside scope;
7. request for account progression identified as outside scope;
8. request for DPS identified as outside scope.

The skill passes only on the frozen held-out rubric when the plugin arm selects
valid tools, follows synthetic warning and pagination signals, avoids
unsupported claims, and includes provenance more consistently than the
no-skill arm. Scoring is only partially blind because the treatment trace can
reveal a `Skill` invocation. Keep raw traces for verification, but generate a
separate randomized scoring view with arm labels, plugin metadata, and skill
invocation events redacted before manual scoring. Raw traces stay outside the
repository; a sanitized summary records the environment, aggregate scores,
trace hashes, scoring-view hashes, and the partial-blinding limitation.

### Release and install smokes

Before npm publication, run the existing full offline suite, tarball inspection,
audit, and scans. After `1.1.0` is published from the verified commit:

- verify npm signatures and attestations;
- install the Codex marketplace/plugin in an isolated configuration and confirm
  one server, ten tools, instructions, and one live `search_wiki` call;
- load the Claude plugin from the repository, run strict validation, confirm one
  server and ten tools, and make one live `search_wiki` call;
- when explicitly approved, install the Gemini extension with a pinned
  temporary CLI, confirm discovery, and make one live `search_wiki` call;
  otherwise complete deterministic contract/schema validation, record the
  native-smoke deferral, and make no native-verification claim;
- perform no more than one live Wiki query per platform smoke;
- prove the Codex and Claude native client launchers on Windows, plus Gemini
  when its downloaded CLI is approved, and a generic process launch on Ubuntu
  before publication; revise and re-review the architecture if bare `npx` fails
  in any tested supported client;
- complete the local direct-MCP-to-plugin cutover only after all supported
  installed clients pass and the observed server origin is plugin-owned.

## Documentation

README installation guidance is split into:

- MCP-only installation for users who want raw configuration;
- Codex plugin marketplace installation;
- Claude plugin marketplace installation;
- Gemini extension installation;
- migration from a direct MCP registration;
- Node 24 requirement and platform-specific diagnostics.

The README explains that the plugin adds installation and research guidance,
not new Wiki data, premium features, or progression awareness.

## Completion Criteria

The design is complete when:

1. all three platforms load the same ten-tool npm runtime at one exact version;
2. MCP initialization returns concise server instructions;
3. the canonical skill improves controlled held-out evaluations without inventing
   unsupported capabilities;
4. manifest and marketplace validators pass with no warnings;
5. the full existing server suite and package gates remain green on Windows and
   Ubuntu;
6. pre- and post-publication native install smokes show exactly one plugin-owned
   server and ten tools in Codex and Claude on Windows, plus Gemini when its
   downloaded CLI is explicitly approved; otherwise Gemini has deterministic
   contract/schema validation and a documented native-smoke deferral, with no
   native-verification claim. A generic bare-`npx` process probe covers Ubuntu;
7. migration guidance prevents simultaneous direct and plugin-provided
   registrations;
8. no secrets, personal configuration, duplicated server code, or Wiki-derived
   reference data enter the repository or npm tarball.

## Authoritative Platform References

- [Codex: Build plugins](https://learn.chatgpt.com/docs/build-plugins.md)
- [Codex: Submit plugins](https://learn.chatgpt.com/docs/submit-plugins.md)
- [Claude Code: Create plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code: Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code: Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Claude Code: MCP](https://code.claude.com/docs/en/mcp)
- [Gemini CLI: Extension reference](https://geminicli.com/docs/extensions/reference/)
- [Gemini CLI: Build extensions](https://geminicli.com/docs/extensions/writing-extensions/)
- [GitHub Actions: Store and share workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [npm: Staged publishing](https://docs.npmjs.com/staged-publishing/)
