import {
  SourceRefSchema,
  buildProvenance,
  type Provenance,
  type SourceRef,
} from "../contracts.ts";
import { ToolFailure } from "../errors.ts";
import { capArray } from "../result.ts";
import type {
  BucketQuerySpec,
  BucketScan,
  ParsedPage,
  RawBucketRow,
  WikiRequestContext,
} from "../wiki/wiki-client.ts";
import { cleanWikitext, findTemplates } from "../wiki/wikitext.ts";

const MAX_PUBLIC_INPUT_CHARACTERS = 256;
const VARIANT_CAP = 100;
const MAP_POINT_CAP = 200;
const ACCESS_NOTE_CAP = 200;

const MONSTER_FIELDS = [
  "page_name",
  "page_name_sub",
  "default_version",
  "name",
  "is_members_only",
  "combat_level",
  "hitpoints",
  "max_hit",
  "attribute",
  "attack_style",
  "attack_speed",
  "attack_level",
  "strength_level",
  "defence_level",
  "ranged_level",
  "magic_level",
  "stab_attack_bonus",
  "slash_attack_bonus",
  "crush_attack_bonus",
  "range_attack_bonus",
  "magic_attack_bonus",
  "stab_defence_bonus",
  "slash_defence_bonus",
  "crush_defence_bonus",
  "range_defence_bonus",
  "light_range_defence_bonus",
  "standard_range_defence_bonus",
  "heavy_range_defence_bonus",
  "magic_defence_bonus",
  "strength_bonus",
  "range_strength_bonus",
  "magic_damage_bonus",
  "flat_armour",
  "poison_resistance",
  "venom_immune",
  "thrall_immune",
  "cannon_immune",
  "burn_immune",
  "freeze_resistance",
  "elemental_weakness",
  "elemental_weakness_percent",
  "slayer_level",
  "slayer_experience",
  "slayer_category",
  "assigned_by",
] as const;

export interface MonsterWikiClient {
  bucketAll(spec: BucketQuerySpec, context: WikiRequestContext): Promise<BucketScan>;
  parsePage(
    title: string,
    props: readonly ["wikitext"],
    section: undefined,
    context: WikiRequestContext,
  ): Promise<ParsedPage>;
}

export interface MonsterLevels {
  attack?: number;
  strength?: number;
  defence?: number;
  ranged?: number;
  magic?: number;
}

export interface MonsterBonuses {
  stab?: number;
  slash?: number;
  crush?: number;
  ranged?: number;
  magic?: number;
}

export interface MonsterDefenceBonuses extends MonsterBonuses {
  rangedLight?: number;
  rangedStandard?: number;
  rangedHeavy?: number;
}

export interface MonsterImmunities {
  venom?: boolean;
  thralls?: boolean;
  cannon?: boolean;
  burn?: boolean;
}

export interface MonsterResistances {
  poison?: number;
  freeze?: number;
}

export interface MonsterWeakness {
  element: string;
  percent?: number;
}

export interface MonsterSlayer {
  level?: number;
  experience?: number;
  category?: string;
  assignedBy?: string[];
}

export interface MonsterVariant {
  name: string;
  page: string;
  anchor: string;
  url: string;
  defaultVersion?: boolean;
  members?: boolean;
  combatLevel?: number;
  hitpoints?: number;
  maxHit?: number;
  attributes: string[];
  attackStyles: string[];
  attackSpeed?: number;
  levels?: MonsterLevels;
  attackBonuses?: MonsterBonuses;
  defenceBonuses?: MonsterDefenceBonuses;
  meleeStrengthBonus?: number;
  rangedStrengthBonus?: number;
  magicDamageBonus?: number;
  flatArmour?: number;
  immunities?: MonsterImmunities;
  resistances?: MonsterResistances;
  weakness?: MonsterWeakness;
  slayer?: MonsterSlayer;
}

export interface MonsterMapPoint {
  x: number;
  y: number;
  plane: number;
  mapId: number;
  historic: boolean;
}

export interface MonsterInfoInput {
  monster: string;
  variant?: string;
}

export interface MonsterInfoOutput {
  monster: string;
  selectedVariant?: string;
  variants: MonsterVariant[];
  totalVariants: number;
  totalVariantsIsExact: boolean;
  variantsTruncated: boolean;
  mapPoints: MonsterMapPoint[];
  accessNotes: string[];
  warnings: string[];
  provenance: Provenance;
}

interface VariantEntry {
  value: MonsterVariant;
  source: SourceRef;
}

