# OSRS Wiki MCP Cross-Agent Plugin Design

**Status:** Proposed for independent reviewer-agent approval
**Date:** 2026-07-15  
**Repository:** `SanderVirula/osrs-wiki-mcp`

## Purpose

Package the existing public, stateless OSRS Wiki MCP as a thin installable
extension for Codex, Claude Code, and Gemini CLI. The plugin must improve
discovery, one-install setup, and tool-selection behavior without creating a
second server implementation, adding player state, or changing the product
into a hosted service.

The MCP remains the product and the only data-access implementation. Platform
manifests and one shared skill are distribution and guidance layers over the
published npm executable.

## Goals

- Let users install the MCP and its usage guidance as one versioned bundle.
- Reuse one `skills/osrs-wiki-research/SKILL.md` across all three agents.
- Reuse one `.mcp.json` for Codex and Claude Code; keep Gemini's required inline
  server declaration mechanically identical.
- Add concise MCP server-level instructions so clients benefit even when they
  ignore or do not support the plugin skill.
- Keep the npm runtime pinned exactly and preserve the existing read-only,
  stateless, low-volume request model.
- Prevent duplicate global and plugin-provided registrations during migration.
- Keep releases reproducible, testable, and free of secrets or personal
  configuration.

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

### A. Shared-root cross-agent wrapper — selected

Place the Codex and Claude manifests, their separate marketplace catalogs,
Gemini's extension manifest, one MCP config, and one skill at the repository
root. All wrappers start the exact published `osrs-wiki-mcp` version.

This gives each platform its native install surface while keeping one runtime
and one set of behavioral guidance. The unavoidable duplication is limited to
Gemini's inline MCP declaration and is protected by contract tests.

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

The repository root is both the source repository and the plugin root:

```text
osrs-wiki-mcp/
├── .agents/plugins/marketplace.json       # Codex marketplace catalog
├── .claude-plugin/
│   ├── marketplace.json                   # Claude marketplace catalog
│   └── plugin.json                        # Claude plugin manifest
├── .codex-plugin/plugin.json              # Codex plugin manifest
├── .mcp.json                              # Shared Codex/Claude MCP declaration
├── gemini-extension.json                  # Gemini manifest + matching MCP entry
├── skills/osrs-wiki-research/
│   ├── SKILL.md                           # Shared lazy-loaded workflow
│   └── agents/openai.yaml                 # Codex skill UI metadata
├── src/server.ts                          # Server instructions and tools
├── test/plugin-bundle.test.ts             # Cross-file/version contracts
└── test/server-contract.test.ts           # MCP initialize contract
```

Only `.codex-plugin/plugin.json` belongs under `.codex-plugin`. Only the Claude
manifest and marketplace belong under `.claude-plugin`. Skills and `.mcp.json`
remain at the plugin root so both platforms discover the same files. Gemini
discovers the same root `skills/` directory and reads its MCP declaration from
`gemini-extension.json`.

Codex and Claude use separate marketplace files because their catalog schemas
are incompatible. Both catalogs identify `osrs-wiki-mcp` and use the repository
root (`./`) as the plugin source. Their marketplace name is
`sander-virula-osrs`.

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

`agents/openai.yaml` contains only the Codex display name, short description,
and starter prompt derived from the skill. Other clients ignore it.

### MCP process declaration

The shared MCP server name is `osrs-wiki`. Codex and Claude read:

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
The command is cross-platform `npx`, not Windows-only `npx.cmd`. There are no
environment variables, credentials, writable data paths, or unpinned package
selectors.

The plugin requires Node.js 24 or newer, matching the executable's enforced
runtime floor. Startup failures remain sanitized on stderr and stdout remains
reserved for MCP protocol traffic.

### Platform manifests

All manifests use the stable identifier `osrs-wiki-mcp`, version `1.1.0`, MIT
code license, public repository URL, and accurate read-only capability copy.

- Codex: `.codex-plugin/plugin.json` points to `./skills/` and `./.mcp.json`
  and includes concise interface metadata and up to three realistic starter
  prompts. It declares no app because there is no hosted MCP or ChatGPT app.
- Claude: `.claude-plugin/plugin.json` declares the same skill and MCP paths.
  `.claude-plugin/marketplace.json` publishes the repository-root plugin with
  strict manifest ownership.
