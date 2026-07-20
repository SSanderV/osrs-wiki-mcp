import type { SourceRef } from "../contracts.ts";
import { SourceRefSchema } from "../contracts.ts";
import { ToolFailure } from "../errors.ts";
import type { Deadline } from "../http/deadline.ts";
import type {
  JsonEnvelope,
  JsonRequestOptions,
} from "../http/json-http-client.ts";
import {
  BucketEnvelopeSchema,
  MediaWikiErrorEnvelopeSchema,
  ParseEnvelopeSchema,
  SearchEnvelopeSchema,
  type BucketEnvelope,
  type ParseEnvelope,
  type ParseSection,
  type SearchEnvelope,
} from "./schemas.ts";

const DEFAULT_API_URL = "https://oldschool.runescape.wiki/api.php";
const DEFAULT_WIKI_ORIGIN = "https://oldschool.runescape.wiki";
const BUCKET_PAGE_SIZE = 500;
const BUCKET_RAW_CAP = 10_000;
const MAX_PUBLIC_INPUT_CHARACTERS = 256;

export interface JsonRequester {
  request<T>(url: string | URL, options: JsonRequestOptions<T>): Promise<JsonEnvelope<T>>;
}

export interface WikiRequestContext {
  toolDeadline: Deadline;
  signal?: AbortSignal;
}

export interface SearchResultRow {
  title: string;
  pageId?: number;
  snippet: string;
  size?: number;
  wordCount?: number;
  url: string;
  source: SourceRef;
}

export interface SearchResult {
  results: SearchResultRow[];
  total: number;
  offset: number;
  nextOffset?: number;
  fetchedAt: string;
  source: SourceRef;
}

export type ParseProp = "wikitext" | "sections" | "text";

export interface ParsedPage {
  title: string;
  pageId: number;
  revisionId: number;
  revisionUrl: string;
  wikitext?: string;
  text?: string;
  sections?: ParseSection[];
  source: SourceRef;
  fetchedAt: string;
}

export type BucketScalar = string | number | boolean | null;
export type BucketWhere = readonly [field: string, value: BucketScalar];

export interface BucketQuerySpec {
  bucket: string;
  select: readonly string[];
  where?: readonly BucketWhere[];
}

export interface RawBucketRow {
  data: unknown;
  source: SourceRef;
}

export interface BucketPage {
  rows: RawBucketRow[];
  fetchedAt: string;
  fromCache: boolean;
  source: SourceRef;
}

export interface BucketScan {
  rows: RawBucketRow[];
  sources: SourceRef[];
  rawRowsExamined: number;
  incomplete: boolean;
  rawCapReached: boolean;
  failedRawOffset?: number;
  warning?: string;
}

export interface WikiClientOptions {
  apiUrl?: string;
  wikiOrigin?: string;
}

export class WikiClient {
  readonly #http: JsonRequester;
  readonly #apiUrl: string;
  readonly #wikiOrigin: string;

  constructor(
    http: JsonRequester,
    { apiUrl = DEFAULT_API_URL, wikiOrigin = DEFAULT_WIKI_ORIGIN }: WikiClientOptions = {},
  ) {
    this.#http = http;
    this.#apiUrl = new URL(apiUrl).toString();
    this.#wikiOrigin = new URL(wikiOrigin).origin;
  }

  async search(
    query: string,
    limit: number,
    offset: number,
    context: WikiRequestContext,
  ): Promise<SearchResult> {
    const normalizedQuery = publicInput(query, "Search query");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new RangeError("Search limit must be an integer from 1 through 20.");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError("Search offset must be a non-negative integer.");
    }

