#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { capabilityProfile } from "./strategy.mjs";

const SCENARIO_SCHEMA_VERSION = 1;
const DELIVERY_SCENARIO_SCHEMA_VERSION = 2;
const DELIVERY_REPORT_SCHEMA_VERSION = 2;
const RUBRIC_SCHEMA_VERSION = 1;
const DELIVERY_PROFILES = Object.freeze(["bare", "thin-atdd", "full-openatdd"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function inside(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absolute);
  invariant(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)), `Path leaves evaluation workspace: ${candidate}`);
  return absolute;
}

async function readJson(target) {
  const source = await readFile(target, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${target}: ${error.message}`);
  }
}

function validateScenario(scenario, source = "scenario") {
  invariant(scenario && typeof scenario === "object" && !Array.isArray(scenario), `${source} must be an object.`);
  invariant([SCENARIO_SCHEMA_VERSION, DELIVERY_SCENARIO_SCHEMA_VERSION].includes(scenario.schemaVersion), `${source} uses unsupported schemaVersion ${scenario.schemaVersion}.`);
  invariant(typeof scenario.id === "string" && scenario.id.length > 0, `${source} requires an id.`);
  invariant(typeof scenario.prompt === "string" && scenario.prompt.trim().length > 0, `${source} requires a prompt.`);
  invariant(typeof scenario.rubric === "string" && scenario.rubric.length > 0, `${source} requires a rubric path.`);
  if (scenario.schemaVersion === SCENARIO_SCHEMA_VERSION) {
    invariant(scenario.expect && typeof scenario.expect === "object", `${source} requires expect rules.`);
  } else {
    invariant(scenario.kind === "delivery", `${source} schemaVersion 2 requires kind=delivery.`);
    invariant(["simple", "medium", "complex"].includes(scenario.difficulty), `${source} requires simple, medium, or complex difficulty.`);
    invariant(typeof scenario.seed?.directory === "string" && scenario.seed.directory.length > 0, `${source} delivery scenario requires seed.directory.`);
  }
  invariant(Array.isArray(scenario.hiddenChecks) && scenario.hiddenChecks.length > 0, `${source} requires at least one hidden check.`);
  for (const check of scenario.hiddenChecks) {
    invariant(typeof check.id === "string" && check.id.length > 0, `${source} hidden checks require an id.`);
    invariant(Array.isArray(check.argv) && check.argv.length > 0 && check.argv.every((part) => typeof part === "string"), `${source} hidden check ${check.id} requires string argv.`);
  }
  return scenario;
}

function validateRubric(rubric, source = "rubric") {
  invariant(rubric && typeof rubric === "object" && !Array.isArray(rubric), `${source} must be an object.`);
  invariant(rubric.schemaVersion === RUBRIC_SCHEMA_VERSION, `${source} uses unsupported schemaVersion ${rubric.schemaVersion}.`);
  invariant(Number.isFinite(rubric.passScore), `${source} requires passScore.`);
  invariant(rubric.penalties && typeof rubric.penalties === "object", `${source} requires penalties.`);
  invariant(rubric.gates && typeof rubric.gates === "object", `${source} requires gates.`);
  return rubric;
}

function normalizeTranscript(value) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return { role: "assistant", type: "message", text: entry, turn: index + 1 };
      return {
        role: entry.role ?? "assistant",
        type: entry.type ?? "message",
        text: String(entry.text ?? ""),
        ...(entry.decisionId ? { decisionId: String(entry.decisionId) } : {}),
        turn: entry.turn ?? index + 1,
      };
    });
  }
  if (typeof value === "string" && value.length > 0) return [{ role: "assistant", type: "message", text: value, turn: 1 }];
  return [];
}

function normalizeResult(value, fallbackDurationMs) {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value : { transcript: String(value ?? "") };
  return {
    transcript: normalizeTranscript(result.transcript ?? result.response ?? ""),
    actions: Array.isArray(result.actions) ? clone(result.actions) : [],
    decisions: {
      raised: Array.isArray(result.decisions?.raised) ? [...result.decisions.raised].map(String) : [],
      resolved: Array.isArray(result.decisions?.resolved) ? [...result.decisions.resolved].map(String) : [],
    },
    architecture: Array.isArray(result.architecture) ? [...result.architecture].map(String) : [],
    contractViolations: Array.isArray(result.contractViolations) ? [...result.contractViolations].map(String) : [],
    commands: Array.isArray(result.commands) ? result.commands.map((item) => ({
      command: String(item?.command ?? ""),
      status: String(item?.status ?? ""),
      exitCode: Number.isFinite(item?.exitCode) ? item.exitCode : null,
    })) : [],
    profile: result.profile && typeof result.profile === "object" ? clone(result.profile) : null,
    metrics: {
      ...(Number.isFinite(result.metrics?.inputTokens) ? { inputTokens: result.metrics.inputTokens } : {}),
      ...(Number.isFinite(result.metrics?.cachedInputTokens) ? { cachedInputTokens: result.metrics.cachedInputTokens } : {}),
      ...(Number.isFinite(result.metrics?.outputTokens) ? { outputTokens: result.metrics.outputTokens } : {}),
      durationMs: Number.isFinite(result.metrics?.durationMs) ? result.metrics.durationMs : fallbackDurationMs,
    },
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

async function runArgv(argv, options = {}) {
  invariant(Array.isArray(argv) && argv.length > 0, "Command argv must be a non-empty array.");
  const started = Date.now();
  const maximumOutput = options.maxOutputBytes ?? 1024 * 1024;
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 60_000);

    const collect = (bucket, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumOutput) {
        child.kill("SIGKILL");
        return;
      }
      bucket.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - started,
        outputLimitExceeded: outputBytes > maximumOutput,
      });
    });
    child.stdin.end(options.stdin ?? "");
  });
}

async function applyMockWrites(workspace, writes = {}) {
  for (const [relative, value] of Object.entries(writes)) {
    const target = inside(workspace, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(target, content);
  }
}

export function createMockAdapter(fixture, options = {}) {
  invariant(fixture && typeof fixture === "object", "Mock adapter requires a response fixture.");
  return {
    name: options.name ?? "mock",
    kind: "mock",
    provenance: "deterministic-fixture",
    realModel: false,
    async run({ prompt, workspace }) {
      invariant(typeof prompt === "string" && prompt.length > 0, "Mock adapter expected prompt input.");
      const response = clone(fixture);
      await applyMockWrites(workspace, response.writes);
      delete response.writes;
      return response;
    },
  };
}

export function createCommandAdapter(options = {}) {
  invariant(Array.isArray(options.argv) && options.argv.length > 0, "Command adapter requires argv.");
  invariant(options.argv.every((part) => typeof part === "string"), "Command adapter argv must contain only strings.");
  return {
    name: options.name ?? "command",
    kind: "command",
    provenance: options.provenance ?? "external-command",
    realModel: options.realModel === true,
    argv: [...options.argv],
    model: options.model ?? null,
    reasoningEffort: options.reasoningEffort ?? null,
    configMode: options.configMode ?? null,
    async run({ prompt, workspace }) {
      const command = await runArgv(options.argv, {
        cwd: workspace,
        env: { ...process.env, ...(options.env ?? {}) },
        stdin: prompt,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      });
      if (command.exitCode !== 0) {
        throw new Error(`Agent command exited with ${command.exitCode}${command.signal ? ` (${command.signal})` : ""}: ${command.stderr.trim()}`);
      }
      let value;
      try {
        value = JSON.parse(command.stdout);
      } catch {
        value = { transcript: command.stdout };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) value = { transcript: String(value ?? "") };
      return {
        ...value,
        stderr: command.stderr,
        metrics: {
          ...(value.metrics ?? {}),
          durationMs: value.metrics?.durationMs ?? command.durationMs,
        },
      };
    },
  };
}

export function createCodexAdapter(options = {}) {
  const adapterPath = fileURLToPath(new URL("./codex-agent-adapter.mjs", import.meta.url));
  const disabledCapabilities = [...new Set(options.disabledCapabilities ?? [])];
  const suffix = disabledCapabilities.length > 0 ? `without-${disabledCapabilities.join("-")}` : null;
  const model = options.model?.trim() || null;
  const reasoningEffort = options.reasoningEffort?.trim() || "low";
  const isolateUserConfig = options.isolateUserConfig === true;
  const evaluationMode = options.evaluationMode ?? "planning";
  const profileName = options.profile ?? (options.bare === true ? "bare" : "full-openatdd");
  const timeoutMs = options.timeoutMs ?? (evaluationMode === "delivery" ? 600_000 : 240_000);
  invariant(["planning", "delivery"].includes(evaluationMode), "Codex adapter evaluationMode is invalid.");
  if (evaluationMode === "delivery") invariant(DELIVERY_PROFILES.includes(profileName), "Codex adapter delivery profile is invalid.");
  invariant(["low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoningEffort), "Codex adapter reasoningEffort is invalid.");
  return createCommandAdapter({
    name: options.name ?? (evaluationMode === "delivery" ? `codex-${profileName}` : options.bare === true ? "codex-bare" : suffix ? `codex-${suffix}` : "codex-openatdd"),
    argv: [
      process.execPath,
      adapterPath,
      "--evaluation-mode",
      evaluationMode,
      "--mode",
      options.bare === true ? "bare" : "primary",
      ...(evaluationMode === "delivery" ? ["--profile", profileName] : []),
      ...(model ? ["--model", model] : []),
      "--reasoning-effort",
      reasoningEffort,
      "--timeout-ms",
      String(timeoutMs),
      ...(isolateUserConfig ? ["--isolated-config"] : []),
      ...disabledCapabilities.flatMap((id) => ["--disable-capability", id]),
    ],
    provenance: "bundled-codex-exec-adapter",
    realModel: true,
    model,
    reasoningEffort,
    configMode: isolateUserConfig ? "isolated" : evaluationMode === "delivery" ? "user-provider-minimal" : "user",
    timeoutMs: timeoutMs * (evaluationMode === "delivery" && profileName === "full-openatdd" ? 2 : 1) + 15_000,
    maxOutputBytes: options.maxOutputBytes ?? 2 * 1024 * 1024,
  });
}

async function prepareWorkspace(scenario, scenarioPath) {
  const workspace = await mkdtemp(path.join(tmpdir(), "openatdd-agent-eval-"));
  if (scenario.seed?.directory) {
    const source = path.resolve(path.dirname(scenarioPath), scenario.seed.directory);
    await cp(source, workspace, { recursive: true });
  }
  for (const [relative, value] of Object.entries(scenario.seed?.files ?? {})) {
    const target = inside(workspace, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
  return workspace;
}

function expandedArgv(argv, workspace, scenarioPath = "") {
  const scenarioDirectory = scenarioPath ? path.dirname(path.resolve(scenarioPath)) : "";
  return argv.map((part) => part === "<node>" ? process.execPath : part
    .replaceAll("<workspace>", workspace)
    .replaceAll("<scenario-directory>", scenarioDirectory));
}

async function hiddenCheckSourceDigests(scenario, scenarioPath) {
  const scenarioDirectory = path.dirname(path.resolve(scenarioPath));
  const sources = {};
  for (const check of scenario.hiddenChecks) {
    for (const part of check.argv) {
      if (!part.includes("<scenario-directory>")) continue;
      const candidate = path.resolve(part.replaceAll("<scenario-directory>", scenarioDirectory));
      try {
        sources[path.relative(process.cwd(), candidate)] = hash(await readFile(candidate));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return sources;
}

async function executeHiddenChecks(checks, workspace, scenarioPath = "") {
  const results = [];
  for (const check of checks) {
    const observed = await runArgv(expandedArgv(check.argv, workspace, scenarioPath), {
      cwd: workspace,
      stdin: check.stdin ?? "",
      timeoutMs: check.timeoutMs ?? 15_000,
      maxOutputBytes: check.maxOutputBytes ?? 256 * 1024,
    });
    const expectedCode = check.expect?.exitCode ?? 0;
    const stdoutMatches = check.expect?.stdoutIncludes === undefined || observed.stdout.includes(check.expect.stdoutIncludes);
    const stderrMatches = check.expect?.stderrIncludes === undefined || observed.stderr.includes(check.expect.stderrIncludes);
    results.push({
      id: check.id,
      passed: observed.exitCode === expectedCode && stdoutMatches && stderrMatches && !observed.outputLimitExceeded,
      exitCode: observed.exitCode,
      durationMs: observed.durationMs,
      stdout: observed.stdout,
      stderr: observed.stderr,
      ...(observed.outputLimitExceeded ? { error: "output-limit-exceeded" } : {}),
    });
  }
  return results;
}

async function workspaceHashes(root) {
  const entries = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) entries[path.relative(root, absolute)] = hash(await readFile(absolute));
    }
  }
  await visit(root);
  return entries;
}

function changedWorkspaceFiles(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file])
    .sort();
}

function deliveryTranscript(result) {
  return result.transcript.map((entry) => entry.text).join("\n");
}

function deliveryObservation(result, hiddenChecks, before, after) {
  const text = deliveryTranscript(result);
  const successfulVerificationCommands = result.commands.filter((item) => {
    const verificationCommand = /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint|build|typecheck)\b|node\s+--test\b|\b(test|check|lint|build|typecheck)\b/i.test(item.command);
    return verificationCommand && (item.exitCode === 0 || item.status === "completed");
  });
  const changedFiles = changedWorkspaceFiles(before, after);
  const functionalPass = hiddenChecks.length > 0 && hiddenChecks.every((check) => check.passed);
  const claimedReady = /(implemented|completed|finished|ready|done|fixed|passed|\u5df2\u5b9e\u73b0|\u5df2\u5b8c\u6210|\u5df2\u4fee\u590d|\u5df2\u5c31\u7eea|\u901a\u8fc7)/i.test(text);
  const technicalPlanPresent = changedFiles.some((file) => file === "TECHNICAL_PLAN.md" || /^\.openatdd\/tasks\/[^/]+\/solution\.md$/.test(file));
  const handoffComplete = /(implemented|changed|added|fixed|\u5b9e\u73b0|\u4fee\u6539|\u65b0\u589e|\u4fee\u590d)/i.test(text)
    && /(test|verified|verification|passed|\u6d4b\u8bd5|\u9a8c\u8bc1|\u901a\u8fc7)/i.test(text)
    && /(try|usage|run\s+[`'"\w]|how to test|acceptance|\b(node|npm|pnpm|yarn|bun)\s+|\u8bd5\u7528|\u8fd0\u884c|\u9a8c\u6536|\u4f7f\u7528)/i.test(text);
  return {
    functionalPass,
    selfVerification: successfulVerificationCommands.length > 0,
    verificationCommands: successfulVerificationCommands,
    claimedReady,
    falseReady: claimedReady && !functionalPass,
    technicalPlanPresent,
    handoffComplete,
    changedFiles,
    hiddenChecks,
  };
}

function scoreDeliveryObservation(observation) {
  const passedChecks = observation.hiddenChecks.filter((check) => check.passed).length;
  const score = observation.hiddenChecks.length === 0 ? 0 : (passedChecks / observation.hiddenChecks.length) * 100;
  return {
    score,
    passed: observation.functionalPass,
    gates: { hiddenChecks: observation.functionalPass },
  };
}

async function executeDeliveryRun({ scenario, scenarioPath, adapter, profileName, index, keepWorkspace }) {
  const workspace = await prepareWorkspace(scenario, scenarioPath);
  const before = await workspaceHashes(workspace);
  let adapterError = null;
  let result;
  const started = Date.now();
  try {
    try {
      const raw = await adapter.run({ prompt: scenario.prompt, workspace, run: index });
      result = normalizeResult(raw, Date.now() - started);
    } catch (error) {
      adapterError = error.message;
      result = normalizeResult({ transcript: `Agent adapter failed: ${error.message}` }, Date.now() - started);
    }
    const after = await workspaceHashes(workspace);
    const hiddenChecks = await executeHiddenChecks(scenario.hiddenChecks, workspace, scenarioPath);
    const observation = deliveryObservation(result, hiddenChecks, before, after);
    const scoring = scoreDeliveryObservation(observation);
    return {
      run: index,
      adapter: adapter.name,
      profile: profileName,
      profileMetadata: result.profile,
      transcript: result.transcript,
      commands: result.commands,
      metrics: result.metrics,
      observation,
      scoring,
      transcriptSha256: hash(JSON.stringify(result.transcript)),
      ...(adapterError ? { adapterError } : {}),
      ...(result.stderr ? { adapterStderr: result.stderr } : {}),
      ...(keepWorkspace ? { workspace } : {}),
    };
  } finally {
    if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  }
}

function aggregateDeliveryRuns(runs) {
  const suppliedInputTokens = runs.map((run) => run.metrics.inputTokens).filter(Number.isFinite);
  const suppliedCachedInputTokens = runs.map((run) => run.metrics.cachedInputTokens).filter(Number.isFinite);
  const suppliedOutputTokens = runs.map((run) => run.metrics.outputTokens).filter(Number.isFinite);
  const inputTokens = suppliedInputTokens.length === runs.length ? suppliedInputTokens.reduce((sum, value) => sum + value, 0) : null;
  const cachedInputTokens = suppliedCachedInputTokens.length === runs.length ? suppliedCachedInputTokens.reduce((sum, value) => sum + value, 0) : null;
  const rate = (predicate) => runs.length === 0 ? 0 : runs.filter(predicate).length / runs.length;
  return {
    runs: runs.length,
    passedRuns: runs.filter((run) => run.observation.functionalPass).length,
    passRate: rate((run) => run.observation.functionalPass),
    selfVerificationRate: rate((run) => run.observation.selfVerification),
    claimedReadyRate: rate((run) => run.observation.claimedReady),
    falseReadyRate: rate((run) => run.observation.falseReady),
    technicalPlanRate: rate((run) => run.observation.technicalPlanPresent),
    handoffCompleteRate: rate((run) => run.observation.handoffComplete),
    meanScore: runs.length === 0 ? 0 : runs.reduce((sum, run) => sum + run.scoring.score, 0) / runs.length,
    durationMs: runs.reduce((sum, run) => sum + run.metrics.durationMs, 0),
    commandInvocations: runs.reduce((sum, run) => sum + run.commands.length, 0),
    adapterErrors: runs.filter((run) => run.adapterError).length,
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(cachedInputTokens !== null ? { cachedInputTokens, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens) } : {}),
    ...(suppliedOutputTokens.length === runs.length ? { outputTokens: suppliedOutputTokens.reduce((sum, value) => sum + value, 0) } : {}),
  };
}

