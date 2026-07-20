export const SYNTHETIC_FETCHED_AT = "2026-07-15T00:00:00.000Z";

export function syntheticSearchEnvelope() {
  return {
    batchcomplete: true,
    continue: { sroffset: 7, continue: "-||" },
    query: {
      searchinfo: { totalhits: 23 },
      search: [
        {
          ns: 0,
          title: "Test sword",
          pageid: 101,
          size: 321,
          wordcount: 42,
          snippet:
            "A <span class=\"searchmatch\">bright</span> test result &amp; companion.",
          timestamp: "2026-07-14T12:00:00Z",
          harmless_future_field: true,
        },
        {
          ns: 0,
          title: "Test sword/History",
          pageid: 102,
          size: 123,
          wordcount: 18,
          snippet: "An invented subpage.",
          timestamp: "2026-07-13T12:00:00Z",
        },
      ],
    },
  };
}

export function syntheticParseEnvelope(options: { revisionId?: number } = {}) {
  const parse: Record<string, unknown> = {
    title: "Example quest",
    pageid: 202,
    wikitext: "== Overview ==\nAn invented quest page.",
    sections: [
      {
        toclevel: 1,
        level: "2",
        line: "Overview",
        number: "1",
        index: "1",
        fromtitle: "Example quest",
        byteoffset: 0,
        anchor: "Overview",
      },
    ],
  };
  if (options.revisionId !== undefined) parse.revid = options.revisionId;
  return { parse };
}

export function syntheticBucketEnvelope(rows: readonly unknown[]) {
  return { bucket: [...rows], harmless_future_field: "retained" };
}

export function syntheticBucketRows(count: number, start = 0): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    page_name: `Test beast ${start + index}`,
    json: `{"id":${start + index}}`,
  }));
}
