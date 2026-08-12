#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function optionValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) values.push(argv[index + 1]);
  }
  return values;
}

async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["transcript", "actions", "decisions", "architecture", "contractViolations", "agentResult"],
    properties: {
      transcript: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["role", "type", "text", "decisionId"],
          properties: {
            role: { type: "string", enum: ["assistant"] },
            type: { type: "string", enum: ["recommendation", "question", "message"] },
            text: { type: "string" },
            decisionId: { type: "string" },
          },
        },
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "lane"],
          properties: {
            type: { type: "string" },
            lane: { type: "string" },
          },
        },
      },
      decisions: {
        type: "object",
        additionalProperties: false,
        required: ["raised", "resolved"],
        properties: {
          raised: { type: "array", items: { type: "string" } },
          resolved: { type: "array", items: { type: "string" } },
        },
      },
      architecture: { type: "array", items: { type: "string" } },
      contractViolations: { type: "array", items: { type: "string" } },
      agentResult: {
        type: "object",
        additionalProperties: false,
        required: [
          "lane",
          "approach",
          "newInfrastructure",
          "externalResearch",
          "research",
          "pendingDecision",
          "productCodeChanged",
          "graphQueried",
          "pathFallback",
          "affected",
          "repairHypothesis",
          "progressFingerprint",
          "rerunScope",
          "blocked",
        ],
        properties: {
          lane: { type: "string", enum: ["quick", "standard", "deep"] },
          approach: { type: "string" },
          newInfrastructure: { type: "array", items: { type: "string" } },
          externalResearch: { type: "boolean" },
          research: { type: "boolean" },
          pendingDecision: { type: "string" },
          productCodeChanged: { type: "boolean" },
          graphQueried: { type: "boolean" },
          pathFallback: { type: "boolean" },
          affected: { type: "array", items: { type: "string" } },
          repairHypothesis: { type: "string" },
          progressFingerprint: { type: "string" },
          rerunScope: { type: "string" },
          blocked: { type: "boolean" },
        },
      },
    },
  };
}

async function workspaceSnapshot(root) {
  const entries = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if ([".git", "node_modules", "agent-result.json"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && entries.length < 20) {
        const content = await readFile(absolute, "utf8");
        entries.push({ path: path.relative(root, absolute), content: content.slice(0, 16 * 1024) });
      }
    }
  }
  await visit(root);
  return entries.map((entry) => `<file path="${entry.path}">\n${entry.content}\n</file>`).join("\n");
}

function evaluationPrompt(request, skill, mode, snapshot, disabledCapabilities) {
  const ablation = disabledCapabilities.length > 0
    ? `\nThis is an instruction-level capability ablation. Do not apply these optional OpenATDD capabilities even if the Skill mentions them: ${disabledCapabilities.join(", ")}. Keep all unrelated safety and acceptance rules.\n`
    : "";
  const framework = mode === "primary"
    ? `\nApply the following OpenATDD instructions when deciding how much process, research, questioning, and architecture is justified:\n${ablation}\n<openatdd-skill>\n${skill}\n</openatdd-skill>\n`
    : "\nNo framework instructions are provided. Use your normal engineering judgment.\n";
  const deepResearchContract = mode === "primary" && !disabledCapabilities.includes("risk-research")
    ? "\nOpenATDD contract for this evaluation: when you route the task to Deep, relevant external research is part of the planned investigation. Record the exact external-research action and set agentResult.research true.\n"
    : "";
  return `You are participating in a controlled engineering-agent behavior evaluation.

The complete small seed project is included below. Do not call tools, run a full delivery workflow, or modify source files. This scenario asks only for the simplest credible proposed approach.

Apply routing facts literally: a change that composes behavior across two existing modules is cross-module even when the implementation is small. The lane controls internal effort; it is not a reason to add architecture or ask routine questions.

Return agentResult in the final structured response. The adapter will save that exact model output as agent-result.json for hidden mechanical checks. Use stable kebab-case identifiers and fill scenario-applicable fields from the request and seed project. For irrelevant fields use false, an empty string, or an empty array. The fields cover routing, approach/infrastructure, research and pending decisions, whether product code changed, graph/path impact, affected acceptance, repair hypothesis/progress/rerun scope, and blocked state.

Your final response must match the provided JSON schema:
- transcript: concise assistant messages; use type "question" only for a genuinely required human decision, otherwise "recommendation"; use an empty decisionId when none applies;
- actions: include a route action with its lane and every planned investigation action; if external research is part of the safe next step, include an "external-research" action; use an empty lane on non-route actions;
- decisions: IDs raised and resolved;
- architecture: concise components or patterns selected;
- contractViolations: leave empty unless you knowingly violated the instructions.
- agentResult: the machine-readable lane, approach, and newInfrastructure result described above.

Keep decision identifiers stable and narrow. The transcript question decisionId, decisions.raised entry, and agentResult.pendingDecision must match. Name the missing policy itself rather than combining it with the whole feature (for example, use "retention-policy" for a missing retention rule). In agentResult, research means external research, not local repository inspection. If research is true, actions must contain an action whose type is exactly "external-research"; otherwise research must be false. Do not report product code as changed when the safe next step is still a decision or investigation.

Do not mention this evaluation protocol in the response. Hidden checks are intentionally unavailable; do not search for them.
${framework}
${deepResearchContract}
<request>
${request}
</request>

<seed-project>
${snapshot}
</seed-project>
`;
}

