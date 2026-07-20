import { spawn, spawnSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const WIKI_TOOL_NAMES = [
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

function frozenToolIds(suite) {
  const externalToolId = suite.protocol?.externalCapabilityCondition?.toolId;
  if (!/^mcp__external-dps__[a-z0-9_]+$/u.test(externalToolId ?? "")) {
    throw new Error("Suite must freeze one external-dps MCP tool ID");
  }
  return [
    ...WIKI_TOOL_NAMES.map((name) => `mcp__osrs-wiki__${name}`),
    externalToolId,
  ];
}

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function collectRuntimeFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRuntimeFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

async function distRuntimeAggregateSha256(configText) {
  const config = JSON.parse(configText);
  const wikiStubPath = config.mcpServers?.["osrs-wiki"]?.args?.[0];
  if (!wikiStubPath) throw new Error("MCP config is missing the Wiki stub path");
  const distRoot = resolve(dirname(wikiStubPath), "..", "..", "dist");
  const files = await collectRuntimeFiles(distRoot);
  if (files.length === 0) throw new Error(`No generated JavaScript runtime found in ${distRoot}`);
  const records = [];
  for (const path of files) {
    records.push(`${relative(distRoot, path).replaceAll("\\", "/")}\0${sha256(await readFile(path))}`);
  }
  return sha256(records.join("\n"));
}

function verifyFrozenRuntime(suite, configText, runtimeHash) {
  const dependencies = suite.protocol?.preregisteredDependencies;
  const configHash = sha256(configText);
  if (dependencies?.renderedMcpConfigSha256 !== configHash) {
    throw new Error("Rendered MCP config hash does not match preregistration");
  }
  if (dependencies?.distRuntimeAggregateSha256 !== runtimeHash) {
    throw new Error("Generated dist runtime hash does not match preregistration");
  }
  return configHash;
}

function commandLine(claudeCommand, args) {
  if (/\.ps1$/iu.test(claudeCommand)) {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        claudeCommand,
        ...args,
      ],
    };
  }
  return { command: claudeCommand, args };
}