async function runDeliveryProfileSet({ scenario, scenarioPath, adapter, profileName, repetitions, keepWorkspace }) {
  const runs = [];
  for (let index = 1; index <= repetitions; index += 1) {
    runs.push(await executeDeliveryRun({ scenario, scenarioPath, adapter, profileName, index, keepWorkspace }));
  }
  const profileMetadata = runs.map((run) => run.profileMetadata).find(Boolean) ?? null;
  return {
    profile: profileMetadata ?? { name: profileName },
    adapter: {
      name: adapter.name,
      kind: adapter.kind,
      provenance: adapter.provenance,
      realModelEvaluated: adapter.realModel === true,
      model: adapter.model ?? null,
      reasoningEffort: adapter.reasoningEffort ?? null,
      configMode: adapter.configMode ?? null,
    },
    runs,
    summary: aggregateDeliveryRuns(runs),
  };
}

function actionType(action) {
  return typeof action === "string" ? action : action?.type;
}

function routeLane(result) {
  const action = result.actions.find((item) => actionType(item) === "route");
  return typeof action === "object" ? action.lane : undefined;
}

function includesMarker(haystack, marker) {
  return haystack.toLocaleLowerCase("en-US").includes(String(marker).toLocaleLowerCase("en-US"));
}

function observe(scenario, result, hiddenChecks) {
  const questions = result.transcript.filter((entry) => entry.role === "assistant" && entry.type === "question");
  const allowed = new Set([...(scenario.expect.allowedQuestionIds ?? []), ...(scenario.expect.requiredHumanDecisions ?? [])]);
  const unnecessaryQuestions = [];
  for (const entry of questions) {
    if (entry.decisionId && !allowed.has(entry.decisionId)) unnecessaryQuestions.push(entry.decisionId);
    for (const marker of scenario.expect.forbiddenQuestionMarkers ?? []) {
      if (includesMarker(entry.text, marker)) unnecessaryQuestions.push(marker);
    }
  }

  const raised = new Set([
    ...result.decisions.raised,
    ...result.decisions.resolved,
    ...questions.map((entry) => entry.decisionId).filter(Boolean),
  ]);
  const missedDecisions = (scenario.expect.requiredHumanDecisions ?? []).filter((id) => !raised.has(id));
  const actionTypes = result.actions.map(actionType).filter(Boolean);
  const usesResearch = actionTypes.includes("external-research");
  const researchMisroutes = [];
  if (scenario.expect.externalResearch === false && usesResearch) researchMisroutes.push("unexpected-external-research");
  if (scenario.expect.externalResearch === true && !usesResearch) researchMisroutes.push("missing-required-external-research");

  const searchable = JSON.stringify({ transcript: result.transcript, architecture: result.architecture });
  const overEngineeringMarkers = (scenario.expect.overEngineeringMarkers ?? []).filter((marker) => includesMarker(searchable, marker));
  const contractViolations = [...result.contractViolations];
  for (const type of scenario.expect.forbiddenActionTypes ?? []) {
    if (actionTypes.includes(type)) contractViolations.push(`forbidden-action:${type}`);
  }
  const lane = routeLane(result);
  if (scenario.expect.lane && lane !== scenario.expect.lane) contractViolations.push(`lane:${lane ?? "missing"}->${scenario.expect.lane}`);

  return {
    lane: lane ?? null,
    humanTurns: questions.length,
    unnecessaryQuestions: [...new Set(unnecessaryQuestions)],
    researchMisroutes,
    missedDecisions,
    overEngineeringMarkers,
    contractViolations: [...new Set(contractViolations)],
    hiddenChecks,
    firstPassAcceptance: hiddenChecks.length > 0 && hiddenChecks.every((check) => check.passed),
  };
}

