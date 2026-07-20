import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [casesPath, mappingPath, scoresPath, startText = "0", countText = "8"] =
  process.argv.slice(2);
if (!casesPath || !mappingPath || !scoresPath) {
  throw new Error(
    "Usage: audit-raw-traces-v2.mjs <cases> <mapping> <scores> [start] [count]",
  );
}

const start = Number.parseInt(startText, 10);
const count = Number.parseInt(countText, 10);
const sha256 = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
const compactText = (value) =>
  value.length <= 700 ? value : `${value.slice(0, 500)} ... [${value.length} chars]`;

const suite = JSON.parse(await readFile(casesPath, "utf8"));
const externalToolId = suite.protocol?.externalCapabilityCondition?.toolId;
if (!externalToolId) throw new Error("Suite is missing its external tool ID");
const allowedMcpTool = (name) =>
  name.startsWith("mcp__osrs-wiki__") || name === externalToolId;
const mapping = JSON.parse(await readFile(mappingPath, "utf8"))
  .sort((left, right) => left.sequence - right.sequence);
const scores = JSON.parse(await readFile(scoresPath, "utf8"));
const scoreByView = new Map(scores.scores.map((score) => [score.viewId, score]));

for (const entry of mapping.slice(start, start + count)) {
  const raw = await readFile(entry.rawTraceFile, "utf8");
  const stderr = await readFile(entry.stderrFile, "utf8");
  const sanitizedText = await readFile(entry.sanitizedRawFile, "utf8");
  const scoringText = await readFile(entry.scoringViewFile, "utf8");
  if (sha256(raw) !== entry.hashes.rawTrace) throw new Error("Raw hash mismatch");
  if (sha256(stderr) !== entry.hashes.stderr) throw new Error("Stderr hash mismatch");
  if (sha256(sanitizedText) !== entry.hashes.sanitizedRaw) {
    throw new Error("Sanitized hash mismatch");
  }
  if (sha256(scoringText) !== entry.hashes.scoringView) {
    throw new Error("Scoring hash mismatch");
  }
  const sanitized = JSON.parse(sanitizedText);
  const scoring = JSON.parse(scoringText);
  const sanitizedMcp = sanitized.tools.filter((tool) => allowedMcpTool(tool.name));
  if (JSON.stringify(sanitizedMcp) !== JSON.stringify(scoring.mcpCalls)) {
    throw new Error("Scoring MCP calls differ from sanitized raw trace");
  }
  if (sanitized.finalAnswer !== scoring.finalAnswer) {
    throw new Error("Scoring final differs from sanitized raw trace");
  }
  const score = scoreByView.get(entry.viewId);
  if (!score) throw new Error(`Missing score for ${entry.viewId}`);
  process.stdout.write(`${JSON.stringify({
    sequence: entry.sequence,
    arm: entry.arm,
    caseId: entry.caseId,
    run: entry.run,
    score: score.total,
    forbiddenPass: score.forbiddenPass,
    skillInvoked: sanitized.tools.some((tool) => tool.name === "Skill"),
    tools: sanitized.tools.map((tool) => ({
      name: tool.name.startsWith("mcp__osrs-wiki__")
        ? tool.name.replace("mcp__osrs-wiki__", "")
        : tool.name,
      input: tool.input,
      isError: tool.result?.isError ?? null,
    })),
    intermediateText: sanitized.assistantText.map(compactText),
    finalAnswer: sanitized.finalAnswer,
    hashesVerified: true,
  }, null, 2)}\n`);
}
