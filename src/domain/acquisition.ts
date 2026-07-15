import * as z from "zod/v4";

import { buildProvenance, type Provenance, type SourceRef } from "../contracts.ts";
import { ToolFailure, type ToolErrorCode } from "../errors.ts";
import type {
  BucketQuerySpec,
  BucketScan,
  ParsedPage,
  RawBucketRow,
  WikiRequestContext,
} from "../wiki/wiki-client.ts";
import { cleanWikitext, findTemplates } from "../wiki/wikitext.ts";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_PUBLIC_INPUT_CHARACTERS = 256;

const RecipeJsonSchema = z.looseObject({
  ticks: z.union([z.string(), z.number()]).optional(),
  members: z.boolean().optional(),
  materials: z
    .array(
      z.looseObject({
        name: z.string().min(1),
        quantity: z.union([z.string(), z.number()]),
      }),
    )
    .max(200),
  skills: z
    .array(
      z.looseObject({
        name: z.string().min(1),
        level: z.union([z.string(), z.number()]),
        experience: z.union([z.string(), z.number()]).optional(),
        boostable: z.string().optional(),
      }),
    )
    .max(200),
  output: z.looseObject({
    name: z.string().min(1),
    quantity: z.union([z.string(), z.number()]),
  }),
});

export interface AcquisitionWikiClient {
  bucketAll(spec: BucketQuerySpec, context: WikiRequestContext): Promise<BucketScan>;
}

export interface ItemSourcesWikiClient extends AcquisitionWikiClient {
  parsePage(
    title: string,
    props: readonly ["wikitext"],
    section: undefined,
    context: WikiRequestContext,
  ): Promise<ParsedPage>;
}

export interface ShopSource {
  shop: string;
  page: string;
  location?: string;
  stock?: string;
  sellPrice?: string;
  buyPrice?: string;
  currency?: string;
  restock?: string;
  notes?: string;
}

export interface DropSource {
  source: string;
  page: string;
  level?: string;
  quantity?: string;
  rarity?: string;
  notes?: string;
}

export interface RecipeMaterial {
  name: string;
  quantity: string;
}

export interface RecipeSkill {
  name: string;
  level: string;
  experience?: string;
  boostable?: string;
}

export interface RecipeSource {
  page: string;
  ticks?: string;
  members?: boolean;
  materials: RecipeMaterial[];
  skills: RecipeSkill[];
  output: {
    name: string;
    quantity: string;
  };
}

export interface GroundSpawnSource {
  item: string;
  location?: string;
  members?: boolean;
  x: number;
  y: number;
  plane: number;
  mapId: number;
  leagueRegion?: string;
}

export interface NormalizedEntry<T> {
  value: T;
  source: SourceRef;
}

export interface NormalizedCategory<T> {
  entries: Array<NormalizedEntry<T>>;
  skippedRows: number;
  warnings: string[];
  incomplete: boolean;
  rawCapReached: boolean;
  requestSources: SourceRef[];
}

export interface PaginatedCategory<T> {
  results: T[];
  sources: SourceRef[];
  offset: number;
  limit: number;
  returned: number;
  total: number;
  totalIsExact: boolean;
  truncated: boolean;
  incomplete: boolean;
  rawCapReached: boolean;
  skippedRows: number;
  nextOffset?: number;
  warnings: string[];
}

export interface FindSourceInput {
  item: string;
  limit?: number;
  offset?: number;
}

interface FindSourceBase {
  item: string;
  offset: number;
  limit: number;
  returned: number;
  total: number;
  totalIsExact: boolean;
  truncated: boolean;
  incomplete: boolean;
  rawCapReached: boolean;
  rawRowsExamined: number;
  skippedRows: number;
  nextOffset?: number;
  warnings: string[];
  provenance: Provenance;
}

export interface FindShopOutput extends FindSourceBase {
  shops: ShopSource[];
}

export interface FindDropSourcesOutput extends FindSourceBase {
  sources: DropSource[];
}

