# OSRS Wiki MCP

<p align="center">
  <img src="plugins/osrs-wiki-mcp/assets/icon.png" alt="OSRS Wiki MCP icon" width="160">
</p>

A local, read-only [Model Context Protocol](https://modelcontextprotocol.io/)
server for the [Old School RuneScape Wiki](https://oldschool.runescape.wiki/).
It gives AI clients ten focused tools for Wiki research, with validated
structured output and source provenance on every successful response.

- **Stateless:** no player account, database, telemetry, or disk cache.
- **Source-backed:** results include canonical Wiki URLs and fetch timestamps;
  parsed pages also include an exact revision link.
- **Bounded:** response sizes, pagination, retries, and request time are capped.
- **Read-only:** the server only retrieves public Wiki data.

## Quick start

Node.js 24 or newer and `npx` are required.

### Codex

```powershell
codex plugin marketplace add SSanderV/osrs-wiki-mcp --ref v1.1.2
codex plugin add osrs-wiki-mcp@osrs-wiki
```

### Claude Code

```powershell
claude plugin marketplace add SSanderV/osrs-wiki-mcp@v1.1.2 --scope user
claude plugin install osrs-wiki-mcp@osrs-wiki --scope user
```

### Gemini CLI

```powershell
gemini extensions install https://github.com/SSanderV/osrs-wiki-mcp --ref v1.1.2
```

The plugin and extension include the MCP setup plus a small Wiki-research
skill. All three launch the pinned npm package `osrs-wiki-mcp@1.1.2`.

### Other MCP clients

Configure a standard-input/output server with:

```json
{
  "command": "npx",
  "args": ["--yes", "osrs-wiki-mcp@1.1.2"]
}
```

Start a fresh client session after installation. If you previously configured
an `osrs-wiki` MCP server directly, remove that registration first so the
plugin is the only provider of the server.

## Tools

| Tool | Inputs | Use it for |
| --- | --- | --- |
| `search_wiki` | `query`, optional `limit` and `offset` | Find canonical pages and snippets. |
| `get_wiki_page` | `title` | Read a bounded, cleaned page with its section index. |
| `get_wiki_sections` | `title` | List a page's sections. |
| `get_wiki_section` | `title`, `section` | Read one section by its numeric index. |
| `get_item_info` | `item` | Get an item's description, properties, bonuses, and creation facts. |
| `find_shop` | `item`, optional `limit` and `offset` | Page through complete shop listings. |
| `find_drop_sources` | `item`, optional `limit` and `offset` | Page through complete monster-drop listings. |
| `get_item_sources` | `item`, optional `perCategoryLimit` | Get a bounded overview of drops, shops, recipes, and ground spawns. |
| `get_quest_requirements` | `quest` | Get Wiki-sourced requirements without evaluating a player. |
| `get_monster_info` | `monster`, optional `variant` | Get separate monster variants, map points, and access notes. |

Example requests:

- “What are the requirements for Dragon Slayer I?”
- “Where can an ironman obtain a rune scimitar?”
- “Find the exact Wiki section explaining Hespori mechanics.”

All public text inputs accept 1–256 Unicode characters. Tool schemas declare
the exact limits and defaults. When results are truncated or upstream
pagination is incomplete, `warnings` explains the safe follow-up action.

## Responses and provenance

Successful calls return:

- `content` for clients that display readable text; and
- `structuredContent`, validated against the tool's MCP output schema.

Provenance includes the contributing Wiki URLs, original `fetchedAt` time,
attribution, license details, and whether content was transformed. Parsed-page
responses additionally include the exact revision ID and revision URL.

Failures use stable error codes such as `NOT_FOUND`, `UPSTREAM_TIMEOUT`,
`UPSTREAM_RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`,
`UPSTREAM_INVALID_RESPONSE`, and `RESPONSE_TOO_LARGE`. Invalid arguments remain
standard JSON-RPC parameter errors.

## Reliability and privacy

- A tool call has a 30-second total budget; each upstream request gets at most
  20 seconds within that budget.
- Transient network and rate-limit failures receive at most two bounded
  retries, respecting `Retry-After` only when time remains.
- Responses are capped at 5 MiB. Large Bucket scans stop after 10,000 raw rows
  and report incomplete or truncated results.
- Valid upstream responses may be cached in memory for five minutes. The cache is
  limited per process, never written to disk, and cleared on restart.
- Standard output is reserved for MCP traffic. Sanitized diagnostics use
  standard error.

## Scope

The server deliberately does **not** provide player progress, hiscores, Grand
Exchange prices, DPS calculations, Wiki images, persistent storage, hosting,
or a local Wiki mirror. Quest requirements are facts rather than met/missing
evaluations, and monster variants are never combined.

## Development

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:stdio
npm.cmd run pack:check
```

Tests use synthetic fixtures and do not contact the live Wiki. The optional
live smoke makes two low-volume requests and does not persist responses:

```powershell
npm.cmd run test:live
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Licensing and attribution

The source code is [MIT licensed](LICENSE). Retrieved Old School RuneScape Wiki
content remains subject to
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), including
its non-commercial and ShareAlike conditions. Downstream users are responsible
for how they reuse that content. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

RuneScape and Old School RuneScape are trademarks of Jagex Limited. This
independent project is not affiliated with, endorsed by, or sponsored by Jagex
Limited, Weird Gloop, or the Old School RuneScape Wiki.
