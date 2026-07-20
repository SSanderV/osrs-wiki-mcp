import { buildProvenance, type Provenance, type SourceRef } from "../contracts.ts";
import { ToolFailure } from "../errors.ts";
import { capArray } from "../result.ts";
import type {
  BucketPage,
  WikiRequestContext,
} from "../wiki/wiki-client.ts";
import { buildBucketQuery } from "../wiki/wiki-client.ts";
import { cleanWikitext } from "../wiki/wikitext.ts";

const REQUIREMENT_CAP = 200;
const MAX_PUBLIC_INPUT_CHARACTERS = 256;

export interface QuestWikiClient {
  bucketPage(query: string, context: WikiRequestContext): Promise<BucketPage>;
}

export interface SkillRequirement {
  skill: string;
  level: number;
  boostable: boolean | null;
}

export interface QuestRequirementsOutput {
  quest: string;
  description?: string;
  skills: SkillRequirement[];
  questPoints?: number;
  prerequisiteQuests: string[];
  items: string[];
  manualConditions: string[];
  warnings: string[];
  provenance: Provenance;
}

interface QuestAccumulator {
  quest?: string;
  description?: string;
  skills: SkillRequirement[];
  questPoints?: number;
  prerequisiteQuests: string[];
  items: string[];
  manualConditions: string[];
  sources: SourceRef[];
  malformedRows: number;
  validRows: number;
}

export async function getQuestRequirements(
  client: QuestWikiClient,
  quest: string,
  context: WikiRequestContext,
): Promise<QuestRequirementsOutput> {
  const requestedQuest = publicInput(quest);
  const query = buildBucketQuery(
    {
      bucket: "quest",
      select: ["page_name", "description", "requirements", "items_required", "json"],
      where: [["page_name", requestedQuest]],
    },
    5,
    0,
  );
  const page = await client.bucketPage(query, context);
  if (page.rows.length === 0) {
    throw new ToolFailure(
      "NOT_FOUND",
      "The requested quest was not found; use search_wiki to find the canonical title.",
    );
  }

  const accumulator: QuestAccumulator = {
    skills: [],
    prerequisiteQuests: [],
    items: [],
    manualConditions: [],
    sources: [page.source],
    malformedRows: 0,
    validRows: 0,
  };
  for (const row of page.rows) parseQuestRow(row.data, row.source, accumulator);

  if (accumulator.validRows === 0 || accumulator.quest === undefined) {
    throw new ToolFailure(
      "UPSTREAM_INVALID_RESPONSE",
      "The Wiki returned quest rows in an unexpected format.",
    );
  }

  const skills = capArray(
    deduplicate(accumulator.skills, (value) => `${caseFold(value.skill)}\u0000${value.level}`),
    REQUIREMENT_CAP,
    "Skill requirements truncated at 200 entries.",
  );
  const prerequisiteQuests = capArray(
    deduplicate(accumulator.prerequisiteQuests, caseFold),
    REQUIREMENT_CAP,
    "Prerequisite quests truncated at 200 entries.",
  );
  const items = capArray(
    deduplicate(accumulator.items, caseFold),
    REQUIREMENT_CAP,
    "Item requirements truncated at 200 entries.",
  );
  const manualConditions = capArray(
    deduplicate(accumulator.manualConditions, caseFold),
    REQUIREMENT_CAP,
    "Manual conditions truncated at 200 entries.",
  );
  const warnings = [
    ...(accumulator.malformedRows === 0
      ? []
      : [
          `Skipped ${accumulator.malformedRows} malformed upstream quest row${
            accumulator.malformedRows === 1 ? "" : "s"
          }.`,
        ]),
    ...skills.warnings,
    ...prerequisiteQuests.warnings,
    ...items.warnings,
    ...manualConditions.warnings,
  ];

  return {
    quest: accumulator.quest,
    ...(accumulator.description === undefined
      ? {}
      : { description: accumulator.description }),
    skills: skills.value,
    ...(accumulator.questPoints === undefined
      ? {}
      : { questPoints: accumulator.questPoints }),
    prerequisiteQuests: prerequisiteQuests.value,
    items: items.value,
    manualConditions: manualConditions.value,
    warnings,
    provenance: buildProvenance(accumulator.sources),
  };
}