export interface ItemSourceCategory<T> {
  results: T[];
  returned: number;
  total: number;
  totalIsExact: boolean;
  truncated: boolean;
  incomplete: boolean;
  rawCapReached: boolean;
  skippedRows: number;
  nextOffset?: number;
  warnings: string[];
}

export interface ItemSourcesInput {
  item: string;
  perCategoryLimit?: number;
}

export interface ItemSourcesOutput {
  item: string;
  perCategoryLimit: number;
  drops: ItemSourceCategory<DropSource>;
  shops: ItemSourceCategory<ShopSource>;
  recipes: ItemSourceCategory<RecipeSource>;
  groundSpawns: ItemSourceCategory<GroundSpawnSource>;
  coverage: Array<"drops" | "shops" | "recipes" | "ground_spawns">;
  warnings: string[];
  provenance: Provenance;
}

export function normalizeShopRows(
  rows: readonly RawBucketRow[],
): NormalizedCategory<ShopSource> {
  const entries: Array<NormalizedEntry<ShopSource>> = [];
  const seen = new Set<string>();
  let skippedRows = 0;

  for (const row of rows) {
    const object = rowObject(row.data);
    const payload = object ? jsonObject(object.sold_item_json) : undefined;
    const shop = payload ? stringField(payload, "Sold by", "Shop") : undefined;
    const page = row.source.title;
    if (!payload || !shop || !page) {
      skippedRows += 1;
      continue;
    }

    const value: ShopSource = {
      shop,
      page,
      ...optionalString("location", stringField(payload, "Store location", "Location")),
      ...optionalString("stock", stringField(payload, "Store stock", "Stock")),
      ...optionalString("sellPrice", stringField(payload, "Store sell price", "Sell price")),
      ...optionalString("buyPrice", stringField(payload, "Store buy price", "Buy price")),
      ...optionalString("currency", stringField(payload, "Store currency", "Currency")),
      ...optionalString("restock", stringField(payload, "Restock time", "Store restock time")),
      ...optionalString("notes", stringField(payload, "Store notes", "Notes")),
    };
    const identity = sortKey([
      value.shop,
      value.page,
      value.location,
      value.stock,
      value.sellPrice,
      value.buyPrice,
      value.currency,
      value.restock,
      value.notes,
    ]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ value, source: row.source });
  }

  entries.sort((left, right) => compareKeys(shopSortKey(left.value), shopSortKey(right.value)));
  return baseCategory(entries, skippedRows, "shop");
}

export function normalizeDropRows(
  rows: readonly RawBucketRow[],
): NormalizedCategory<DropSource> {
  const entries: Array<NormalizedEntry<DropSource>> = [];
  const seen = new Set<string>();
  let skippedRows = 0;

  for (const row of rows) {
    const object = rowObject(row.data);
    const payload = object ? jsonObject(object.drop_json) : undefined;
    const source = payload ? stringField(payload, "Dropped from", "Source") : undefined;
    const page = row.source.title;
    if (!payload || !source || !page) {
      skippedRows += 1;
      continue;
    }

    const value: DropSource = {
      source,
      page,
      ...optionalString("level", stringField(payload, "Level", "Combat level")),
      ...optionalString("quantity", stringField(payload, "Quantity")),
      ...optionalString("rarity", stringField(payload, "Rarity")),
      ...optionalString("notes", stringField(payload, "Notes", "Rarity notes")),
    };
    const identity = sortKey([
      value.source,
      value.page,
      value.level,
      value.quantity,
      value.rarity,
      value.notes,
    ]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ value, source: row.source });
  }

  entries.sort((left, right) => compareKeys(dropSortKey(left.value), dropSortKey(right.value)));
  return baseCategory(entries, skippedRows, "drop");
}