interface MapPointEntry {
  value: MonsterMapPoint;
  source: SourceRef;
}

export async function getMonsterInfo(
  client: MonsterWikiClient,
  input: MonsterInfoInput,
  context: WikiRequestContext,
): Promise<MonsterInfoOutput> {
  const monster = publicInput(input.monster, "Monster");
  const requestedVariant =
    input.variant === undefined ? undefined : publicInput(input.variant, "Variant");
  const monsterScan = await client.bucketAll(
    {
      bucket: "infobox_monster",
      select: MONSTER_FIELDS,
      where: [["name", monster]],
    },
    context,
  );
  const normalized = normalizeMonsterRows(monsterScan.rows);
  if (normalized.entries.length === 0) {
    throw new ToolFailure(
      "NOT_FOUND",
      "The requested monster was not found; use search_wiki to find the canonical title.",
    );
  }

  const matching =
    requestedVariant === undefined
      ? normalized.entries
      : normalized.entries.filter(
          (entry) => caseFold(entry.value.anchor) === caseFold(requestedVariant),
        );
  if (matching.length === 0) {
    throw new ToolFailure(
      "NOT_FOUND",
      "The requested exact monster variant was not found; omit variant to list available variants.",
    );
  }
  const cappedVariants = capArray(
    matching,
    VARIANT_CAP,
    "Monster variants truncated at 100 entries.",
  );
  const warnings = [
    ...normalized.warnings,
    ...(monsterScan.warning ? [monsterScan.warning] : []),
    ...cappedVariants.warnings,
  ];
  const sources: SourceRef[] = [
    ...monsterScan.sources,
    ...cappedVariants.value.map((entry) => entry.source),
  ];

  let mapEntries: MapPointEntry[] = [];
  try {
    const mapScan = await client.bucketAll(
      {
        bucket: "map",
        select: ["page_name", "features", "options", "is_historic"],
        where: [["page_name", monster]],
      },
      context,
    );
    const maps = normalizeMapRows(mapScan.rows);
    mapEntries = maps.entries;
    sources.push(...mapScan.sources);
    warnings.push(...maps.warnings);
    if (mapScan.warning) warnings.push(mapScan.warning);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    warnings.push("Map data unavailable; monster variants remain usable.");
  }
  const cappedMapPoints = capArray(
    mapEntries,
    MAP_POINT_CAP,
    "Monster map points truncated at 200 entries.",
  );
  warnings.push(...cappedMapPoints.warnings);
  sources.push(...cappedMapPoints.value.map((entry) => entry.source));

  let accessNotes: string[] = [];
  try {
    const page = await client.parsePage(monster, ["wikitext"], undefined, context);
    const notes = normalizeAccessNotes(page);
    const cappedNotes = capArray(
      notes,
      ACCESS_NOTE_CAP,
      "Monster access notes truncated at 200 entries.",
    );
    accessNotes = cappedNotes.value;
    warnings.push(...cappedNotes.warnings);
    sources.push(page.source);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    warnings.push("Access notes unavailable; Bucket monster variants remain usable.");
  }

  return {
    monster,
    ...(requestedVariant === undefined ? {} : { selectedVariant: requestedVariant }),
    variants: cappedVariants.value.map((entry) => entry.value),
    totalVariants: normalized.entries.length,
    totalVariantsIsExact: !monsterScan.incomplete,
    variantsTruncated: cappedVariants.truncated,
    mapPoints: cappedMapPoints.value.map((entry) => entry.value),
    accessNotes,
    warnings,
    provenance: buildProvenance(sources),
  };
}

