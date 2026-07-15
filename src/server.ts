import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import { ProvenanceSchema } from "./contracts.ts";
import { findDropSources, findShop, getItemSources, type ItemSourcesWikiClient } from "./domain/acquisition.ts";
import { getItemInfo } from "./domain/items.ts";
import { getMonsterInfo, type MonsterWikiClient } from "./domain/monsters.ts";
import { getWikiPage, getWikiSection, getWikiSections, searchWiki, type PageWikiClient } from "./domain/pages.ts";
import { getQuestRequirements, type QuestWikiClient } from "./domain/quests.ts";
import { ToolFailure } from "./errors.ts";
import { Deadline, systemClock, type Clock } from "./http/deadline.ts";
import { createSuccess, createToolError } from "./result.ts";
import type { WikiRequestContext } from "./wiki/wiki-client.ts";

const TOOL_BUDGET_MS = 30_000;

export type WikiClientLike = PageWikiClient & ItemSourcesWikiClient & QuestWikiClient & MonsterWikiClient;

export interface ServerLogger {
  error(message: string): void;
}

export interface CreateServerOptions {
  wikiClient: WikiClientLike;
  version: string;
  clock?: Clock;
  logger?: ServerLogger;
}

const PublicTextSchema = z.string().transform((value) => value.trim()).refine(
  (value) => [...value].length >= 1 && [...value].length <= 256,
  { error: "Must contain from 1 through 256 Unicode characters." },
);
const WarningsSchema = z.array(z.string());
const WikiSectionSummarySchema = z.object({
  index: z.string(), name: z.string(), level: z.number().int().positive(), anchor: z.string().optional(),
});

const WikiSearchOutputSchema = z.object({
  results: z.array(z.object({
    title: z.string(), pageId: z.number().int().positive().optional(), snippet: z.string(), url: z.url(),
  })),
  total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(), provenance: ProvenanceSchema,
});
const WikiPageOutputSchema = z.object({
  title: z.string(), content: z.string(), totalCharacters: z.number().int().nonnegative(),
  truncated: z.boolean(), sections: z.array(WikiSectionSummarySchema), warnings: WarningsSchema,
  provenance: ProvenanceSchema,
});
const WikiSectionsOutputSchema = z.object({
  title: z.string(), sections: z.array(WikiSectionSummarySchema), total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(), truncated: z.boolean(), warnings: WarningsSchema,
  provenance: ProvenanceSchema,
});
const WikiSectionOutputSchema = z.object({
  title: z.string(), section: z.string(), content: z.string(),
  totalCharacters: z.number().int().nonnegative(), truncated: z.boolean(), warnings: WarningsSchema,
  provenance: ProvenanceSchema,
});

const ItemBonusesSchema = z.object({
  attackStab: z.number().optional(), attackSlash: z.number().optional(), attackCrush: z.number().optional(),
  attackMagic: z.number().optional(), attackRanged: z.number().optional(), defenceStab: z.number().optional(),
  defenceSlash: z.number().optional(), defenceCrush: z.number().optional(), defenceMagic: z.number().optional(),
  defenceRanged: z.number().optional(), meleeStrength: z.number().optional(), rangedStrength: z.number().optional(),
  magicDamage: z.number().optional(), prayer: z.number().optional(),
});
const ItemCreationSchema = z.object({
  materials: z.string().optional(), skills: z.string().optional(), facility: z.string().optional(),
  quantity: z.number().optional(), ticks: z.number().optional(),
});
const ItemInfoOutputSchema = z.object({
  title: z.string(), name: z.string(), description: z.string(), examine: z.string().optional(),
  members: z.boolean().optional(), tradeable: z.boolean().optional(), equipable: z.boolean().optional(),
  stackable: z.boolean().optional(), noteable: z.boolean().optional(), questItem: z.boolean().optional(),
  value: z.number().optional(), highAlchemy: z.number().optional(), lowAlchemy: z.number().optional(),
  weight: z.number().optional(), bonuses: ItemBonusesSchema.optional(), creation: ItemCreationSchema.optional(),
  warnings: WarningsSchema, provenance: ProvenanceSchema,
});