export function normalizeRecipeRows(
  rows: readonly RawBucketRow[],
  requestedItem: string,
): NormalizedCategory<RecipeSource> {
  const entries: Array<NormalizedEntry<RecipeSource>> = [];
  const seen = new Set<string>();
  let skippedRows = 0;
  const requestedIdentity = caseFold(requestedItem);

  for (const row of rows) {
    const object = rowObject(row.data);
    const rawPayload = object ? jsonObject(object.production_json) : undefined;
    const parsed = RecipeJsonSchema.safeParse(rawPayload);
    const page = row.source.title;
    if (!parsed.success || !page) {
      skippedRows += 1;
      continue;
    }

    const outputName = cleanWikitext(parsed.data.output.name);
    if (caseFold(outputName) !== requestedIdentity) continue;
    const value: RecipeSource = {
      page,
      ...(parsed.data.ticks === undefined
        ? {}
        : { ticks: cleanWikitext(String(parsed.data.ticks)) }),
      ...(parsed.data.members === undefined ? {} : { members: parsed.data.members }),
      materials: parsed.data.materials.map((material) => ({
        name: cleanWikitext(material.name),
        quantity: cleanWikitext(String(material.quantity)),
      })),
      skills: parsed.data.skills.map((skill) => ({
        name: cleanWikitext(skill.name),
        level: cleanWikitext(String(skill.level)),
        ...(skill.experience === undefined
          ? {}
          : { experience: cleanWikitext(String(skill.experience)) }),
        ...(skill.boostable === undefined
          ? {}
          : { boostable: cleanWikitext(skill.boostable) }),
      })),
      output: {
        name: outputName,
        quantity: cleanWikitext(String(parsed.data.output.quantity)),
      },
    };
    const identity = sortKey([
      value.page,
      value.output.name,
      value.output.quantity,
      JSON.stringify(value.materials),
      JSON.stringify(value.skills),
    ]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ value, source: row.source });
  }

  entries.sort((left, right) =>
    compareKeys(
      sortKey([left.value.output.name, left.value.page, left.value.ticks]),
      sortKey([right.value.output.name, right.value.page, right.value.ticks]),
    ),
  );
  return categoryWithWarning(entries, skippedRows, "recipe row");
}

export function normalizeGroundSpawns(
  page: ParsedPage,
  requestedItem: string,
): NormalizedCategory<GroundSpawnSource> {
  const entries: Array<NormalizedEntry<GroundSpawnSource>> = [];
  let skippedRows = 0;
  const requestedIdentity = caseFold(requestedItem);

  for (const template of findTemplates(page.wikitext ?? "", ["ItemSpawnLine"])) {
    const item = cleanWikitext(template.parameters.name ?? "");
    if (caseFold(item) !== requestedIdentity) continue;
    const location = cleanWikitext(template.parameters.location ?? "");
    const members = booleanText(template.parameters.members);
    const plane = boundedInteger(template.parameters.plane, 0, 3, 0);
    const mapId = boundedInteger(
      template.parameters.mapid ?? template.parameters.map_id,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    );
    const leagueRegion = cleanWikitext(
      template.parameters.leagueregion ?? template.parameters.league_region ?? "",
    );
    const coordinates = Object.entries(template.parameters)
      .filter(([key]) => /^\d+$/u.test(key))
      .sort(([left], [right]) => Number(left) - Number(right));
    if (coordinates.length === 0 || plane === undefined || mapId === undefined) {
      skippedRows += Math.max(1, coordinates.length);
      continue;
    }

    for (const [, coordinate] of coordinates) {
      const match = /^\s*(\d{1,5})\s*,\s*(\d{1,5})\s*$/u.exec(coordinate);
      const x = match ? Number(match[1]) : Number.NaN;
      const y = match ? Number(match[2]) : Number.NaN;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x > 20_000 || y > 20_000) {
        skippedRows += 1;
        continue;
      }
      entries.push({
        value: {
          item,
          ...(location.length === 0 ? {} : { location }),
          ...(members === undefined ? {} : { members }),
          x,
          y,
          plane,
          mapId,
          ...(leagueRegion.length === 0 ? {} : { leagueRegion }),
        },
        source: page.source,
      });
    }
  }

  entries.sort((left, right) =>
    compareKeys(
      sortKey([
        left.value.location,
        String(left.value.mapId),
        String(left.value.plane),
        String(left.value.x).padStart(5, "0"),
        String(left.value.y).padStart(5, "0"),
      ]),
      sortKey([
        right.value.location,
        String(right.value.mapId),
        String(right.value.plane),
        String(right.value.x).padStart(5, "0"),
        String(right.value.y).padStart(5, "0"),
      ]),
    ),
  );
  const category = categoryWithWarning(entries, skippedRows, "ground-spawn coordinate");
  return { ...category, requestSources: [page.source] };
}