function normalizeMonsterRows(rows: readonly RawBucketRow[]): {
  entries: VariantEntry[];
  warnings: string[];
} {
  const entries: VariantEntry[] = [];
  const seen = new Set<string>();
  let malformedRows = 0;

  for (const row of rows) {
    const data = objectValue(row.data);
    const page = stringValue(data?.page_name) ?? row.source.title;
    const name = stringValue(data?.name);
    if (!data || !page || !name) {
      malformedRows += 1;
      continue;
    }
    const anchor = variantAnchor(data, page);
    const source = variantSource(row.source, page, anchor);
    const levels = optionalObject<MonsterLevels>({
      ...optionalNumber("attack", data.attack_level),
      ...optionalNumber("strength", data.strength_level),
      ...optionalNumber("defence", data.defence_level),
      ...optionalNumber("ranged", data.ranged_level),
      ...optionalNumber("magic", data.magic_level),
    });
    const attackBonuses = optionalObject<MonsterBonuses>({
      ...optionalNumber("stab", data.stab_attack_bonus),
      ...optionalNumber("slash", data.slash_attack_bonus),
      ...optionalNumber("crush", data.crush_attack_bonus),
      ...optionalNumber("ranged", data.range_attack_bonus),
      ...optionalNumber("magic", data.magic_attack_bonus),
    });
    const defenceBonuses = optionalObject<MonsterDefenceBonuses>({
      ...optionalNumber("stab", data.stab_defence_bonus),
      ...optionalNumber("slash", data.slash_defence_bonus),
      ...optionalNumber("crush", data.crush_defence_bonus),
      ...optionalNumber("ranged", data.range_defence_bonus),
      ...optionalNumber("magic", data.magic_defence_bonus),
      ...optionalNumber("rangedLight", data.light_range_defence_bonus),
      ...optionalNumber("rangedStandard", data.standard_range_defence_bonus),
      ...optionalNumber("rangedHeavy", data.heavy_range_defence_bonus),
    });
    const immunities = optionalObject<MonsterImmunities>({
      ...optionalBoolean("venom", data.venom_immune),
      ...optionalBoolean("thralls", data.thrall_immune),
      ...optionalBoolean("cannon", data.cannon_immune),
      ...optionalBoolean("burn", data.burn_immune),
    });
    const resistances = optionalObject<MonsterResistances>({
      ...optionalNumber("poison", data.poison_resistance),
      ...optionalNumber("freeze", data.freeze_resistance),
    });
    const weaknessElement = stringValue(data.elemental_weakness);
    const weakness: MonsterWeakness | undefined = weaknessElement
      ? {
          element: weaknessElement,
          ...optionalNumber("percent", data.elemental_weakness_percent),
        }
      : undefined;
    const assignedBy = stringList(data.assigned_by);
    const slayer = optionalObject<MonsterSlayer>({
      ...optionalNumber("level", data.slayer_level),
      ...optionalNumber("experience", data.slayer_experience),
      ...optionalString("category", data.slayer_category),
      ...(assignedBy.length === 0 ? {} : { assignedBy }),
    });
    const value: MonsterVariant = {
      name,
      page,
      anchor,
      url: source.url,
      ...optionalBoolean("defaultVersion", data.default_version),
      ...optionalBoolean("members", data.is_members_only),
      ...optionalNumber("combatLevel", data.combat_level),
      ...optionalNumber("hitpoints", data.hitpoints),
      ...optionalNumber("maxHit", data.max_hit),
      attributes: stringList(data.attribute),
      attackStyles: stringList(data.attack_style),
      ...optionalNumber("attackSpeed", data.attack_speed),
      ...(levels === undefined ? {} : { levels }),
      ...(attackBonuses === undefined ? {} : { attackBonuses }),
      ...(defenceBonuses === undefined ? {} : { defenceBonuses }),
      ...optionalNumber("meleeStrengthBonus", data.strength_bonus),
      ...optionalNumber("rangedStrengthBonus", data.range_strength_bonus),
      ...optionalNumber("magicDamageBonus", data.magic_damage_bonus),
      ...optionalNumber("flatArmour", data.flat_armour),
      ...(immunities === undefined ? {} : { immunities }),
      ...(resistances === undefined ? {} : { resistances }),
      ...(weakness === undefined ? {} : { weakness }),
      ...(slayer === undefined ? {} : { slayer }),
    };
    const identity = `${caseFold(page)}\u0000${caseFold(anchor)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ value, source });
  }

  entries.sort((left, right) => {
    const defaultDifference = Number(Boolean(right.value.defaultVersion)) - Number(Boolean(left.value.defaultVersion));
    if (defaultDifference !== 0) return defaultDifference;
    return compareText(left.value.anchor, right.value.anchor);
  });
  return {
    entries,
    warnings:
      malformedRows === 0
        ? []
        : [
            `Skipped ${malformedRows} malformed upstream monster row${
              malformedRows === 1 ? "" : "s"
            }.`,
          ],
  };
}

function normalizeMapRows(rows: readonly RawBucketRow[]): {
  entries: MapPointEntry[];
  warnings: string[];
} {
  const entries: MapPointEntry[] = [];
  const seen = new Set<string>();
  let malformedRows = 0;

  for (const row of rows) {
    const data = objectValue(row.data);
    const featuresValue = jsonValue(data?.features);
    const features = Array.isArray(featuresValue)
      ? featuresValue
      : objectValue(featuresValue)?.features;
    const options = objectValue(jsonValue(data?.options));
    if (!data || !Array.isArray(features)) {
      malformedRows += 1;
      continue;
    }
    let validFromRow = 0;
    for (const featureValue of features) {
      const feature = objectValue(featureValue);
      const geometry = objectValue(feature?.geometry);
      const coordinates = geometry?.coordinates;
      if (geometry?.type !== "Point" || !Array.isArray(coordinates)) continue;
      const x = numberValue(coordinates[0]);
      const y = numberValue(coordinates[1]);
      if (
        x === undefined ||
        y === undefined ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0 ||
        x > 20_000 ||
        y > 20_000
      ) {
        continue;
      }
      const properties = objectValue(feature?.properties);
      const plane = integerValue(
        properties?.plane ?? options?.plane,
        0,
        3,
      );
      const mapId = integerValue(
        properties?.mapID ?? properties?.mapId ?? properties?.map_id ??
          options?.mapID ?? options?.mapId ?? options?.map_id,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      if (plane === undefined || mapId === undefined) continue;
      const historic = booleanValue(data.is_historic) ?? false;
      const identity = `${x}\u0000${y}\u0000${plane}\u0000${mapId}\u0000${historic}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      entries.push({ value: { x, y, plane, mapId, historic }, source: row.source });
      validFromRow += 1;
    }
    if (validFromRow === 0) malformedRows += 1;
  }

  entries.sort((left, right) =>
    left.value.mapId - right.value.mapId ||
    left.value.plane - right.value.plane ||
    left.value.x - right.value.x ||
    left.value.y - right.value.y,
  );
  return {
    entries,
    warnings:
      malformedRows === 0
        ? []
        : [
            `Skipped ${malformedRows} malformed map row${malformedRows === 1 ? "" : "s"}.`,
          ],
  };
}

