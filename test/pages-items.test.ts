import assert from "node:assert/strict";
import test from "node:test";

import type { SourceRef } from "../src/contracts.ts";
import { ToolFailure } from "../src/errors.ts";
import { Deadline } from "../src/http/deadline.ts";
import { getItemInfo } from "../src/domain/items.ts";
import {
  getWikiPage,
  getWikiSection,
  getWikiSections,
  searchWiki,
  type PageWikiClient,
} from "../src/domain/pages.ts";
import type {
  ParsedPage,
  SearchResult,
  WikiRequestContext,
} from "../src/wiki/wiki-client.ts";
import { FakeClock } from "./helpers/fake-clock.ts";

const fetchedAt = "2026-07-15T00:00:00.000Z";

function pageSource(title = "Test sword"): SourceRef {
  return {
    kind: "page",
    title,
    url: `https://oldschool.runescape.wiki/w/${title.replaceAll(" ", "_")}`,
    pageId: 100,
    revisionId: 200,
    revisionUrl: `https://oldschool.runescape.wiki/w/index.php?title=${title.replaceAll(" ", "+")}&oldid=200`,
    fetchedAt,
  };
}

function searchSource(): SourceRef {
  return {
    kind: "search",
    url: "https://oldschool.runescape.wiki/api.php?action=query&list=search",
    fetchedAt,
  };
}

function context(): WikiRequestContext {
  const clock = new FakeClock();
  return { toolDeadline: Deadline.after(clock, 30_000) };
}

function parsedPage(overrides: Partial<ParsedPage> = {}): ParsedPage {
  const title = overrides.title ?? "Test sword";
  const source = overrides.source ?? pageSource(title);
  return {
    title,
    pageId: 100,
    revisionId: 200,
    revisionUrl: source.revisionUrl!,
    source,
    fetchedAt,
    ...overrides,
  };
}

function clientWith(options: {
  search?: SearchResult;
  parsed?: ParsedPage;
  parseError?: unknown;
}): PageWikiClient {
  return {
    async search() {
      if (!options.search) throw new Error("Unexpected search call");
      return options.search;
    },
    async parsePage() {
      if (options.parseError) throw options.parseError;
      if (!options.parsed) throw new Error("Unexpected parse call");
      return options.parsed;
    },
  };
}

test("search_wiki returns normalized results and response provenance", async () => {
  const rowSource: SourceRef = {
    kind: "search",
    title: "Test sword",
    url: "https://oldschool.runescape.wiki/w/Test_sword",
    pageId: 101,
    fetchedAt,
  };
  const result = await searchWiki(
    clientWith({
      search: {
        results: [
          {
            title: "Test sword",
            pageId: 101,
            snippet: "An invented result.",
            url: rowSource.url,
            source: rowSource,
          },
        ],
        total: 1,
        offset: 0,
        fetchedAt,
        source: searchSource(),
      },
    }),
    "Test sword",
    10,
    0,
    context(),
  );

  assert.deepEqual(result.results[0], {
    title: "Test sword",
    pageId: 101,
    snippet: "An invented result.",
    url: "https://oldschool.runescape.wiki/w/Test_sword",
  });
  assert.equal(result.total, 1);
  assert.equal(result.provenance.sources.length, 2);
  assert.equal(result.provenance.fetchedAt, fetchedAt);
});

test("get_wiki_page caps cleaned content at 16,000 Unicode characters", async () => {
  const result = await getWikiPage(
    clientWith({
      parsed: parsedPage({
        wikitext: `== Overview ==\n${"😀".repeat(16_100)}`,
        sections: [{ index: "1", line: "Overview", level: "2" }],
      }),
    }),
    "Test sword",
    context(),
  );

  assert.equal([...result.content].length, 16_000);
  assert.equal(result.totalCharacters, 16_112);
  assert.equal(result.truncated, true);
  assert.match(result.warnings[0] ?? "", /get_wiki_sections/);
  assert.match(result.warnings[0] ?? "", /get_wiki_section/);
  assert.equal(result.sections[0]?.name, "Overview");
});