export function paginateNormalized<T>(
  category: NormalizedCategory<T>,
  offset: number,
  limit: number,
): PaginatedCategory<T> {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("Normalized offset must be a non-negative integer.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new RangeError("Normalized limit must be an integer from 1 through 100.");
  }

  const selected = category.entries.slice(offset, offset + limit);
  const exactMoreResults = offset + selected.length < category.entries.length;
  const nextOffset = !category.incomplete && exactMoreResults ? offset + selected.length : undefined;
  return {
    results: selected.map((entry) => entry.value),
    sources: [...category.requestSources, ...selected.map((entry) => entry.source)],
    offset,
    limit,
    returned: selected.length,
    total: category.entries.length,
    totalIsExact: !category.incomplete,
    truncated: category.incomplete || exactMoreResults,
    incomplete: category.incomplete,
    rawCapReached: category.rawCapReached,
    skippedRows: category.skippedRows,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    warnings: [...category.warnings],
  };
}

export async function findShop(
  client: AcquisitionWikiClient,
  input: FindSourceInput,
  context: WikiRequestContext,
): Promise<FindShopOutput> {
  const item = publicInput(input.item);
  const scan = await client.bucketAll(
    {
      bucket: "storeline",
      select: ["page_name", "sold_item", "sold_item_json"],
      where: [["sold_item", item]],
    },
    context,
  );
  const page = paginateNormalized(
    withScan(normalizeShopRows(scan.rows), scan),
    input.offset ?? 0,
    input.limit ?? DEFAULT_PAGE_LIMIT,
  );
  return {
    item,
    shops: page.results,
    ...findMetadata(page, scan),
    provenance: buildProvenance(page.sources),
  };
}

export async function findDropSources(
  client: AcquisitionWikiClient,
  input: FindSourceInput,
  context: WikiRequestContext,
): Promise<FindDropSourcesOutput> {
  const item = publicInput(input.item);
  const scan = await client.bucketAll(
    {
      bucket: "dropsline",
      select: ["page_name", "item_name", "drop_json"],
      where: [["item_name", item]],
    },
    context,
  );
  const page = paginateNormalized(
    withScan(normalizeDropRows(scan.rows), scan),
    input.offset ?? 0,
    input.limit ?? DEFAULT_PAGE_LIMIT,
  );
  return {
    item,
    sources: page.results,
    ...findMetadata(page, scan),
    provenance: buildProvenance(page.sources),
  };
}

