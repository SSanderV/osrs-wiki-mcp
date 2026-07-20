import * as z from "zod/v4";

export const SourceRefSchema = z.object({
  kind: z.enum(["page", "search", "bucket"]),
  title: z.string().min(1).optional(),
  url: z.url(),
  pageId: z.number().int().positive().optional(),
  revisionId: z.number().int().positive().optional(),
  revisionUrl: z.url().optional(),
  fetchedAt: z.iso.datetime(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ProvenanceSchema = z.object({
  attribution: z.literal("Old School RuneScape Wiki contributors"),
  license: z.literal("CC BY-NC-SA 3.0"),
  licenseUrl: z.literal("https://creativecommons.org/licenses/by-nc-sa/3.0/"),
  transformed: z.literal(true),
  fetchedAt: z.iso.datetime(),
  sources: z.array(SourceRefSchema).min(1).max(300),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

function sourceIdentity(source: SourceRef): string {
  return `${source.kind}\u0000${source.url}\u0000${source.revisionId ?? ""}`;
}

export function deduplicateSources(sources: readonly SourceRef[]): SourceRef[] {
  const deduplicated = new Map<string, SourceRef>();

  for (const candidate of sources) {
    const source = SourceRefSchema.parse(candidate);
    const key = sourceIdentity(source);
    const current = deduplicated.get(key);

    if (!current || Date.parse(source.fetchedAt) < Date.parse(current.fetchedAt)) {
      deduplicated.set(key, source);
    }
  }

  return [...deduplicated.values()];
}

export function buildProvenance(sources: readonly SourceRef[]): Provenance {
  const uniqueSources = deduplicateSources(sources);
  if (uniqueSources.length === 0) {
    throw new Error("At least one source is required to build provenance.");
  }

  const fetchedAt = uniqueSources.reduce(
    (oldest, source) =>
      Date.parse(source.fetchedAt) < Date.parse(oldest) ? source.fetchedAt : oldest,
    uniqueSources[0]!.fetchedAt,
  );

  return ProvenanceSchema.parse({
    attribution: "Old School RuneScape Wiki contributors",
    license: "CC BY-NC-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
    transformed: true,
    fetchedAt,
    sources: uniqueSources,
  });
}
