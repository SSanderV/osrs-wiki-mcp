import { buildProvenance, type Provenance, type SourceRef } from "../contracts.ts";
import type {
  BucketQuerySpec,
  BucketScan,
  RawBucketRow,
  WikiRequestContext,
} from "../wiki/wiki-client.ts";
import { cleanWikitext } from "../wiki/wikitext.ts";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_PUBLIC_INPUT_CHARACTERS = 256;

export interface AcquisitionWikiClient {
  bucketAll(spec: BucketQuerySpec, context: WikiRequestContext): Promise<BucketScan>;
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

function withScan<T>(category: NormalizedCategory<T>, scan: BucketScan): NormalizedCategory<T> {
  return {
    ...category,
    incomplete: scan.incomplete,
    rawCapReached: scan.rawCapReached,
    requestSources: scan.sources,
    warnings: [...category.warnings, ...(scan.warning ? [scan.warning] : [])],
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
