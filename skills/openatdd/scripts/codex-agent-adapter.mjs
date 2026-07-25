#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function runCodex(prompt, schemaPath, outputPath, timeoutMs, options = {}) {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn("codex", [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      ...(options.model ? ["--model", options.model] : []),
      "-c",
      `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
      "--sandbox",
      "workspace-write",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--json",
      "-",
    ], {
      cwd: process.cwd(),
      env: process.env,
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
    process.stdout.write("Usage: codex-agent-adapter.mjs [--mode primary|bare] [--model MODEL] [--reasoning-effort LEVEL] [--timeout-ms N]\n");
    return;
  }
  const mode = optionValue(argv, "--mode") ?? "primary";
  invariant(["primary", "bare"].includes(mode), "--mode must be primary or bare.");
  const timeoutMs = Number(optionValue(argv, "--timeout-ms") ?? 210_000);
  invariant(Number.isFinite(timeoutMs) && timeoutMs > 0, "--timeout-ms must be positive.");
  const model = optionValue(argv, "--model");
  const reasoningEffort = optionValue(argv, "--reasoning-effort") ?? "low";
  invariant(["low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoningEffort), "--reasoning-effort is invalid.");
  const request = await stdinText();
  invariant(request.trim().length > 0, "Expected the evaluation request on stdin.");
  const skillPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");
  const skill = mode === "primary" ? await readFile(skillPath, "utf8") : "";
  const disabledCapabilities = optionValues(argv, "--disable-capability");
  const snapshot = await workspaceSnapshot(process.cwd());
  const temporary = await mkdtemp(path.join(tmpdir(), "openatdd-codex-adapter-"));
  try {
    const schemaPath = path.join(temporary, "output-schema.json");
    const outputPath = path.join(temporary, "output.json");
    await writeFile(schemaPath, `${JSON.stringify(outputSchema(), null, 2)}\n`);
    const observed = await runCodex(
      evaluationPrompt(request, skill, mode, snapshot, disabledCapabilities),
      schemaPath,
      outputPath,
      timeoutMs,
      { model, reasoningEffort },
    );
    invariant(observed.exitCode === 0, `codex exec exited with ${observed.exitCode}${observed.signal ? ` (${observed.signal})` : ""}: ${observed.stderr.trim()}`);
    const result = JSON.parse(await readFile(outputPath, "utf8"));
    await writeFile(path.join(process.cwd(), "agent-result.json"), `${JSON.stringify(result.agentResult, null, 2)}\n`);
    delete result.agentResult;
    result.metrics = {
      ...tokenMetrics(observed.stdout),
      durationMs: observed.durationMs,
    };
    if (observed.stderr.trim()) result.stderr = observed.stderr;
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