const ShopSourceSchema = z.object({
  shop: z.string(), page: z.string(), location: z.string().optional(), stock: z.string().optional(),
  sellPrice: z.string().optional(), buyPrice: z.string().optional(), currency: z.string().optional(),
  restock: z.string().optional(), notes: z.string().optional(),
});
const DropSourceSchema = z.object({
  source: z.string(), page: z.string(), level: z.string().optional(), quantity: z.string().optional(),
  rarity: z.string().optional(), notes: z.string().optional(),
});
const RecipeSourceSchema = z.object({
  page: z.string(), ticks: z.string().optional(), members: z.boolean().optional(),
  materials: z.array(z.object({ name: z.string(), quantity: z.string() })),
  skills: z.array(z.object({
    name: z.string(), level: z.string(), experience: z.string().optional(), boostable: z.string().optional(),
  })),
  output: z.object({ name: z.string(), quantity: z.string() }),
});
const GroundSpawnSourceSchema = z.object({
  item: z.string(), location: z.string().optional(), members: z.boolean().optional(), x: z.number(),
  y: z.number(), plane: z.number(), mapId: z.number(), leagueRegion: z.string().optional(),
});
const FindMetadataShape = {
  item: z.string(), offset: z.number().int().nonnegative(), limit: z.number().int().positive(),
  returned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), totalIsExact: z.boolean(),
  truncated: z.boolean(), incomplete: z.boolean(), rawCapReached: z.boolean(),
  rawRowsExamined: z.number().int().nonnegative(), skippedRows: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(), warnings: WarningsSchema, provenance: ProvenanceSchema,
};
const FindShopOutputSchema = z.object({ ...FindMetadataShape, shops: z.array(ShopSourceSchema) });
const FindDropSourcesOutputSchema = z.object({ ...FindMetadataShape, sources: z.array(DropSourceSchema) });

function categorySchema<T extends z.ZodType>(result: T) {
  return z.object({
    results: z.array(result), returned: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
    totalIsExact: z.boolean(), truncated: z.boolean(), incomplete: z.boolean(), rawCapReached: z.boolean(),
    skippedRows: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().optional(),
    warnings: WarningsSchema,
  });
}
const ItemSourcesOutputSchema = z.object({
  item: z.string(), perCategoryLimit: z.number().int().positive(), drops: categorySchema(DropSourceSchema),
  shops: categorySchema(ShopSourceSchema), recipes: categorySchema(RecipeSourceSchema),
  groundSpawns: categorySchema(GroundSpawnSourceSchema),
  coverage: z.array(z.enum(["drops", "shops", "recipes", "ground_spawns"])),
  warnings: WarningsSchema, provenance: ProvenanceSchema,
});
const QuestRequirementsOutputSchema = z.object({
  quest: z.string(), description: z.string().optional(),
  skills: z.array(z.object({ skill: z.string(), level: z.number().int().positive(), boostable: z.boolean().nullable() })),
  questPoints: z.number().int().nonnegative().optional(), prerequisiteQuests: z.array(z.string()),
  items: z.array(z.string()), manualConditions: z.array(z.string()), warnings: WarningsSchema,
  provenance: ProvenanceSchema,
});

const MonsterBonusesSchema = z.object({
  stab: z.number().optional(), slash: z.number().optional(), crush: z.number().optional(),
  ranged: z.number().optional(), magic: z.number().optional(),
});
const MonsterVariantSchema = z.object({
  name: z.string(), page: z.string(), anchor: z.string(), url: z.url(), defaultVersion: z.boolean().optional(),
  members: z.boolean().optional(), combatLevel: z.number().optional(), hitpoints: z.number().optional(),
  maxHit: z.number().optional(), attributes: z.array(z.string()), attackStyles: z.array(z.string()),
  attackSpeed: z.number().optional(),
  levels: z.object({
    attack: z.number().optional(), strength: z.number().optional(), defence: z.number().optional(),
    ranged: z.number().optional(), magic: z.number().optional(),
  }).optional(),
  attackBonuses: MonsterBonusesSchema.optional(),
  defenceBonuses: MonsterBonusesSchema.extend({
    rangedLight: z.number().optional(), rangedStandard: z.number().optional(), rangedHeavy: z.number().optional(),
  }).optional(),
  meleeStrengthBonus: z.number().optional(), rangedStrengthBonus: z.number().optional(),
  magicDamageBonus: z.number().optional(), flatArmour: z.number().optional(),
  immunities: z.object({
    venom: z.boolean().optional(), thralls: z.boolean().optional(), cannon: z.boolean().optional(), burn: z.boolean().optional(),
  }).optional(),
  resistances: z.object({ poison: z.number().optional(), freeze: z.number().optional() }).optional(),
  weakness: z.object({ element: z.string(), percent: z.number().optional() }).optional(),
  slayer: z.object({
    level: z.number().optional(), experience: z.number().optional(), category: z.string().optional(),
    assignedBy: z.array(z.string()).optional(),
  }).optional(),
});
const MonsterInfoOutputSchema = z.object({
  monster: z.string(), selectedVariant: z.string().optional(), variants: z.array(MonsterVariantSchema),
  totalVariants: z.number().int().nonnegative(), totalVariantsIsExact: z.boolean(), variantsTruncated: z.boolean(),
  mapPoints: z.array(z.object({
    x: z.number(), y: z.number(), plane: z.number(), mapId: z.number(), historic: z.boolean(),
  })),
  accessNotes: z.array(z.string()), warnings: WarningsSchema, provenance: ProvenanceSchema,
});