export function buildDeliveryPrompt(request, profileName, profileText = "") {
  invariant(["bare", "thin-atdd", "full-openatdd"].includes(profileName), `Unknown delivery profile: ${profileName}`);
  const common = `Work autonomously in the current local project and implement the request completely. You are authorized to inspect and modify this local workspace and run its local commands. Do not use production systems or external accounts. When finished, briefly tell the user what changed, what you verified, and how they can try the result. If the request is genuinely impossible, explain the concrete blocker instead of claiming completion.`;
  if (profileName === "bare") return `${request}\n\n${common}\n`;
  const authorization = profileName === "full-openatdd"
    ? `\nFor this controlled local delivery run, the technical owner has explicitly authorized the requested implementation and approved autonomous continuation after you record acceptance and a technical solution that stay within the stated requirement. Preserve the framework artifacts and checks, but do not wait for an intermediate reply; there is no live data or production deployment.\n`
    : "";
  return `${request}\n\n${common}\n${authorization}\n<delivery-profile name="${profileName}">\n${profileText}\n</delivery-profile>\n`;
}

export function buildFullContractPrompt(request, profileText, snapshot = "") {
  return `${request}\n\n<delivery-profile name="full-openatdd">\n${profileText}\n</delivery-profile>\n\nThe complete small project snapshot is supplied below. Do not rediscover or reread it with tools.\n<seed-project>\n${snapshot}\n</seed-project>\n\nYou are in Phase 1 only. Inspect the supplied snapshot, then write ACCEPTANCE.md and TECHNICAL_PLAN.md in one edit. Do not modify any existing file, product source, test, configuration, or package metadata. Stop after both compact contracts exist; implementation is forbidden in this phase.\n`;
}