if (process.argv[2] === "--print-tool-allowlist") {
  const suitePath = process.argv[3];
  if (!suitePath) throw new Error("Missing suite path");
  const suite = JSON.parse(await readFile(suitePath, "utf8"));
  process.stdout.write(`${JSON.stringify(frozenToolIds(suite))}\n`);
} else if (process.argv[2] === "--print-dist-runtime-hash") {
  const mcpConfig = process.argv[3];
  if (!mcpConfig) throw new Error("Usage: --print-dist-runtime-hash <mcp-config>");
  const configText = await readFile(mcpConfig, "utf8");
  process.stdout.write(`${await distRuntimeAggregateSha256(configText)}\n`);
} else if (process.argv[2] === "--print-run-contract") {
  const suitePath = process.argv[3];
  const mcpConfig = process.argv[4];
  if (!suitePath || !mcpConfig) {
    throw new Error("Usage: --print-run-contract <suite> <mcp-config>");
  }
  const suite = JSON.parse(await readFile(suitePath, "utf8"));
  const configText = await readFile(mcpConfig, "utf8");
  const config = JSON.parse(configText);
  if (JSON.stringify(Object.keys(config.mcpServers ?? {})) !== JSON.stringify(["osrs-wiki", "external-dps"])) {
    throw new Error("MCP config must contain exactly osrs-wiki and external-dps in frozen order");
  }
  const resolvedConfig = resolve(mcpConfig);
  const runtimeHash = await distRuntimeAggregateSha256(configText);
  const configHash = verifyFrozenRuntime(suite, configText, runtimeHash);
  process.stdout.write(`${JSON.stringify({
    mcpConfigForArms: {
      baseline: resolvedConfig,
      treatment: resolvedConfig,
    },
    mcpConfigSha256: configHash,
    distRuntimeAggregateSha256: runtimeHash,
    toolAllowlist: frozenToolIds(suite),
  })}\n`);
} else {
  const [
    casesPath,
    baselinePlugin,
    treatmentPlugin,
    mcpConfig,
    projectDir,
    outputDir,
    claudeCommand,
  ] = process.argv.slice(2);

  if (![casesPath, baselinePlugin, treatmentPlugin, mcpConfig, projectDir, outputDir, claudeCommand].every(Boolean)) {
    throw new Error(
      "Usage: run-product-contract-v2.mjs <cases> <baseline-plugin> <treatment-plugin> <mcp> <project> <output> <claude-command>",
    );
  }

  const suite = JSON.parse(await readFile(casesPath, "utf8"));
  const expectedVersion = suite.frozenEnvironment?.claudeCodeVersion;
  const model = suite.frozenEnvironment?.model;
  const effort = suite.frozenEnvironment?.effort;
  if (
    !expectedVersion ||
    !model ||
    !effort ||
    !Array.isArray(suite.cases) ||
    suite.protocol?.finalPreregisteredQualificationEvaluation !== true
  ) {
    throw new Error("Invalid product-contract-v2 preregistered suite");
  }
  const configText = await readFile(mcpConfig, "utf8");
  const runtimeHash = await distRuntimeAggregateSha256(configText);
  verifyFrozenRuntime(suite, configText, runtimeHash);

  const versionArgs = ["--version"];
  const versionCommand = commandLine(claudeCommand, versionArgs);
  const versionResult = spawnSync(versionCommand.command, versionCommand.args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (
    versionResult.status !== 0 ||
    !versionResult.stdout.trim().includes(expectedVersion)
  ) {
    throw new Error(
      `Claude version mismatch: expected ${expectedVersion}, got ${versionResult.stdout.trim() || versionResult.stderr.trim()}`,
    );
  }

  const allowed = frozenToolIds(suite).join(",");
  await mkdir(outputDir, { recursive: true });
  if ((await readdir(outputDir)).length > 0) {
    throw new Error(`Output directory must be empty: ${outputDir}`);
  }

  const blocks = [];
  for (const evalCase of suite.cases) {
    for (let run = 1; run <= 2; run += 1) {
      const firstArm = randomInt(2) === 0 ? "baseline" : "treatment";
      const secondArm = firstArm === "baseline" ? "treatment" : "baseline";
      blocks.push([
        { caseId: evalCase.id, run, arm: firstArm },
        { caseId: evalCase.id, run, arm: secondArm },
      ]);
    }
  }
  for (let index = blocks.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [blocks[index], blocks[swap]] = [blocks[swap], blocks[index]];
  }

  const caseById = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase]));
  const schedule = blocks.flat().map((entry, index) => ({ sequence: index + 1, ...entry }));
  await writeFile(
    resolve(outputDir, "schedule.json"),
    JSON.stringify(schedule, null, 2),
    "utf8",
  );

  const records = [];
  for (const entry of schedule) {
    const evalCase = caseById.get(entry.caseId);
    if (!evalCase) throw new Error(`Unknown case: ${entry.caseId}`);
    const pluginDir = entry.arm === "baseline" ? baselinePlugin : treatmentPlugin;
    const id = randomUUID();
    const stdoutPath = resolve(outputDir, `${id}.jsonl`);
    const stderrPath = resolve(outputDir, `${id}.stderr.txt`);
    const claudeArgs = [
      "-p",
      "--model",
      model,
      "--effort",
      effort,
      "--plugin-dir",
      pluginDir,
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
      "--setting-sources",
      "project",
      "--no-session-persistence",
      "--tools",
      "Skill",
      "--allowedTools",
      allowed,
      "--output-format",
      "stream-json",
      "--verbose",
      evalCase.prompt,
    ];
    const invocation = commandLine(claudeCommand, claudeArgs);
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const exitCode = await new Promise((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Timed out: ${entry.caseId} run ${entry.run}`));
      }, 180_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });

    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    records.push({
      ...entry,
      scenario: evalCase.scenario,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      exitCode,
      stdoutFile: stdoutPath,
      stderrFile: stderrPath,
    });
    await writeFile(resolve(outputDir, "index.json"), JSON.stringify(records, null, 2), "utf8");
    process.stdout.write(
      `product-contract ${entry.sequence}/${schedule.length}: ${entry.caseId} run ${entry.run} exit ${exitCode}\n`,
    );
    if (exitCode !== 0) {
      throw new Error(`Claude exited ${exitCode} for ${entry.caseId} run ${entry.run}`);
    }
  }
}