export async function getItemSources(
  client: ItemSourcesWikiClient,
  input: ItemSourcesInput,
  context: WikiRequestContext,
): Promise<ItemSourcesOutput> {
  const item = publicInput(input.item);
  const perCategoryLimit = input.perCategoryLimit ?? 20;
  if (
    !Number.isInteger(perCategoryLimit) ||
    perCategoryLimit < 1 ||
    perCategoryLimit > MAX_PAGE_LIMIT
  ) {
    throw new RangeError("perCategoryLimit must be an integer from 1 through 100.");
  }

  const successfulSources: SourceRef[] = [];
  const coverage: ItemSourcesOutput["coverage"] = [];

  const drops = await attemptOverviewCategory("Drops", context.signal, async () => {
    const scan = await client.bucketAll(
      {
        bucket: "dropsline",
        select: ["page_name", "item_name", "drop_json"],
        where: [["item_name", item]],
      },
      context,
    );
    return paginateNormalized(withScan(normalizeDropRows(scan.rows), scan), 0, perCategoryLimit);
  }, "find_drop_sources");
  if (drops.succeeded) {
    coverage.push("drops");
    successfulSources.push(...drops.sources);
  }

  const shops = await attemptOverviewCategory("Shops", context.signal, async () => {
    const scan = await client.bucketAll(
      {
        bucket: "storeline",
        select: ["page_name", "sold_item", "sold_item_json"],
        where: [["sold_item", item]],
      },
      context,
    );
    return paginateNormalized(withScan(normalizeShopRows(scan.rows), scan), 0, perCategoryLimit);
  }, "find_shop");
  if (shops.succeeded) {
    coverage.push("shops");
    successfulSources.push(...shops.sources);
  }

  const recipes = await attemptOverviewCategory("Recipes", context.signal, async () => {
    const scan = await client.bucketAll(
      {
        bucket: "recipe",
        select: ["page_name", "production_json"],
        where: [["page_name", item]],
      },
      context,
    );
    return paginateNormalized(
      withScan(normalizeRecipeRows(scan.rows, item), scan),
      0,
      perCategoryLimit,
    );
  });
  if (recipes.succeeded) {
    coverage.push("recipes");
    successfulSources.push(...recipes.sources);
  }

  const groundSpawns = await attemptOverviewCategory("Ground spawns", context.signal, async () => {
    const page = await client.parsePage(item, ["wikitext"], undefined, context);
    return paginateNormalized(normalizeGroundSpawns(page, item), 0, perCategoryLimit);
  });
  if (groundSpawns.succeeded) {
    coverage.push("ground_spawns");
    successfulSources.push(...groundSpawns.sources);
  }

  if (coverage.length === 0) {
    const attempts = [drops, shops, recipes, groundSpawns];
    const failureCode: ToolErrorCode = attempts.every(
      ({ failureCode: code }) => code === "UPSTREAM_TIMEOUT",
    )
      ? "UPSTREAM_TIMEOUT"
      : "UPSTREAM_UNAVAILABLE";
    throw new ToolFailure(
      failureCode,
      "Every item-source category was unavailable; retry the same tool call.",
    );
  }

  const categories = [drops.category, shops.category, recipes.category, groundSpawns.category];
  return {
    item,
    perCategoryLimit,
    drops: drops.category,
    shops: shops.category,
    recipes: recipes.category,
    groundSpawns: groundSpawns.category,
    coverage,
    warnings: categories.flatMap((category) => category.warnings),
    provenance: buildProvenance(successfulSources),
  };
}

function withScan<T>(category: NormalizedCategory<T>, scan: BucketScan): NormalizedCategory<T> {
  return {
    ...category,
    incomplete: scan.incomplete,
    rawCapReached: scan.rawCapReached,
    requestSources: scan.sources,
    warnings: [...category.warnings, ...(scan.warning ? [scan.warning] : [])],
  };
}

interface OverviewAttempt<T> {
  category: ItemSourceCategory<T>;
  sources: SourceRef[];
  succeeded: boolean;
  failureCode?: ToolErrorCode;
}

