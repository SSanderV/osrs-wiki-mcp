---
name: osrs-wiki-research
description: Use when a request involves OSRS Wiki pages or sections, items, shops, drops, quest requirements or readiness, monster forms, live prices, player state, loadouts, or DPS, and before any OSRS Wiki MCP tool call or Wiki scope-boundary answer.
---

# OSRS Wiki Research

Use the narrowest tool that directly answers the request. Treat tool output as the only factual source; never fill gaps from assumptions.

**Domain tool first:** when the request asks for supported Wiki facts about a named item, quest, monster, or page, pass that name verbatim to the matching domain tool immediately—even if it is unfamiliar. Do not reinterpret, correct, preflight, or confirm it with `search_wiki`. Search only when the user expresses ambiguity, supplies no title, or a domain tool returns `NOT_FOUND`; then retry with an exact returned title.

## Choose the tool

- Resolve an uncertain or ambiguous title with `search_wiki`. Choose the single best-matching returned title, retrieve only that page, and summarize only it. Do not fetch, compare, merge, or summarize other candidates unless the user explicitly asks for a comparison.
- Retrieve a known page with `get_wiki_page`. If it reports truncation, call `get_wiki_sections`, select the relevant section, then call `get_wiki_section`.
- Use `get_item_info` for item properties.
- Start acquisition research with `get_item_sources`, the bounded multi-category overview. When asked for a concise overview, set `perCategoryLimit` to `2`.
- Use `find_shop` and `find_drop_sources` for complete, paginated listings. When the user asks for complete results in a category, follow that category's recovery warning or `nextOffset` until `truncated` and `incomplete` are false.
- Use `get_quest_requirements` for published requirements. Include the sentence: "No player-readiness evaluation was performed." Never assign met, missing, ready, or not-ready status.
- Use `get_monster_info` for monster facts. Preserve every returned variant as a separate record; never merge variant values.

## Recover and report

Read warnings before answering. Follow recovery instructions needed for the requested completeness, and disclose other truncation or incompleteness rather than treating it as complete. After any truncated page, always call `get_wiki_sections`—even if a likely section number appears elsewhere—then pass its returned index to `get_wiki_section`. If an upstream failure leaves results incomplete, say so and relay the suggested retry path.

Ground the answer in returned structured fields. Every successful research answer must print at least one source URL from `provenance`, plus its attribution or license information; disclose relevant truncation, incompleteness, and fetch age.

## Respect boundaries

This MCP does not provide live Grand Exchange prices, player account state, quest-readiness evaluation, loadouts, or DPS calculations. Do not invent those values. For DPS requests, state that this MCP cannot inspect the player's setup or calculate DPS. Never report a DPS value or inferred loadout as Wiki or MCP output. If suggesting another calculator or workflow, label it explicitly as outside this MCP. When a request crosses a boundary, state the limitation directly and provide only the Wiki facts that an available tool can verify.
