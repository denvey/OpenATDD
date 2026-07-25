#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OpenATDDError, asArray, recoverTransactions } from "./lib.mjs";
import { dryRunFinalization, finalizeTask } from "./finalization.mjs";
import {
  createCodexAdapter,
  createCommandAdapter,
  createMockAdapter,
  runAgentEvaluation,
  verifyAgentEvaluationReport,
} from "./agent-eval.mjs";
import { capabilityProfile, writeStrategyRetrospective } from "./strategy.mjs";
import {
  adoptTask,
  analyzeKnowledgeImpact,
  approveAcceptance,
  approveSolution,
  assessTask,
  beginImplementation,
  beginPreUat,
  createTask,
  draftSolution,
  initProject,
  loadTask,
  markReady,
  getTaskContext,
  preflightTask,
  prepareHandoff,
  prepareTaskContext,
  prepareUatPlan,
  recordAcceptanceResult,
  recordAgentDispatch,
  recordCheck,
  recordEnvironmentObservation,
  recordIssue,
  recordRepairAttempt,
  recordSolutionReview,
  recordTaskDecision,
  recordUatBatch,
  reopenAcceptance,
  reopenSolution,
  rebuildKnowledgeGraph,
  resumeTask,
  resolveTaskDecision,
  searchKnowledgeGraph,
  searchMemory,
  summarizeState,
  validateTask,
  writeReport,
} from "./workflow.mjs";

const HELP = `OpenATDD — acceptance-first AI delivery

Usage:
  openatdd init [--root PATH]
  openatdd new TASK --requirement TEXT [--root PATH]
  openatdd adopt TASK --requirement TEXT [--root PATH]
  openatdd status TASK [--json]
  openatdd assess TASK --scope SCOPE --project-pattern PATTERN
                  --reversibility LEVEL --uncertainty LEVEL [--risk SIGNAL]
  openatdd decision TASK --input FILE
  openatdd resolve-decision TASK --id DEC-001 --option OPTION [--rationale TEXT]
  openatdd approve-acceptance TASK
  openatdd draft-solution TASK
  openatdd review-solution TASK --status passed|failed --reviewer main|independent --summary TEXT
                  --check all [--agent-id AGENT-001]
  openatdd approve-solution TASK
  openatdd reopen-acceptance TASK --reason TEXT
  openatdd reopen-solution TASK --reason TEXT
  openatdd begin TASK
  openatdd resume TASK
  openatdd finalize TASK --dry-run [--manifest PATH] [--assertions FILE]
  openatdd finalize TASK [--manifest PATH] [--assertions FILE]
  openatdd pre-uat TASK
  openatdd preflight TASK [--environment local] [--assertions FILE]
  openatdd observe-env ENV --key KEY --value VALUE --source TEXT --evidence PATH
  openatdd plan-uat TASK [--plan FILE]
  openatdd batch TASK --id BATCH --status STATUS --evidence PATH
  openatdd handoff TASK [--estimated-minutes N]
  openatdd record TASK --acceptance AC-01 --status STATUS [--summary TEXT] --evidence PATH
  openatdd check TASK --name NAME --scope focused|module|broad --status STATUS
                  --command COMMAND --evidence PATH [--source-fingerprint HASH]
  openatdd issue TASK --acceptance AC-01 --status open --symptom TEXT [--evidence PATH]
  openatdd issue TASK --id ISSUE-001 --status resolved --root-cause TEXT
                  --regression TEST --invariant TEXT --paths PATH --evidence PATH
  openatdd agent-dispatch TASK --role ROLE --status STATUS [--id ID] [--surface implementation|verification]
                  [--profile NAME] [--model MODEL] [--reasoning-effort LEVEL]
                  [--fork-turns none] [--sandbox MODE] [--input-tokens N]
                  [--cached-input-tokens N] [--output-tokens N] [--duration-ms N]
  openatdd repair-attempt TASK --hypothesis TEXT --outcome OUTCOME [--progress-fingerprint HASH]
  openatdd graph-rebuild
  openatdd graph-query QUERY [--limit N]
  openatdd graph-impact TASK [--paths PATH]
  openatdd context-build TASK [--persist] [--query TEXT]
  openatdd context-show TASK
  openatdd agent-eval --scenario FILE [--adapter mock|command|codex] [--argv-json JSON]
                  [--real-model] [--adapter-name NAME] [--model MODEL]
                  [--reasoning-effort LEVEL] [--bare-agent]
                  [--bare-argv-json JSON] [--bare-real-model] [--ablate CAPABILITY]
                  [--runs N] [--report FILE]
  openatdd agent-eval --verify-report FILE [--min-runs N] [--require-baseline]
                  [--require-ablation CAPABILITY]
  openatdd retrospect TASK [--eval-report FILE] [--json]
  openatdd validate TASK [--json]
  openatdd ready TASK
  openatdd report TASK
  openatdd memory QUERY [--limit N] [--json]

Repeat --evidence, --paths, --regression, or --tags to record multiple values.
`;