async function attemptOverviewCategory<T>(
  label: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<PaginatedCategory<T>>,
  specializedTool?: "find_drop_sources" | "find_shop",
): Promise<OverviewAttempt<T>> {
  try {
    const page = await operation();
    const warnings = [...page.warnings];
    if (page.incomplete) {
      warnings.push(
        specializedTool
          ? `${label} are incomplete; retry this call or use ${specializedTool} with offset 0.`
          : `${label} are incomplete; retry this call.`,
      );
    } else if (page.nextOffset !== undefined) {
      warnings.push(
        specializedTool
          ? `${label} truncated at ${page.returned} results; use ${specializedTool} with offset ${page.nextOffset} for the complete list.`
          : page.limit >= MAX_PAGE_LIMIT
            ? `${label} truncated at ${page.returned} results; the overview is already at the maximum of 100 and has no pagination tool.`
            : `${label} truncated at ${page.returned} results; increase perCategoryLimit up to 100.`,
      );
    }
    return {
      category: publicOverviewCategory(page, warnings),
      sources: page.sources,
      succeeded: true,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const code = error instanceof ToolFailure ? error.code : "INTERNAL_ERROR";
    return {
      category: {
        results: [],
        returned: 0,
        total: 0,
        totalIsExact: false,
        truncated: false,
        incomplete: true,
        rawCapReached: false,
        skippedRows: 0,
        warnings: [`${label} category unavailable (${code}); retry the same tool call.`],
      },
      sources: [],
      succeeded: false,
      failureCode: code,
    };
  }
}

function publicOverviewCategory<T>(
  page: PaginatedCategory<T>,
  warnings: string[],
): ItemSourceCategory<T> {
  return {
    results: page.results,
    returned: page.returned,
    total: page.total,
    totalIsExact: page.totalIsExact,
    truncated: page.truncated,
    incomplete: page.incomplete,
    rawCapReached: page.rawCapReached,
    skippedRows: page.skippedRows,
    ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
    warnings,
  };
}

function findMetadata<T>(
  page: PaginatedCategory<T>,
  scan: BucketScan,
): Omit<FindSourceBase, "item" | "provenance"> {
  return {
    offset: page.offset,
    limit: page.limit,
    returned: page.returned,
    total: page.total,
    totalIsExact: page.totalIsExact,
    truncated: page.truncated,
    incomplete: page.incomplete,
    rawCapReached: page.rawCapReached,
    rawRowsExamined: scan.rawRowsExamined,
    skippedRows: page.skippedRows,
    ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
    warnings: page.warnings,
  };
}

function baseCategory<T>(
  entries: Array<NormalizedEntry<T>>,
  skippedRows: number,
  kind: "shop" | "drop",
): NormalizedCategory<T> {
  return {
    entries,
    skippedRows,
    warnings:
      skippedRows === 0
        ? []
        : [
            `Skipped ${skippedRows} malformed upstream ${kind} row${
              skippedRows === 1 ? "" : "s"
            }.`,
          ],
    incomplete: false,
    rawCapReached: false,
    requestSources: [],
  };
}

function categoryWithWarning<T>(
  entries: Array<NormalizedEntry<T>>,
  skippedRows: number,
  label: string,
): NormalizedCategory<T> {
  return {
    entries,
    skippedRows,
    warnings:
      skippedRows === 0
        ? []
        : [
            `Skipped ${skippedRows} malformed ${label}${skippedRows === 1 ? "" : "s"}.`,
          ],
    incomplete: false,
    rawCapReached: false,
    requestSources: [],
  };
}

function rowObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(decodeBucketJson(value)) as unknown;
    return rowObject(parsed);
  } catch {
    return undefined;
  }
}

function decodeBucketJson(value: string): string {
  return value
    .replaceAll("&#123;", "{")
    .replaceAll("&#125;", "}")
    .replaceAll("&#34;", '"')
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function stringField(
  object: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" || typeof value === "number") {
      const cleaned = cleanWikitext(String(value));
      if (cleaned.length > 0) return cleaned;
    }
  }
  return undefined;
}

function optionalString<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function shopSortKey(value: ShopSource): string {
  return sortKey([value.shop, value.location, value.page, value.notes]);
}

function dropSortKey(value: DropSource): string {
  return sortKey([value.source, value.level, value.page, value.rarity, value.quantity]);
}

function sortKey(values: readonly (string | undefined)[]): string {
  return values.map((value) => (value ?? "").normalize("NFKC").toLowerCase()).join("\u0000");
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function publicInput(value: string): string {
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length === 0 || length > MAX_PUBLIC_INPUT_CHARACTERS) {
    throw new RangeError("Item must contain from 1 through 256 Unicode characters.");
  }
  return normalized;
}

function caseFold(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function booleanText(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = cleanWikitext(value).trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number | undefined {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}