function scoreObservation(observation, scenario, rubric) {
  const excessHumanTurns = Math.max(0, observation.humanTurns - (scenario.expect.maxHumanTurns ?? Number.POSITIVE_INFINITY));
  const failures = observation.hiddenChecks.filter((check) => !check.passed).length;
  const counts = {
    excessHumanTurns,
    unnecessaryQuestions: observation.unnecessaryQuestions.length,
    researchMisroutes: observation.researchMisroutes.length,
    missedDecisions: observation.missedDecisions.length,
    overEngineeringMarkers: observation.overEngineeringMarkers.length,
    contractViolations: observation.contractViolations.length,
    hiddenCheckFailures: failures,
  };
  const penalties = Object.entries(counts).map(([category, count]) => ({
    category,
    count,
    points: count * (rubric.penalties[category] ?? 0),
  }));
  const score = Math.max(0, 100 - penalties.reduce((total, item) => total + item.points, 0));
  const gates = {
    score: score >= rubric.passScore,
    hiddenChecks: rubric.gates.requireHiddenChecks !== true || observation.firstPassAcceptance,
    contract: rubric.gates.requireNoContractViolations !== true || observation.contractViolations.length === 0,
    decisions: rubric.gates.requireNoMissedDecisions !== true || observation.missedDecisions.length === 0,
    research: rubric.gates.requireNoResearchMisroutes !== true || observation.researchMisroutes.length === 0,
  };
  return { score, passed: Object.values(gates).every(Boolean), penalties, gates };
}

async function executeRun({ scenario, scenarioPath, rubric, adapter, index, keepWorkspace }) {
  const workspace = await prepareWorkspace(scenario, scenarioPath);
  try {
    const started = Date.now();
    const raw = await adapter.run({ prompt: scenario.prompt, workspace, run: index });
    const result = normalizeResult(raw, Date.now() - started);
    const hiddenChecks = await executeHiddenChecks(scenario.hiddenChecks, workspace);
    const observation = observe(scenario, result, hiddenChecks);
    const scoring = scoreObservation(observation, scenario, rubric);
    return {
      run: index,
      adapter: adapter.name,
      transcript: result.transcript,
      actions: result.actions,
      decisions: result.decisions,
      architecture: result.architecture,
      metrics: result.metrics,
      observation,
      scoring,
      transcriptSha256: hash(JSON.stringify(result.transcript)),
      ...(result.stderr ? { adapterStderr: result.stderr } : {}),
      ...(keepWorkspace ? { workspace } : {}),
    };
  } finally {
    if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  }
}

