#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { capabilityProfile } from "./strategy.mjs";

const SCENARIO_SCHEMA_VERSION = 1;
const RUBRIC_SCHEMA_VERSION = 1;

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
  invariant(scenario.schemaVersion === SCENARIO_SCHEMA_VERSION, `${source} uses unsupported schemaVersion ${scenario.schemaVersion}.`);
  invariant(typeof scenario.id === "string" && scenario.id.length > 0, `${source} requires an id.`);
  invariant(typeof scenario.prompt === "string" && scenario.prompt.trim().length > 0, `${source} requires a prompt.`);
  invariant(typeof scenario.rubric === "string" && scenario.rubric.length > 0, `${source} requires a rubric path.`);
  invariant(scenario.expect && typeof scenario.expect === "object", `${source} requires expect rules.`);
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
  return createCommandAdapter({
    name: options.name ?? (options.bare === true ? "codex-bare" : suffix ? `codex-${suffix}` : "codex-openatdd"),
    argv: [
      process.execPath,
      adapterPath,
      "--mode",
      options.bare === true ? "bare" : "primary",
      ...disabledCapabilities.flatMap((id) => ["--disable-capability", id]),
    ],
    provenance: "bundled-codex-exec-adapter",
    realModel: true,
    timeoutMs: options.timeoutMs ?? 240_000,
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

function expandedArgv(argv, workspace) {
  return argv.map((part) => part === "<node>" ? process.execPath : part.replaceAll("<workspace>", workspace));
}

async function executeHiddenChecks(checks, workspace) {
  const results = [];
  for (const check of checks) {
    const observed = await runArgv(expandedArgv(check.argv, workspace), {
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

export async function verifyAgentEvaluationReport(reportPath, options = {}) {
  invariant(reportPath, "verifyAgentEvaluationReport requires reportPath.");
  const absolute = path.resolve(reportPath);
  const report = await readJson(absolute);
  const minimumRuns = options.minimumRuns ?? 2;
  invariant(Number.isInteger(minimumRuns) && minimumRuns > 0, "minimumRuns must be a positive integer.");
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
    process.stdout.write(`Usage:\n  agent-eval.mjs --scenario <file> [--adapter mock|command|codex] [--argv-json '["command","arg"]'] [--real-model] [--adapter-name NAME] [--bare-agent] [--ablate CAPABILITY] [--runs N] [--report <file>]\n  agent-eval.mjs --verify-report <file> [--min-runs N] [--require-baseline] [--require-ablation CAPABILITY]\n`);
    return;
  }
  if (optionValue(argv, "--verify-report")) {
    const verified = await verifyAgentEvaluationReport(optionValue(argv, "--verify-report"), {
      minimumRuns: Number(optionValue(argv, "--min-runs") ?? 2),
      requireBaseline: argv.includes("--require-baseline"),
      requiredAblations: optionValues(argv, "--require-ablation"),
    });
    process.stdout.write(`${JSON.stringify(verified, null, 2)}\n`);
    return;
  }
  const scenarioPath = optionValue(argv, "--scenario");
  invariant(scenarioPath, "--scenario is required.");
  const scenario = validateScenario(await readJson(path.resolve(scenarioPath)), scenarioPath);
  const adapterKind = optionValue(argv, "--adapter") ?? "mock";
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
    adapter = createCodexAdapter({ name: optionValue(argv, "--adapter-name") });
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
      baselineAdapter = createCodexAdapter({ bare: true, name: optionValue(argv, "--bare-adapter-name") });
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
    adapter: createCodexAdapter({ disabledCapabilities: [capabilityId] }),
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
  rubric: RUBRIC_SCHEMA_VERSION,
});