    const url = this.#apiRequestUrl({
      action: "query",
      format: "json",
      formatversion: "2",
      list: "search",
      srsearch: normalizedQuery,
      srlimit: String(limit),
      sroffset: String(offset),
      srprop: "size|wordcount|snippet|timestamp",
    });
    const envelope = await this.#http.request(url, {
      cacheKey: `search:${url}`,
      toolDeadline: context.toolDeadline,
      validate: (value) => SearchEnvelopeSchema.parse(value),
      admit: (value) => !isApiError(value),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if (isApiError(envelope.data)) throw apiFailure(envelope.data.error.code);

    const results = envelope.data.query.search.map((row): SearchResultRow => {
      const url = canonicalPageUrl(this.#wikiOrigin, row.title);
      const source = SourceRefSchema.parse({
        kind: "search",
        title: row.title,
        url,
        ...(row.pageid === undefined ? {} : { pageId: row.pageid }),
        fetchedAt: envelope.fetchedAt,
      });
      return {
        title: row.title,
        ...(row.pageid === undefined ? {} : { pageId: row.pageid }),
        snippet: cleanSearchSnippet(row.snippet),
        ...(row.size === undefined ? {} : { size: row.size }),
        ...(row.wordcount === undefined ? {} : { wordCount: row.wordcount }),
        url,
        source,
      };
    });

    const continuedOffset = envelope.data.continue?.sroffset;
    const calculatedOffset = offset + results.length;
    const nextOffset =
      continuedOffset ??
      (calculatedOffset < envelope.data.query.searchinfo.totalhits
        ? calculatedOffset
        : undefined);

    return {
      results,
      total: envelope.data.query.searchinfo.totalhits,
      offset,
      ...(nextOffset === undefined ? {} : { nextOffset }),
      fetchedAt: envelope.fetchedAt,
      source: SourceRefSchema.parse({
        kind: "search",
        url,
        fetchedAt: envelope.fetchedAt,
      }),
    };
  }

  async parsePage(
    title: string,
    props: readonly ParseProp[],
    section: string | undefined,
    context: WikiRequestContext,
  ): Promise<ParsedPage> {
    const normalizedTitle = publicInput(title, "Page title");
    const requestedProps = [...new Set(props)];
    if (requestedProps.length === 0) {
      throw new RangeError("At least one parse property is required.");
    }
    const normalizedSection =
      section === undefined ? undefined : publicInput(section, "Section identity");
    const propValue = [...requestedProps, "revid"].join("|");
    const url = this.#apiRequestUrl({
      action: "parse",
      format: "json",
      formatversion: "2",
      page: normalizedTitle,
      prop: propValue,
      ...(normalizedSection === undefined ? {} : { section: normalizedSection }),
    });
    const envelope = await this.#http.request(url, {
      cacheKey: `parse:${url}`,
      toolDeadline: context.toolDeadline,
      validate: (value) => validateParseEnvelope(value, requestedProps),
      admit: (value) => !isApiError(value),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if (isApiError(envelope.data)) throw apiFailure(envelope.data.error.code);

    const parsed = envelope.data.parse;
    const pageUrl = canonicalPageUrl(this.#wikiOrigin, parsed.title);
    const revisionUrl = revisionPageUrl(this.#wikiOrigin, parsed.title, parsed.revid);
    const source = SourceRefSchema.parse({
      kind: "page",
      title: parsed.title,
      url: pageUrl,
      pageId: parsed.pageid,
      revisionId: parsed.revid,
      revisionUrl,
      fetchedAt: envelope.fetchedAt,
    });

    return {
      title: parsed.title,
      pageId: parsed.pageid,
      revisionId: parsed.revid,
      revisionUrl,
      ...(parsed.wikitext === undefined
        ? {}
        : { wikitext: parsedTextValue(parsed.wikitext) }),
      ...(parsed.text === undefined ? {} : { text: parsedTextValue(parsed.text) }),
      ...(parsed.sections === undefined ? {} : { sections: parsed.sections }),
      source,
      fetchedAt: envelope.fetchedAt,
    };
  }

  async bucketPage(query: string, context: WikiRequestContext): Promise<BucketPage> {
    assertBucketQuery(query);
    const url = this.#apiRequestUrl({
      action: "bucket",
      format: "json",
      formatversion: "2",
      query,
    });
    const envelope = await this.#http.request(url, {
      cacheKey: `bucket:${url}`,
      toolDeadline: context.toolDeadline,
      validate: (value) => BucketEnvelopeSchema.parse(value),
      admit: (value) => !isApiError(value),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if (isApiError(envelope.data)) throw apiFailure(envelope.data.error.code);

    return {
      rows: envelope.data.bucket.map((data) => ({
        data,
        source: bucketRowSource(
          this.#wikiOrigin,
          url,
          data,
          envelope.fetchedAt,
        ),
      })),
      fetchedAt: envelope.fetchedAt,
      fromCache: envelope.fromCache,
      source: SourceRefSchema.parse({
        kind: "bucket",
        url,
        fetchedAt: envelope.fetchedAt,
      }),
    };
  }

  async bucketAll(
    spec: BucketQuerySpec,
    context: WikiRequestContext,
  ): Promise<BucketScan> {
    const rows: RawBucketRow[] = [];
    const sources: SourceRef[] = [];

    for (let rawOffset = 0; rawOffset < BUCKET_RAW_CAP; rawOffset += BUCKET_PAGE_SIZE) {
      if (context.signal?.aborted) throw abortReason(context.signal);
      if (context.toolDeadline.expired()) {
        if (rows.length === 0) throw timeoutFailure();
        return partialBucketScan(rows, sources, rawOffset);
      }

      try {
        const query = buildBucketQuery(spec, BUCKET_PAGE_SIZE, rawOffset);
        const page = await this.bucketPage(query, context);
        sources.push(page.source);
        rows.push(...page.rows);
        if (page.rows.length < BUCKET_PAGE_SIZE) {
          return {
            rows,
            sources,
            rawRowsExamined: rows.length,
            incomplete: false,
            rawCapReached: false,
          };
        }
      } catch (error) {
        if (context.signal?.aborted) throw error;
        if (rows.length === 0) throw error;
        return partialBucketScan(rows, sources, rawOffset);
      }
    }

    return {
      rows,
      sources,
      rawRowsExamined: rows.length,
      incomplete: true,
      rawCapReached: true,
      warning:
        "Upstream raw-row cap reached after 10,000 raw rows; results are incomplete.",
    };
  }

  #apiRequestUrl(parameters: Readonly<Record<string, string>>): string {
    const url = new URL(this.#apiUrl);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
}

