import * as z from "zod/v4";

export const MediaWikiErrorEnvelopeSchema = z.looseObject({
  error: z.looseObject({
    code: z.string().min(1),
    info: z.string().optional(),
  }),
});

export const SearchRowSchema = z.looseObject({
  title: z.string().min(1),
  pageid: z.number().int().positive().optional(),
  snippet: z.string().default(""),
  size: z.number().int().nonnegative().optional(),
  wordcount: z.number().int().nonnegative().optional(),
  timestamp: z.string().optional(),
});

const SearchSuccessEnvelopeSchema = z.looseObject({
  query: z.looseObject({
    searchinfo: z.looseObject({
      totalhits: z.number().int().nonnegative(),
    }),
    search: z.array(SearchRowSchema).max(50),
  }),
  continue: z
    .looseObject({
      sroffset: z.number().int().nonnegative(),
    })
    .optional(),
});

export const SearchEnvelopeSchema = z.union([
  SearchSuccessEnvelopeSchema,
  MediaWikiErrorEnvelopeSchema,
]);

const LegacyTextSchema = z.looseObject({ "*": z.string() });
export const ParsedTextSchema = z.union([z.string(), LegacyTextSchema]);

export const ParseSectionSchema = z.looseObject({
  index: z.string().min(1),
  line: z.string(),
  level: z.union([z.string(), z.number()]),
  anchor: z.string().optional(),
  number: z.string().optional(),
  toclevel: z.number().int().nonnegative().optional(),
  byteoffset: z.number().int().nonnegative().optional(),
});

const ParseSuccessEnvelopeSchema = z.looseObject({
  parse: z.looseObject({
    title: z.string().min(1),
    pageid: z.number().int().positive(),
    revid: z.number().int().positive(),
    wikitext: ParsedTextSchema.optional(),
    text: ParsedTextSchema.optional(),
    sections: z.array(ParseSectionSchema).max(1_000).optional(),
  }),
});

export const ParseEnvelopeSchema = z.union([
  ParseSuccessEnvelopeSchema,
  MediaWikiErrorEnvelopeSchema,
]);

const BucketSuccessEnvelopeSchema = z.looseObject({
  bucket: z.array(z.unknown()).max(500),
});

export const BucketEnvelopeSchema = z.union([
  BucketSuccessEnvelopeSchema,
  MediaWikiErrorEnvelopeSchema,
]);

export type MediaWikiErrorEnvelope = z.infer<typeof MediaWikiErrorEnvelopeSchema>;
export type SearchEnvelope = z.infer<typeof SearchEnvelopeSchema>;
export type ParseEnvelope = z.infer<typeof ParseEnvelopeSchema>;
export type ParseSection = z.infer<typeof ParseSectionSchema>;
export type BucketEnvelope = z.infer<typeof BucketEnvelopeSchema>;
