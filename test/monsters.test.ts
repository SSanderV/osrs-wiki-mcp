import assert from "node:assert/strict";
import test from "node:test";

import type { SourceRef } from "../src/contracts.ts";
import { ToolFailure } from "../src/errors.ts";
import { Deadline } from "../src/http/deadline.ts";
import {
  getMonsterInfo,
  type MonsterWikiClient,
} from "../src/domain/monsters.ts";
import type {
  BucketQuerySpec,
  BucketScan,
  ParsedPage,
  RawBucketRow,
  WikiRequestContext,
} from "../src/wiki/wiki-client.ts";
import { FakeClock } from "./helpers/fake-clock.ts";

const fetchedAt = "2026-07-15T00:00:00.000Z";

function source(title = "Test beast"): SourceRef {
  return {
    kind: "bucket",
    title,
    url: `https://oldschool.runescape.wiki/w/${title.replaceAll(" ", "_")}`,
    fetchedAt,
  };
}

function requestSource(bucket: string): SourceRef {
  return {
    kind: "bucket",
    url: `https://oldschool.runescape.wiki/api.php?action=bucket&query=${bucket}`,
    fetchedAt,
  };
}

function monsterRow(anchor: string, overrides: Record<string, unknown> = {}): RawBucketRow {
  return {
    data: {
      page_name: "Test beast",
      page_name_sub: `Test beast#${anchor}`,
      default_version: anchor === "Post-quest",
      name: "Test beast",
      is_members_only: true,
      combat_level: anchor === "Post-quest" ? 100 : 50,
      hitpoints: anchor === "Post-quest" ? 200 : 100,
      max_hit: anchor === "Post-quest" ? 30 : 15,
      attack_style: "Melee, Magic",
      attack_speed: 4,
      attack_level: 80,
      strength_level: 90,
      defence_level: 70,
      ranged_level: 1,
      magic_level: 60,
      venom_immune: true,
      thrall_immune: false,
      cannon_immune: true,
      freeze_resistance: 50,
      elemental_weakness: "Water",
      elemental_weakness_percent: 40,
      slayer_level: 80,
      slayer_experience: 125,
      slayer_category: "Test beasts",
      assigned_by: "Master Alpha, Master Beta",
      ...overrides,
    },
    source: source(),
  };
}

function mapRow(features: unknown, overrides: Record<string, unknown> = {}): RawBucketRow {
  return {
    data: {
      page_name: "Test beast",
      features: JSON.stringify(features),
      options: JSON.stringify({ plane: 1, mapID: 2 }),
      is_historic: false,
      ...overrides,
    },
    source: source(),
  };
}

function scan(bucket: string, rows: RawBucketRow[], incomplete = false): BucketScan {
  return {
    rows,
    sources: [requestSource(bucket)],
    rawRowsExamined: rows.length,
    incomplete,
    rawCapReached: false,
    ...(incomplete
      ? {
          failedRawOffset: rows.length,
          warning: `Upstream pagination failed after ${rows.length} raw rows; retry the same tool call. Completed upstream pages may be reused from cache.`,
        }
      : {}),
  };
}

function parsedPage(wikitext = "Ordinary monster page."): ParsedPage {
  const pageSource: SourceRef = {
    kind: "page",
    title: "Test beast",
    url: "https://oldschool.runescape.wiki/w/Test_beast",
    pageId: 100,
    revisionId: 200,
    revisionUrl:
      "https://oldschool.runescape.wiki/w/index.php?title=Test+beast&oldid=200",
    fetchedAt,
  };
  return {
    title: "Test beast",
    pageId: 100,
    revisionId: 200,
    revisionUrl: pageSource.revisionUrl!,
    wikitext,
    source: pageSource,
    fetchedAt,
  };
}

function context(): WikiRequestContext {
  const clock = new FakeClock();
  return { toolDeadline: Deadline.after(clock, 30_000) };
}

function clientWith(options: {
  monsterRows?: RawBucketRow[];
  mapRows?: RawBucketRow[];
  page?: ParsedPage;
  mapFailure?: boolean;
  pageFailure?: boolean;
  capture?: (spec: BucketQuerySpec) => void;
} = {}): MonsterWikiClient {
  return {
    async bucketAll(spec) {
      options.capture?.(spec);
      if (spec.bucket === "map") {
        if (options.mapFailure) {
          throw new ToolFailure("UPSTREAM_UNAVAILABLE", "synthetic map failure");
        }
        return scan("map", options.mapRows ?? []);
      }
      return scan("infobox_monster", options.monsterRows ?? []);
    },
    async parsePage() {
      if (options.pageFailure) {
        throw new ToolFailure("UPSTREAM_UNAVAILABLE", "synthetic page failure");
      }
      return options.page ?? parsedPage();
    },
  };
}