function aggregateRuns(runs) {
  const scores = runs.map((run) => run.scoring.score);
  const passedRuns = runs.filter((run) => run.scoring.passed).length;
  const suppliedInputTokens = runs.map((run) => run.metrics.inputTokens).filter(Number.isFinite);
  const suppliedCachedInputTokens = runs.map((run) => run.metrics.cachedInputTokens).filter(Number.isFinite);
  const suppliedOutputTokens = runs.map((run) => run.metrics.outputTokens).filter(Number.isFinite);
  const inputTokens = suppliedInputTokens.length === runs.length ? suppliedInputTokens.reduce((sum, value) => sum + value, 0) : null;
  const cachedInputTokens = suppliedCachedInputTokens.length === runs.length ? suppliedCachedInputTokens.reduce((sum, value) => sum + value, 0) : null;
  return {
    runs: runs.length,
    passedRuns,
    passRate: runs.length === 0 ? 0 : passedRuns / runs.length,
    meanScore: scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length,
    scoreRange: scores.length === 0 ? 0 : Math.max(...scores) - Math.min(...scores),
    repeatableOutcome: new Set(runs.map((run) => run.scoring.passed)).size <= 1,
    distinctTranscripts: new Set(runs.map((run) => run.transcriptSha256)).size,
    firstPassAcceptanceRate: runs.length === 0 ? 0 : runs.filter((run) => run.observation.firstPassAcceptance).length / runs.length,
    humanTurns: runs.reduce((sum, run) => sum + run.observation.humanTurns, 0),
    unnecessaryQuestions: runs.reduce((sum, run) => sum + run.observation.unnecessaryQuestions.length, 0),
    researchMisroutes: runs.reduce((sum, run) => sum + run.observation.researchMisroutes.length, 0),
    missedDecisions: runs.reduce((sum, run) => sum + run.observation.missedDecisions.length, 0),
    overEngineeringMarkers: runs.reduce((sum, run) => sum + run.observation.overEngineeringMarkers.length, 0),
    contractViolations: runs.reduce((sum, run) => sum + run.observation.contractViolations.length, 0),
    durationMs: runs.reduce((sum, run) => sum + run.metrics.durationMs, 0),
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(cachedInputTokens !== null ? { cachedInputTokens, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens) } : {}),
    ...(suppliedOutputTokens.length === runs.length ? { outputTokens: suppliedOutputTokens.reduce((sum, value) => sum + value, 0) } : {}),
  };
}

async function runAdapterSet({ scenario, scenarioPath, rubric, adapter, repetitions, keepWorkspace }) {
  const runs = [];
  for (let index = 1; index <= repetitions; index += 1) {
    runs.push(await executeRun({ scenario, scenarioPath, rubric, adapter, index, keepWorkspace }));
  }
  return {
    adapter: {
      name: adapter.name,
      kind: adapter.kind,
      provenance: adapter.provenance,
      realModelEvaluated: adapter.realModel === true,
      model: adapter.model ?? null,
      reasoningEffort: adapter.reasoningEffort ?? null,
      configMode: adapter.configMode ?? null,
    },
    runs,
    summary: aggregateRuns(runs),
  };
}

export async function runAgentEvaluation(options) {
  invariant(options?.scenarioPath, "runAgentEvaluation requires scenarioPath.");
  invariant(options?.adapter, "runAgentEvaluation requires an adapter.");
  const scenarioPath = path.resolve(options.scenarioPath);
  const scenario = validateScenario(await readJson(scenarioPath), scenarioPath);
  const rubricPath = path.resolve(path.dirname(scenarioPath), scenario.rubric);
  const rubric = validateRubric(await readJson(rubricPath), rubricPath);
  const repetitions = options.repetitions ?? scenario.repetitions ?? 1;
  invariant(Number.isInteger(repetitions) && repetitions > 0, "repetitions must be a positive integer.");

  const primary = await runAdapterSet({
    scenario,
    scenarioPath,
    rubric,
    adapter: options.adapter,
    repetitions,
    keepWorkspace: options.keepWorkspace === true,
  });
  const baseline = options.baselineAdapter ? await runAdapterSet({
    scenario,
    scenarioPath,
    rubric,
    adapter: options.baselineAdapter,
    repetitions,
    keepWorkspace: options.keepWorkspace === true,
  }) : null;
  const ablations = [];
  for (const item of options.ablationAdapters ?? []) {
    invariant(item?.adapter, "Ablation evaluation requires an adapter.");
    invariant(item?.capabilityId, "Ablation evaluation requires capabilityId.");
    const evaluated = await runAdapterSet({
      scenario,
      scenarioPath,
      rubric,
      adapter: item.adapter,
      repetitions,
      keepWorkspace: options.keepWorkspace === true,
    });
    ablations.push({
      capabilityId: item.capabilityId,
      profile: item.profile ?? capabilityProfile(`without-${item.capabilityId}`, [item.capabilityId]),
      ...evaluated,
    });
  }
  const generatedAt = (options.clock ?? (() => new Date()))().toISOString();
  const report = {
    schemaVersion: 1,
    generatedAt,
    scenario: {
      id: scenario.id,
      schemaVersion: scenario.schemaVersion,
      source: path.relative(process.cwd(), scenarioPath),
      promptSha256: hash(scenario.prompt),
    },
    rubric: {
      name: rubric.name,
      schemaVersion: rubric.schemaVersion,
      passScore: rubric.passScore,
    },
    strategyProfile: options.strategyProfile ?? capabilityProfile("full"),
    primary,
    ...(baseline ? {
      baseline,
      comparison: {
        meanScoreDelta: primary.summary.meanScore - baseline.summary.meanScore,
        passRateDelta: primary.summary.passRate - baseline.summary.passRate,
        humanTurnsDelta: primary.summary.humanTurns - baseline.summary.humanTurns,
      },
    } : {}),
    ...(ablations.length > 0 ? {
      ablations,
      ablationComparisons: ablations.map((item) => ({
        capabilityId: item.capabilityId,
        meanScoreDelta: primary.summary.meanScore - item.summary.meanScore,
        passRateDelta: primary.summary.passRate - item.summary.passRate,
        humanTurnsDelta: primary.summary.humanTurns - item.summary.humanTurns,
        inputTokensDelta: Number.isFinite(primary.summary.inputTokens) && Number.isFinite(item.summary.inputTokens)
          ? primary.summary.inputTokens - item.summary.inputTokens
          : null,
        uncachedInputTokensDelta: Number.isFinite(primary.summary.uncachedInputTokens) && Number.isFinite(item.summary.uncachedInputTokens)
          ? primary.summary.uncachedInputTokens - item.summary.uncachedInputTokens
          : null,
      })),
    } : {}),
    claims: {
      fixtureOnly: primary.adapter.kind === "mock"
        && (!baseline || baseline.adapter.kind === "mock")
        && ablations.every((item) => item.adapter.kind === "mock"),
      realModelPassClaimed: primary.adapter.realModelEvaluated === true && primary.summary.passRate === 1,
    },
  };

  if (options.reportPath !== false) {
    const reportPath = path.resolve(options.reportPath ?? path.join("evals", "reports", `${scenario.id}-${generatedAt.replace(/[^0-9]/g, "")}.json`));
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    report.reportPath = reportPath;
  }
  return report;
}

function deliveryDelta(profile, bare) {
  const delta = (key) => Number.isFinite(profile.summary[key]) && Number.isFinite(bare.summary[key])
    ? profile.summary[key] - bare.summary[key]
    : null;
  return {
    profile: profile.profile.name,
    baseline: bare.profile.name,
    passRateDelta: delta("passRate"),
    falseReadyRateDelta: delta("falseReadyRate"),
    selfVerificationRateDelta: delta("selfVerificationRate"),
    technicalPlanRateDelta: delta("technicalPlanRate"),
    handoffCompleteRateDelta: delta("handoffCompleteRate"),
    durationMsDelta: delta("durationMs"),
    commandInvocationsDelta: delta("commandInvocations"),
    inputTokensDelta: delta("inputTokens"),
    uncachedInputTokensDelta: delta("uncachedInputTokens"),
    outputTokensDelta: delta("outputTokens"),
  };
}