const annotations = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true,
} as const;

export function createServer({ wikiClient, version, clock = systemClock, logger = console }: CreateServerOptions): McpServer {
  const server = new McpServer({ name: "osrs-wiki-mcp", version });
  const protocolTools = new Map<string, {
    schema: z.ZodType;
    call(args: unknown, signal: AbortSignal): Promise<CallToolResult>;
  }>();

  function registerTool<Input extends z.ZodRawShape, Output extends z.ZodRawShape>(
    name: string,
    config: {
      description: string;
      inputSchema: Input;
      outputSchema: Output;
      annotations: typeof annotations;
    },
    handler: (
      args: z.output<z.ZodObject<Input>>,
      signal: AbortSignal,
    ) => Promise<CallToolResult>,
  ): void {
    const schema = z.object(config.inputSchema);
    protocolTools.set(name, {
      schema,
      call: (args, signal) => handler(args as z.output<typeof schema>, signal),
    });
    server.registerTool<Output, typeof schema>(
      name,
      { ...config, inputSchema: schema },
      (args, extra) => handler(args, extra.signal),
    );
  }

  registerTool("search_wiki", {
    description: "Search the Old School RuneScape Wiki for canonical article titles and snippets.",
    inputSchema: {
      query: PublicTextSchema.describe("Wiki search query"), limit: z.number().int().min(1).max(20).default(5),
      offset: z.number().int().nonnegative().default(0),
    },
    outputSchema: WikiSearchOutputSchema.shape, annotations,
  }, ({ query, limit, offset }, signal) => executeTool(
    "search_wiki", WikiSearchOutputSchema, clock, logger, signal,
    (context) => searchWiki(wikiClient, query, limit, offset, context),
  ));

  registerTool("get_wiki_page", {
    description: "Get a bounded Old School RuneScape Wiki page. If truncated, use get_wiki_sections and get_wiki_section.",
    inputSchema: { title: PublicTextSchema.describe("Exact Wiki page title") },
    outputSchema: WikiPageOutputSchema.shape, annotations,
  }, ({ title }, signal) => executeTool(
    "get_wiki_page", WikiPageOutputSchema, clock, logger, signal,
    (context) => getWikiPage(wikiClient, title, context),
  ));

  registerTool("get_wiki_sections", {
    description: "List bounded section metadata for an Old School RuneScape Wiki page before calling get_wiki_section.",
    inputSchema: { title: PublicTextSchema.describe("Exact Wiki page title") },
    outputSchema: WikiSectionsOutputSchema.shape, annotations,
  }, ({ title }, signal) => executeTool(
    "get_wiki_sections", WikiSectionsOutputSchema, clock, logger, signal,
    (context) => getWikiSections(wikiClient, title, context),
  ));

  registerTool("get_wiki_section", {
    description: "Get one bounded Old School RuneScape Wiki section by the numeric index returned by get_wiki_sections.",
    inputSchema: {
      title: PublicTextSchema.describe("Exact Wiki page title"),
      section: z.number().int().nonnegative().describe("Section index from get_wiki_sections"),
    },
    outputSchema: WikiSectionOutputSchema.shape, annotations,
  }, ({ title, section }, signal) => executeTool(
    "get_wiki_section", WikiSectionOutputSchema, clock, logger, signal,
    (context) => getWikiSection(wikiClient, title, String(section), context),
  ));

  registerTool("get_item_info", {
    description: "Get normalized facts from an Old School RuneScape Wiki item page; use get_item_sources for acquisition data.",
    inputSchema: { item: PublicTextSchema.describe("Exact Wiki item name") },
    outputSchema: ItemInfoOutputSchema.shape, annotations,
  }, ({ item }, signal) => executeTool(
    "get_item_info", ItemInfoOutputSchema, clock, logger, signal,
    (context) => getItemInfo(wikiClient, item, context),
  ));

  registerTool("find_shop", {
    description: "Get the complete paginated Old School RuneScape Wiki shop listing for an item; get_item_sources is the bounded overview.",
    inputSchema: {
      item: PublicTextSchema.describe("Exact Wiki item name"), limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().nonnegative().default(0),
    },
    outputSchema: FindShopOutputSchema.shape, annotations,
  }, ({ item, limit, offset }, signal) => executeTool(
    "find_shop", FindShopOutputSchema, clock, logger, signal,
    (context) => findShop(wikiClient, { item, limit, offset }, context),
  ));

  registerTool("find_drop_sources", {
    description: "Get the complete paginated Old School RuneScape Wiki drop listing for an item; get_item_sources is the bounded overview.",
    inputSchema: {
      item: PublicTextSchema.describe("Exact Wiki item name"), limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().nonnegative().default(0),
    },
    outputSchema: FindDropSourcesOutputSchema.shape, annotations,
  }, ({ item, limit, offset }, signal) => executeTool(
    "find_drop_sources", FindDropSourcesOutputSchema, clock, logger, signal,
    (context) => findDropSources(wikiClient, { item, limit, offset }, context),
  ));

  registerTool("get_item_sources", {
    description: "Get a bounded Old School RuneScape Wiki acquisition overview; follow truncation warnings with find_shop or find_drop_sources.",
    inputSchema: {
      item: PublicTextSchema.describe("Exact Wiki item name"),
      perCategoryLimit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: ItemSourcesOutputSchema.shape, annotations,
  }, ({ item, perCategoryLimit }, signal) => executeTool(
    "get_item_sources", ItemSourcesOutputSchema, clock, logger, signal,
    (context) => getItemSources(wikiClient, { item, perCategoryLimit }, context),
  ));

  registerTool("get_quest_requirements", {
    description: "Get Old School RuneScape Wiki quest requirements without evaluating any player's progress.",
    inputSchema: { quest: PublicTextSchema.describe("Exact Wiki quest name") },
    outputSchema: QuestRequirementsOutputSchema.shape, annotations,
  }, ({ quest }, signal) => executeTool(
    "get_quest_requirements", QuestRequirementsOutputSchema, clock, logger, signal,
    (context) => getQuestRequirements(wikiClient, quest, context),
  ));

  registerTool("get_monster_info", {
    description: "Get separate Old School RuneScape Wiki monster variants and facts without combining variants or calculating DPS.",
    inputSchema: {
      monster: PublicTextSchema.describe("Exact Wiki monster name"),
      variant: PublicTextSchema.describe("Optional exact variant anchor").optional(),
    },
    outputSchema: MonsterInfoOutputSchema.shape, annotations,
  }, ({ monster, variant }, signal) => executeTool(
    "get_monster_info", MonsterInfoOutputSchema, clock, logger, signal,
    (context) => getMonsterInfo(wikiClient, { monster, ...(variant === undefined ? {} : { variant }) }, context),
  ));

  // McpServer intentionally converts every input-validation failure into an in-band
  // tool error. The public contract requires malformed calls and unknown names to be
  // JSON-RPC InvalidParams errors, so the documented low-level server escape hatch is
  // used only for calls; tools/list remains owned by the high-level registry.
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = protocolTools.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found.`);
    }
    const parsed = await tool.schema.safeParseAsync(request.params.arguments ?? {});
    if (!parsed.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for tool ${request.params.name}.`,
      );
    }
    return tool.call(parsed.data, extra.signal);
  });

  return server;
}

async function executeTool<T extends Record<string, unknown>>(
  toolName: string,
  schema: z.ZodType<T>,
  clock: Clock,
  logger: ServerLogger,
  signal: AbortSignal,
  operation: (context: WikiRequestContext) => Promise<unknown>,
): Promise<CallToolResult> {
  const context: WikiRequestContext = { toolDeadline: Deadline.after(clock, TOOL_BUDGET_MS), signal };
  try {
    const value = await operation(context);
    if (signal.aborted) throw signal.reason;
    return createSuccess(schema, value, (parsed) => JSON.stringify(parsed, null, 2));
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    if (!(error instanceof ToolFailure)) logger.error(`${toolName} failed internally.`);
    return createToolError(error);
  }
}
