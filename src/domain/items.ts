import { buildProvenance, type Provenance } from "../contracts.ts";
import { ToolFailure } from "../errors.ts";
import type { WikiRequestContext } from "../wiki/wiki-client.ts";
import {
  cleanWikitext,
  findTemplates,
  parseInfobox,
  removeTemplates,
  type WikiTemplate,
} from "../wiki/wikitext.ts";
import type { PageWikiClient } from "./pages.ts";

export interface ItemBonuses {
  attackStab?: number;
  attackSlash?: number;
  attackCrush?: number;
  attackMagic?: number;
  attackRanged?: number;
  defenceStab?: number;
  defenceSlash?: number;
  defenceCrush?: number;
  defenceMagic?: number;
  defenceRanged?: number;
  meleeStrength?: number;
  rangedStrength?: number;
  magicDamage?: number;
  prayer?: number;
}

export interface ItemCreation {
  materials?: string;
  skills?: string;
  facility?: string;
  quantity?: number;
  ticks?: number;
}

export interface ItemInfoOutput {
  title: string;
  name: string;
  description: string;
  examine?: string;
  members?: boolean;
  tradeable?: boolean;
  equipable?: boolean;
  stackable?: boolean;
  noteable?: boolean;
  questItem?: boolean;
  value?: number;
  highAlchemy?: number;
  lowAlchemy?: number;
  weight?: number;
  bonuses?: ItemBonuses;
  creation?: ItemCreation;
  warnings: string[];
  provenance: Provenance;
}

export async function getItemInfo(
  client: PageWikiClient,
  title: string,
  context: WikiRequestContext,
): Promise<ItemInfoOutput> {
  let page;
  try {
    page = await client.parsePage(title, ["wikitext"], undefined, context);
  } catch (error) {
    if (error instanceof ToolFailure && error.code === "NOT_FOUND") {
      throw itemNotFound(error);
    }
    throw error;
  }

  const wikitext = page.wikitext ?? "";
  const item = parseInfobox(wikitext, "Infobox Item");
  if (!item) throw itemNotFound();

  const name = cleanValue(item.parameters.name) || page.title;
  const examine = cleanValue(item.parameters.examine);
  const description = leadDescription(wikitext) || examine;
  const value = numericValue(item.parameters.value);
  const explicitlyNotAlchable =
    booleanValue(item.parameters.alchable) === false ||
    isNo(item.parameters.highalch) ||
    isNo(item.parameters.lowalch);
  const explicitHighAlchemy = numericValue(item.parameters.highalch);
  const explicitLowAlchemy = numericValue(item.parameters.lowalch);
  const highAlchemy =
    explicitHighAlchemy ??
    (!explicitlyNotAlchable && value !== undefined ? Math.floor(value * 0.6) : undefined);
  const lowAlchemy =
    explicitLowAlchemy ??
    (!explicitlyNotAlchable && value !== undefined ? Math.floor(value * 0.4) : undefined);
  const bonuses = normalizeBonuses(
    findTemplates(wikitext, ["Infobox Bonuses", "CombatBonuses"])[0],
  );
  const creation = normalizeCreation(parseInfobox(wikitext, "Infobox Creation"));

  return {
    title: page.title,
    name,
    description,
    ...(examine.length === 0 ? {} : { examine }),
    ...optionalBoolean("members", item.parameters.members),
    ...optionalBoolean("tradeable", item.parameters.tradeable),
    ...optionalBoolean("equipable", item.parameters.equipable),
    ...optionalBoolean("stackable", item.parameters.stackable),
    ...optionalBoolean("noteable", item.parameters.noteable),
    ...optionalBoolean("questItem", item.parameters.quest),
    ...(value === undefined ? {} : { value }),
    ...(highAlchemy === undefined ? {} : { highAlchemy }),
    ...(lowAlchemy === undefined ? {} : { lowAlchemy }),
    ...optionalNumber("weight", item.parameters.weight),
    ...(bonuses === undefined ? {} : { bonuses }),
    ...(creation === undefined ? {} : { creation }),
    warnings: [],
    provenance: buildProvenance([page.source]),
  };
}

function normalizeBonuses(template: WikiTemplate | undefined): ItemBonuses | undefined {
  if (!template) return undefined;
  const fields = {
    attackStab: "astab",
    attackSlash: "aslash",
    attackCrush: "acrush",
    attackMagic: "amagic",
    attackRanged: "arange",
    defenceStab: "dstab",
    defenceSlash: "dslash",
    defenceCrush: "dcrush",
    defenceMagic: "dmagic",
    defenceRanged: "drange",
    meleeStrength: "str",
    rangedStrength: "rstr",
    magicDamage: "mdmg",
    prayer: "prayer",
  } as const;
  const bonuses: ItemBonuses = {};
  for (const [output, input] of Object.entries(fields)) {
    const value = numericValue(template.parameters[input]);
    if (value !== undefined) Object.assign(bonuses, { [output]: value });
  }
  return Object.keys(bonuses).length === 0 ? undefined : bonuses;
}

function normalizeCreation(template: WikiTemplate | undefined): ItemCreation | undefined {
  if (!template) return undefined;
  const materials = cleanValue(template.parameters.materials);
  const skills = cleanValue(template.parameters.skills);
  const facility = cleanValue(template.parameters.facility);
  const quantity = numericValue(template.parameters.quantity);
  const ticks = numericValue(template.parameters.ticks);
  const creation: ItemCreation = {
    ...(materials.length === 0 ? {} : { materials }),
    ...(skills.length === 0 ? {} : { skills }),
    ...(facility.length === 0 ? {} : { facility }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(ticks === undefined ? {} : { ticks }),
  };
  return Object.keys(creation).length === 0 ? undefined : creation;
}

function leadDescription(wikitext: string): string {
  const withoutTemplates = removeTemplates(wikitext);
  const beforeFirstHeading = withoutTemplates.split(/^={2,6}\s*.*?\s*={2,6}\s*$/mu)[0] ?? "";
  return cleanWikitext(beforeFirstHeading);
}

function cleanValue(value: string | undefined): string {
  return value === undefined ? "" : cleanWikitext(value);
}

function numericValue(value: string | undefined): number | undefined {
  if (value === undefined || isNo(value)) return undefined;
  const cleaned = cleanWikitext(value).replaceAll(",", "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = cleanWikitext(value).trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function optionalBoolean<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, boolean>> {
  const parsed = booleanValue(value);
  return parsed === undefined ? {} : ({ [key]: parsed } as Record<K, boolean>);
}

function optionalNumber<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, number>> {
  const parsed = numericValue(value);
  return parsed === undefined ? {} : ({ [key]: parsed } as Record<K, number>);
}

function isNo(value: string | undefined): boolean {
  return value !== undefined && cleanWikitext(value).trim().toLowerCase() === "no";
}

function itemNotFound(cause?: unknown): ToolFailure {
  return new ToolFailure(
    "NOT_FOUND",
    "The requested item page or item infobox was not found; use search_wiki to find the canonical title.",
    { cause },
  );
}
