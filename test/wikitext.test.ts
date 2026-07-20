import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanWikitext,
  findTemplates,
  parseInfobox,
  removeTemplates,
} from "../src/wiki/wikitext.ts";

test("template extraction respects nested brace depth", () => {
  const source = `Before
{{Infobox Item
|name={{plink|Test sword}}
|examine=An [[invented item|invented sword]].
}}
After`;

  const templates = findTemplates(source, ["Infobox Item"]);

  assert.equal(templates.length, 1);
  assert.equal(templates[0]?.name, "Infobox Item");
  assert.equal(templates[0]?.parameters.name, "{{plink|Test sword}}");
  assert.equal(
    templates[0]?.parameters.examine,
    "An [[invented item|invented sword]].",
  );
});

test("ordinary Wiki links keep their display text", () => {
  assert.equal(
    cleanWikitext("Use the [[Test blade|display blade]] with [[Test bar]]."),
    "Use the display blade with Test bar.",
  );
});

test("file and image links are removed with their captions", () => {
  assert.equal(
    cleanWikitext(
      "Before [[File:Test.png|thumb|A [[nested caption]]]] middle [[Image:Other.png|20px]] after.",
    ),
    "Before middle after.",
  );
});

test("comments, references, tables, and HTML tags are removed", () => {
  const source = `Lead<!-- hidden --><ref name="a">citation</ref> text.<br>
{| class="wikitable"
| hidden table
|}
Tail<ref name="b" />.`;

  assert.equal(cleanWikitext(source), "Lead text.\nTail.");
});

test("headings are preserved as bounded Markdown structure", () => {
  assert.equal(
    cleanWikitext("== Overview ==\nText\n=== Details ===\nMore", {
      preserveHeadings: true,
    }),
    "## Overview\nText\n### Details\nMore",
  );
});

test("infobox parameters split only at top-level separators", () => {
  const infobox = parseInfobox(
    `{{Infobox Item
|name=Test sword
|examine=Uses {{SCP|a=b|c=d}} and [[Test|display]].
|value=1,000
}}`,
    "Infobox Item",
  );

  assert.equal(infobox?.name, "Infobox Item");
  assert.equal(infobox?.parameters.name, "Test sword");
  assert.equal(
    infobox?.parameters.examine,
    "Uses {{SCP|a=b|c=d}} and [[Test|display]].",
  );
  assert.equal(infobox?.parameters.value, "1,000");
});

test("top-level templates can be removed without consuming surrounding prose", () => {
  assert.equal(
    removeTemplates("Before {{Outer|nested={{Inner|x}}}} after."),
    "Before  after.",
  );
});