test("get_monster_info preserves every variant and uses the reviewed fields", async () => {
  const specs: BucketQuerySpec[] = [];
  const result = await getMonsterInfo(
    clientWith({
      monsterRows: [monsterRow("Quest encounter"), monsterRow("Post-quest")],
      capture: (spec) => specs.push(spec),
    }),
    { monster: "Test beast" },
    context(),
  );

  assert.deepEqual(
    result.variants.map((variant) => variant.anchor),
    ["Post-quest", "Quest encounter"],
  );
  assert.deepEqual(
    result.variants.map((variant) => variant.hitpoints),
    [200, 100],
  );
  const monsterSpec = specs.find((spec) => spec.bucket === "infobox_monster");
  assert.deepEqual(monsterSpec?.where, [["name", "Test beast"]]);
  assert.equal(monsterSpec?.select.includes("page_name_sub"), true);
  assert.equal(monsterSpec?.select.includes("magic_defence_bonus"), true);
  assert.equal(monsterSpec?.select.includes("assigned_by"), true);
});

test("variant filter is exact and case-insensitive", async () => {
  const result = await getMonsterInfo(
    clientWith({
      monsterRows: [monsterRow("Quest encounter"), monsterRow("Post-quest")],
    }),
    { monster: "Test beast", variant: "post-QUEST" },
    context(),
  );

  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0]?.anchor, "Post-quest");
  assert.equal(result.variants[0]?.combatLevel, 100);
});

test("immunities, weaknesses, and Slayer data remain variant-specific", async () => {
  const result = await getMonsterInfo(
    clientWith({ monsterRows: [monsterRow("Post-quest")] }),
    { monster: "Test beast" },
    context(),
  );
  const variant = result.variants[0]!;

  assert.deepEqual(variant.immunities, {
    venom: true,
    thralls: false,
    cannon: true,
  });
  assert.deepEqual(variant.weakness, { element: "Water", percent: 40 });
  assert.deepEqual(variant.slayer, {
    level: 80,
    experience: 125,
    category: "Test beasts",
    assignedBy: ["Master Alpha", "Master Beta"],
  });
  assert.equal(variant.resistances?.freeze, 50);
});

test("valid map points survive malformed optional map rows with warnings", async () => {
  const result = await getMonsterInfo(
    clientWith({
      monsterRows: [monsterRow("Post-quest")],
      mapRows: [
        mapRow([
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [3200, 3201] },
            properties: { plane: 2, mapID: 3 },
          },
        ]),
        mapRow([{ geometry: { type: "LineString", coordinates: [] } }]),
      ],
    }),
    { monster: "Test beast" },
    context(),
  );

  assert.deepEqual(result.mapPoints, [
    { x: 3200, y: 3201, plane: 2, mapId: 3, historic: false },
  ]);
  assert.match(result.warnings.join(" "), /malformed map row/);
});

test("page-level access notes carry required revision provenance", async () => {
  const result = await getMonsterInfo(
    clientWith({
      monsterRows: [monsterRow("Post-quest")],
      page: parsedPage(`{{Infobox Monster
|name=Test beast
|quest=[[Example quest]]
|access=Complete [[Example quest]] to enter.
}}
{{Infobox Monster|name=Test beast|quest=[[Example quest]]}}`),
    }),
    { monster: "Test beast" },
    context(),
  );

  assert.deepEqual(result.accessNotes, [
    "Example quest",
    "Complete Example quest to enter.",
  ]);
  assert.equal(result.provenance.sources.some((entry) => entry.revisionId === 200), true);
});

test("optional map and page failures degrade without losing variants", async () => {
  const result = await getMonsterInfo(
    clientWith({
      monsterRows: [monsterRow("Post-quest")],
      mapFailure: true,
      pageFailure: true,
    }),
    { monster: "Test beast" },
    context(),
  );

  assert.equal(result.variants.length, 1);
  assert.match(result.warnings.join(" "), /Map data unavailable/);
  assert.match(result.warnings.join(" "), /Access notes unavailable/);
});

test("variant and map caps are explicit and the result contains no DPS fields", async () => {
  const monsters = Array.from({ length: 105 }, (_unused, index) =>
    monsterRow(`Variant ${String(index).padStart(3, "0")}`),
  );
  const features = Array.from({ length: 205 }, (_unused, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [index, index + 1] },
    properties: { plane: 0, mapID: 0 },
  }));
  const result = await getMonsterInfo(
    clientWith({ monsterRows: monsters, mapRows: [mapRow(features)] }),
    { monster: "Test beast" },
    context(),
  );

  assert.equal(result.variants.length, 100);
  assert.equal(result.totalVariants, 105);
  assert.equal(result.mapPoints.length, 200);
  assert.match(result.warnings.join(" "), /variants truncated/i);
  assert.match(result.warnings.join(" "), /map points truncated/i);
  const serialized = JSON.stringify(result);
  assert.equal(/dps|damagePerSecond|timeToKill/iu.test(serialized), false);
});

test("missing monsters and unknown exact variants map to NOT_FOUND", async (t) => {
  await t.test("missing monster", async () => {
    await assert.rejects(
      getMonsterInfo(clientWith(), { monster: "Absent beast" }, context()),
      (error: unknown) =>
        error instanceof ToolFailure &&
        error.code === "NOT_FOUND" &&
        error.message.includes("search_wiki"),
    );
  });

  await t.test("unknown variant", async () => {
    await assert.rejects(
      getMonsterInfo(
        clientWith({ monsterRows: [monsterRow("Post-quest")] }),
        { monster: "Test beast", variant: "Unknown" },
        context(),
      ),
      (error: unknown) => error instanceof ToolFailure && error.code === "NOT_FOUND",
    );
  });
});
