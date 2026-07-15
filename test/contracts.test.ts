import assert from "node:assert/strict";
import test from "node:test";

import * as z from "zod/v4";

import {
  ProvenanceSchema,
  SourceRefSchema,
  buildProvenance,
  deduplicateSources,
} from "../src/contracts.ts";
import { ToolFailure } from "../src/errors.ts";
import { capArray, capText, createSuccess, createToolError } from "../src/result.ts";

const oldestSource = {
  kind: "page" as const,
  title: "Test sword",
  url: "https://oldschool.runescape.wiki/w/Test_sword",
  pageId: 101,
  revisionId: 202,
  revisionUrl: "https://oldschool.runescape.wiki/w/Test_sword?oldid=202",
  fetchedAt: "2026-07-15T00:00:00.000Z",
};

test("source and provenance schemas require honest URLs and timestamps", () => {
  assert.deepEqual(SourceRefSchema.parse(oldestSource), oldestSource);

  const provenance = buildProvenance([oldestSource]);
  assert.deepEqual(ProvenanceSchema.parse(provenance), provenance);
  assert.equal(provenance.fetchedAt, oldestSource.fetchedAt);

  assert.throws(() => SourceRefSchema.parse({ ...oldestSource, url: "not a URL" }));
  assert.throws(() => SourceRefSchema.parse({ ...oldestSource, fetchedAt: "yesterday" }));
});

test("source deduplication keeps the oldest contributing fetch time", () => {
  const newer = { ...oldestSource, fetchedAt: "2026-07-15T00:05:00.000Z" };
  const deduplicated = deduplicateSources([newer, oldestSource]);

  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0]?.fetchedAt, oldestSource.fetchedAt);
});

test("createSuccess validates and returns matching readable and structured output", () => {
  const schema = z.object({ answer: z.string(), warnings: z.array(z.string()) });
  const output = { answer: "bounded", warnings: [] };

  const result = createSuccess(schema, output, ({ answer }) => `Answer: ${answer}`);

  assert.deepEqual(result.content, [{ type: "text", text: "Answer: bounded" }]);
  assert.deepEqual(result.structuredContent, output);
  assert.equal(result.isError, undefined);
  assert.throws(() => createSuccess(schema, { answer: 1, warnings: [] }, "invalid"));
});

test("createToolError exposes a stable code without structured content", () => {
  const result = createToolError(
    new ToolFailure("NOT_FOUND", "The requested page was not found. Try search_wiki."),
  );

  assert.deepEqual(result.content, [
    {
      type: "text",
      text: "NOT_FOUND: The requested page was not found. Try search_wiki.",
    },
  ]);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
});

test("cap helpers disclose every truncation", () => {
  assert.deepEqual(capText("abcdef", 3, "Text truncated."), {
    value: "abc",
    truncated: true,
    warnings: ["Text truncated."],
  });
  assert.deepEqual(capArray([1, 2, 3], 2, "Rows truncated."), {
    value: [1, 2],
    total: 3,
    truncated: true,
    warnings: ["Rows truncated."],
  });
  assert.deepEqual(capText("😀😀😀", 2, "Unicode text truncated."), {
    value: "😀😀",
    truncated: true,
    warnings: ["Unicode text truncated."],
  });
});