export async function runDeliveryEvaluation(options) {
  invariant(options?.scenarioPath, "runDeliveryEvaluation requires scenarioPath.");
  invariant(Array.isArray(options?.profileAdapters) && options.profileAdapters.length > 0, "runDeliveryEvaluation requires profileAdapters.");
  const scenarioPath = path.resolve(options.scenarioPath);
  const scenario = validateScenario(await readJson(scenarioPath), scenarioPath);
  invariant(scenario.schemaVersion === DELIVERY_SCENARIO_SCHEMA_VERSION && scenario.kind === "delivery", "runDeliveryEvaluation requires a delivery scenario.");
  const rubricPath = path.resolve(path.dirname(scenarioPath), scenario.rubric);
  const rubric = validateRubric(await readJson(rubricPath), rubricPath);
  const repetitions = options.repetitions ?? scenario.repetitions ?? 1;
  invariant(Number.isInteger(repetitions) && repetitions > 0, "repetitions must be a positive integer.");
  const adaptersByProfile = new Map(options.profileAdapters.map((item) => [item.profileName, item.adapter]));
  const requestedProfiles = options.profileNames ?? scenario.profiles ?? DELIVERY_PROFILES;
  invariant(requestedProfiles.length > 0 && requestedProfiles.every((name) => DELIVERY_PROFILES.includes(name)), "Delivery scenario profiles are invalid.");
  for (const profileName of requestedProfiles) invariant(adaptersByProfile.has(profileName), `Missing delivery adapter for profile ${profileName}.`);

  const profiles = {};
  for (const profileName of requestedProfiles) {
    profiles[profileName] = await runDeliveryProfileSet({
      scenario,
      scenarioPath,
      adapter: adaptersByProfile.get(profileName),
      profileName,
      repetitions,
      keepWorkspace: options.keepWorkspace === true,
    });
  }
  const generatedAt = (options.clock ?? (() => new Date()))().toISOString();
  const bare = profiles.bare;
  const hiddenSources = await hiddenCheckSourceDigests(scenario, scenarioPath);
  const report = {
    schemaVersion: DELIVERY_REPORT_SCHEMA_VERSION,
    evaluationMode: "delivery",
    generatedAt,
    scenario: {
      id: scenario.id,
      schemaVersion: scenario.schemaVersion,
      difficulty: scenario.difficulty,
      source: path.relative(process.cwd(), scenarioPath),
      promptSha256: hash(scenario.prompt),
      hiddenChecksSha256: hash(JSON.stringify(scenario.hiddenChecks)),
      hiddenSources,
    },
    rubric: {
      name: rubric.name,
      schemaVersion: rubric.schemaVersion,
      passScore: rubric.passScore,
    },
    sampleLimit: `Each profile has ${repetitions} run(s); observed differences are descriptive, not causal or statistically significant.`,
    profiles,
    comparisons: bare ? requestedProfiles.filter((name) => name !== "bare").map((name) => deliveryDelta(profiles[name], bare)) : [],
    claims: {
      fixtureOnly: requestedProfiles.every((name) => profiles[name].adapter.kind === "mock"),
      realModelComplete: requestedProfiles.every((name) => profiles[name].adapter.realModelEvaluated === true && profiles[name].summary.runs === repetitions),
      functionalPassDerivedFromHiddenChecks: true,
    },
  };
  if (options.reportPath !== false) {
    const reportPath = path.resolve(options.reportPath ?? path.join("evals", "reports", `${scenario.id}-${generatedAt.replace(/[^0-9]/g, "")}.json`));
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    report.reportPath = reportPath;
  }
  return report;
}

function normalizedRecordedCommandCount(commands = []) {
  let count = 0;
  let previous = null;
  for (const command of commands) {
    const previousIsRunning = ["in_progress", "running", "started"].includes(previous?.status);
    const currentIsTerminal = ["completed", "failed", "blocked", "cancelled"].includes(command?.status);
    if (previous?.command === command?.command && previousIsRunning && currentIsTerminal) {
      previous = command;
      continue;
    }
    count += 1;
    previous = command;
  }
  return count;
}

function deliveryProfileSummary(report, profileName) {
  const profile = report.profiles[profileName];
  const summary = { ...profile.summary };
  if (!Number.isFinite(summary.commandInvocations)) {
    summary.commandInvocations = profile.runs.reduce((sum, run) => sum + normalizedRecordedCommandCount(run.commands), 0);
  }
  return summary;
}

function summedDeliveryProfile(reports, profileName) {
  const summaries = reports.map((report) => deliveryProfileSummary(report, profileName));
  const runs = summaries.reduce((sum, item) => sum + item.runs, 0);
  const sum = (key) => summaries.every((item) => Number.isFinite(item[key])) ? summaries.reduce((total, item) => total + item[key], 0) : null;
  const rateFromCounts = (key) => runs === 0 ? 0 : summaries.reduce((total, item) => total + item[key] * item.runs, 0) / runs;
  return {
    runs,
    passedRuns: summaries.reduce((total, item) => total + item.passedRuns, 0),
    passRate: runs === 0 ? 0 : summaries.reduce((total, item) => total + item.passedRuns, 0) / runs,
    selfVerificationRate: rateFromCounts("selfVerificationRate"),
    falseReadyRate: rateFromCounts("falseReadyRate"),
    technicalPlanRate: rateFromCounts("technicalPlanRate"),
    handoffCompleteRate: rateFromCounts("handoffCompleteRate"),
    durationMs: sum("durationMs"),
    commandInvocations: sum("commandInvocations"),
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    uncachedInputTokens: sum("uncachedInputTokens"),
    outputTokens: sum("outputTokens"),
  };
}

function deliverySummaryDelta(profileName, profile, baselineName, baseline) {
  const delta = (key) => Number.isFinite(profile[key]) && Number.isFinite(baseline[key])
    ? profile[key] - baseline[key]
    : null;
  const relativeChange = (key) => Number.isFinite(profile[key]) && Number.isFinite(baseline[key]) && baseline[key] !== 0
    ? (profile[key] - baseline[key]) / baseline[key]
    : null;
  return {
    profile: profileName,
    baseline: baselineName,
    passRateDelta: delta("passRate"),
    falseReadyRateDelta: delta("falseReadyRate"),
    selfVerificationRateDelta: delta("selfVerificationRate"),
    technicalPlanRateDelta: delta("technicalPlanRate"),
    handoffCompleteRateDelta: delta("handoffCompleteRate"),
    durationMsDelta: delta("durationMs"),
    durationRelativeChange: relativeChange("durationMs"),
    commandInvocationsDelta: delta("commandInvocations"),
    commandInvocationsRelativeChange: relativeChange("commandInvocations"),
    inputTokensDelta: delta("inputTokens"),
    inputTokensRelativeChange: relativeChange("inputTokens"),
    cachedInputTokensDelta: delta("cachedInputTokens"),
    cachedInputTokensRelativeChange: relativeChange("cachedInputTokens"),
    uncachedInputTokensDelta: delta("uncachedInputTokens"),
    uncachedInputTokensRelativeChange: relativeChange("uncachedInputTokens"),
    outputTokensDelta: delta("outputTokens"),
    outputTokensRelativeChange: relativeChange("outputTokens"),
  };
}

