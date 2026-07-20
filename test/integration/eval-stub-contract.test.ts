import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const EXPECTED_TOOLS = [
  "search_wiki",
  "get_wiki_page",
  "get_wiki_sections",
  "get_wiki_section",
  "get_item_info",
  "find_shop",
  "find_drop_sources",
  "get_item_sources",
  "get_quest_requirements",
  "get_monster_info",
];

interface EvalCase {
  id: string;
  prompt: string;
  scenario: string;
  requiredToolSequence: string[];
  requiredAnswerBehaviors: string[];
  forbiddenAnswerBehaviors: string[];
}

interface EvalSuite {
  cases: EvalCase[];
  protocol?: {
    classification?: string;
    priorResultsImmutable?: boolean;
  };
}

interface EvalRubric {
  dimensions: Array<{
    id: string;
    zero: string;
    one: string;
    two: string;
  }>;
  passCriteria: {
    minimumTreatmentMean: number;
    minimumTreatmentMeanImprovement: number;
    minimumCasesImprovedOrTied: number;
  };
}

async function loadJson<T>(relativePath: string): Promise<T> {
  const file = new URL(`../../evals/osrs-wiki-research/${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function structured(result: CallToolResult): Record<string, unknown> {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.ok(result.structuredContent);
  return result.structuredContent;
}

test("synthetic stdio fixture exposes all ten real tools and recovery paths without network", async () => {
  const serverPath = fileURLToPath(
    new URL("../../evals/osrs-wiki-research/stub-server.mjs", import.meta.url),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });
  const client = new Client({ name: "osrs-wiki-eval-contract", version: "1.1.0" });

  try {
    await client.connect(transport);
    assert.match(client.getInstructions() ?? "", /most specific OSRS Wiki tool/u);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), EXPECTED_TOOLS);

    const search = structured(await client.callTool({
      name: "search_wiki",
      arguments: { query: "ambiguous test sword" },
    }) as CallToolResult);
    assert.equal((search.results as unknown[]).length, 2);

    const page = structured(await client.callTool({
      name: "get_wiki_page",
      arguments: { title: "Long test page" },
    }) as CallToolResult);
    assert.equal(page.truncated, true);
    assert.match((page.warnings as string[]).join(" "), /get_wiki_sections.*get_wiki_section/u);

    const sections = structured(await client.callTool({
      name: "get_wiki_sections",
      arguments: { title: "Long test page" },
    }) as CallToolResult);
    assert.equal((sections.sections as unknown[]).length, 2);

    const section = structured(await client.callTool({
      name: "get_wiki_section",
      arguments: { title: "Long test page", section: 1 },
    }) as CallToolResult);
    assert.match(section.content as string, /Recovered synthetic section 1/u);

    structured(await client.callTool({
      name: "get_item_info",
      arguments: { item: "Test sword" },
    }) as CallToolResult);
    structured(await client.callTool({
      name: "find_shop",
      arguments: { item: "Test sword", limit: 2 },
    }) as CallToolResult);

    const overview = structured(await client.callTool({
      name: "get_item_sources",
      arguments: { item: "Test sword", perCategoryLimit: 2 },
    }) as CallToolResult);
    const overviewDrops = overview.drops as Record<string, unknown>;
    assert.equal(overviewDrops.truncated, true);
    assert.equal(overviewDrops.nextOffset, 2);
    assert.match((overview.warnings as string[]).join(" "), /find_drop_sources.*offset 2/u);

    const remainingDrops = structured(await client.callTool({
      name: "find_drop_sources",
      arguments: { item: "Test sword", offset: 2, limit: 100 },
    }) as CallToolResult);
    assert.equal(remainingDrops.returned, 3);
    assert.equal(remainingDrops.truncated, false);

    const quest = structured(await client.callTool({
      name: "get_quest_requirements",
      arguments: { quest: "Example quest" },
    }) as CallToolResult);
    assert.equal(quest.quest, "Example quest");
    assert.equal("met" in quest, false);
    assert.equal("missing" in quest, false);

    const monster = structured(await client.callTool({
      name: "get_monster_info",
      arguments: { monster: "Test beast" },
    }) as CallToolResult);
    assert.deepEqual(
      (monster.variants as Array<{ anchor: string }>).map(({ anchor }) => anchor),
      ["Standard", "Armoured"],
    );
  } finally {
    await client.close();
  }
});

test("external DPS fixture is a distinct one-tool non-Wiki capability", async () => {
  const serverPath = fileURLToPath(
    new URL("../../evals/osrs-wiki-research/external-dps-stub-server.mjs", import.meta.url),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });
  const client = new Client({ name: "external-dps-eval-contract", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), ["calculate_synthetic_dps"]);

    const result = structured(await client.callTool({
      name: "calculate_synthetic_dps",
      arguments: {
        attackRoll: 12000,
        maxHit: 30,
        attackIntervalTicks: 4,
        targetDefence: 150,
      },
    }) as CallToolResult);
    assert.equal(result.syntheticDps, 7.5);
    assert.equal(result.sourceKind, "external-evaluation-tool");
    assert.equal(result.networkAttempts, 0);
    assert.match(result.warning as string, /not OSRS Wiki data/u);
  } finally {
    await client.close();
  }
});

test("product-contract v2 preregistration is fresh and keeps external DPS help composable", async () => {
  const priorSuites = await Promise.all([
    loadJson<EvalSuite>("diagnostic-cases.json"),
    loadJson<EvalSuite>("held-out-cases.json"),
    loadJson<EvalSuite>("confirmatory-cases.json"),
    loadJson<EvalSuite>("confirmatory-v2-cases.json"),
  ]);
  const suite = await loadJson<EvalSuite>("product-contract-v2-cases.json");
  const rubric = await loadJson<EvalRubric>("rubric-v2.json");
  const skill = await readFile(
    new URL("../../skills/osrs-wiki-research/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.equal(suite.cases.length, 8);
  assert.equal(new Set(suite.cases.map(({ id }) => id)).size, 8);
  assert.equal(suite.protocol?.classification, "new-product-contract-hypothesis");
  assert.equal(suite.protocol?.priorResultsImmutable, true);

  const priorPrompts = new Set(priorSuites.flatMap(({ cases }) => cases.map(({ prompt }) => prompt)));
  for (const { prompt } of suite.cases) {
    assert.equal(priorPrompts.has(prompt), false, `reused prior prompt: ${prompt}`);
  }

  const promptFor = (scenario: string) => {
    const evalCase = suite.cases.find((candidate) => candidate.scenario === scenario);
    assert.ok(evalCase);
    return evalCase.prompt;
  };
  assert.doesNotMatch(promptFor("ambiguous-title"), /canonical|single|one article/iu);
  assert.doesNotMatch(promptFor("long-page-section-recovery"), /section index|before retriev|truncat/iu);
  assert.doesNotMatch(promptFor("dps-capability-separation"), /explicitly outside|cannot inspect|cannot calculate/iu);

  const dpsCase = suite.cases.find(({ scenario }) => scenario === "dps-capability-separation");
  assert.ok(dpsCase);
  assert.ok(dpsCase.requiredAnswerBehaviors.includes("labels any external DPS workflow as outside this MCP"));
  assert.ok(dpsCase.forbiddenAnswerBehaviors.includes("blurs an external workflow into MCP or Wiki capability"));
  assert.equal(
    dpsCase.forbiddenAnswerBehaviors.some((behavior) => /request.*input|future.*calculation/iu.test(behavior)),
    false,
  );

  const scope = rubric.dimensions.find(({ id }) => id === "scope-safety");
  assert.ok(scope);
  assert.match(scope.zero, /attributes.*DPS.*MCP|DPS.*as MCP/iu);
  assert.match(scope.one, /fails to clearly separate.*external/iu);
  assert.match(scope.two, /explicitly outside this MCP/iu);

  assert.match(skill, /when the request asks for supported Wiki facts/iu);
  assert.doesNotMatch(skill, /when the request names an item, quest, monster, or page/iu);
  assert.match(skill, /when the user asks for complete results in a category/iu);
  assert.match(skill, /disclose other truncation or incompleteness/iu);
  const provenance = rubric.dimensions.find(({ id }) => id === "provenance-use");
  assert.ok(provenance);
  assert.match(provenance.two, /URL.*attribution or license.*fetch age/iu);
  for (const evalCase of suite.cases.filter(({ requiredToolSequence }) =>
    requiredToolSequence.some((name) => name !== "calculate_synthetic_dps"))) {
    assert.ok(
      evalCase.requiredAnswerBehaviors.some((behavior) =>
        /canonical provenance URL.*attribution or license.*fetch age/iu.test(behavior)),
      `incomplete provenance requirement: ${evalCase.id}`,
    );
  }
  assert.equal(rubric.passCriteria.minimumTreatmentMean, 8.5);
  assert.equal(rubric.passCriteria.minimumTreatmentMeanImprovement, 1);
  assert.equal(rubric.passCriteria.minimumCasesImprovedOrTied, 7);
});

test("product-contract scoring and audit preserve the external MCP call", async () => {
  const root = await mkdtemp(join(tmpdir(), "osrs-wiki-product-contract-"));
  try {
    const rawDir = join(root, "raw");
    const sanitizedDir = join(root, "sanitized");
    const scoringDir = join(root, "scoring");
    await mkdir(rawDir);

    const rawPath = join(rawDir, "trace.jsonl");
    const stderrPath = join(rawDir, "trace.stderr.txt");
    const rawEvents = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "skill-1", name: "Skill", input: { skill: "osrs-wiki-research" } },
            {
              type: "tool_use",
              id: "external-1",
              name: "mcp__external-dps__calculate_synthetic_dps",
              input: { attackRoll: 12000, maxHit: 30, attackIntervalTicks: 4, targetDefence: 150 },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "external-1",
            is_error: false,
            content: [{ type: "text", text: "{\"syntheticDps\":7.5}" }],
          }],
        },
      },
      { type: "result", result: "Wiki MCP: unsupported. External calculator: 7.5 synthetic DPS." },
    ];
    await writeFile(rawPath, `${rawEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    await writeFile(stderrPath, "", "utf8");

    const rawIndexPath = join(rawDir, "index.json");
    await writeFile(rawIndexPath, JSON.stringify([{
      sequence: 1,
      arm: "treatment",
      caseId: "product-contract-v2-dps-capability-separation",
      scenario: "dps-capability-separation",
      run: 1,
      stdoutFile: rawPath,
      stderrFile: stderrPath,
    }]), "utf8");

    const casesPath = fileURLToPath(
      new URL("../../evals/osrs-wiki-research/product-contract-v2-cases.json", import.meta.url),
    );
    const preparePath = fileURLToPath(
      new URL("../../evals/osrs-wiki-research/prepare-scoring-v2.mjs", import.meta.url),
    );
    const mappingPath = join(root, "mapping.json");
    const prepared = spawnSync(process.execPath, [
      preparePath,
      casesPath,
      rawIndexPath,
      sanitizedDir,
      scoringDir,
      mappingPath,
    ], { encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);

    const scoringIndex = JSON.parse(await readFile(join(scoringDir, "index.json"), "utf8")) as Array<{
      viewId: string;
      scoringViewFile: string;
    }>;
    assert.equal(scoringIndex.length, 1);
    const [scoringEntry] = scoringIndex;
    assert.ok(scoringEntry);
    const scoringView = JSON.parse(await readFile(scoringEntry.scoringViewFile, "utf8")) as {
      mcpCalls: Array<{ name: string }>;
    };
    assert.deepEqual(scoringView.mcpCalls.map(({ name }) => name), [
      "mcp__external-dps__calculate_synthetic_dps",
    ]);

    const scoresPath = join(root, "scores.json");
    await writeFile(scoresPath, JSON.stringify({ scores: [{
      viewId: scoringEntry.viewId,
      total: 10,
      dimensions: [2, 2, 2, 2, 2],
      forbiddenPass: true,
    }] }), "utf8");
    const auditPath = fileURLToPath(
      new URL("../../evals/osrs-wiki-research/audit-raw-traces-v2.mjs", import.meta.url),
    );
    const audited = spawnSync(process.execPath, [
      auditPath,
      casesPath,
      mappingPath,
      scoresPath,
      "0",
      "1",
    ], { encoding: "utf8" });
    assert.equal(audited.status, 0, audited.stderr);
    assert.match(audited.stdout, /mcp__external-dps__calculate_synthetic_dps/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("product-contract runner freezes the ten Wiki tools plus the external calculator", () => {
  const runnerPath = fileURLToPath(
    new URL("../../evals/osrs-wiki-research/run-product-contract-v2.mjs", import.meta.url),
  );
  const casesPath = fileURLToPath(
    new URL("../../evals/osrs-wiki-research/product-contract-v2-cases.json", import.meta.url),
  );
  const result = spawnSync(process.execPath, [runnerPath, "--print-tool-allowlist", casesPath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const allowlist = JSON.parse(result.stdout) as string[];
  assert.equal(allowlist.length, 11);
  assert.equal(allowlist.filter((name) => name.startsWith("mcp__osrs-wiki__")).length, 10);
  assert.ok(allowlist.includes("mcp__external-dps__calculate_synthetic_dps"));
});

test("one rendered MCP config connects both servers and is identical for both arms", async () => {
  const root = await mkdtemp(join(tmpdir(), "osrs-wiki-product-contract-config-"));
  try {
    const configPath = join(root, "eval-mcp.json");
    const builderPath = fileURLToPath(
      new URL("../../evals/osrs-wiki-research/build-product-contract-v2-mcp-config.mjs", import.meta.url),
    );
    const built = spawnSync(process.execPath, [builderPath, configPath], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);

    const configText = await readFile(configPath, "utf8");
    const config = JSON.parse(configText) as {
      mcpServers: {
        "osrs-wiki": { command: string; args: string[] };
        "external-dps": { command: string; args: string[] };
      };
    };
    assert.deepEqual(Object.keys(config.mcpServers), ["osrs-wiki", "external-dps"]);
    assert.equal(config.mcpServers["osrs-wiki"].command, process.execPath);
    assert.equal(config.mcpServers["external-dps"].command, process.execPath);
    assert.deepEqual(config.mcpServers["osrs-wiki"].args, [fileURLToPath(
      new URL("../../evals/osrs-wiki-research/stub-server.mjs", import.meta.url),
    )]);
    assert.deepEqual(config.mcpServers["external-dps"].args, [fileURLToPath(
      new URL("../../evals/osrs-wiki-research/external-dps-stub-server.mjs", import.meta.url),
    )]);

    for (const [serverName, expectedTools] of [
      ["osrs-wiki", EXPECTED_TOOLS],
      ["external-dps", ["calculate_synthetic_dps"]],
    ] as const) {
      const definition = config.mcpServers[serverName];
      const transport = new StdioClientTransport({
        command: definition.command,
        args: definition.args,
        stderr: "pipe",
      });
      const client = new Client({ name: `config-contract-${serverName}`, version: "1.0.0" });
      try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(({ name }) => name), expectedTools);
      } finally {
        await client.close();
      }
    }

    const runnerPath = fileURLToPath(
      new URL("../../evals/osrs-wiki-research/run-product-contract-v2.mjs", import.meta.url),
    );
    const configHash = createHash("sha256").update(configText, "utf8").digest("hex").toUpperCase();
    const suite = await loadJson<{
      protocol: {
        preregisteredDependencies: {
          renderedMcpConfigSha256: string;
          distRuntimeAggregateSha256: string;
        };
      };
    }>("product-contract-v2-cases.json");
    // The superseded preregistration deliberately preserves the original machine's
    // absolute Node, checkout, and fixture paths. After checking the semantic launcher
    // identity above, exercise the unchanged runner with only the machine-local raw
    // config hash replaced in a temporary suite copy.
    const machineSuite = structuredClone(suite);
    machineSuite.protocol.preregisteredDependencies.renderedMcpConfigSha256 = configHash;
    const contractCasesPath = join(root, "machine-product-contract-v2-cases.json");
    await writeFile(contractCasesPath, `${JSON.stringify(machineSuite, null, 2)}\n`, "utf8");
    const contractResult = spawnSync(process.execPath, [
      runnerPath,
      "--print-run-contract",
      contractCasesPath,
      configPath,
    ], { encoding: "utf8" });
    assert.equal(contractResult.status, 0, contractResult.stderr);
    const contract = JSON.parse(contractResult.stdout) as {
      mcpConfigForArms: { baseline: string; treatment: string };
      mcpConfigSha256: string;
      distRuntimeAggregateSha256: string;
      toolAllowlist: string[];
    };
    assert.equal(contract.mcpConfigForArms.baseline, contract.mcpConfigForArms.treatment);
    assert.equal(contract.toolAllowlist.length, 11);
    assert.equal(contract.mcpConfigSha256, configHash);
    assert.match(contract.distRuntimeAggregateSha256, /^[A-F0-9]{64}$/u);
    assert.equal(
      contract.distRuntimeAggregateSha256,
      suite.protocol.preregisteredDependencies.distRuntimeAggregateSha256,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
