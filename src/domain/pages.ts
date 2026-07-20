import { buildProvenance, type Provenance } from "../contracts.ts";
import { ToolFailure } from "../errors.ts";
import { capArray, capText } from "../result.ts";
import type {
  ParsedPage,
  ParseProp,
  SearchResult,
  WikiRequestContext,
} from "../wiki/wiki-client.ts";
import { cleanWikitext } from "../wiki/wikitext.ts";

const TEXT_CAP = 16_000;
const SECTION_CAP = 200;

export interface PageWikiClient {
  search(
    query: string,
    limit: number,
    offset: number,
    context: WikiRequestContext,
  ): Promise<SearchResult>;
  parsePage(
    title: string,
    props: readonly ParseProp[],
    section: string | undefined,
    context: WikiRequestContext,
  ): Promise<ParsedPage>;
}

export interface WikiSearchOutput {
  results: Array<{
    title: string;
    pageId?: number;
    snippet: string;
    url: string;
  }>;
  total: number;
  offset: number;
  nextOffset?: number;
  provenance: Provenance;
}

export interface WikiSectionSummary {
  index: string;
  name: string;
  level: number;
  anchor?: string;
}

export interface WikiPageOutput {
  title: string;
  content: string;
  totalCharacters: number;
  truncated: boolean;
  sections: WikiSectionSummary[];
  warnings: string[];
  provenance: Provenance;
}

export interface WikiSectionsOutput {
  title: string;
  sections: WikiSectionSummary[];
  total: number;
  returned: number;
  truncated: boolean;
  warnings: string[];
  provenance: Provenance;
}

export interface WikiSectionOutput {
  title: string;
  section: string;
  content: string;
  totalCharacters: number;
  truncated: boolean;
  warnings: string[];
  provenance: Provenance;
}

export async function searchWiki(
  client: PageWikiClient,
  query: string,
  limit: number,
  offset: number,
  context: WikiRequestContext,
): Promise<WikiSearchOutput> {
  const result = await client.search(query, limit, offset, context);
  return {
    results: result.results.map((row) => ({
      title: row.title,
      ...(row.pageId === undefined ? {} : { pageId: row.pageId }),
      snippet: row.snippet,
      url: row.url,
    })),
    total: result.total,
    offset: result.offset,
    ...(result.nextOffset === undefined ? {} : { nextOffset: result.nextOffset }),
    provenance: buildProvenance([result.source, ...result.results.map((row) => row.source)]),
  };
}

export async function getWikiPage(
  client: PageWikiClient,
  title: string,
  context: WikiRequestContext,
): Promise<WikiPageOutput> {
  const page = await parseWithGuidance(client, title, ["wikitext", "sections"], undefined, context);
  const content = cleanWikitext(page.wikitext ?? "", { preserveHeadings: true });
  const totalCharacters = [...content].length;
  const cappedContent = capText(
    content,
    TEXT_CAP,
    "Page content truncated at 16,000 characters; use get_wiki_sections and get_wiki_section to retrieve specific sections.",
  );
  const sections = capArray(
    normalizeSections(page),
    SECTION_CAP,
    "Section summary truncated at 200 entries; use get_wiki_sections for the complete bounded section list.",
  );

  return {
    title: page.title,
    content: cappedContent.value,
    totalCharacters,
    truncated: cappedContent.truncated,
    sections: sections.value,
    warnings: [...cappedContent.warnings, ...sections.warnings],
    provenance: buildProvenance([page.source]),
  };
}

export async function getWikiSections(
  client: PageWikiClient,
  title: string,
  context: WikiRequestContext,
): Promise<WikiSectionsOutput> {
  const page = await parseWithGuidance(client, title, ["sections"], undefined, context);
  const sections = capArray(
    normalizeSections(page),
    SECTION_CAP,
    "Section list truncated at 200 entries.",
  );
  return {
    title: page.title,
    sections: sections.value,
    total: sections.total,
    returned: sections.value.length,
    truncated: sections.truncated,
    warnings: sections.warnings,
    provenance: buildProvenance([page.source]),
  };
}

export async function getWikiSection(
  client: PageWikiClient,
  title: string,
  section: string,
  context: WikiRequestContext,
): Promise<WikiSectionOutput> {
  const page = await parseWithGuidance(client, title, ["wikitext"], section, context);
  const content = cleanWikitext(page.wikitext ?? "", { preserveHeadings: true });
  const totalCharacters = [...content].length;
  const capped = capText(content, TEXT_CAP, "Section content truncated at 16,000 characters.");
  return {
    title: page.title,
    section,
    content: capped.value,
    totalCharacters,
    truncated: capped.truncated,
    warnings: capped.warnings,
    provenance: buildProvenance([page.source]),
  };
}

async function parseWithGuidance(
  client: PageWikiClient,
  title: string,
  props: readonly ParseProp[],
  section: string | undefined,
  context: WikiRequestContext,
): Promise<ParsedPage> {
  try {
    return await client.parsePage(title, props, section, context);
  } catch (error) {
    if (error instanceof ToolFailure && error.code === "NOT_FOUND") {
      throw new ToolFailure(
        "NOT_FOUND",
        "The requested Wiki page or section was not found; use search_wiki to find the canonical title.",
        { cause: error },
      );
    }
    throw error;
  }
}

function normalizeSections(page: ParsedPage): WikiSectionSummary[] {
  return (page.sections ?? []).flatMap((section) => {
    const level = Number(section.level);
    const name = cleanWikitext(section.line);
    if (!Number.isInteger(level) || level < 1 || name.length === 0) return [];
    return [
      {
        index: section.index,
        name,
        level,
        ...(section.anchor === undefined ? {} : { anchor: section.anchor }),
      },
    ];
  });
}