function normalizeAccessNotes(page: ParsedPage): string[] {
  const notes: string[] = [];
  for (const template of findTemplates(page.wikitext ?? "", ["Infobox Monster"])) {
    for (const key of ["quest", "questreq", "quest_req", "access", "requirements"]) {
      const value = template.parameters[key];
      if (value === undefined) continue;
      const cleaned = cleanWikitext(value);
      if (cleaned.length > 0) notes.push(cleaned);
    }
  }
  return deduplicate(notes, caseFold);
}

function variantAnchor(data: Record<string, unknown>, page: string): string {
  const sub = stringValue(data.page_name_sub);
  if (sub) {
    const hash = sub.indexOf("#");
    if (hash >= 0 && hash < sub.length - 1) return sub.slice(hash + 1).trim();
    if (caseFold(sub) !== caseFold(page)) return sub;
  }
  const defaultValue = stringValue(data.default_version);
  return defaultValue && !/^(?:yes|no|true|false|0|1)$/iu.test(defaultValue)
    ? defaultValue
    : "Default";
}

function variantSource(source: SourceRef, page: string, anchor: string): SourceRef {
  const url = new URL(source.url);
  url.hash = anchor.replaceAll(" ", "_");
  return SourceRefSchema.parse({
    kind: "bucket",
    title: page,
    url: url.toString(),
    fetchedAt: source.fetchedAt,
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = cleanWikitext(String(value));
  return cleaned.length === 0 ? undefined : cleaned;
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;]+/gu)
      : [];
  return deduplicate(
    values.flatMap((entry) => {
      const cleaned = stringValue(entry);
      return cleaned === undefined ? [] : [cleaned];
    }),
    caseFold,
  );
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = cleanWikitext(value).replaceAll(",", "").replace(/%$/u, "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integerValue(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = cleanWikitext(value).trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function optionalNumber<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  const parsed = numberValue(value);
  return parsed === undefined ? {} : ({ [key]: parsed } as Record<K, number>);
}

function optionalBoolean<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, boolean>> {
  const parsed = booleanValue(value);
  return parsed === undefined ? {} : ({ [key]: parsed } as Record<K, boolean>);
}

function optionalString<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const parsed = stringValue(value);
  return parsed === undefined ? {} : ({ [key]: parsed } as Record<K, string>);
}

function optionalObject<T extends object>(value: T): T | undefined {
  return Object.keys(value).length === 0 ? undefined : value;
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

function compareText(left: string, right: string): number {
  const a = caseFold(left);
  const b = caseFold(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function caseFold(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function publicInput(value: string, label: string): string {
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length === 0 || length > MAX_PUBLIC_INPUT_CHARACTERS) {
    throw new RangeError(`${label} must contain from 1 through 256 Unicode characters.`);
  }
  return normalized;
}