function parseQuestRow(
  value: unknown,
  source: SourceRef,
  accumulator: QuestAccumulator,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    accumulator.malformedRows += 1;
    return;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.page_name !== "string" || typeof row.requirements !== "string") {
    accumulator.malformedRows += 1;
    return;
  }

  const title = cleanWikitext(row.page_name);
  if (title.length === 0) {
    accumulator.malformedRows += 1;
    return;
  }
  accumulator.validRows += 1;
  accumulator.quest ??= title;
  accumulator.sources.push(source);
  if (accumulator.description === undefined && typeof row.description === "string") {
    const description = cleanWikitext(row.description);
    if (description.length > 0) accumulator.description = description;
  }

  parseRequirementLines(row.requirements, accumulator);
  if (typeof row.items_required === "string") {
    for (const line of row.items_required.split(/\r?\n/gu)) {
      const item = cleanListLine(line);
      if (item.length > 0 && caseFold(item) !== "none") accumulator.items.push(item);
    }
  }
}

function parseRequirementLines(value: string, accumulator: QuestAccumulator): void {
  let prerequisiteDepth: number | undefined;

  for (const rawLine of value.split(/\r?\n/gu)) {
    const marker = /^\s*([*#:;]+)\s*(.*?)\s*$/u.exec(rawLine);
    const markerDepth = marker?.[1]?.length ?? 0;
    const body = marker?.[2] ?? rawLine.trim();
    if (body.length === 0) continue;

    const skill = attribute(body, "data-skill");
    const levelText = attribute(body, "data-level");
    const level = levelText === undefined ? Number.NaN : Number(levelText.replaceAll(",", ""));
    if (skill !== undefined && Number.isInteger(level) && level > 0) {
      accumulator.skills.push({
        skill: cleanWikitext(skill),
        level,
        boostable: /\bnot\s+boostable\b/iu.test(cleanWikitext(body)) ? false : null,
      });
      continue;
    }

    const cleaned = cleanWikitext(body);
    const points = /\b(\d[\d,]*)\s+Quest points?\b/iu.exec(cleaned);
    if (points?.[1]) {
      const parsed = Number(points[1].replaceAll(",", ""));
      if (Number.isInteger(parsed)) {
        accumulator.questPoints = Math.max(accumulator.questPoints ?? 0, parsed);
        continue;
      }
    }

    if (/^Completion of the following quests:?$/iu.test(cleaned)) {
      prerequisiteDepth = markerDepth;
      continue;
    }

    if (prerequisiteDepth !== undefined && markerDepth > prerequisiteDepth) {
      const prerequisite = exactWikiLink(body);
      if (prerequisite !== undefined) accumulator.prerequisiteQuests.push(prerequisite);
      else if (cleaned.length > 0) accumulator.manualConditions.push(cleaned);
      continue;
    }
    prerequisiteDepth = undefined;
    if (cleaned.length > 0) accumulator.manualConditions.push(cleaned);
  }
}

function attribute(value: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "iu").exec(value);
  return match?.[2];
}

function exactWikiLink(value: string): string | undefined {
  const match = /^\s*\[\[\s*([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]+)?\]\]\s*$/u.exec(value);
  if (!match?.[1]) return undefined;
  const title = cleanWikitext(match[1]);
  return title.length === 0 ? undefined : title;
}

function cleanListLine(value: string): string {
  return cleanWikitext(value.replace(/^\s*[*#:;]+\s*/u, ""));
}

function deduplicate<T>(values: readonly T[], identity: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = identity(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function caseFold(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function publicInput(value: string): string {
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length === 0 || length > MAX_PUBLIC_INPUT_CHARACTERS) {
    throw new RangeError("Quest must contain from 1 through 256 Unicode characters.");
  }
  return normalized;
}
