import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../../dist/server.js";

const FETCHED_AT = "2026-07-15T00:00:00.000Z";

const searchSource = {
  kind: "search",
  title: "Synthetic search",
  url: "https://oldschool.runescape.wiki/w/Synthetic:Search",
  fetchedAt: FETCHED_AT,
};

function pageSource(title) {
  const encodedTitle = encodeURIComponent(`Synthetic:${title}`);
  return {
    kind: "page",
    title,
    url: `https://oldschool.runescape.wiki/w/${encodedTitle}`,
    pageId: 101,
    revisionId: 202,
    revisionUrl: `https://oldschool.runescape.wiki/w/index.php?title=${encodedTitle}&oldid=202`,
    fetchedAt: FETCHED_AT,
  };
}

function bucketSource(bucket, title) {
  return {
    kind: "bucket",
    ...(title === undefined ? {} : { title }),
    url: `https://oldschool.runescape.wiki/api.php?action=bucket&synthetic=1&query=${bucket}`,
    fetchedAt: FETCHED_AT,
  };
}

function dropRows() {
  return Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    const monster = `Test beast ${number}`;
    return {
      data: {
        page_name: monster,
        item_name: "Test sword",
        drop_json: JSON.stringify({
          "Dropped from": monster,
          Level: String(10 + number),
          Quantity: "1",
          Rarity: `${number}/5`,
        }),
      },
      source: bucketSource("dropsline", monster),
    };
  });
}

function shopRows() {
  return ["Test merchant", "Example trader", "Synthetic vendor"].map((merchant, index) => ({
    data: {
      page_name: `${merchant} shop`,
      sold_item: "Test sword",
      sold_item_json: JSON.stringify({
        "Sold by": merchant,
        "Store location": `Test town ${index + 1}`,
        "Store stock": String(index + 1),
        "Store sell price": `${100 + index} coins`,
      }),
    },
    source: bucketSource("storeline", `${merchant} shop`),
  }));
}

const itemWikitext = `{{Infobox Item
|name=Test sword
|examine=An invented item for synthetic evaluation.
|members=No
|value=100
}}
An invented item used only by the synthetic evaluation fixture.
{{ItemSpawnLine|name=Test sword|location=Test field|100,200|plane=0|mapID=0}}`;

const longPageWikitext = [
  "== Overview ==",
  "Synthetic long-page content. ".repeat(700),
  "== Details ==",
  "More invented content for deterministic section recovery. ".repeat(100),
].join("\n");

const wikiClient = {
  async search(_query, _limit, offset) {
    const results = [
      {
        title: "Test sword",
        pageId: 101,
        snippet: "An invented item page.",
        url: pageSource("Test sword").url,
        source: pageSource("Test sword"),
      },
      {
        title: "Test sword (training)",
        pageId: 102,
        snippet: "A second invented page used to make the title ambiguous.",
        url: pageSource("Test sword (training)").url,
        source: pageSource("Test sword (training)"),
      },
    ];
    return {
      results,
      total: results.length,
      offset,
      fetchedAt: FETCHED_AT,
      source: searchSource,
    };
  },

  async parsePage(title, props, section) {
    const source = pageSource(title);
    let wikitext;
    if (section !== undefined) {
      wikitext = `== Recovered section ==\nRecovered synthetic section ${section}.`;
    } else if (title === "Test sword") {
      wikitext = itemWikitext;
    } else if (title === "Long test page") {
      wikitext = longPageWikitext;
    } else {
      wikitext = `An invented page for ${title}.`;
    }

    return {
      title,
      pageId: source.pageId,
      revisionId: source.revisionId,
      revisionUrl: source.revisionUrl,
      ...(props.includes("wikitext") ? { wikitext } : {}),
      ...(props.includes("sections")
        ? {
            sections: [
              { index: "1", line: "Overview", level: "2", anchor: "Overview" },
              { index: "2", line: "Details", level: "2", anchor: "Details" },
            ],
          }
        : {}),
      source,
      fetchedAt: FETCHED_AT,
    };
  },

  async bucketAll(spec) {
    let rows = [];
    if (spec.bucket === "storeline") {
      rows = shopRows();
    } else if (spec.bucket === "dropsline") {
      rows = dropRows();
    } else if (spec.bucket === "recipe") {
      rows = [{
        data: {
          page_name: "Test sword",
          production_json: JSON.stringify({
            materials: [{ name: "Test bar", quantity: 1 }],
            skills: [{ name: "Smithing", level: 1 }],
            output: { name: "Test sword", quantity: 1 },
          }),
        },
        source: bucketSource("recipe", "Test sword"),
      }];
    } else if (spec.bucket === "infobox_monster") {
      rows = [
        {
          data: {
            page_name: "Test beast",
            page_name_sub: "Test beast#Standard",
            default_version: true,
            name: "Test beast",
            combat_level: 10,
            hitpoints: 20,
            attack_style: "Melee",
          },
          source: bucketSource("infobox_monster", "Test beast"),
        },
        {
          data: {
            page_name: "Test beast",
            page_name_sub: "Test beast#Armoured",
            default_version: false,
            name: "Test beast",
            combat_level: 12,
            hitpoints: 24,
            attack_style: "Ranged",
          },
          source: bucketSource("infobox_monster", "Test beast"),
        },
      ];
    }

    return {
      rows,
      sources: [bucketSource(spec.bucket)],
      rawRowsExamined: rows.length,
      incomplete: false,
      rawCapReached: false,
    };
  },

  async bucketPage() {
    const source = bucketSource("quest");
    return {
      rows: [{
        data: {
          page_name: "Example quest",
          description: "An invented quest for synthetic evaluation.",
          requirements: "* <span data-skill=\"Magic\" data-level=\"1\">1 Magic</span>",
          items_required: "* Test sword",
          json: "{}",
        },
        source: bucketSource("quest", "Example quest"),
      }],
      fetchedAt: FETCHED_AT,
      fromCache: false,
      source,
    };
  },
};

globalThis.fetch = async () => {
  throw new Error("Synthetic evaluation fixture attempted network access.");
};

const server = createServer({
  wikiClient,
  version: "1.1.0",
  logger: { error() {} },
});
await server.connect(new StdioServerTransport());