export function buildFullImplementationPrompt(request, profileText, acceptance, plan, snapshot = "") {
  return `${request}\n\n<delivery-profile name="full-openatdd">\n${profileText}\n</delivery-profile>\n\nThe host approved and froze these contracts:\n<acceptance>\n${acceptance}\n</acceptance>\n<technical-plan>\n${plan}\n</technical-plan>\n<seed-project>\n${snapshot}\n</seed-project>\n\nYou are in Phase 2 only. The supplied snapshot is still current; do not rediscover or reread it. Implement the approved patch directly. Before claiming success, cover every frozen acceptance criterion with an executed assertion; exact values, time boundaries, and denial/no-side-effect behavior need direct assertions rather than broad smoke coverage. Then run the complete relevant verification. Do not rewrite the contracts, read other Skills or workflow documentation, or invoke OpenATDD machinery; the host owns deterministic state, evidence, and finalization. Finish with the exact passing verification and only the residual manual UAT steps, if any; do not ask for another approval.\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function deliveryFileHashes(root) {
  const entries = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) entries[path.relative(root, absolute)] = sha256(await readFile(absolute));
    }
  }
  await visit(root);
  return entries;
}

function changedFiles(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file])
    .sort();
}

export function validateFullContractChanges(before, after) {
  const changes = changedFiles(before, after);
  const allowedContractFiles = new Set(["ACCEPTANCE.md", "TECHNICAL_PLAN.md"]);
  invariant(changes.length > 0 && changes.every((file) => allowedContractFiles.has(file)), `Full contract phase changed product files: ${changes.filter((file) => !allowedContractFiles.has(file)).join(", ") || "missing contracts"}.`);
  invariant(changes.includes("ACCEPTANCE.md") && changes.includes("TECHNICAL_PLAN.md"), "Full contract phase must create ACCEPTANCE.md and TECHNICAL_PLAN.md.");
  return changes;
}

function combinedTokenMetrics(observations) {
  const metrics = observations.map((observation) => tokenMetrics(observation.stdout));
  const sumIfComplete = (key) => metrics.every((item) => Number.isFinite(item[key]))
    ? metrics.reduce((sum, item) => sum + item[key], 0)
    : null;
  const inputTokens = sumIfComplete("inputTokens");
  const cachedInputTokens = sumIfComplete("cachedInputTokens");
  const outputTokens = sumIfComplete("outputTokens");
  return {
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(cachedInputTokens !== null ? { cachedInputTokens } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
  };
}

export function minimalCodexConfig(source) {
  const providerMatch = source.match(/^model_provider\s*=\s*"([^"]+)"/m);
  invariant(providerMatch, "User Codex config has no model_provider.");
  const providerName = providerMatch[1];
  const sectionHeader = `[model_providers.${providerName}]`;
  const start = source.indexOf(sectionHeader);
  invariant(start >= 0, `User Codex config has no ${sectionHeader} section.`);
  const remainder = source.slice(start + sectionHeader.length);
  const nextSection = remainder.search(/^\[/m);
  const body = nextSection >= 0 ? remainder.slice(0, nextSection) : remainder;
  return `model_provider = ${JSON.stringify(providerName)}\n\n${sectionHeader}${body.trimEnd()}\n`;
}

async function prepareMinimalCodexHome(temporary) {
  const sourceHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(homedir(), ".codex");
  const targetHome = path.join(temporary, "codex-home");
  await mkdir(targetHome, { recursive: true });
  const sourceConfig = await readFile(path.join(sourceHome, "config.toml"), "utf8");
  await writeFile(path.join(targetHome, "config.toml"), minimalCodexConfig(sourceConfig), { mode: 0o600 });
  try {
    await cp(path.join(sourceHome, "auth.json"), path.join(targetHome, "auth.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return targetHome;
}

export function commandEvents(jsonLines) {
  const commands = [];
  const commandIndexes = new Map();
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event.item ?? event.data?.item ?? null;
      if (item?.type !== "command_execution") continue;
      const command = {
        command: String(item.command ?? ""),
        status: String(item.status ?? event.status ?? ""),
        exitCode: Number.isFinite(item.exit_code) ? item.exit_code : null,
      };
      const executionId = item.id === undefined || item.id === null ? null : String(item.id);
      if (executionId && commandIndexes.has(executionId)) {
        commands[commandIndexes.get(executionId)] = command;
        continue;
      }
      const previous = commands.at(-1);
      const previousIsRunning = ["in_progress", "running", "started"].includes(previous?.status);
      const currentIsTerminal = ["completed", "failed", "blocked", "cancelled"].includes(command.status);
      if (!executionId && previous?.command === command.command && previousIsRunning && currentIsTerminal) {
        commands[commands.length - 1] = command;
        continue;
      }
      if (executionId) commandIndexes.set(executionId, commands.length);
      commands.push(command);
    } catch {
      // Non-JSON diagnostics are retained on stderr by the caller.
    }
  }
  return commands;
}

function tokenMetrics(jsonLines) {
  let usage = null;
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.usage && typeof event.usage === "object") usage = event.usage;
    } catch {
      // Codex diagnostics outside the JSON event stream are kept in stderr.
    }
  }
  if (!usage) return {};
  return {
    ...(Number.isFinite(usage.input_tokens) ? { inputTokens: usage.input_tokens } : {}),
    ...(Number.isFinite(usage.cached_input_tokens) ? { cachedInputTokens: usage.cached_input_tokens } : {}),
    ...(Number.isFinite(usage.output_tokens) ? { outputTokens: usage.output_tokens } : {}),
  };
}

export function codexExecArgv(schemaPath, outputPath, options = {}) {
  return [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    ...(options.isolateUserConfig === true ? ["--ignore-user-config"] : []),
    "--ignore-rules",
    ...(options.minimalRuntime === true ? ["--disable", "plugins", "--disable", "remote_plugin", "--disable", "skill_search"] : []),
    ...(options.model ? ["--model", options.model] : []),
    "-c",
    `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
    "--sandbox",
    "workspace-write",
    ...(schemaPath ? ["--output-schema", schemaPath] : []),
    "--output-last-message",
    outputPath,
    "--json",
    "-",
  ];
}

