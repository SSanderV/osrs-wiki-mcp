export interface WikiTemplate {
  name: string;
  raw: string;
  parameters: Record<string, string>;
}

export interface CleanWikitextOptions {
  preserveHeadings?: boolean;
}

interface TemplateRange {
  start: number;
  end: number;
  raw: string;
}

export function findTemplates(
  source: string,
  acceptedNames?: readonly string[],
): WikiTemplate[] {
  const accepted = acceptedNames
    ? new Set(acceptedNames.map(normalizedTemplateName))
    : undefined;
  return templateRanges(source)
    .map((range) => parseTemplate(range.raw))
    .filter((template): template is WikiTemplate => template !== null)
    .filter(
      (template) => !accepted || accepted.has(normalizedTemplateName(template.name)),
    );
}

export function parseInfobox(source: string, name: string): WikiTemplate | undefined {
  return findTemplates(source, [name])[0];
}

export function removeTemplates(source: string): string {
  const ranges = templateRanges(source);
  if (ranges.length === 0) return source;

  let result = "";
  let offset = 0;
  for (const range of ranges) {
    result += source.slice(offset, range.start);
    offset = range.end;
  }
  return result + source.slice(offset);
}

export function cleanWikitext(
  source: string,
  { preserveHeadings = false }: CleanWikitextOptions = {},
): string {
  let value = source
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/giu, "")
    .replace(/<ref\b[^>]*\/\s*>/giu, "")
    .replace(/^\{\|[\s\S]*?^\|\}\s*$/gmu, "");

  value = removeTemplates(value);
  value = replaceWikiLinks(value);
  value = value
    .replace(/\[(?:https?:)?\/\/[^\s\]]+(?:\s+([^\]]+))?\]/giu, (_match, label) =>
      typeof label === "string" ? label : "",
    )
    .replace(/<[^>]+>/gu, "")
    .replace(/'{2,5}/gu, "");
  value = decodeEntities(value);

  const lines = value.split(/\r?\n/gu).flatMap((line) => {
    const heading = /^(={2,6})\s*(.*?)\s*\1\s*$/u.exec(line.trim());
    if (heading) {
      const title = heading[2]?.trim() ?? "";
      if (title.length === 0) return [];
      return [preserveHeadings ? `${"#".repeat(heading[1]!.length)} ${title}` : title];
    }

    const cleaned = line
      .replace(/^[*#;:]+\s*/u, "")
      .replace(/[ \t]+/gu, " ")
      .trim();
    return cleaned.length === 0 ? [] : [cleaned];
  });

  return lines.join("\n").trim();
}

function templateRanges(source: string): TemplateRange[] {
  const ranges: TemplateRange[] = [];
  const stack: Array<2 | 3> = [];
  let topLevelStart = -1;

  for (let index = 0; index < source.length; ) {
    if (source.startsWith("{{{", index)) {
      if (stack.length === 0) topLevelStart = index;
      stack.push(3);
      index += 3;
      continue;
    }
    if (source.startsWith("{{", index)) {
      if (stack.length === 0) topLevelStart = index;
      stack.push(2);
      index += 2;
      continue;
    }
    if (stack.at(-1) === 3 && source.startsWith("}}}", index)) {
      stack.pop();
      index += 3;
      if (stack.length === 0 && topLevelStart >= 0) {
        ranges.push({
          start: topLevelStart,
          end: index,
          raw: source.slice(topLevelStart, index),
        });
        topLevelStart = -1;
      }
      continue;
    }
    if (stack.at(-1) === 2 && source.startsWith("}}", index)) {
      stack.pop();
      index += 2;
      if (stack.length === 0 && topLevelStart >= 0) {
        ranges.push({
          start: topLevelStart,
          end: index,
          raw: source.slice(topLevelStart, index),
        });
        topLevelStart = -1;
      }
      continue;
    }
    index += 1;
  }

  return ranges;
}

function parseTemplate(raw: string): WikiTemplate | null {
  if (!raw.startsWith("{{") || !raw.endsWith("}}") || raw.startsWith("{{{")) {
    return null;
  }
  const content = raw.slice(2, -2);
  const parts = splitTopLevel(content, "|");
  const name = parts.shift()?.trim() ?? "";
  if (name.length === 0) return null;

  const parameters: Record<string, string> = {};
  let positional = 1;
  for (const part of parts) {
    const equals = findTopLevelCharacter(part, "=");
    if (equals < 0) {
      parameters[String(positional)] = part.trim();
      positional += 1;
      continue;
    }
    const key = normalizedParameterName(part.slice(0, equals));
    if (key.length > 0) parameters[key] = part.slice(equals + 1).trim();
  }

  return { name, raw, parameters };
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value.startsWith("{{{", index)) {
      braceDepth += 1;
      index += 2;
      continue;
    }
    if (value.startsWith("{{", index)) {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (braceDepth > 0 && value.startsWith("}}}", index)) {
      braceDepth -= 1;
      index += 2;
      continue;
    }
    if (braceDepth > 0 && value.startsWith("}}", index)) {
      braceDepth -= 1;
      index += 1;
      continue;
    }
    if (value.startsWith("[[", index)) {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (linkDepth > 0 && value.startsWith("]]", index)) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (value[index] === separator && braceDepth === 0 && linkDepth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function findTopLevelCharacter(value: string, character: string): number {
  const first = splitTopLevel(value, character)[0] ?? value;
  return first.length === value.length ? -1 : first.length;
}

function replaceWikiLinks(source: string): string {
  let value = source;
  for (let pass = 0; pass < 100; pass += 1) {
    let changed = false;
    value = value.replace(/\[\[([^\[\]]*)\]\]/gu, (_match, contents: string) => {
      changed = true;
      const parts = contents.split("|");
      const target = parts[0]?.trim() ?? "";
      if (/^(?:file|image|category):/iu.test(target)) return "";
      const display = parts.length > 1 ? parts.at(-1)!.trim() : target.split("#")[0]!.trim();
      return display.replace(/^:/u, "");
    });
    if (!changed) break;
  }
  return value;
}

function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu, (match, decimal, hex, name) => {
    const parsed =
      typeof decimal === "string"
        ? Number.parseInt(decimal, 10)
        : typeof hex === "string"
          ? Number.parseInt(hex, 16)
          : undefined;
    if (parsed !== undefined) {
      try {
        return String.fromCodePoint(parsed);
      } catch {
        return match;
      }
    }
    return named[String(name).toLowerCase()] ?? match;
  });
}

function normalizedTemplateName(value: string): string {
  return value.trim().replaceAll("_", " ").replace(/\s+/gu, " ").toLowerCase();
}

function normalizedParameterName(value: string): string {
  return value.trim().replace(/\s+/gu, "_").toLowerCase();
}