function parseArguments(argv) {
  const command = argv[0];
  const positionals = [];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? undefined : token.slice(equals + 1);
    if (value === undefined && argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined) value = true;
    if (options[key] === undefined) options[key] = value;
    else options[key] = [...asArray(options[key]), value];
  }
  return { command, positionals, options };
}

function required(value, name) {
  if (value === undefined || value === true || String(value).trim() === "") {
    throw new OpenATDDError("ARGUMENT_REQUIRED", `Missing required argument: ${name}`);
  }
  return String(value);
}

function taskId(positionals) {
  return required(positionals[0], "TASK");
}

function outputJson(io, value) {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function outputState(io, state) {
  const summary = summarizeState(state);
  io.stdout.write(`${summary.taskId}: ${summary.phase}\n`);
  io.stdout.write(`Acceptance approved: ${summary.acceptanceApproved ? "yes" : "no"}\n`);
  io.stdout.write(`Solution approved: ${summary.solutionApproved ? "yes" : "no"}\n`);
  if (summary.acceptance.length > 0) {
    for (const item of summary.acceptance) {
      io.stdout.write(`- ${item.id} [${item.classification}] ${item.status}\n`);
    }
  }
  if (summary.affectedDependencies.length > 0) {
    io.stdout.write(`Affected dependencies: ${summary.affectedDependencies.map((item) => item.taskId).join(", ")}\n`);
  }
}

async function readJsonInput(root, value, name) {
  const target = path.resolve(root, required(value, name));
  return JSON.parse(await readFile(target, "utf8"));
}

function jsonArgv(value, name) {
  let argv;
  try {
    argv = JSON.parse(required(value, name));
  } catch (error) {
    throw new OpenATDDError("INVALID_ARGUMENT", `${name} must be a JSON argv array: ${error.message}`);
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((item) => typeof item !== "string")) {
    throw new OpenATDDError("INVALID_ARGUMENT", `${name} must be a non-empty JSON string array.`);
  }
  return argv;
}

async function execute(parsed, io) {
  const { command, positionals, options } = parsed;
  const root = path.resolve(String(options.root ?? io.cwd));
  const json = Boolean(options.json);

  await recoverTransactions(root);

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      io.stdout.write(HELP);
      return 0;
    case "init": {
      const files = await initProject(root);
      if (json) outputJson(io, { root: files.root, openatdd: files.openatdd });
      else io.stdout.write(`Initialized OpenATDD at ${files.openatdd}\n`);
      return 0;
    }
    case "new": {
      const result = await createTask(root, taskId(positionals), required(options.requirement, "--requirement"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Created acceptance draft: ${result.files.acceptance}\n`);
      return 0;
    }
    case "adopt": {
      const result = await adoptTask(root, taskId(positionals), required(options.requirement, "--requirement"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Adopted existing acceptance card: ${result.files.acceptance}\n`);
      return 0;
    }
    case "status": {
      const { state } = await loadTask(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(state));
      else outputState(io, state);
      return 0;
    }
    case "assess":
    case "route": {
      const result = await assessTask(root, taskId(positionals), {
        scope: required(options.scope, "--scope"),
        projectPattern: required(options["project-pattern"], "--project-pattern"),
        reversibility: required(options.reversibility, "--reversibility"),
        uncertainty: required(options.uncertainty, "--uncertainty"),
        riskSignals: asArray(options.risk).map(String),
      });
      if (json) outputJson(io, result.state.routing);
      else io.stdout.write(`Task lane: ${result.state.routing.lane} (${result.state.routing.reasons.join(", ")})\n`);
      return 0;
    }
    case "decision": {
      const input = await readJsonInput(root, options.input, "--input");
      const result = await recordTaskDecision(root, taskId(positionals), input);
      const decision = result.state.decisions.at(-1);
      if (json) outputJson(io, decision);
      else io.stdout.write(`Recorded decision ${decision.id}: ${decision.status}\n`);
      return 0;
    }
    case "resolve-decision": {
      const result = await resolveTaskDecision(
        root,
        taskId(positionals),
        required(options.id, "--id"),
        required(options.option, "--option"),
        { rationale: options.rationale },
      );
      const decision = result.state.decisions.find((item) => item.id === options.id);
      if (json) outputJson(io, decision);
      else io.stdout.write(`Resolved decision ${decision.id}: ${decision.resolution.optionId}\n`);
      return 0;
    }
    case "approve-acceptance": {
      const result = await approveAcceptance(root, taskId(positionals));
      if (json) outputJson(io, { ...summarizeState(result.state), warnings: result.warnings, unchanged: result.unchanged });
      else {
        io.stdout.write(`${result.unchanged ? "Acceptance remains approved" : "Approved acceptance"}: ${result.state.taskId}\n`);
        for (const warning of result.warnings) io.stdout.write(`Warning: ${warning}\n`);
      }
      return 0;
    }
    case "draft-solution": {
      const result = await draftSolution(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Solution draft ready: ${result.files.solution}\n`);
      return 0;
    }
    case "review-solution": {
      const result = await recordSolutionReview(root, taskId(positionals), {
        status: required(options.status, "--status"),
        reviewer: required(options.reviewer, "--reviewer"),
        summary: required(options.summary, "--summary"),
        findings: options.finding,
        checks: options.check,
        agentId: options["agent-id"],
      });
      if (json) outputJson(io, result.state.reviews.solution);
      else io.stdout.write(`Solution review: ${result.state.reviews.solution.status}\n`);
      return 0;
    }
    case "approve-solution": {
      const result = await approveSolution(root, taskId(positionals));
      const payload = {
        ...summarizeState(result.state),
        warnings: result.warnings,
        unchanged: result.unchanged,
        affectedDependencies: result.affectedDependencies,
      };
      if (json) outputJson(io, payload);
      else {
        io.stdout.write(`${result.unchanged ? "Solution remains approved" : "Approved solution"}: ${result.state.taskId}\n`);
        for (const dependency of result.affectedDependencies) {
          io.stdout.write(`Affected historical task: ${dependency.taskId} (${dependency.acceptanceIds.join(", ")})\n`);
        }
        for (const warning of result.warnings) io.stdout.write(`Warning: ${warning}\n`);
      }
      return 0;
    }
    case "resume": {
      const result = await resumeTask(root, taskId(positionals));
      const payload = { ...summarizeState(result.state), scopedContext: result.scopedContext };
      if (json) outputJson(io, payload);
      else io.stdout.write(`Resumed ${result.state.taskId} at ${result.state.phase}${result.scopedContext ? ` with ${result.scopedContext.surface} context` : ""}\n`);
      return 0;
    }
    case "reopen-acceptance": {
      const result = await reopenAcceptance(root, taskId(positionals), required(options.reason, "--reason"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Reopened acceptance: ${result.state.taskId}\n`);
      return 0;
    }
    case "reopen-solution": {
      const result = await reopenSolution(root, taskId(positionals), required(options.reason, "--reason"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Reopened solution: ${result.state.taskId}\n`);
      return 0;
    }
    case "begin": {
      const result = await beginImplementation(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Implementation started: ${result.state.taskId}\n`);
      return 0;
    }
    case "finalize": {
      const assertions = options.assertions
        ? JSON.parse(await readFile(path.resolve(root, String(options.assertions)), "utf8"))
        : undefined;
      const input = {
        manifest: options.manifest ? String(options.manifest) : undefined,
        assertions,
        timeoutMs: options["timeout-ms"],
      };
      if (options["dry-run"]) {
        const result = await dryRunFinalization(root, taskId(positionals), input);
        if (json) outputJson(io, result.preview);
        else {
          io.stdout.write(`Finalization dry-run passed: ${result.state.taskId}\n`);
          io.stdout.write(`Preview: ${result.files.finalizePreview}\n`);
          io.stdout.write(`Handoff preview: ${result.files.previewReport}\n`);
        }
      } else {
        const result = await finalizeTask(root, taskId(positionals), input);
        if (json) outputJson(io, { ...result.result, unchanged: result.unchanged });
        else {
          io.stdout.write(`${result.unchanged ? "Finalization remains complete" : "Finalization completed"}: ${result.state.taskId}\n`);
          io.stdout.write(`Report: ${result.files.report}\n`);
          io.stdout.write(`Result: ${result.files.finalizeResult}\n`);
        }
      }
      return 0;
    }
    case "pre-uat": {
      const result = await beginPreUat(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Pre-UAT started: ${result.state.taskId}\n`);
      return 0;
    }
    case "preflight": {
      const assertions = options.assertions
        ? JSON.parse(await readFile(path.resolve(root, String(options.assertions)), "utf8"))
        : undefined;
      const result = await preflightTask(root, taskId(positionals), {
        environment: options.environment ? String(options.environment) : "local",
        assertions,
        source: options.source,
        timeoutMs: options["timeout-ms"],
      });
      if (json) outputJson(io, result.state.preflight);
      else {
        io.stdout.write(`Environment preflight passed: ${result.state.preflight.environment}\n`);
        for (const warning of result.state.preflight.warnings ?? []) io.stdout.write(`Warning: ${warning}\n`);
      }
      return 0;
    }
    case "observe-env": {
      const environment = required(positionals[0], "ENV");
      const result = await recordEnvironmentObservation(root, environment, {
        key: required(options.key, "--key"),
        value: required(options.value, "--value"),
        source: required(options.source, "--source"),
        evidence: options.evidence,
      });
      if (json) outputJson(io, result.observation);
      else io.stdout.write(`Updated ${environment} environment profile: ${options.key}\n`);
      return 0;
    }
    case "plan-uat": {
      const plan = options.plan ? JSON.parse(await readFile(path.resolve(root, String(options.plan)), "utf8")) : undefined;
      const result = await prepareUatPlan(root, taskId(positionals), { plan });
      if (json) outputJson(io, { plan: result.plan, warnings: result.warnings });
      else io.stdout.write(`Prepared ${result.plan.batches.length} cohesive UAT batch(es): ${result.files.uatPlan}\n`);
      return 0;
    }
    case "batch": {
      const result = await recordUatBatch(root, taskId(positionals), {
        batchId: required(options.id, "--id"),
        status: required(options.status, "--status"),
        summary: options.summary,
        evidence: options.evidence,
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded UAT batch ${options.id}: ${options.status}\n`);
      return 0;
    }
    case "handoff": {
      const result = await prepareHandoff(root, taskId(positionals), {
        environment: options.environment,
        version: options.version,
        estimatedMinutes: options["estimated-minutes"],
      });
      if (json) outputJson(io, result.handoff);
      else io.stdout.write(`Prepared detailed UAT handoff: ${result.files.handoff}\n`);
      return 0;
    }
    case "record": {
      const result = await recordAcceptanceResult(root, taskId(positionals), {
        acceptanceId: required(options.acceptance, "--acceptance"),
        status: required(options.status, "--status"),
        summary: options.summary,
        evidence: options.evidence,
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded ${options.acceptance}: ${options.status}\n`);
      return 0;
    }
    case "check": {
      const result = await recordCheck(root, taskId(positionals), {
        name: required(options.name, "--name"),
        status: required(options.status, "--status"),
        command: required(options.command, "--command"),
        summary: options.summary,
        evidence: options.evidence,
        scope: options.scope,
        sourceFingerprint: options["source-fingerprint"],
        durationMs: options["duration-ms"],
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded check ${options.name}: ${options.status}\n`);
      return 0;
    }
    case "issue": {
      const result = await recordIssue(root, taskId(positionals), {
        id: options.id,
        acceptanceId: options.acceptance,
        status: required(options.status, "--status"),
        symptom: options.symptom,
        rootCause: options["root-cause"],
        regression: options.regression,
        invariant: options.invariant,
        paths: options.paths,
        tags: options.tags,
        area: options.area,
        evidence: options.evidence,
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded issue state for ${result.state.taskId}: ${options.status}\n`);
      return 0;
    }
    case "agent-dispatch": {
      const result = await recordAgentDispatch(root, taskId(positionals), {
        id: options.id,
        role: required(options.role, "--role"),
        status: required(options.status, "--status"),
        summary: options.summary,
        surface: options.surface,
        profile: options.profile,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
        forkTurns: options["fork-turns"],
        sandbox: options.sandbox,
        inputTokens: options["input-tokens"],
        cachedInputTokens: options["cached-input-tokens"],
        outputTokens: options["output-tokens"],
        durationMs: options["duration-ms"],
      });
      const dispatch = result.dispatch ?? result.state.agents.dispatches.find((item) => item.id === (options.id ?? result.state.agents.dispatches.at(-1).id));
      if (json) outputJson(io, { ...dispatch, scopedContext: result.scopedContext });
      else io.stdout.write(`Agent dispatch ${dispatch.id}: ${dispatch.status}\n`);
      return 0;
    }
    case "repair-attempt": {
      const result = await recordRepairAttempt(root, taskId(positionals), {
        issueId: options["issue-id"],
        hypothesis: required(options.hypothesis, "--hypothesis"),
        outcome: required(options.outcome, "--outcome"),
        summary: options.summary,
        progressFingerprint: options["progress-fingerprint"],
      });
      const attempt = result.state.repair.attempts.at(-1);
      if (json) outputJson(io, attempt);
      else io.stdout.write(`Repair attempt ${attempt.id}: ${attempt.outcome}\n`);
      return 0;
    }
    case "graph-rebuild": {
      const graph = await rebuildKnowledgeGraph(root);
      const result = { builtAt: graph.builtAt, contentDigest: graph.contentDigest, nodes: graph.nodes.length, edges: graph.edges.length, warnings: graph.warnings };
      if (json) outputJson(io, result);
      else io.stdout.write(`Knowledge graph rebuilt: ${result.nodes} nodes, ${result.edges} edges\n`);
      return 0;
    }
    case "graph-query": {
      const query = required(positionals.join(" ") || options.query, "QUERY");
      const limit = Number(options.limit ?? 20);
      const result = await searchKnowledgeGraph(root, query, { limit: Number.isFinite(limit) ? limit : 20 });
      if (json) outputJson(io, result);
      else for (const match of result.matches) io.stdout.write(`${match.node.id} [${match.score}] ${match.node.title ?? ""}\n`);
      return 0;
    }
    case "graph-impact": {
      const id = taskId(positionals);
      const result = await analyzeKnowledgeImpact(root, id, asArray(options.paths).map(String));
      if (json) outputJson(io, result);
      else if (result.length === 0) io.stdout.write("No affected historical task found.\n");
      else for (const impact of result) io.stdout.write(`${impact.taskId}: ${impact.acceptanceIds.join(", ")} (${impact.reasons.join(", ")})\n`);
      return 0;
    }
    case "context-build": {
      const result = await prepareTaskContext(root, taskId(positionals), {
        persist: options.persist ? true : undefined,
        query: options.query,
      });
      if (json) outputJson(io, result.context);
      else io.stdout.write(`Scoped context prepared: ${result.context.implementation.length} implementation, ${result.context.verification.length} verification references\n`);
      return 0;
    }
    case "context-show": {
      const context = await getTaskContext(root, taskId(positionals));
      if (json) outputJson(io, context);
      else io.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
      return 0;
    }
    case "agent-eval": {
      if (options["verify-report"]) {
        const verified = await verifyAgentEvaluationReport(path.resolve(root, String(options["verify-report"])), {
          minimumRuns: Number(options["min-runs"] ?? 2),
          requireBaseline: Boolean(options["require-baseline"]),
          requiredAblations: asArray(options["require-ablation"]).map(String),
        });
        if (json) outputJson(io, verified);
        else io.stdout.write(`Real Agent report verified: ${verified.scenarioId} (${verified.primary.runs} runs)\n`);
        return 0;
      }
      const scenarioPath = path.resolve(root, required(options.scenario, "--scenario"));
      const scenario = JSON.parse(await readFile(scenarioPath, "utf8"));
      const adapterKind = String(options.adapter ?? "mock");
      const codexOptions = {
        model: options.model ? String(options.model) : undefined,
        reasoningEffort: options["reasoning-effort"] ? String(options["reasoning-effort"]) : undefined,
      };
      if (!["mock", "command", "codex"].includes(adapterKind)) throw new OpenATDDError("INVALID_ARGUMENT", `Unknown adapter: ${adapterKind}`);
      const adapter = adapterKind === "command"
        ? createCommandAdapter({
          name: options["adapter-name"],
          argv: jsonArgv(options["argv-json"], "--argv-json"),
          realModel: Boolean(options["real-model"]),
          provenance: options["real-model"] ? "declared-real-model-command" : undefined,
        })
        : adapterKind === "codex"
          ? createCodexAdapter({ name: options["adapter-name"], ...codexOptions })
          : createMockAdapter(scenario.mock?.primary);
      let baselineAdapter;
      if (options["bare-agent"]) {
        baselineAdapter = options["bare-argv-json"]
          ? createCommandAdapter({
            name: options["bare-adapter-name"] ?? "bare-command",
            argv: jsonArgv(options["bare-argv-json"], "--bare-argv-json"),
            realModel: Boolean(options["bare-real-model"]),
            provenance: options["bare-real-model"] ? "declared-real-model-command" : undefined,
          })
          : adapterKind === "codex"
            ? createCodexAdapter({ bare: true, name: options["bare-adapter-name"], ...codexOptions })
            : createMockAdapter(scenario.mock?.bareAgent, { name: "bare-mock" });
      }
      const ablatedCapabilities = asArray(options.ablate).map(String);
      if (ablatedCapabilities.length > 0 && adapterKind !== "codex") {
        throw new OpenATDDError("INVALID_ARGUMENT", "--ablate currently requires --adapter codex.");
      }
      const ablationAdapters = ablatedCapabilities.map((capabilityId) => ({
        capabilityId,
        profile: capabilityProfile(`without-${capabilityId}`, [capabilityId]),
        adapter: createCodexAdapter({ disabledCapabilities: [capabilityId], ...codexOptions }),
      }));
      const repetitions = options.runs === undefined ? undefined : Number(options.runs);
      const report = await runAgentEvaluation({
        scenarioPath,
        adapter,
        baselineAdapter,
        strategyProfile: capabilityProfile(String(options.profile ?? "full")),
        ablationAdapters,
        ...(repetitions === undefined ? {} : { repetitions }),
        ...(options.report ? { reportPath: path.resolve(root, String(options.report)) } : {}),
      });
      if (json) outputJson(io, report);
      else io.stdout.write(`Agent eval ${report.scenario.id}: ${(report.primary.summary.passRate * 100).toFixed(0)}% pass rate\n`);
      return 0;
    }
    case "retrospect": {
      const loaded = await loadTask(root, taskId(positionals));
      const result = await writeStrategyRetrospective(root, loaded.state, loaded.files, {
        evaluationPaths: options["eval-report"],
      });
      if (json) outputJson(io, result.retrospective);
      else io.stdout.write(`${result.summary}\nReport: ${result.files.markdown}\nJSON: ${result.files.json}\n`);
      return 0;
    }
    case "validate": {
      const result = await validateTask(root, taskId(positionals));
      if (json) outputJson(io, result);
      else {
        io.stdout.write(`${result.valid ? "Valid" : "Invalid"}: ${result.state.taskId}\n`);
        for (const error of result.errors) io.stdout.write(`Error: ${error}\n`);
        for (const warning of result.warnings) io.stdout.write(`Warning: ${warning}\n`);
      }
      return result.valid ? 0 : 1;
    }
    case "ready": {
      const result = await markReady(root, taskId(positionals));
      if (json) outputJson(io, { ...summarizeState(result.state), report: result.files.report, notification: result.files.notification });
      else io.stdout.write(`READY_FOR_UAT: ${result.state.taskId}\nReport: ${result.files.report}\nNotification draft: ${result.files.notification}\n`);
      return 0;
    }
    case "report": {
      const result = await writeReport(root, taskId(positionals));
      if (json) outputJson(io, { taskId: result.state.taskId, report: result.files.report });
      else io.stdout.write(`Wrote report: ${result.files.report}\n`);
      return 0;
    }
    case "memory": {
      const query = required(positionals.join(" ") || options.query, "QUERY");
      const rawLimit = Number(options.limit ?? 10);
      const result = await searchMemory(root, query, Number.isFinite(rawLimit) ? rawLimit : 10);
      if (json) outputJson(io, result);
      else if (result.matches.length === 0 && result.environmentMatches.length === 0) io.stdout.write("No relevant project memory found.\n");
      else {
        for (const match of result.matches) {
          io.stdout.write(`${match.id} [score ${match.score}] ${match.title} — ${match.file}\n`);
        }
        for (const match of result.environmentMatches) {
          io.stdout.write(`ENV:${match.environment}/${match.key} [score ${match.score}] ${match.value} — verified ${match.last_verified_at}\n`);
        }
      }
      return 0;
    }
    default:
      throw new OpenATDDError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
  }
}

function writeError(io, error) {
  const code = error instanceof OpenATDDError ? error.code : "UNEXPECTED_ERROR";
  io.stderr.write(`[${code}] ${error.message}\n`);
  for (const item of error?.details?.errors ?? []) io.stderr.write(`- ${item}\n`);
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const io = {
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    cwd: overrides.cwd ?? process.cwd(),
  };
  try {
    return await execute(parseArguments(argv), io);
  } catch (error) {
    writeError(io, error);
    return 1;
  }
}

const direct = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (direct) process.exitCode = await main();
