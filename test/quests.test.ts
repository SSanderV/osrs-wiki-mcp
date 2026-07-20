import assert from "node:assert/strict";
import test from "node:test";

import type { SourceRef } from "../src/contracts.ts";
import { ToolFailure } from "../src/errors.ts";
import { Deadline } from "../src/http/deadline.ts";
import {
  getQuestRequirements,
  type QuestWikiClient,
} from "../src/domain/quests.ts";
import type {
  BucketPage,
  RawBucketRow,
  WikiRequestContext,
} from "../src/wiki/wiki-client.ts";
import { FakeClock } from "./helpers/fake-clock.ts";

const fetchedAt = "2026-07-15T00:00:00.000Z";
const requestSource: SourceRef = {
  kind: "bucket",
  url: "https://oldschool.runescape.wiki/api.php?action=bucket&query=synthetic-quest",
  fetchedAt,
};

function pageSource(title = "Example quest"): SourceRef {
  return {
    kind: "bucket",
    title,
    url: `https://oldschool.runescape.wiki/w/${title.replaceAll(" ", "_")}`,
    fetchedAt,
  };
}

function questRow(overrides: Record<string, unknown> = {}): RawBucketRow {
  return {
    data: {
      page_name: "Example quest",
      description: "An invented quest.",
      requirements: `* <span data-skill="Magic" data-level="75">75 Magic</span> (not boostable)
* <span data-level="60" data-skill="Agility">60 Agility</span>
* 200 Quest points
* Completion of the following quests:
** [[Example prequest]]
** 100 [[Kudos]]
* Complete the [[Example training]] exercise`,
      items_required: `* [[Test key]]
* 3 [[Test bar|test bars]]
* [[Test rope]] or [[Alternative rope]]`,
      json: "{}",
      ...overrides,
    },
    source: pageSource(),
  };
}

function page(rows: RawBucketRow[]): BucketPage {
  return {
    rows,
    fetchedAt,
    fromCache: false,
    source: requestSource,
  };
}

function context(): WikiRequestContext {
  const clock = new FakeClock();
  return { toolDeadline: Deadline.after(clock, 30_000) };
}

function clientReturning(
  result: BucketPage,
  capture?: (query: string) => void,
): QuestWikiClient {
  return {
    async bucketPage(query) {
      capture?.(query);
      return result;
    },
  };
}

test("get_quest_requirements returns Wiki facts without evaluating a player", async () => {
  let query = "";
  const result = await getQuestRequirements(
    clientReturning(page([questRow()]), (value) => {
      query = value;
    }),
    "Example quest",
    context(),
  );

  assert.equal(
    query,
    "bucket('quest').select('page_name','description','requirements','items_required','json').where('page_name','Example quest').limit(5).offset(0).run()",
  );
  assert.deepEqual(result.skills, [
    { skill: "Magic", level: 75, boostable: false },
    { skill: "Agility", level: 60, boostable: null },
  ]);
  assert.equal(result.questPoints, 200);
  assert.deepEqual(result.prerequisiteQuests, ["Example prequest"]);
  assert.deepEqual(result.items, [
    "Test key",
    "3 test bars",
    "Test rope or Alternative rope",
  ]);
  assert.deepEqual(result.manualConditions, [
    "100 Kudos",
    "Complete the Example training exercise",
  ]);
  assert.equal(result.provenance.sources.some((source) => source.title === "Example quest"), true);

  const bannedKeys = new Set([
    "player",
    "met",
    "missing",
    "unmet",
    "current",
    "evaluationStatus",
    "unavailable",
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(bannedKeys.has(key), false, `unexpected player-evaluation key: ${key}`);
      visit(nested);
    }
  };
  visit(result);
});

test("malformed quest rows are skipped with a warning", async () => {
  const malformed: RawBucketRow = {
    data: { page_name: "Example quest", requirements: 42 },
    source: pageSource(),
  };
  const result = await getQuestRequirements(
    clientReturning(page([malformed, questRow()])),
    "Example quest",
    context(),
  );

  assert.match(result.warnings.join(" "), /Skipped 1 malformed upstream quest row/);
  assert.equal(result.skills.length, 2);
});

test("every quest-requirement list is capped at 200 with warnings", async () => {
  const skills = Array.from(
    { length: 205 },
    (_unused, index) =>
      `* <span data-skill="Test skill ${index}" data-level="${index + 1}">${index + 1}</span>`,
  ).join("\n");
  const quests = [
    "* Completion of the following quests:",
    ...Array.from({ length: 205 }, (_unused, index) => `** [[Test quest ${index}]]`),
  ].join("\n");
  const manual = Array.from(
    { length: 205 },
    (_unused, index) => `* Manual condition ${index}`,
  ).join("\n");
  const items = Array.from({ length: 205 }, (_unused, index) => `* Test item ${index}`).join(
    "\n",
  );
  const result = await getQuestRequirements(
    clientReturning(
      page([
        questRow({
          requirements: `${skills}\n${quests}\n${manual}`,
          items_required: items,
        }),
      ]),
    ),
    "Example quest",
    context(),
  );

  assert.equal(result.skills.length, 200);
  assert.equal(result.prerequisiteQuests.length, 200);
  assert.equal(result.manualConditions.length, 200);
  assert.equal(result.items.length, 200);
  assert.equal(result.warnings.filter((warning) => /truncated/u.test(warning)).length, 4);
});

test("a missing quest row maps to NOT_FOUND with search guidance", async () => {
  await assert.rejects(
    getQuestRequirements(clientReturning(page([])), "Absent quest", context()),
    (error: unknown) =>
      error instanceof ToolFailure &&
      error.code === "NOT_FOUND" &&
      error.message.includes("search_wiki"),
  );
});