function deliverySummaryMarkdown(summary) {
  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  const signedPercent = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${percent(value)}` : "n/a";
  const percentagePoints = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp` : "n/a";
  const lines = [
    "# End-to-end Agent delivery evaluation",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "| Difficulty | Profile | Pass | False ready | Self verification | Technical plan | Handoff | Mean seconds/run | Commands | Input tokens | Output tokens |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const report of summary.scenarios) {
    for (const profileName of DELIVERY_PROFILES) {
      const item = report.profiles[profileName];
      lines.push(`| ${report.difficulty} | ${profileName} | ${percent(item.passRate)} | ${percent(item.falseReadyRate)} | ${percent(item.selfVerificationRate)} | ${percent(item.technicalPlanRate)} | ${percent(item.handoffCompleteRate)} | ${(item.durationMs / item.runs / 1000).toFixed(2)} | ${item.commandInvocations ?? "n/a"} | ${item.inputTokens ?? "n/a"} | ${item.outputTokens ?? "n/a"} |`);
    }
  }
  lines.push("", "## Totals", "", "| Profile | Pass | False ready | Self verification | Technical plan | Handoff | Mean seconds/run | Commands | Input tokens | Non-cached input | Output tokens |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const profileName of DELIVERY_PROFILES) {
    const item = summary.totals[profileName];
    lines.push(`| ${profileName} | ${percent(item.passRate)} | ${percent(item.falseReadyRate)} | ${percent(item.selfVerificationRate)} | ${percent(item.technicalPlanRate)} | ${percent(item.handoffCompleteRate)} | ${(item.durationMs / item.runs / 1000).toFixed(2)} | ${item.commandInvocations ?? "n/a"} | ${item.inputTokens ?? "n/a"} | ${item.uncachedInputTokens ?? "n/a"} | ${item.outputTokens ?? "n/a"} |`);
  }
  lines.push("", "## Relative to bare", "", "| Profile | Pass | False ready | Self verification | Technical plan | Handoff | Time | Commands | Input tokens | Non-cached input | Output tokens |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const comparison of summary.comparisons) {
    lines.push(`| ${comparison.profile} | ${percentagePoints(comparison.passRateDelta)} | ${percentagePoints(comparison.falseReadyRateDelta)} | ${percentagePoints(comparison.selfVerificationRateDelta)} | ${percentagePoints(comparison.technicalPlanRateDelta)} | ${percentagePoints(comparison.handoffCompleteRateDelta)} | ${signedPercent(comparison.durationRelativeChange)} | ${signedPercent(comparison.commandInvocationsRelativeChange)} | ${signedPercent(comparison.inputTokensRelativeChange)} | ${signedPercent(comparison.uncachedInputTokensRelativeChange)} | ${signedPercent(comparison.outputTokensRelativeChange)} |`);
  }
  lines.push("", `> ${summary.sampleLimit}`, "");
  return `${lines.join("\n")}\n`;
}