test("get_wiki_sections caps the section list at 200 with totals", async () => {
  const sections = Array.from({ length: 205 }, (_unused, index) => ({
    index: String(index + 1),
    line: `Section ${index + 1}`,
    level: "2",
    anchor: `Section_${index + 1}`,
  }));
  const result = await getWikiSections(
    clientWith({ parsed: parsedPage({ sections }) }),
    "Test sword",
    context(),
  );

  assert.equal(result.sections.length, 200);
  assert.equal(result.total, 205);
  assert.equal(result.returned, 200);
  assert.equal(result.truncated, true);
  assert.match(result.warnings[0] ?? "", /200/);
});

test("get_wiki_section uses MediaWiki section identity and caps its body", async () => {
  let capturedSection: string | undefined;
  const client: PageWikiClient = {
    async search() {
      throw new Error("Unexpected search call");
    },
    async parsePage(_title, _props, section) {
      capturedSection = section;
      return parsedPage({ wikitext: "x".repeat(16_001) });
    },
  };

  const result = await getWikiSection(client, "Test sword", "3", context());

  assert.equal(capturedSection, "3");
  assert.equal(result.content.length, 16_000);
  assert.equal(result.truncated, true);
  assert.match(result.warnings[0] ?? "", /Section content truncated/);
});

test("get_item_info normalizes infoboxes and does not invent alchemy values", async () => {
  const wikitext = `{{Infobox Item
|name=Test sword
|members=Yes
|tradeable=No
|equipable=Yes
|stackable=No
|noteable=Yes
|quest=No
|value=1,000
|highalch=No
|lowalch=No
|weight=1.5
|examine=An [[invented item|invented sword]].
}}
{{Infobox Bonuses
|astab=10
|aslash=20
|acrush=-2
|amagic=0
|arange=1
|dstab=3
|dslash=4
|dcrush=5
|dmagic=6
|drange=7
|str=8
|rstr=9
|mdmg=2
|prayer=1
}}
{{Infobox Creation
|materials=2 × [[Test bar]]
|skills=20 [[Smithing]]
|facility=[[Anvil]]
}}
The '''Test sword''' is an [[invented blade]] used for tests.
== Combat ==
More details.`;
  const result = await getItemInfo(
    clientWith({ parsed: parsedPage({ wikitext }) }),
    "Test sword",
    context(),
  );

  assert.equal(result.name, "Test sword");
  assert.equal(result.description, "The Test sword is an invented blade used for tests.");
  assert.equal(result.examine, "An invented sword.");
  assert.equal(result.members, true);
  assert.equal(result.tradeable, false);
  assert.equal(result.value, 1_000);
  assert.equal("highAlchemy" in result, false);
  assert.equal("lowAlchemy" in result, false);
  assert.equal(result.bonuses?.attackStab, 10);
  assert.equal(result.bonuses?.meleeStrength, 8);
  assert.deepEqual(result.creation, {
    materials: "2 × Test bar",
    skills: "20 Smithing",
    facility: "Anvil",
  });
  assert.equal(result.provenance.sources[0]?.revisionId, 200);
});

test("missing pages and item infoboxes map to NOT_FOUND with search guidance", async (t) => {
  await t.test("missing page", async () => {
    await assert.rejects(
      getWikiPage(
        clientWith({
          parseError: new ToolFailure("NOT_FOUND", "missing"),
        }),
        "Absent page",
        context(),
      ),
      (error: unknown) =>
        error instanceof ToolFailure &&
        error.code === "NOT_FOUND" &&
        error.message.includes("search_wiki"),
    );
  });

  await t.test("page without item infobox", async () => {
    await assert.rejects(
      getItemInfo(
        clientWith({ parsed: parsedPage({ wikitext: "Ordinary page text." }) }),
        "Ordinary page",
        context(),
      ),
      (error: unknown) =>
        error instanceof ToolFailure &&
        error.code === "NOT_FOUND" &&
        error.message.includes("search_wiki"),
    );
  });
});
