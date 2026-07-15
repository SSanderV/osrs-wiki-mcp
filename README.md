# OSRS Wiki MCP

> Unreleased. The implementation is being verified before its first public
> GitHub and npm release.

A stateless, local [Model Context Protocol](https://modelcontextprotocol.io/)
server that turns Old School RuneScape Wiki data into bounded semantic
responses with validated structured content and source provenance.

## Requirements and installation

Node.js 24 or newer is required. The executable prints a concise upgrade
message on older supported runtimes.

Until the npm release exists, install from a local checkout:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
node dist/index.js
```

Once version 1.0.0 is published, an MCP client can use this pinned command:

```json
{
  "command": "npx",
  "args": ["-y", "osrs-wiki-mcp@1.0.0"]
}
```

The server speaks MCP over standard input/output. Standard output is reserved
for protocol messages; sanitized startup diagnostics use standard error.

## Tools

All tools are read-only and may contact the Old School RuneScape Wiki.

| Tool | Exact inputs | Purpose |
| --- | --- | --- |
| `search_wiki` | `query` (string), `limit` (1–20, default 5), `offset` (default 0) | Search for canonical pages and snippets. |
| `get_wiki_page` | `title` (string) | Return a bounded cleaned page and its section summary. |
| `get_wiki_sections` | `title` (string) | List up to 200 page sections. |
| `get_wiki_section` | `title` (string), `section` (non-negative integer) | Return one bounded section using an index from `get_wiki_sections`. |
| `get_item_info` | `item` (string) | Normalize an item's description, properties, bonuses, and creation facts. |
| `find_shop` | `item` (string), `limit` (1–100, default 50), `offset` (default 0) | Return a complete paginated shop listing. |
| `find_drop_sources` | `item` (string), `limit` (1–100, default 50), `offset` (default 0) | Return a complete paginated monster-drop listing. |
| `get_item_sources` | `item` (string), `perCategoryLimit` (1–100, default 20) | Return a bounded overview of drops, shops, recipes, and ground spawns. |
| `get_quest_requirements` | `quest` (string) | Return Wiki-sourced requirements without evaluating a player. |
| `get_monster_info` | `monster` (string), `variant` (optional exact anchor) | Return separate monster variants, map points, and access notes without DPS calculations. |

Public text inputs contain 1–256 Unicode characters. Truncation and incomplete
upstream pagination are disclosed in `warnings`; actionable warnings name a
follow-up tool or safe retry when one exists.

## Responses and errors

Successful calls include both:

- `content`: a readable representation for clients that display text; and
- `structuredContent`: the same result validated against the tool's declared
  MCP output schema.

Valid calls that cannot complete return `isError: true`, no structured content,
and one stable code: `NOT_FOUND`, `UPSTREAM_TIMEOUT`,
`UPSTREAM_RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`,
`UPSTREAM_INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, or `INTERNAL_ERROR`.
Malformed arguments and unknown tool names are JSON-RPC parameter errors.

## Reliability and cache policy

- Every tool call has a 30-second monotonic budget. Each logical upstream
  request has at most 20 seconds within the remaining tool budget.
- Transient network errors and HTTP 429/502/503/504 responses receive at most
  two bounded retries. `Retry-After` is honored only when it fits the remaining
  budgets.
- Upstream requests are serialized per process. Identical in-flight requests
  are deduplicated without allowing one caller's cancellation to cancel its
  siblings.
- Responses are capped at 5 MiB after decompression. Bucket scans are capped at
  20 pages of 500 raw rows (10,000 rows total).
- Valid successful envelopes may be cached in memory for 300 seconds, up to 256
  entries and approximately 32 MiB. Cache timestamps remain the original fetch
  time. Wiki error envelopes, invalid data, aborted requests, and oversized
  responses are never cached.
- The cache is per-process only. Nothing is written to disk and restarting the
  process clears all state.

## Provenance and licensing

Every successful response includes provenance with the contributing canonical
Wiki URLs, original `fetchedAt`, attribution party, license and license deed
URL, and a transformation indicator. Parsed-page responses additionally carry
the exact revision ID and revision URL. Bucket responses use fetch time when a
revision is not available without extra upstream requests.

The source code is [MIT licensed](LICENSE). Content retrieved from the Old
School RuneScape Wiki remains subject to
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/),
including its non-commercial and ShareAlike conditions. Downstream users are
responsible for how they reuse that content. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Testing

Offline tests use synthetic fixtures and never need the live Wiki:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:stdio
npm.cmd run pack:check
```

The live smoke test is opt-in. It builds the server and makes exactly two
low-volume requests (`search_wiki` and `get_item_info`); it never stores the
response:

```powershell
npm.cmd run test:live
```

## Scope and limitations

Version 1 deliberately excludes player accounts, progression evaluation,
hiscores, Grand Exchange prices, DPS calculations, Wiki images, persistent
storage, a hosted proxy, and a local Wiki mirror. Quest requirements are facts,
not met/missing evaluations. Monster variants are never combined.

RuneScape and Old School RuneScape are trademarks of Jagex Limited. This
independent project is not affiliated with, endorsed by, or sponsored by Jagex
Limited, Weird Gloop, or the Old School RuneScape Wiki. It uses a descriptive
User-Agent with this repository URL and is designed for distributed,
low-volume, per-user access.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.