- Gemini: `gemini-extension.json` declares the same name, version,
  description, and MCP server. It relies on lazy agent-skill discovery and does
  not define a `GEMINI.md`, avoiding permanent context cost.

No manifest advertises player awareness, account advice, write access, or a
hosted service.

## Data and Control Flow

1. The user installs the repository-backed plugin or extension.
2. The client loads the shared skill lazily and starts the pinned npm package
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
repository is the wrapper/marketplace source. The npm package is published
first from the same verified commit, then the Git tag and marketplace install
smokes are completed. This ordering ensures the exact package pin exists before
any installed wrapper tries to start it.

## Migration and Duplicate Prevention

Installing the plugin while a direct global `osrs-wiki` MCP registration is
still enabled can expose duplicate tools or a server-name conflict. The README
must therefore include a migration note:

1. Install and validate the plugin in an isolated test invocation.
2. Disable or remove the old direct MCP registration.
3. Enable the plugin and start a fresh client session.
4. Confirm exactly one `osrs-wiki` server and ten tools are present.

## Reliability, Security, Privacy, and Licensing

- The wrapper adds no network destination. The process still contacts only the
  documented OSRS Wiki endpoints.
- Exact npm pinning, npm provenance, dependency-signature verification, the
  existing tarball allowlist, and repository/history secret scans remain
  release gates.
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
  contract validation and a clean temporary-CLI install smoke before release.

## Testing Strategy

### Server behavior

Use TDD to add an MCP boundary assertion that `Client.getInstructions()`
equals the exported instruction string after initialization. Existing tool
list, call, cancellation, and reliability tests must remain unchanged and pass.

### Bundle contracts

Add offline Node tests that parse every JSON manifest and assert:

- names and versions are synchronized;
- Codex and Claude reference the same `.mcp.json` and `skills/` directory;
- Gemini's MCP declaration deep-equals the shared declaration;
- the server is exactly `npx --yes osrs-wiki-mcp@1.1.0`;
- no declaration contains `env`, secrets, absolute personal paths, progression
  claims, mutable package ranges, hooks, apps, monitors, or a second server;
- marketplace entries resolve to the repository root and identify the same
  plugin exactly once.

Run the official Codex plugin validator and `claude plugin validate --strict .`
in addition to the repository tests. Validate the Gemini manifest against the
current documented schema and exercise a temporary local extension install.

### Skill behavior

Skill development follows a baseline-first evaluation:

- run fresh lower-tier agent sessions with the raw MCP but without the skill;
- record tool-selection or answer-shape failures;
- write the minimum skill that addresses observed failures;
- rerun the same prompts with the plugin and compare traces/results;
- have the primary agent inspect every result rather than accepting an
  automated score alone.

The fixed evaluation set contains five positive scenarios and three negative
or boundary scenarios:

1. bounded item acquisition overview with recovery to complete drops;
2. exact quest requirements without player-readiness claims;
3. ambiguous page title resolved through search;
4. truncated long page recovered through sections;
5. monster variants kept separate with provenance;
6. request for GE price identified as outside scope;
7. request for account progression identified as outside scope;
8. request for DPS identified as outside scope.

The skill passes when the plugin arm selects valid tools, follows warnings,
avoids unsupported claims, and includes provenance more consistently than the
no-skill arm. Eval outputs are temporary evidence and are not committed.

### Release and install smokes

Before npm publication, run the existing full offline suite, tarball inspection,
audit, and scans. After `1.1.0` is published from the verified commit:

- verify npm signatures and attestations;
- install the Codex marketplace/plugin in an isolated configuration and confirm
  one server, ten tools, instructions, and one live `search_wiki` call;
- load the Claude plugin from the repository, run strict validation, confirm one
  server and ten tools, and make one live `search_wiki` call;
- install the Gemini extension with a pinned temporary CLI, confirm discovery,
  and make one live `search_wiki` call;
- perform no more than one live Wiki query per platform smoke;
- complete the local direct-MCP-to-plugin cutover only after all supported
  installed clients pass.

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
3. the shared skill improves the fixed baseline evaluations without inventing
   unsupported capabilities;
4. manifest and marketplace validators pass with no warnings;
5. the full existing server suite and package gates remain green on Windows and
   Ubuntu;
6. post-publication install smokes show exactly one server and ten tools in
   Codex, Claude, and Gemini;
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
