# OSRS Wiki MCP

> Unreleased and under active development.

A stateless, local Model Context Protocol server that turns Old School
RuneScape Wiki data into bounded semantic responses with machine-readable
structured content and source provenance.

The planned version 1 surface contains ten read-only tools:

- `search_wiki`
- `get_wiki_page`
- `get_wiki_sections`
- `get_wiki_section`
- `get_item_info`
- `find_shop`
- `find_drop_sources`
- `get_item_sources`
- `get_quest_requirements`
- `get_monster_info`

Version 1 deliberately excludes player accounts, progression evaluation,
hiscores, Grand Exchange prices, DPS calculations, Wiki images, and persistent
storage.

## Licensing

The source code is MIT licensed. Content retrieved from the Old School
RuneScape Wiki remains subject to CC BY-NC-SA 3.0. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

Node.js 24 or newer is required.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Continuous tests use synthetic fixtures. Live Wiki smoke tests are opt-in and
must remain low volume.