export async function summarizeDeliveryEvaluationReports(reportPaths, options = {}) {
  invariant(Array.isArray(reportPaths) && reportPaths.length > 0, "At least one delivery report is required.");
  const reports = [];
  const contracts = [];
  for (const reportPath of reportPaths) {
    const absoluteReportPath = path.resolve(reportPath);
    const reportSource = await readFile(absoluteReportPath, "utf8");
    const report = JSON.parse(reportSource);
    invariant(report.schemaVersion === DELIVERY_REPORT_SCHEMA_VERSION && report.evaluationMode === "delivery", `${reportPath} is not a delivery report.`);
    for (const profileName of DELIVERY_PROFILES) invariant(report.profiles?.[profileName], `${reportPath} is missing profile ${profileName}.`);
    const scenarioPath = path.resolve(report.scenario.source);
    const scenario = validateScenario(await readJson(scenarioPath), scenarioPath);
    invariant(hash(scenario.prompt) === report.scenario.promptSha256, `${reportPath} no longer matches its scenario prompt.`);
    const hiddenChecksSha256 = hash(JSON.stringify(scenario.hiddenChecks));
    const hiddenSources = await hiddenCheckSourceDigests(scenario, scenarioPath);
    if (report.scenario.hiddenChecksSha256) invariant(report.scenario.hiddenChecksSha256 === hiddenChecksSha256, `${reportPath} no longer matches its hidden checks.`);
    if (report.scenario.hiddenSources) invariant(JSON.stringify(report.scenario.hiddenSources) === JSON.stringify(hiddenSources), `${reportPath} no longer matches its hidden source files.`);
    contracts.push({
      report: path.relative(process.cwd(), absoluteReportPath),
      reportSha256: hash(reportSource),
      scenario: path.relative(process.cwd(), scenarioPath),
      promptSha256: report.scenario.promptSha256,
      hiddenChecksSha256,
      hiddenSources,
    });
    reports.push(report);
  }
  const generatedAt = (options.clock ?? (() => new Date()))().toISOString();
  const totals = Object.fromEntries(DELIVERY_PROFILES.map((name) => [name, summedDeliveryProfile(reports, name)]));
  const summary = {
    schemaVersion: 1,
    generatedAt,
    sampleLimit: "Two runs per scenario/profile are descriptive only; differences are not causal or statistically significant.",
    contracts,
    scenarios: reports.map((report) => ({
      id: report.scenario.id,
      difficulty: report.scenario.difficulty,
      profiles: Object.fromEntries(DELIVERY_PROFILES.map((name) => [name, deliveryProfileSummary(report, name)])),
    })),
    totals,
    comparisons: DELIVERY_PROFILES
      .filter((name) => name !== "bare")
      .map((name) => deliverySummaryDelta(name, totals[name], "bare", totals.bare)),
  };
  if (options.jsonPath) {
    const target = path.resolve(options.jsonPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (options.markdownPath) {
    const target = path.resolve(options.markdownPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, deliverySummaryMarkdown(summary));
  }
  return summary;
}

const DEFAULT_OPTIMIZATION_THRESHOLDS = Object.freeze({
  "thin-atdd": Object.freeze({ inputTokensReduction: 0.15, durationReduction: 0.10 }),
  "full-openatdd": Object.freeze({ inputTokensReduction: 0.80, durationReduction: 0.50, maximumBareInputMultiple: 2 }),
});

function deliveryOptimizationMarkdown(comparison) {
  const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
  const lines = [
    "# OpenATDD delivery cost optimization",
    "",
    `Generated: ${comparison.generatedAt}`,
    "",
    `Result: **${comparison.passed ? "passed" : "failed"}**`,
    "",
    "| Profile | Input reduction | Time reduction | Candidate / bare input | Quality | Thresholds |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const item of comparison.profiles) {
    lines.push(`| ${item.profile} | ${percent(item.inputTokensReduction)} | ${percent(item.durationReduction)} | ${Number.isFinite(item.candidateBareInputMultiple) ? `${item.candidateBareInputMultiple.toFixed(2)}×` : "n/a"} | ${item.qualityPassed ? "pass" : "fail"} | ${item.passed ? "pass" : "fail"} |`);
  }
  lines.push("", "## Checks", "");
  for (const check of comparison.checks) lines.push(`- [${check.passed ? "x" : " "}] ${check.id}: ${check.summary}`);
  lines.push("", "> Two runs per scenario/profile are descriptive only; differences are not causal or statistically significant.", "");
  return `${lines.join("\n")}\n`;
}

export function compareDeliverySummaryObjects(baseline, candidate, options = {}) {
  invariant(baseline?.schemaVersion === 1 && candidate?.schemaVersion === 1, "Optimization comparison requires schema-v1 delivery summaries.");
  const thresholds = options.thresholds ?? DEFAULT_OPTIMIZATION_THRESHOLDS;
  const checks = [];
  const profiles = ["thin-atdd", "full-openatdd"].map((profileName) => {
    const before = baseline.totals?.[profileName];
    const after = candidate.totals?.[profileName];
    const bare = candidate.totals?.bare;
    invariant(before && after && bare, `Optimization comparison is missing ${profileName} or bare totals.`);
    const reduction = (key) => Number.isFinite(before[key]) && before[key] !== 0 && Number.isFinite(after[key])
      ? (before[key] - after[key]) / before[key]
      : null;
    const inputTokensReduction = reduction("inputTokens");
    const durationReduction = reduction("durationMs");
    const candidateBareInputMultiple = Number.isFinite(after.inputTokens) && Number.isFinite(bare.inputTokens) && bare.inputTokens !== 0
      ? after.inputTokens / bare.inputTokens
      : null;
    const qualityPassed = after.passRate === 1
      && after.falseReadyRate === 0
      && after.selfVerificationRate === 1
      && after.technicalPlanRate === 1
      && after.handoffCompleteRate === 1;
    const profileThresholds = thresholds[profileName];
    const profileChecks = [
      {
        id: `${profileName}-quality`,
        passed: qualityPassed,
        summary: "functional, self-verification, technical-plan, and handoff rates are 100% with zero false readiness",
      },
      {
        id: `${profileName}-input`,
        passed: Number.isFinite(inputTokensReduction) && inputTokensReduction >= profileThresholds.inputTokensReduction,
        summary: `input reduction ${Number.isFinite(inputTokensReduction) ? (inputTokensReduction * 100).toFixed(1) : "n/a"}% >= ${(profileThresholds.inputTokensReduction * 100).toFixed(1)}%`,
      },
      {
        id: `${profileName}-time`,
        passed: Number.isFinite(durationReduction) && durationReduction >= profileThresholds.durationReduction,
        summary: `time reduction ${Number.isFinite(durationReduction) ? (durationReduction * 100).toFixed(1) : "n/a"}% >= ${(profileThresholds.durationReduction * 100).toFixed(1)}%`,
      },
    ];
    if (Number.isFinite(profileThresholds.maximumBareInputMultiple)) {
      profileChecks.push({
        id: `${profileName}-bare-multiple`,
        passed: Number.isFinite(candidateBareInputMultiple) && candidateBareInputMultiple <= profileThresholds.maximumBareInputMultiple,
        summary: `candidate/bare input ${Number.isFinite(candidateBareInputMultiple) ? candidateBareInputMultiple.toFixed(2) : "n/a"}x <= ${profileThresholds.maximumBareInputMultiple.toFixed(2)}x`,
      });
    }
    checks.push(...profileChecks);
    return {
      profile: profileName,
      baseline: before,
      candidate: after,
      inputTokensReduction,
      durationReduction,
      candidateBareInputMultiple,
      qualityPassed,
      passed: profileChecks.every((check) => check.passed),
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: (options.clock ?? (() => new Date()))().toISOString(),
    baselineSha256: options.baselineSha256 ?? null,
    candidateSha256: options.candidateSha256 ?? null,
    thresholds,
    profiles,
    checks,
    passed: checks.every((check) => check.passed),
    sampleLimit: "Two runs per scenario/profile are descriptive only; differences are not causal or statistically significant.",
  };
}

export async function compareDeliveryEvaluationSummaries(baselinePath, candidatePath, options = {}) {
  invariant(baselinePath && candidatePath, "Optimization comparison requires baseline and candidate summary paths.");
  const baselineSource = await readFile(path.resolve(baselinePath), "utf8");
  const candidateSource = await readFile(path.resolve(candidatePath), "utf8");
  const comparison = compareDeliverySummaryObjects(JSON.parse(baselineSource), JSON.parse(candidateSource), {
    ...options,
    baselineSha256: hash(baselineSource),
    candidateSha256: hash(candidateSource),
  });
  if (options.jsonPath) {
    const target = path.resolve(options.jsonPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(comparison, null, 2)}\n`);
  }
  if (options.markdownPath) {
    const target = path.resolve(options.markdownPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, deliveryOptimizationMarkdown(comparison));
  }
  return comparison;
}

export async function verifyAgentEvaluationReport(reportPath, options = {}) {
  invariant(reportPath, "verifyAgentEvaluationReport requires reportPath.");
  const absolute = path.resolve(reportPath);
  const report = await readJson(absolute);
  const minimumRuns = options.minimumRuns ?? 2;
  invariant(Number.isInteger(minimumRuns) && minimumRuns > 0, "minimumRuns must be a positive integer.");
  if (report.schemaVersion === DELIVERY_REPORT_SCHEMA_VERSION) {
    invariant(report.evaluationMode === "delivery", "Delivery report is missing evaluationMode=delivery.");
    const requiredProfiles = Array.isArray(options.requiredProfiles) && options.requiredProfiles.length > 0 ? options.requiredProfiles : DELIVERY_PROFILES;
    for (const profileName of requiredProfiles) {
      const profile = report.profiles?.[profileName];
      invariant(profile, `Delivery report is missing profile ${profileName}.`);
      invariant(profile.adapter?.realModelEvaluated === true, `Delivery profile ${profileName} did not use a declared real-model adapter.`);
      invariant(profile.adapter?.provenance === "bundled-codex-exec-adapter", `Delivery profile ${profileName} did not use the bundled Codex adapter.`);
      invariant(profile.summary?.runs >= minimumRuns, `Delivery profile ${profileName} requires at least ${minimumRuns} runs.`);
      invariant(profile.summary?.adapterErrors === 0, `Delivery profile ${profileName} contains adapter errors.`);
      invariant(profile.runs.every((run) => Array.isArray(run.observation?.hiddenChecks) && run.observation.hiddenChecks.length > 0), `Delivery profile ${profileName} has missing hidden checks.`);
      invariant(profile.runs.every((run) => Number.isFinite(run.metrics?.durationMs)
        && Number.isFinite(run.metrics?.inputTokens)
        && Number.isFinite(run.metrics?.cachedInputTokens)
        && Number.isFinite(run.metrics?.outputTokens)), `Delivery profile ${profileName} has incomplete usage metrics.`);
    }
    invariant(report.claims?.realModelComplete === true, "Delivery report does not contain a complete real-model matrix.");
    return {
      valid: true,
      reportPath: absolute,
      scenarioId: report.scenario?.id ?? null,
      difficulty: report.scenario?.difficulty ?? null,
      profiles: Object.fromEntries(requiredProfiles.map((name) => [name, report.profiles[name].summary])),
    };
  }
  invariant(report.schemaVersion === 1, `Unsupported Agent evaluation report schemaVersion ${report.schemaVersion}.`);
  invariant(report.primary?.adapter?.realModelEvaluated === true, "Primary evaluation did not use a declared real-model adapter.");
  invariant(report.primary?.adapter?.provenance === "bundled-codex-exec-adapter", "Primary evaluation did not use the bundled Codex adapter.");
  invariant(report.primary?.summary?.runs >= minimumRuns, `Primary evaluation requires at least ${minimumRuns} runs.`);
  invariant(report.primary?.summary?.passRate === 1, "Primary real-model evaluation did not pass every run.");
  invariant(report.claims?.realModelPassClaimed === true, "Report does not contain a valid real-model pass claim.");
  invariant(report.primary.runs.every((run) => run.observation?.hiddenChecks?.length > 0 && run.observation.hiddenChecks.every((check) => check.passed)), "Primary real-model evaluation has failed or missing hidden checks.");
  if (options.requireBaseline === true) {
    invariant(report.baseline?.adapter?.realModelEvaluated === true, "Bare-agent baseline did not use a declared real-model adapter.");
    invariant(report.baseline?.adapter?.provenance === "bundled-codex-exec-adapter", "Bare-agent baseline did not use the bundled Codex adapter.");
    invariant(report.baseline?.summary?.runs >= minimumRuns, `Bare-agent baseline requires at least ${minimumRuns} runs.`);
  }
  const requiredAblations = [...new Set(options.requiredAblations ?? [])];
  for (const capabilityId of requiredAblations) {
    const ablation = report.ablations?.find((item) => item.capabilityId === capabilityId);
    invariant(ablation, `Required capability ablation is missing: ${capabilityId}.`);
    invariant(ablation.adapter?.realModelEvaluated === true, `Ablation ${capabilityId} did not use a declared real-model adapter.`);
    invariant(ablation.adapter?.provenance === "bundled-codex-exec-adapter", `Ablation ${capabilityId} did not use the bundled Codex adapter.`);
    invariant(ablation.summary?.runs >= minimumRuns, `Ablation ${capabilityId} requires at least ${minimumRuns} runs.`);
  }
  return {
    valid: true,
    reportPath: absolute,
    scenarioId: report.scenario?.id ?? null,
    primary: report.primary.summary,
    baseline: report.baseline?.summary ?? null,
    ablations: requiredAblations.map((capabilityId) => {
      const item = report.ablations.find((entry) => entry.capabilityId === capabilityId);
      return { capabilityId, summary: item.summary, profile: item.profile };
    }),
  };
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

function parseArgvJson(value, label) {
  invariant(value, `${label} is required.`);
  let argv;
  try {
    argv = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be a JSON argv array: ${error.message}`);
  }
  invariant(Array.isArray(argv) && argv.every((part) => typeof part === "string") && argv.length > 0, `${label} must be a non-empty JSON string array.`);
  return argv;
}

async function cli(argv) {
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write(`Usage:\n  agent-eval.mjs --scenario <file> [--adapter mock|command|codex] [--delivery-profile PROFILE] [--argv-json '["command","arg"]'] [--real-model] [--adapter-name NAME] [--model MODEL] [--reasoning-effort LEVEL] [--isolated-config] [--bare-agent] [--ablate CAPABILITY] [--runs N] [--report <file>]\n  Schema-v2 delivery scenarios run bare, thin-atdd, and full-openatdd unless --delivery-profile narrows a diagnostic run.\n  agent-eval.mjs --verify-report <file> [--min-runs N] [--require-baseline] [--require-ablation CAPABILITY] [--require-profile PROFILE]\n  agent-eval.mjs --summarize-report <file> [--summarize-report <file> ...] [--summary-json <file>] [--summary-markdown <file>]\n  agent-eval.mjs --compare-baseline <summary.json> --compare-candidate <summary.json> [--comparison-json <file>] [--comparison-markdown <file>] [--enforce-optimization]\n`);
    return;
  }
  if (optionValue(argv, "--compare-baseline") || optionValue(argv, "--compare-candidate")) {
    const comparison = await compareDeliveryEvaluationSummaries(
      optionValue(argv, "--compare-baseline"),
      optionValue(argv, "--compare-candidate"),
      {
        jsonPath: optionValue(argv, "--comparison-json"),
        markdownPath: optionValue(argv, "--comparison-markdown"),
      },
    );
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
    invariant(!argv.includes("--enforce-optimization") || comparison.passed, "Delivery optimization thresholds failed.");
    return;
  }
  const summaryReports = optionValues(argv, "--summarize-report");
  if (summaryReports.length > 0) {
    const summary = await summarizeDeliveryEvaluationReports(summaryReports, {
      jsonPath: optionValue(argv, "--summary-json"),
      markdownPath: optionValue(argv, "--summary-markdown"),
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (optionValue(argv, "--verify-report")) {
    const verified = await verifyAgentEvaluationReport(optionValue(argv, "--verify-report"), {
      minimumRuns: Number(optionValue(argv, "--min-runs") ?? 2),
      requireBaseline: argv.includes("--require-baseline"),
      requiredAblations: optionValues(argv, "--require-ablation"),
      requiredProfiles: optionValues(argv, "--require-profile").length > 0 ? optionValues(argv, "--require-profile") : undefined,
    });
    process.stdout.write(`${JSON.stringify(verified, null, 2)}\n`);
    return;
  }
  const scenarioPath = optionValue(argv, "--scenario");
  invariant(scenarioPath, "--scenario is required.");
  const scenario = validateScenario(await readJson(path.resolve(scenarioPath)), scenarioPath);
  const adapterKind = optionValue(argv, "--adapter") ?? "mock";
  const codexOptions = {
    model: optionValue(argv, "--model"),
    reasoningEffort: optionValue(argv, "--reasoning-effort"),
    isolateUserConfig: argv.includes("--isolated-config"),
  };
  if (scenario.schemaVersion === DELIVERY_SCENARIO_SCHEMA_VERSION) {
    const selectedProfiles = optionValues(argv, "--delivery-profile");
    const requestedProfiles = selectedProfiles.length > 0 ? [...new Set(selectedProfiles)] : DELIVERY_PROFILES;
    invariant(requestedProfiles.every((name) => DELIVERY_PROFILES.includes(name)), "--delivery-profile is invalid.");
    const profileAdapters = requestedProfiles.map((profileName) => {
      if (adapterKind === "codex") {
        return {
          profileName,
          adapter: createCodexAdapter({
            evaluationMode: "delivery",
            profile: profileName,
            bare: profileName === "bare",
            ...codexOptions,
          }),
        };
      }
      if (adapterKind === "command") {
        return {
          profileName,
          adapter: createCommandAdapter({
            name: `${optionValue(argv, "--adapter-name") ?? "delivery-command"}-${profileName}`,
            argv: parseArgvJson(optionValue(argv, "--argv-json"), "--argv-json"),
            realModel: argv.includes("--real-model"),
            provenance: argv.includes("--real-model") ? "declared-real-model-command" : undefined,
            env: { OPENATDD_EVAL_PROFILE: profileName },
          }),
        };
      }
      const fixture = scenario.mock?.profiles?.[profileName];
      invariant(fixture, `Scenario ${scenario.id} has no mock profile fixture for ${profileName}.`);
      return { profileName, adapter: createMockAdapter(fixture, { name: `mock-${profileName}` }) };
    });
    const repetitionsValue = optionValue(argv, "--runs");
    const report = await runDeliveryEvaluation({
      scenarioPath,
      profileAdapters,
      profileNames: requestedProfiles,
      ...(repetitionsValue ? { repetitions: Number(repetitionsValue) } : {}),
      ...(optionValue(argv, "--report") ? { reportPath: optionValue(argv, "--report") } : {}),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  let adapter;
  if (adapterKind === "mock") {
    invariant(scenario.mock?.primary, `Scenario ${scenario.id} has no mock.primary fixture.`);
    adapter = createMockAdapter(scenario.mock.primary);
  } else if (adapterKind === "command") {
    adapter = createCommandAdapter({
      name: optionValue(argv, "--adapter-name"),
      argv: parseArgvJson(optionValue(argv, "--argv-json"), "--argv-json"),
      realModel: argv.includes("--real-model"),
      provenance: argv.includes("--real-model") ? "declared-real-model-command" : undefined,
    });
  } else if (adapterKind === "codex") {
    adapter = createCodexAdapter({ name: optionValue(argv, "--adapter-name"), ...codexOptions });
  } else {
    throw new Error(`Unknown adapter: ${adapterKind}`);
  }

  let baselineAdapter;
  if (argv.includes("--bare-agent")) {
    if (optionValue(argv, "--bare-argv-json")) {
      baselineAdapter = createCommandAdapter({
        name: optionValue(argv, "--bare-adapter-name") ?? "bare-command",
        argv: parseArgvJson(optionValue(argv, "--bare-argv-json"), "--bare-argv-json"),
        realModel: argv.includes("--bare-real-model"),
        provenance: argv.includes("--bare-real-model") ? "declared-real-model-command" : undefined,
      });
    } else if (adapterKind === "codex") {
      baselineAdapter = createCodexAdapter({ bare: true, name: optionValue(argv, "--bare-adapter-name"), ...codexOptions });
    } else {
      invariant(scenario.mock?.bareAgent, `Scenario ${scenario.id} has no mock.bareAgent fixture.`);
      baselineAdapter = createMockAdapter(scenario.mock.bareAgent, { name: "bare-mock" });
    }
  }
  const ablatedCapabilities = optionValues(argv, "--ablate");
  invariant(ablatedCapabilities.length === 0 || adapterKind === "codex", "--ablate currently requires --adapter codex.");
  const ablationAdapters = ablatedCapabilities.map((capabilityId) => ({
    capabilityId,
    profile: capabilityProfile(`without-${capabilityId}`, [capabilityId]),
    adapter: createCodexAdapter({ disabledCapabilities: [capabilityId], ...codexOptions }),
  }));
  const repetitionsValue = optionValue(argv, "--runs");
  const report = await runAgentEvaluation({
    scenarioPath,
    adapter,
    baselineAdapter,
    strategyProfile: capabilityProfile(optionValue(argv, "--profile") ?? "full"),
    ablationAdapters,
    ...(repetitionsValue ? { repetitions: Number(repetitionsValue) } : {}),
    ...(optionValue(argv, "--report") ? { reportPath: optionValue(argv, "--report") } : {}),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export const agentEvalVersions = Object.freeze({
  scenario: SCENARIO_SCHEMA_VERSION,
  deliveryScenario: DELIVERY_SCENARIO_SCHEMA_VERSION,
  deliveryReport: DELIVERY_REPORT_SCHEMA_VERSION,
  rubric: RUBRIC_SCHEMA_VERSION,
});