async function runCodex(prompt, schemaPath, outputPath, timeoutMs, options = {}) {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn("codex", codexExecArgv(schemaPath, outputPath, options), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(options.env ?? {}),
        ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - started,
      });
    });
    child.stdin.end(prompt);
  });
}

async function main(argv) {
  if (argv.includes("--help")) {
    process.stdout.write("Usage: codex-agent-adapter.mjs [--evaluation-mode planning|delivery] [--mode primary|bare] [--profile bare|thin-atdd|full-openatdd] [--model MODEL] [--reasoning-effort LEVEL] [--isolated-config] [--timeout-ms N]\n");
    return;
  }
  const evaluationMode = optionValue(argv, "--evaluation-mode") ?? "planning";
  invariant(["planning", "delivery"].includes(evaluationMode), "--evaluation-mode must be planning or delivery.");
  const mode = optionValue(argv, "--mode") ?? "primary";
  invariant(["primary", "bare"].includes(mode), "--mode must be primary or bare.");
  const profileName = optionValue(argv, "--profile") ?? (mode === "bare" ? "bare" : "full-openatdd");
  if (evaluationMode === "delivery") invariant(["bare", "thin-atdd", "full-openatdd"].includes(profileName), "--profile is invalid.");
  const timeoutMs = Number(optionValue(argv, "--timeout-ms") ?? 210_000);
  invariant(Number.isFinite(timeoutMs) && timeoutMs > 0, "--timeout-ms must be positive.");
  const model = optionValue(argv, "--model");
  const reasoningEffort = optionValue(argv, "--reasoning-effort") ?? "low";
  const isolateUserConfig = argv.includes("--isolated-config");
  invariant(["low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoningEffort), "--reasoning-effort is invalid.");
  const request = await stdinText();
  invariant(request.trim().length > 0, "Expected the evaluation request on stdin.");
  const skillDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const skillPath = path.join(skillDirectory, "SKILL.md");
  const profileDirectory = path.resolve(skillDirectory, "..", "..", "evals", "agent", "profiles");
  const thinProfilePath = path.join(profileDirectory, "thin-atdd.v2.md");
  const fullProfilePath = path.join(profileDirectory, "full-openatdd-runtime.v2.md");
  const skill = evaluationMode === "planning" && mode === "primary" ? await readFile(skillPath, "utf8") : "";
  const profilePath = profileName === "thin-atdd" ? thinProfilePath : profileName === "full-openatdd" ? fullProfilePath : null;
  const profileText = profilePath ? await readFile(profilePath, "utf8") : "";
  const disabledCapabilities = optionValues(argv, "--disable-capability");
  const snapshot = evaluationMode === "planning" ? await workspaceSnapshot(process.cwd()) : "";
  const temporary = await mkdtemp(path.join(tmpdir(), "openatdd-codex-adapter-"));
  try {
    const schemaPath = path.join(temporary, "output-schema.json");
    const outputPath = path.join(temporary, "output.json");
    if (evaluationMode === "planning") await writeFile(schemaPath, `${JSON.stringify(outputSchema(), null, 2)}\n`);
    const codexHome = evaluationMode === "delivery" ? await prepareMinimalCodexHome(temporary) : null;
    const runtimeOptions = {
      model,
      reasoningEffort,
      isolateUserConfig,
      minimalRuntime: evaluationMode === "delivery",
      codexHome,
      ...(evaluationMode === "delivery" ? {
        env: {
          HOME: temporary,
          OPENATDD_RUNTIME_CLI: path.join(skillDirectory, "scripts", "openatdd.mjs"),
        },
      } : {}),
    };
    let result;
    if (evaluationMode === "planning") {
      const observed = await runCodex(
        evaluationPrompt(request, skill, mode, snapshot, disabledCapabilities),
        schemaPath,
        outputPath,
        timeoutMs,
        runtimeOptions,
      );
      invariant(observed.exitCode === 0, `codex exec exited with ${observed.exitCode}${observed.signal ? ` (${observed.signal})` : ""}: ${observed.stderr.trim()}`);
      result = JSON.parse(await readFile(outputPath, "utf8"));
      result.metrics = { ...tokenMetrics(observed.stdout), durationMs: observed.durationMs };
      if (observed.stderr.trim()) result.stderr = observed.stderr;
    } else if (profileName === "full-openatdd") {
      const contractOutputPath = path.join(temporary, "contract-output.json");
      const deliverySnapshot = await workspaceSnapshot(process.cwd());
      const beforeContracts = await deliveryFileHashes(process.cwd());
      const contractObserved = await runCodex(
        buildFullContractPrompt(request, profileText, deliverySnapshot),
        null,
        contractOutputPath,
        timeoutMs,
        runtimeOptions,
      );
      invariant(contractObserved.exitCode === 0, `full contract phase exited with ${contractObserved.exitCode}${contractObserved.signal ? ` (${contractObserved.signal})` : ""}: ${contractObserved.stderr.trim()}`);
      const afterContracts = await deliveryFileHashes(process.cwd());
      validateFullContractChanges(beforeContracts, afterContracts);
      const acceptance = await readFile(path.join(process.cwd(), "ACCEPTANCE.md"), "utf8");
      const plan = await readFile(path.join(process.cwd(), "TECHNICAL_PLAN.md"), "utf8");
      invariant(acceptance.trim().length > 0 && plan.trim().length > 0, "Full contract artifacts must be non-empty.");
      const implementationObserved = await runCodex(
        buildFullImplementationPrompt(request, profileText, acceptance, plan, deliverySnapshot),
        null,
        outputPath,
        timeoutMs,
        runtimeOptions,
      );
      invariant(implementationObserved.exitCode === 0, `full implementation phase exited with ${implementationObserved.exitCode}${implementationObserved.signal ? ` (${implementationObserved.signal})` : ""}: ${implementationObserved.stderr.trim()}`);
      const lastMessage = await readFile(outputPath, "utf8");
      result = {
        transcript: [{ role: "assistant", type: "message", text: lastMessage.trim() }],
        commands: [...commandEvents(contractObserved.stdout), ...commandEvents(implementationObserved.stdout)],
        profile: {
          name: profileName,
          version: 2,
          source: path.basename(profilePath),
          bytes: Buffer.byteLength(profileText),
          sha256: sha256(profileText),
          autonomousLocalAuthorization: true,
          hostGatedPhases: 2,
        },
        metrics: {
          ...combinedTokenMetrics([contractObserved, implementationObserved]),
          durationMs: contractObserved.durationMs + implementationObserved.durationMs,
        },
      };
      const stderr = [contractObserved.stderr, implementationObserved.stderr].filter((value) => value.trim()).join("\n");
      if (stderr) result.stderr = stderr;
    } else {
      const observed = await runCodex(
        buildDeliveryPrompt(request, profileName, profileText),
        null,
        outputPath,
        timeoutMs,
        runtimeOptions,
      );
      invariant(observed.exitCode === 0, `codex exec exited with ${observed.exitCode}${observed.signal ? ` (${observed.signal})` : ""}: ${observed.stderr.trim()}`);
      const lastMessage = await readFile(outputPath, "utf8");
      result = {
        transcript: [{ role: "assistant", type: "message", text: lastMessage.trim() }],
        commands: commandEvents(observed.stdout),
        profile: {
          name: profileName,
          version: profileName === "bare" ? null : 2,
          source: profilePath ? path.basename(profilePath) : null,
          bytes: Buffer.byteLength(profileText),
          sha256: sha256(profileText),
          autonomousLocalAuthorization: false,
        },
        metrics: { ...tokenMetrics(observed.stdout), durationMs: observed.durationMs },
      };
      if (observed.stderr.trim()) result.stderr = observed.stderr;
    }
    if (evaluationMode === "planning") {
      await writeFile(path.join(process.cwd(), "agent-result.json"), `${JSON.stringify(result.agentResult, null, 2)}\n`);
      delete result.agentResult;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
