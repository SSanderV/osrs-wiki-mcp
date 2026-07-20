import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [casesPath, rawIndexPath, sanitizedDir, scoringDir, mappingPath] = process.argv.slice(2);
if (![casesPath, rawIndexPath, sanitizedDir, scoringDir, mappingPath].every(Boolean)) {
  throw new Error(
    "Usage: prepare-scoring-v2.mjs <cases> <raw-index> <sanitized-dir> <scoring-dir> <mapping>",
  );
}

const sha256 = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
const ensureEmpty = async (directory) => {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`Output directory must be empty: ${directory}`);
  }
};

await ensureEmpty(sanitizedDir);
await ensureEmpty(scoringDir);

const suite = JSON.parse(await readFile(casesPath, "utf8"));
const externalToolId = suite.protocol?.externalCapabilityCondition?.toolId;
if (!externalToolId) throw new Error("Suite is missing its external tool ID");
const allowedMcpTool = (name) =>
  name.startsWith("mcp__osrs-wiki__") || name === externalToolId;
const rawIndex = JSON.parse(await readFile(rawIndexPath, "utf8"));
const caseById = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase]));
const mapping = [];
const scoringOrder = [];
const sanitizedHashes = [];
const scoringHashes = [];
let unparsedLines = 0;

for (const record of rawIndex) {
  const evalCase = caseById.get(record.caseId);
  if (!evalCase) throw new Error(`Unknown product-contract case: ${record.caseId}`);
  const raw = await readFile(record.stdoutFile, "utf8");
  const stderr = await readFile(record.stderrFile, "utf8");
  const events = [];
  for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      unparsedLines += 1;
    }
  }

  const toolUses = events.flatMap((event) =>
    event.type === "assistant"
      ? (event.message?.content ?? [])
          .filter((block) => block.type === "tool_use")
          .map((block) => ({ id: block.id, name: block.name, input: block.input }))
      : [],
  );
  const toolResults = new Map(events.flatMap((event) =>
    event.type === "user"
      ? (event.message?.content ?? [])
          .filter((block) => block.type === "tool_result")
          .map((block) => [
            block.tool_use_id,
            { isError: Boolean(block.is_error), content: block.content },
          ])
      : [],
  ));
  const pairedTools = toolUses.map((tool) => ({
    name: tool.name,
    input: tool.input,
    result: toolResults.get(tool.id) ?? null,
  }));
  const unexpectedMcpTools = pairedTools
    .filter((tool) => tool.name.startsWith("mcp__") && !allowedMcpTool(tool.name))
    .map((tool) => tool.name);
  if (unexpectedMcpTools.length > 0) {
    throw new Error(`Unexpected MCP tools: ${[...new Set(unexpectedMcpTools)].join(", ")}`);
  }
  const mcpTools = pairedTools.filter((tool) => allowedMcpTool(tool.name));
  const finalEvent = events.findLast((event) => event.type === "result");
  const visibleAssistantText = events.flatMap((event) =>
    event.type === "assistant"
      ? (event.message?.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
      : [],
  );

  const rawId = randomUUID();
  const viewId = randomUUID();
  const sanitized = {
    schemaVersion: 2,
    caseId: record.caseId,
    scenario: record.scenario,
    run: record.run,
    prompt: evalCase.prompt,
    tools: pairedTools,
    assistantText: visibleAssistantText,
    finalAnswer: finalEvent?.result ?? "",
    unparsedLineCount: raw.split(/\r?\n/u).filter(Boolean).length - events.length,
  };
  const scoringView = {
    schemaVersion: 2,
    viewId,
    caseId: record.caseId,
    scenario: record.scenario,
    prompt: evalCase.prompt,
    caseCriteria: {
      allowedToolNames: evalCase.allowedToolNames,
      requiredToolSequence: evalCase.requiredToolSequence,
      requiredAnswerBehaviors: evalCase.requiredAnswerBehaviors,
      forbiddenAnswerBehaviors: evalCase.forbiddenAnswerBehaviors,
    },
    mcpCalls: mcpTools,
    finalAnswer: finalEvent?.result ?? "",
  };
  const sanitizedText = `${JSON.stringify(sanitized, null, 2)}\n`;
  const scoringText = `${JSON.stringify(scoringView, null, 2)}\n`;
  const sanitizedFile = resolve(sanitizedDir, `${rawId}.json`);
  const scoringFile = resolve(scoringDir, `${viewId}.json`);
  await writeFile(sanitizedFile, sanitizedText, "utf8");
  await writeFile(scoringFile, scoringText, "utf8");
  const sanitizedHash = sha256(sanitizedText);
  const scoringHash = sha256(scoringText);
  sanitizedHashes.push(sanitizedHash);
  scoringHashes.push(scoringHash);
  mapping.push({
    viewId,
    caseId: record.caseId,
    scenario: record.scenario,
    run: record.run,
    sequence: record.sequence,
    arm: record.arm,
    rawTraceFile: record.stdoutFile,
    stderrFile: record.stderrFile,
    sanitizedRawFile: sanitizedFile,
    scoringViewFile: scoringFile,
    hashes: {
      rawTrace: sha256(raw),
      stderr: sha256(stderr),
      sanitizedRaw: sanitizedHash,
      scoringView: scoringHash,
    },
  });
  scoringOrder.push({ viewId, scoringViewFile: scoringFile });
}

for (let index = scoringOrder.length - 1; index > 0; index -= 1) {
  const swap = randomInt(index + 1);
  [scoringOrder[index], scoringOrder[swap]] = [scoringOrder[swap], scoringOrder[index]];
}

await writeFile(mappingPath, JSON.stringify(mapping, null, 2), "utf8");
await writeFile(
  resolve(scoringDir, "index.json"),
  JSON.stringify(scoringOrder, null, 2),
  "utf8",
);
const artifactSummary = {
  schemaVersion: 2,
  viewCount: scoringOrder.length,
  sanitizedRawCount: sanitizedHashes.length,
  unparsedLineCount: unparsedLines,
  aggregateHashes: {
    sanitizedRaw: sha256([...sanitizedHashes].sort().join("\n")),
    scoringViews: sha256([...scoringHashes].sort().join("\n")),
  },
};
await writeFile(
  resolve(scoringDir, "artifact-summary.json"),
  `${JSON.stringify(artifactSummary, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(artifactSummary, null, 2)}\n`);