export function escapeBucketLiteral(value: string): string {
  return `'${value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")}'`;
}

export function buildBucketQuery(
  spec: BucketQuerySpec,
  limit: number,
  offset: number,
): string {
  assertBucketIdentifier(spec.bucket, "Bucket name");
  if (spec.select.length === 0 || spec.select.length > 64) {
    throw new RangeError("Bucket select must contain from 1 through 64 fields.");
  }
  for (const field of spec.select) assertBucketIdentifier(field, "Bucket field");
  if (!Number.isInteger(limit) || limit < 1 || limit > BUCKET_PAGE_SIZE) {
    throw new RangeError("Bucket limit must be an integer from 1 through 500.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("Bucket offset must be a non-negative integer.");
  }

  let query = `bucket(${escapeBucketLiteral(spec.bucket)}).select(${spec.select
    .map(escapeBucketLiteral)
    .join(",")})`;
  for (const [field, value] of spec.where ?? []) {
    assertBucketIdentifier(field, "Bucket where field");
    query += `.where(${escapeBucketLiteral(field)},${bucketValue(value)})`;
  }
  return `${query}.limit(${limit}).offset(${offset}).run()`;
}

function validateParseEnvelope(value: unknown, props: readonly ParseProp[]): ParseEnvelope {
  const envelope = ParseEnvelopeSchema.parse(value);
  if (isApiError(envelope)) return envelope;

  for (const prop of props) {
    if (envelope.parse[prop] === undefined) {
      throw new Error(`The parse envelope omitted requested property ${prop}.`);
    }
  }
  return envelope;
}

function isApiError(
  envelope: SearchEnvelope | ParseEnvelope | BucketEnvelope,
): envelope is Extract<typeof envelope, { error: unknown }> {
  return MediaWikiErrorEnvelopeSchema.safeParse(envelope).success;
}

function apiFailure(code: string): ToolFailure {
  if (code === "missingtitle" || code === "nosuchsection" || code === "pagecannotexist") {
    return new ToolFailure("NOT_FOUND", "The requested Wiki page or section was not found.");
  }
  return new ToolFailure("UPSTREAM_UNAVAILABLE", "The Wiki API rejected the request.");
}

function cleanSearchSnippet(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu, (match, decimal, hex, name) => {
    if (typeof decimal === "string") return codePoint(Number.parseInt(decimal, 10), match);
    if (typeof hex === "string") return codePoint(Number.parseInt(hex, 16), match);
    return named[String(name).toLowerCase()] ?? match;
  });
}

function codePoint(value: number, fallback: string): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function parsedTextValue(value: string | { "*": string }): string {
  return typeof value === "string" ? value : value["*"];
}

function canonicalPageUrl(origin: string, title: string): string {
  const path = title
    .replaceAll(" ", "_")
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%3A", ":"))
    .join("/");
  return new URL(`/w/${path}`, origin).toString();
}

function revisionPageUrl(origin: string, title: string, revisionId: number): string {
  const url = new URL("/w/index.php", origin);
  url.searchParams.set("title", title);
  url.searchParams.set("oldid", String(revisionId));
  return url.toString();
}

function bucketRowSource(
  wikiOrigin: string,
  requestUrl: string,
  row: unknown,
  fetchedAt: string,
): SourceRef {
  const title = bucketRowPageName(row);
  return SourceRefSchema.parse({
    kind: "bucket",
    ...(title === undefined
      ? { url: requestUrl }
      : { title, url: canonicalPageUrl(wikiOrigin, title) }),
    fetchedAt,
  });
}

function bucketRowPageName(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null || !("page_name" in row)) return undefined;
  const value = (row as { page_name?: unknown }).page_name;
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  return title.length > 0 ? title : undefined;
}

function partialBucketScan(
  rows: RawBucketRow[],
  sources: SourceRef[],
  failedRawOffset: number,
): BucketScan {
  return {
    rows,
    sources,
    rawRowsExamined: rows.length,
    incomplete: true,
    rawCapReached: false,
    failedRawOffset,
    warning: `Upstream pagination failed after ${rows.length} raw rows; retry the same tool call. Completed upstream pages may be reused from cache.`,
  };
}

function publicInput(value: string, label: string): string {
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length === 0 || length > MAX_PUBLIC_INPUT_CHARACTERS) {
    throw new RangeError(`${label} must contain from 1 through 256 Unicode characters.`);
  }
  return normalized;
}

function assertBucketIdentifier(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new RangeError(`${label} contains unsupported characters.`);
  }
}

function bucketValue(value: BucketScalar): string {
  if (typeof value === "string") return escapeBucketLiteral(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Bucket numeric values must be finite.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return "nil";
}

function assertBucketQuery(query: string): void {
  if (
    query.length === 0 ||
    query.length > 16_384 ||
    !query.startsWith("bucket(") ||
    !query.endsWith(".run()")
  ) {
    throw new RangeError("Bucket query must be a bounded complete query.");
  }
}

function timeoutFailure(): ToolFailure {
  return new ToolFailure("UPSTREAM_TIMEOUT", "The Wiki request exceeded its time budget.");
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
