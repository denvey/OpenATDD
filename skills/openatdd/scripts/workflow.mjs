import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, readFile, readlink, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  asArray,
  assert,
  assertTaskId,
  atomicWriteBatch,
  atomicWrite,
  artifactLocator,
  captureEvidence,
  filesBelow,
  gitPrivateRoot,
  inferHumanLanguage,
  isoNow,
  normalizeImpactPath,
  pathExists,
  readJson,
  readUtf8,
  resolveArtifactPath,
  sha256,
  toPosix,
  tokenize,
  verifyCapturedEvidence,
  writeJson,
} from "./lib.mjs";
import {
  acceptanceTemplate,
  acceptanceContract,
  acceptanceFingerprint,
  fingerprint,
  replaceRequirementSection,
  requirementDocument,
  solutionContract,
  solutionFingerprint,
  solutionTemplate,
  validateAcceptance,
  validateSolution,
} from "./contracts.mjs";
import { RISK_OVERLAYS, agentPolicyForLane, authorizationOverlays, classifyTask, controllerProfileForLane, interactionPolicyForLane } from "./routing.mjs";
import { profileForDispatch, verificationExecutionProfile } from "./agent-profiles.mjs";
import {
  IMPLEMENTATION_ROUTES,
  deriveDefaultExecutionPlan,
  validateExecutionPlan,
  validateExecutionResult,
  validateRuntimeAttestation,
  validateRuntimeFailure,
} from "./execution-contracts.mjs";
import {
  blockingDecisions,
  createDecision,
  resolveDecision,
} from "./decisions.mjs";
import {
  buildGraph,
  loadGraph,
  queryGraph,
  safeImpactAnalysis,
} from "./graph.mjs";
import {
  buildScopedContext,
  loadScopedContext,
} from "./context.mjs";
import {
  ensureEnvironmentInfrastructure,
  loadEnvironmentProfile,
  loadLocalCredentials,
  loadScanOnlyCredentials,
  observeEnvironment,
  runEnvironmentPreflight,
  scanEnvironmentArtifacts,
  splitProfileList,
} from "./profiles.mjs";
import { canonicalJson, fingerprintProject, loadFinalizationManifest } from "./manifest.mjs";
import { projectStageTiming } from "./timing.mjs";

const execFileAsync = promisify(execFile);

let orchestrationContractsPromise;

async function orchestrationContracts() {
  if (!orchestrationContractsPromise) {
    orchestrationContractsPromise = import("./orchestration-contracts.mjs").catch((error) => {
      if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
      throw error;
    });
  }
  return orchestrationContractsPromise;
}

function orchestrationDefaults() {
  return {
    status: "idle",
    revision: 0,
    controller: null,
    capabilities: null,
    contract: null,
    plan: null,
    batches: [],
    sessions: {},
    eventIds: [],
    events: [],
    aggregate: {
      total: 0,
      planned: 0,
      creating: 0,
      created: 0,
      running: 0,
      waiting: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      needs_input: 0,
      integrating: 0,
      integrated: 0,
      conflict: 0,
      nextActions: [],
      explanation: null,
    },
    integration: {
      status: "not_started",
      sessionIds: [],
      integratedSessionIds: [],
      conflicts: [],
      candidateFingerprint: null,
      startedAt: null,
      completedAt: null,
      budgetMs: 15 * 60 * 1000,
      budgetStartedAt: null,
      deadlineAt: null,
      elapsedMs: 0,
      budgetStatus: "not_started",
      overrunActions: ["minimal-contract-repair", "controller-sequential", "replan"],
    },
    cleanup: {
      status: "not_started",
      attemptedAt: null,
      completedAt: null,
      items: [],
      summary: { total: 0, cleaned: 0, retained: 0, failed: 0, complete: true },
    },
    nextActions: [],
  };
}

function normalizeOrchestrationResult(value, fallback = undefined) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.orchestration && typeof value.orchestration === "object") return value.orchestration;
    if (value.state?.orchestration && typeof value.state.orchestration === "object") return value.state.orchestration;
    if (value.state?.execution?.orchestration && typeof value.state.execution.orchestration === "object") return value.state.execution.orchestration;
  }
  return value ?? fallback;
}

function contractValidationResult(value, code, message) {
  if (value === undefined) return value;
  if (value?.valid === false) assert(false, code, message, { errors: value.errors ?? [] });
  return value?.normalized ?? value?.value ?? value?.capabilities ?? value?.directive ?? value;
}

function sessionState(status = "planned") {
  return {
    status,
    state: status,
    sessionId: null,
    threadId: null,
    hostId: null,
    worktree: null,
    branch: null,
    base: null,
    mainBaseline: null,
    writeScope: [],
    doNotTouch: [],
    subtaskId: null,
    result: null,
    durationMs: null,
    createdAt: null,
    updatedAt: null,
  };
}

function sessionStatus(session = {}) {
  return session.status ?? session.state ?? "planned";
}

function orchestrationTask(orchestration, subtaskId) {
  return (orchestration.plan?.tasks
    ?? orchestration.batches?.flatMap((batch) => batch.tasks ?? [])
    ?? []).find((task) => task.id === subtaskId);
}

function authorityFingerprint(state) {
  return sha256(canonicalJson({
    acceptance: state.acceptance,
    solution: state.solution,
    decisions: state.decisions,
    routing: state.routing,
    review: state.reviews?.solution ?? null,
    executionPlan: state.execution?.plan ?? null,
    directive: state.execution?.directive ?? null,
  }));
}

async function protectedContractFingerprint(root) {
  const directory = path.join(root, ".openatdd", "requirements");
  const entries = [];
  for (const file of await filesBelow(directory)) {
    const relative = toPosix(path.relative(root, file));
    entries.push([relative, sha256(await readFile(file))]);
  }
  return sha256(canonicalJson(entries.sort(([left], [right]) => left.localeCompare(right))));
}

async function gitWorktreeIdentity(root) {
  try {
    const options = { cwd: root, encoding: "utf8" };
    const [{ stdout: topLevel }, { stdout: commonDir }, { stdout: head }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--show-toplevel"], options),
      execFileAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], options),
      execFileAsync("git", ["rev-parse", "HEAD"], options),
    ]);
    let branch = null;
    try {
      branch = (await execFileAsync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], options)).stdout.trim() || null;
    } catch {
      // Detached Codex worktrees are valid; their branch identity is derived
      // from the immutable head plus the unique worktree path.
    }
    const normalizedTopLevel = await realpath(topLevel.trim());
    const normalizedHead = head.trim();
    return {
      git: true,
      topLevel: normalizedTopLevel,
      commonDir: await realpath(commonDir.trim()),
      head: normalizedHead,
      branch,
      branchIdentity: branch ?? `detached:${normalizedHead}:${normalizedTopLevel}`,
    };
  } catch {
    return { git: false, topLevel: path.resolve(root), commonDir: null, head: null, branch: null, branchIdentity: null };
  }
}

function orchestrationSessionId(event = {}) {
  return String(event.sessionId ?? event.session?.sessionId ?? event.id ?? "").trim();
}

function orchestrationEventId(event = {}) {
  return String(event.eventId ?? event.id ?? "").trim();
}

function orchestrationRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
}

function summarizeOrchestrationFallback(orchestration) {
  const sessions = Object.values(orchestration?.sessions ?? {});
  const counts = {};
  for (const session of sessions) {
    const status = sessionStatus(session);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const nextActions = [];
  if (["planned", "running", "waiting"].includes(orchestration?.status)) {
    if (sessions.some((session) => sessionStatus(session) === "planned")) nextActions.push("create");
    if (sessions.some((session) => ["created", "running"].includes(sessionStatus(session)))) nextActions.push("wait");
    if (sessions.some((session) => sessionStatus(session) === "passed")) nextActions.push("integrate");
  }
  return {
    status: orchestration?.status ?? "idle",
    revision: orchestration?.revision ?? 0,
    aggregate: {
      total: sessions.length,
      ...counts,
      nextActions: [...new Set([...(orchestration?.aggregate?.nextActions ?? []), ...nextActions])],
      explanation: orchestration?.aggregate?.explanation ?? null,
    },
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      subtaskId: session.subtaskId,
      status: sessionStatus(session),
      threadId: session.threadId,
      worktree: session.worktree,
      branch: session.branch,
      durationMs: session.durationMs,
      result: session.result ? {
        status: session.result.status,
        changedPaths: session.result.changedPaths ?? [],
        candidateFingerprint: session.result.candidateFingerprint ?? null,
      } : null,
    })),
    integration: orchestration?.integration ?? null,
    cleanup: orchestration?.cleanup ?? orchestrationDefaults().cleanup,
    nextActions: orchestration?.nextActions ?? [],
  };
}

export const PHASES = Object.freeze({
  ACCEPTANCE_DRAFT: "ACCEPTANCE_DRAFT",
  ACCEPTANCE_APPROVED: "ACCEPTANCE_APPROVED",
  SOLUTION_DRAFT: "SOLUTION_DRAFT",
  CONTRACT_APPROVED: "CONTRACT_APPROVED",
  IMPLEMENTING: "IMPLEMENTING",
  PRE_UAT: "PRE_UAT",
  REPAIRING: "REPAIRING",
  BLOCKED: "BLOCKED",
  DELIVERED: "DELIVERED",
});

export const DELIVERY_TERMINAL_PHASES = Object.freeze([
  PHASES.DELIVERED,
]);

export function isDeliveryTerminalPhase(phase) {
  return DELIVERY_TERMINAL_PHASES.includes(phase);
}

export const SOLUTION_REVIEW_CHECKS = Object.freeze([
  "simplicity",
  "project-fit",
  "summary-detail-consistency",
  "hidden-material-choices",
  "acceptance-trace",
  "unnecessary-infrastructure",
]);

export const INDEPENDENT_REVIEW_BUDGETS = Object.freeze({
  initial: 15 * 60 * 1000,
  recheck: 5 * 60 * 1000,
});

export const INDEPENDENT_REVIEW_MAX_ATTEMPTS = 2;

const CONFIG_TEMPLATE = `version: 1
notification:
  mode: draft
verification:
  web: playwright
  require_fresh_evidence: true
impact_analysis:
  enabled: true
memory:
  strategy: scoped
# authorization_overlays extends the built-in set of risk overlays that require
# a resolved authorization decision; it can only add overlays, never remove one.
# authorization_overlays: payment, authentication
`;

const INVARIANTS_TEMPLATE = `# Project invariants

Record durable rules discovered while resolving real defects. Keep this file
small; use the incident index for details.
`;

const PROJECT_TRUTH_TEMPLATE = `# Project truth

Keep only current, durable facts in this file and keep each entry short. Delete
facts that are no longer true; history stays in tasks, decisions, incidents,
and Git.

## Product rules

## Architecture boundaries

## Technical decisions
`;

function historyEvent(event, at, details = undefined) {
  return details === undefined ? { event, at } : { event, at, details };
}

function initialState(taskId, requirement, now) {
  return {
    schemaVersion: 3,
    deliveryVersion: 3,
    taskId,
    requirement,
    phase: PHASES.ACCEPTANCE_DRAFT,
    createdAt: now,
    updatedAt: now,
    acceptance: { approvedAt: null, sha256: null, items: [] },
    solution: { approvedAt: null, sha256: null, impactPaths: [], trace: [] },
    routing: {
      status: "not_assessed",
      lane: null,
      reasons: [],
      investigation: { externalResearch: false },
      controller: null,
      agents: { roles: [] },
      interaction: { approvals: "human", contract: "full" },
    },
    decisions: [],
    reviews: { solution: null, independent: { initialSolutionSha256: null, recheckSolutionSha256: null, lastVerdict: null, unavailable: [] } },
    agents: { dispatches: [] },
    execution: { planStatus: "not_planned", plannedAt: null, plan: null, results: {}, fallbackReason: null, nextActions: [], directive: null, orchestration: orchestrationDefaults() },
    context: { status: "not_prepared", path: null, digest: null, sourceDigests: {} },
    repair: { attempts: [], lastProgressFingerprint: null, lastHypothesis: null, consecutiveNoProgress: 0 },
    verificationNotBefore: null,
    verification: { epoch: 0, startedAt: now, clean: true },
    results: {},
    checks: {},
    checkSequence: [],
    issues: [],
    affectedDependencies: [],
    preflight: { status: "not_run", environment: "local", checkedAt: null, warnings: [] },
    uat: { planStatus: "not_planned", batches: {}, warnings: [] },
    handoff: { status: "not_prepared", preparedAt: null },
    finalization: { status: "not_started", version: 1 },
    timing: { currentPhase: PHASES.ACCEPTANCE_DRAFT, phaseStartedAt: now, phases: [] },
    readyAt: null,
    history: [historyEvent("TASK_CREATED", now, { requirement })],
  };
}

export function setPhase(state, phase, now) {
  if (state.phase === phase) return;
  const startedAt = state.timing?.phaseStartedAt ?? state.updatedAt ?? state.createdAt;
  const durationMs = Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime());
  state.timing ??= { currentPhase: state.phase, phaseStartedAt: startedAt, phases: [] };
  state.timing.phases.push({ phase: state.phase, startedAt, endedAt: now, durationMs });
  state.phase = phase;
  state.timing.currentPhase = phase;
  state.timing.phaseStartedAt = now;
}

export function advanceEpoch(state, now, reason) {
  const previous = state.verification?.epoch ?? 0;
  state.verification = { epoch: previous + 1, startedAt: now, clean: !state.issues?.some((issue) => issue.status === "open"), reason };
  state.verificationNotBefore = now;
  state.readyAt = null;
  return state.verification.epoch;
}

export function projectFiles(root) {
  const projectRoot = path.resolve(root);
  const openatdd = path.join(projectRoot, ".openatdd");
  const runtime = gitPrivateRoot(projectRoot);
  return {
    root: projectRoot,
    openatdd,
    config: path.join(openatdd, "config.yaml"),
    requirements: path.join(openatdd, "requirements"),
    tasks: path.join(runtime, "tasks"),
    runtime,
    memory: path.join(runtime, "memory"),
    incidents: path.join(runtime, "memory", "incidents"),
    invariants: path.join(openatdd, "knowledge", "invariants.md"),
    memoryIndex: path.join(runtime, "memory", "index.json"),
    knowledge: path.join(openatdd, "knowledge"),
    projectTruth: path.join(openatdd, "knowledge", "project.md"),
    standards: path.join(openatdd, "knowledge", "standards"),
    research: path.join(openatdd, "knowledge", "research"),
    knowledgeGraph: path.join(runtime, "knowledge", "graph.json"),
    environments: path.join(openatdd, "environments"),
    environmentObservations: path.join(runtime, "environments", "observations.json"),
    dotenv: path.join(projectRoot, ".env.openatdd.local"),
    dotenvExample: path.join(projectRoot, ".env.openatdd.example"),
    finalizationManifest: path.join(openatdd, "finalization.json"),
    transactions: path.join(runtime, "transactions"),
    reverificationIndex: path.join(runtime, "reverification", "index.json"),
  };
}

export function taskFiles(root, taskId) {
  assertTaskId(taskId);
  const project = projectFiles(root);
  const task = path.join(project.tasks, taskId);
  const requirement = path.join(project.requirements, `${taskId}.md`);
  return {
    ...project,
    task,
    requirement,
    acceptance: requirement,
    solution: requirement,
    state: path.join(task, "state.json"),
    issues: path.join(task, "issues.md"),
    evidence: path.join(task, "evidence"),
    report: path.join(task, "report.md"),
    notification: path.join(task, "notification.md"),
    preflight: path.join(task, "preflight.json"),
    uatPlan: path.join(task, "uat-plan.json"),
    handoff: path.join(task, "handoff.json"),
    finalizationManifest: path.join(task, "finalization.manifest.json"),
    finalization: path.join(task, "finalization.json"),
    finalizePreview: path.join(task, "finalize-preview.json"),
    previewReport: path.join(task, "report.preview.md"),
    finalizeResult: path.join(task, "finalize-result.json"),
    finalizationSnapshot: path.join(task, "finalization-snapshot.json"),
    contextFile: path.join(task, "context.json"),
    retrospective: path.join(task, "retrospective.md"),
    retrospectiveJson: path.join(task, "retrospective.json"),
  };
}

export async function initProject(root) {
  const files = projectFiles(root);
  await mkdir(files.requirements, { recursive: true });
  await mkdir(files.tasks, { recursive: true });
  await mkdir(files.incidents, { recursive: true });
  await mkdir(files.standards, { recursive: true });
  await mkdir(files.research, { recursive: true });
  if (!(await pathExists(files.config))) await atomicWrite(files.config, CONFIG_TEMPLATE);
  if (!(await pathExists(files.invariants))) await atomicWrite(files.invariants, INVARIANTS_TEMPLATE);
  if (!(await pathExists(files.projectTruth))) await atomicWrite(files.projectTruth, PROJECT_TRUTH_TEMPLATE);
  if (!(await pathExists(files.memoryIndex))) {
    await writeJson(files.memoryIndex, { schemaVersion: 1, incidents: [] });
  }
  if (!(await pathExists(files.reverificationIndex))) {
    await writeJson(files.reverificationIndex, { schemaVersion: 1, entries: [] });
  }
  await ensureEnvironmentInfrastructure(root, "local");
  return files;
}

export async function createTask(root, taskId, requirement, clock = () => new Date()) {
  assertTaskId(taskId);
  assert(requirement?.trim(), "REQUIREMENT_REQUIRED", "A one-line requirement is required.");
  await initProject(root);
  const files = taskFiles(root, taskId);
  assert(!(await pathExists(files.requirement)) && !(await pathExists(files.state)), "TASK_EXISTS", `Task already exists: ${taskId}`);
  await mkdir(files.evidence, { recursive: true });
  const now = isoNow(clock);
  const state = initialState(taskId, requirement.trim(), now);
  const creationBaseline = await fingerprintProject(root, { include: ["**/*"] });
  state.creationBaseline = {
    recordedAt: now,
    fingerprint: creationBaseline.fingerprint,
    files: creationBaseline.files,
  };
  await atomicWrite(files.requirement, requirementDocument(taskId, requirement.trim()));
  await atomicWrite(files.issues, renderIssues(state));
  await writeJson(files.state, state);
  return loadTask(root, taskId);
}

export async function adoptTask(root, taskId, requirement, clock = () => new Date()) {
  assertTaskId(taskId);
  assert(requirement?.trim(), "REQUIREMENT_REQUIRED", "A one-line requirement is required.");
  await initProject(root);
  const files = taskFiles(root, taskId);
  assert(await pathExists(files.requirement), "ACCEPTANCE_NOT_FOUND", `Cannot adopt ${taskId} without its requirement document.`);
  assert(!(await pathExists(files.state)), "TASK_EXISTS", `Task state already exists: ${taskId}`);
  await mkdir(files.evidence, { recursive: true });
  const now = isoNow(clock);
  const state = initialState(taskId, requirement.trim(), now);
  state.history.push(historyEvent("TASK_ADOPTED", now));
  if (!(await pathExists(files.issues))) await atomicWrite(files.issues, renderIssues(state));
  await writeJson(files.state, state);
  return { state, files };
}

export async function loadTask(root, taskId) {
  const files = taskFiles(root, taskId);
  assert(await pathExists(files.requirement) && await pathExists(files.state), "TASK_NOT_FOUND", `OpenATDD task does not exist: ${taskId}`);
  const persisted = await readJson(files.state);
  assert(persisted.schemaVersion === 3, "UNSUPPORTED_STATE", `Unsupported task state version: ${persisted.schemaVersion}`);
  const state = persisted;
  const hadExecution = Boolean(state.execution);
  if (state.routing?.lane) {
    state.routing.controller = controllerProfileForLane(state.routing.lane);
    state.routing.agents = agentPolicyForLane(state.routing.lane);
  }
  state.execution ??= { planStatus: "not_planned", plannedAt: null, plan: null, results: {}, fallbackReason: null, nextActions: [] };
  state.execution.planStatus ??= state.execution.plan ? "planned" : "not_planned";
  state.execution.plannedAt ??= null;
  state.execution.plan ??= null;
  state.execution.results ??= {};
  state.execution.fallbackReason ??= null;
  state.execution.nextActions ??= state.execution.plan ? ["dispatch-worker"] : [];
  if (hadExecution) {
    state.execution.directive ??= null;
    state.execution.orchestration = {
      ...orchestrationDefaults(),
      ...(state.execution.orchestration ?? {}),
      aggregate: {
        ...orchestrationDefaults().aggregate,
        ...(state.execution.orchestration?.aggregate ?? {}),
      },
      integration: {
        ...orchestrationDefaults().integration,
        ...(state.execution.orchestration?.integration ?? {}),
      },
      sessions: state.execution.orchestration?.sessions ?? {},
      eventIds: state.execution.orchestration?.eventIds ?? [],
      events: state.execution.orchestration?.events ?? [],
      batches: state.execution.orchestration?.batches ?? [],
      nextActions: state.execution.orchestration?.nextActions ?? [],
    };
  }
  state.reviews ??= { solution: null };
  state.reviews.independent ??= { initialSolutionSha256: null, recheckSolutionSha256: null, lastVerdict: null, unavailable: [] };
  state.reviews.independent.recheckSolutionSha256 ??= null;
  state.reviews.independent.lastVerdict ??= null;
  state.reviews.independent.unavailable ??= [];
  return { state, files };
}

async function saveTask(files, state, clock = () => new Date()) {
  state.updatedAt = isoNow(clock);
  await writeJson(files.state, state);
  return { state, files };
}

async function refreshKnowledgeGraph(root, clock = () => new Date()) {
  try {
    return await buildGraph(root, { persist: true, clock });
  } catch {
    return null;
  }
}

function assertPhase(state, allowed, action) {
  const phases = asArray(allowed);
  assert(
    phases.includes(state.phase),
    "INVALID_PHASE",
    `${action} is not allowed in phase ${state.phase}. Expected: ${phases.join(", ")}.`,
  );
}

function appendHistory(state, event, at, details = undefined) {
  state.history.push(historyEvent(event, at, details));
}

function normalizedReviewChecks(value) {
  const requested = new Set(asArray(value).flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean));
  if (requested.has("all")) return [...SOLUTION_REVIEW_CHECKS];
  return SOLUTION_REVIEW_CHECKS.filter((check) => requested.has(check));
}

function contextSurfaceForRole(role) {
  return role === "independent-review" ? "verification" : "implementation";
}

function independentReviewDispatches(state, solutionSha256, round) {
  return state.agents.dispatches.filter((item) => item.role === "independent-review"
    && item.reviewControl?.solutionSha256 === solutionSha256
    && item.reviewControl?.round === round);
}

function currentIndependentReviewPlan(state, document) {
  const solutionSha256 = solutionFingerprint(document);
  const control = state.reviews.independent ?? { initialSolutionSha256: null, recheckSolutionSha256: null, lastVerdict: null, unavailable: [] };
  const previousReview = state.reviews.solution;
  let round = "initial";
  if (control.initialSolutionSha256 && control.initialSolutionSha256 !== solutionSha256) {
    assert(previousReview?.status === "failed", "INDEPENDENT_REVIEW_RECHECK_NOT_REQUIRED", "A changed solution may enter the recheck round only after an independent reviewer returned actionable findings.");
    assert(!control.recheckSolutionSha256 || control.recheckSolutionSha256 === solutionSha256, "INDEPENDENT_REVIEW_ROUNDS_EXHAUSTED", "The one targeted recheck round has already been used; do not dispatch another Reviewer after further solution changes.");
    round = "recheck";
  }
  if (round === "initial" && control.initialSolutionSha256) {
    assert(control.initialSolutionSha256 === solutionSha256, "INDEPENDENT_REVIEW_SOLUTION_CHANGED", "The solution changed after the initial review round started; record the actionable failed review before dispatching a recheck.");
  }
  if (round === "recheck") {
    assert(previousReview?.reviewer === "independent" && previousReview.solutionSha256 === control.initialSolutionSha256, "INDEPENDENT_REVIEW_RECHECK_NOT_REQUIRED", "A recheck must follow an independent failed review of the initial solution.");
  }
  return { solutionSha256, round, timeoutMs: INDEPENDENT_REVIEW_BUDGETS[round] };
}

function assertIndependentReviewDispatchAllowed(state, id, plan) {
  const unavailableKey = `${plan.round}:${plan.solutionSha256}`;
  const unavailable = state.reviews?.independent?.unavailable?.find((item) => item.key === unavailableKey);
  const permanentCapabilityUnavailable = ["model_identity", "permission"].includes(unavailable?.reason);
  assert(!permanentCapabilityUnavailable, "INDEPENDENT_REVIEW_CAPABILITY_UNAVAILABLE", "Independent review capability is already unavailable for this solution round; use the explicit fallback path instead of retrying dispatch.");
  const attempts = independentReviewDispatches(state, plan.solutionSha256, plan.round);
  const same = attempts.find((item) => item.id === id);
  if (same) {
    return { ...plan, attempt: same.reviewControl.attempt, maxAttempts: INDEPENDENT_REVIEW_MAX_ATTEMPTS };
  }
  assert(!attempts.some((item) => item.status === "passed"), "INDEPENDENT_REVIEW_ALREADY_COMPLETED", "This solution round already has a usable independent reviewer result.");
  assert(attempts.every((item) => ["failed", "blocked"].includes(item.status)), "INDEPENDENT_REVIEW_ATTEMPT_ACTIVE", "Finish or stop the current independent reviewer before starting another attempt.");
  assert(attempts.length < INDEPENDENT_REVIEW_MAX_ATTEMPTS, "INDEPENDENT_REVIEW_BUDGET_EXHAUSTED", "Independent review execution failed twice for this solution round; a third dispatch is not allowed.");
  return { ...plan, attempt: attempts.length + 1, maxAttempts: INDEPENDENT_REVIEW_MAX_ATTEMPTS };
}

function independentReviewFallbackEligibility(state, solutionSha256) {
  const unavailable = state.reviews?.independent?.unavailable?.find((item) => item.solutionSha256 === solutionSha256) ?? null;
  const lastVerdict = state.reviews?.independent?.lastVerdict;
  const recheckExhausted = lastVerdict?.status === "failed"
    && lastVerdict.round === "recheck"
    && lastVerdict.solutionSha256 !== solutionSha256;
  return { eligible: Boolean(unavailable || recheckExhausted), unavailable, recheckExhausted };
}

async function loadContextForState(root, state, files, input = {}) {
  const lane = input.lane ?? state.routing?.lane ?? "standard";
  const persist = input.persist ?? lane !== "quick";
  const surface = input.surface ?? "implementation";
  assert(["implementation", "verification"].includes(surface), "INVALID_CONTEXT_SURFACE", `Unknown context surface: ${surface}`);
  const context = await loadScopedContext(root, state.taskId, { lane, persist });
  state.context = {
    status: "prepared",
    path: persist ? artifactLocator(files.root, files.contextFile) : null,
    digest: context.digest,
    sourceDigests: context.sourceDigests,
  };
  return {
    context,
    surface,
    references: context[surface],
    persisted: persist,
  };
}

function validationFailure(code, message, validation) {
  assert(validation.errors.length === 0, code, message, {
    errors: validation.errors,
    warnings: validation.warnings,
  });
}

async function assertAcceptanceIntegrity(files, state) {
  assert(state.acceptance.approvedAt, "ACCEPTANCE_NOT_APPROVED", "Acceptance has not been approved.");
  const document = await readUtf8(files.requirement);
  const markdown = acceptanceContract(document);
  assert(
    acceptanceFingerprint(document) === state.acceptance.sha256,
    "ACCEPTANCE_DRIFT",
    "The acceptance section changed after approval. Reopen acceptance before changing it.",
  );
  return markdown;
}

async function assertSolutionIntegrity(files, state) {
  assert(state.solution.approvedAt, "SOLUTION_NOT_APPROVED", "Solution has not been approved.");
  const document = await readUtf8(files.requirement);
  const markdown = solutionContract(document);
  assert(
    solutionFingerprint(document) === state.solution.sha256,
    "SOLUTION_DRIFT",
    "The solution section changed after approval. Reopen the solution before changing it.",
  );
  return markdown;
}

export async function assertContractIntegrity(files, state) {
  await assertAcceptanceIntegrity(files, state);
  await assertSolutionIntegrity(files, state);
}

function nextDecisionId(state) {
  const numbers = state.decisions.map((decision) => Number(decision.id?.match(/(\d+)$/)?.[1] ?? 0));
  return `DEC-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

export async function assessTask(root, taskId, assessment, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, Object.values(PHASES).filter((phase) => !isDeliveryTerminalPhase(phase)), "Task assessment");
  const routing = classifyTask(assessment);
  const now = isoNow(clock);
  state.deliveryVersion = 3;
  state.routing = { status: "assessed", assessedAt: now, ...routing };
  state.context = { ...state.context, status: "stale", path: state.context?.path ?? null, digest: null, sourceDigests: {} };
  state.readyAt = null;
  appendHistory(state, "TASK_ASSESSED", now, { lane: routing.lane, reasons: routing.reasons });
  return saveTask(files, state, clock);
}

export async function recordTaskDecision(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.ACCEPTANCE_DRAFT, PHASES.ACCEPTANCE_APPROVED, PHASES.SOLUTION_DRAFT], "Decision recording");
  const now = isoNow(clock);
  const decision = createDecision({
    ...input,
    id: input.id || nextDecisionId(state),
    createdAt: input.createdAt ?? now,
    resolvedAt: input.status === "resolved" || input.resolution ? (input.resolvedAt ?? now) : undefined,
  });
  assert(!state.decisions.some((item) => item.id === decision.id), "DECISION_EXISTS", `Decision already exists: ${decision.id}`);
  if (state.acceptance.approvedAt && decision.blocking && decision.status === "pending") {
    assert(false, "DECISION_REQUIRES_ACCEPTANCE_REOPEN", "A new blocking decision requires reopening acceptance before it can be recorded.");
  }
  state.decisions.push(decision);
  state.context = { ...state.context, status: "stale", digest: null, sourceDigests: {} };
  state.readyAt = null;
  appendHistory(state, "DECISION_RECORDED", now, { decisionId: decision.id, owner: decision.owner, status: decision.status });
  return saveTask(files, state, clock);
}

export async function resolveTaskDecision(root, taskId, decisionId, optionId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  const index = state.decisions.findIndex((decision) => decision.id === decisionId);
  assert(index !== -1, "DECISION_NOT_FOUND", `Decision does not exist: ${decisionId}`);
  const now = isoNow(clock);
  const resolved = resolveDecision(state.decisions[index], optionId, { ...input, resolvedAt: input.resolvedAt ?? now });
  if (resolved.downstreamInvalidation?.required && (state.acceptance.approvedAt || state.solution.approvedAt)) {
    assert(false, "DECISION_CHANGE_REQUIRES_REOPEN", "Changing a resolved decision requires reopening the approved contract first.", {
      errors: resolved.downstreamInvalidation.targets,
    });
  }
  state.decisions[index] = resolved;
  state.context = { ...state.context, status: "stale", digest: null, sourceDigests: {} };
  state.readyAt = null;
  appendHistory(state, "DECISION_RESOLVED", now, { decisionId, optionId });
  return saveTask(files, state, clock);
}

export async function recordSolutionReview(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.SOLUTION_DRAFT, PHASES.CONTRACT_APPROVED], "Solution review");
  assert(["passed", "failed"].includes(input.status), "INVALID_REVIEW_STATUS", "Solution review status must be passed or failed.");
  assert(["main", "independent"].includes(input.reviewer), "INVALID_REVIEWER", "Solution reviewer must be main or independent.");
  assert(input.summary?.trim(), "REVIEW_SUMMARY_REQUIRED", "A concise solution review summary is required.");
  const checks = normalizedReviewChecks(input.checks);
  if (state.deliveryVersion >= 3 && input.status === "passed") {
    const missing = SOLUTION_REVIEW_CHECKS.filter((check) => !checks.includes(check));
    assert(missing.length === 0, "SOLUTION_REVIEW_INCOMPLETE", "A passed solution review must complete every structured review check.", {
      errors: missing.map((check) => `Missing solution review check: ${check}`),
    });
  }
  let independentDispatch = null;
  if (state.deliveryVersion >= 3 && input.reviewer === "independent") {
    assert(input.agentId?.trim(), "INDEPENDENT_REVIEW_AGENT_REQUIRED", "An independent review must reference its completed Agent dispatch.");
    independentDispatch = state.agents.dispatches.find((item) => item.id === input.agentId.trim());
    assert(
      independentDispatch?.role === "independent-review" && independentDispatch.status === "passed",
      "INDEPENDENT_REVIEW_AGENT_REQUIRED",
      "The referenced independent-review Agent dispatch must be completed successfully.",
    );
    assert(independentDispatch.runtimeAttestation?.verified === true, "INDEPENDENT_REVIEW_ATTESTATION_REQUIRED", "The independent reviewer must have a verified runtime attestation.");
    const expected = profileForDispatch({ role: "independent-review", lane: state.routing?.lane, deliveryVersion: state.deliveryVersion });
    assert(independentDispatch.profile === expected.profile && independentDispatch.model === expected.model && independentDispatch.reasoningEffort === expected.reasoningEffort, "INDEPENDENT_REVIEW_PROFILE_REQUIRED", "The independent reviewer must use the authoritative lane-aware Sol profile.");
    assert(independentDispatch.context?.digest, "INDEPENDENT_REVIEW_CONTEXT_REQUIRED", "The independent reviewer must receive recorded scoped context.");
    assert(independentDispatch.reviewControl?.solutionSha256 === solutionFingerprint(await readUtf8(files.requirement)), "INDEPENDENT_REVIEW_CURRENT_SOLUTION_REQUIRED", "The independent reviewer result must be bound to the current solution fingerprint.");
  }
  const now = isoNow(clock);
  state.reviews.solution = {
    status: input.status,
    reviewer: input.reviewer,
    summary: input.summary.trim(),
    findings: asArray(input.findings).map((item) => String(item).trim()).filter(Boolean),
    checks,
    agentId: independentDispatch?.id ?? null,
    contextDigest: independentDispatch?.context?.digest ?? null,
    reviewedAt: now,
    solutionSha256: solutionFingerprint(await readUtf8(files.requirement)),
    fallbackReason: input.reviewer === "main" ? input.fallbackReason?.trim() || null : null,
  };
  if (input.reviewer === "independent") {
    state.reviews.independent.lastVerdict = {
      status: input.status,
      round: independentDispatch.reviewControl.round,
      solutionSha256: independentDispatch.reviewControl.solutionSha256,
      reviewedAt: now,
    };
  }
  state.readyAt = null;
  appendHistory(state, "SOLUTION_REVIEWED", now, { status: input.status, reviewer: input.reviewer });
  return saveTask(files, state, clock);
}

export async function recordIndependentReviewFallbackDecision(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, PHASES.SOLUTION_DRAFT, "Independent review fallback decision");
  assert(input.humanConfirmed === true, "HUMAN_CONFIRMATION_REQUIRED", "Independent review fallback for a dangerous Deep task requires explicit human confirmation.");
  assert(["approved", "denied"].includes(input.status), "INVALID_REVIEW_FALLBACK_STATUS", "Independent review fallback decision must be approved or denied.");
  assert(input.rationale?.trim(), "REVIEW_FALLBACK_RATIONALE_REQUIRED", "Independent review fallback decision requires a rationale.");
  const document = await readUtf8(files.requirement);
  const solutionSha256 = solutionFingerprint(document);
  const eligibility = independentReviewFallbackEligibility(state, solutionSha256);
  assert(eligibility.eligible, "INDEPENDENT_REVIEW_BUDGET_NOT_EXHAUSTED", "A human fallback decision is available only after independent review exhausts its runtime attempts or its one targeted recheck round.");
  const now = isoNow(clock);
  state.reviews.independent.fallbackDecision = {
    status: input.status,
    rationale: input.rationale.trim(),
    humanConfirmed: true,
    solutionSha256,
    decidedAt: now,
  };
  appendHistory(state, "INDEPENDENT_REVIEW_FALLBACK_DECIDED", now, { status: input.status, solutionSha256 });
  return saveTask(files, state, clock);
}

function executionTask(state, subtaskId) {
  return state.execution?.plan?.tasks?.find((item) => item.id === subtaskId) ?? null;
}

function inventoryChanges(beforeFiles, afterFiles) {
  const before = new Map((beforeFiles ?? []).map((item) => [item.path, item]));
  const after = new Map((afterFiles ?? []).map((item) => [item.path, item]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => JSON.stringify(before.get(file)) !== JSON.stringify(after.get(file)))
    .sort();
}

function pathWithinScope(file, scope) {
  return scope.some((allowed) => file === allowed || file.startsWith(`${allowed}/`) || allowed.startsWith(`${file}/`));
}

export async function planExecution(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.CONTRACT_APPROVED, PHASES.IMPLEMENTING], "Execution planning");
  await assertContractIntegrity(files, state);
  assert(state.routing?.lane !== "quick", "QUICK_EXECUTION_DELEGATION_DISABLED", "Quick tasks remain direct by default and cannot create a routine delegated execution plan.");
  const plan = validateExecutionPlan(state.acceptance.items.map((item) => item.id), input);
  if (state.execution?.directive?.mode === "parallel") {
    const contracts = await orchestrationContracts();
    if (contracts.validateOrchestrationPreparation) {
      const batches = contracts.planOrchestrationBatches
        ? contractValidationResult(contracts.planOrchestrationBatches(plan), "ORCHESTRATION_PLAN_INVALID", "Execution plan cannot be safely split into orchestration batches.")
        : executionBatchesFallback(plan);
      contractValidationResult(
        contracts.validateOrchestrationPreparation(plan, batches),
        "ORCHESTRATION_PREPARATION_INVALID",
        "Parallel orchestration preparation is invalid.",
      );
    }
  }
  const now = isoNow(clock);
  const directive = state.execution?.directive ?? null;
  state.execution = {
    planStatus: "planned",
    plannedAt: now,
    plan,
    results: {},
    fallbackReason: null,
    nextActions: ["dispatch-worker"],
    directive,
    orchestration: orchestrationDefaults(),
  };
  appendHistory(state, "EXECUTION_PLANNED", now, { taskCount: plan.tasks.length, stages: [...new Set(plan.tasks.map((item) => item.stage))].length });
  return saveTask(files, state, clock);
}

export async function recordExecutionResult(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.IMPLEMENTING, PHASES.REPAIRING, PHASES.BLOCKED], "Execution result recording");
  await assertContractIntegrity(files, state);
  assert(state.execution?.planStatus === "planned", "EXECUTION_PLAN_REQUIRED", "Record a validated execution plan before worker results.");
  const task = executionTask(state, input.taskId);
  assert(task, "UNKNOWN_EXECUTION_TASK", `Unknown execution task: ${input.taskId ?? "missing"}.`);
  const dispatch = state.agents.dispatches.find((item) => item.subtaskId === task.id && item.role === task.route);
  if (input.status === "passed") {
    assert(dispatch?.runtimeAttestation?.verified === true, "EXECUTION_AGENT_ATTESTATION_REQUIRED", `Execution task ${task.id} needs a runtime-attested Agent dispatch.`);
    assert(dispatch.candidateBaseline?.files, "EXECUTION_AGENT_BASELINE_REQUIRED", `Execution task ${task.id} needs a source baseline captured when its Agent started.`);
    assert(dispatch.status === "passed", "EXECUTION_AGENT_NOT_PASSED", `Execution task ${task.id} cannot pass before its Agent dispatch passes.`);
  } else {
    assert(dispatch && ["failed", "blocked"].includes(dispatch.status), "EXECUTION_AGENT_NOT_BLOCKED", `Execution task ${task.id} can only block after its Agent dispatch fails or blocks.`);
    assert(dispatch.runtimeAttestation?.verified === true || dispatch.runtimeFailure?.verified === false, "EXECUTION_AGENT_FAILURE_REQUIRED", `Execution task ${task.id} needs an attested runtime or a concrete runtime failure.`);
  }
  const source = await fingerprintProject(root, { include: ["**/*"] });
  const result = validateExecutionResult(task, input, source.fingerprint);
  const allChangedPaths = dispatch.candidateBaseline?.files
    ? inventoryChanges(dispatch.candidateBaseline.files, source.files)
    : [];
  const outOfScope = allChangedPaths.filter((file) => !pathWithinScope(file, task.writeScope));
  assert(outOfScope.length === 0, "EXECUTION_ACTUAL_SCOPE_VIOLATION", `Execution task ${task.id} changed files outside its planned write scope.`, { errors: outOfScope });
  const actualChangedPaths = allChangedPaths;
  assert(JSON.stringify(actualChangedPaths) === JSON.stringify([...result.changedPaths].sort()), "EXECUTION_CHANGED_PATHS_MISMATCH", `Execution task ${task.id} changedPaths do not match the actual candidate diff.`, {
    errors: [`reported=${result.changedPaths.join(",") || "none"}`, `actual=${actualChangedPaths.join(",") || "none"}`],
  });
  const evidence = result.status === "passed"
    ? await captureEvidence(files.root, input.evidence, evidenceBoundary(state), clock)
    : await optionalEvidence(files.root, input.evidence, evidenceBoundary(state), clock);
  const now = isoNow(clock);
  state.execution.results[task.id] = { ...result, evidence, recordedAt: now };
  if (result.status === "blocked") setPhase(state, PHASES.BLOCKED, now);
  appendHistory(state, "EXECUTION_RESULT_RECORDED", now, { taskId: task.id, status: result.status, candidateFingerprint: result.candidateFingerprint });
  const saved = await saveTask(files, state, clock);
  return { ...saved, result: state.execution.results[task.id] };
}

function ensureOrchestration(state) {
  state.execution ??= { planStatus: "not_planned", plannedAt: null, plan: null, results: {} };
  state.execution.orchestration ??= orchestrationDefaults();
  state.execution.orchestration = {
    ...orchestrationDefaults(),
    ...state.execution.orchestration,
    aggregate: { ...orchestrationDefaults().aggregate, ...(state.execution.orchestration.aggregate ?? {}) },
    integration: { ...orchestrationDefaults().integration, ...(state.execution.orchestration.integration ?? {}) },
    sessions: state.execution.orchestration.sessions ?? {},
    eventIds: state.execution.orchestration.eventIds ?? [],
    events: state.execution.orchestration.events ?? [],
    cleanup: { ...orchestrationDefaults().cleanup, ...(state.execution.orchestration.cleanup ?? {}) },
  };
  return state.execution.orchestration;
}

function refreshOrchestrationAggregate(orchestration) {
  const sessions = Object.values(orchestration.sessions ?? {});
  const aggregate = { ...orchestrationDefaults().aggregate, ...(orchestration.aggregate ?? {}), total: sessions.length };
  for (const status of ["planned", "creating", "created", "running", "waiting", "passed", "failed", "blocked", "needs_input", "integrating", "integrated", "conflict"]) {
    aggregate[status] = 0;
  }
  for (const session of sessions) {
    const status = sessionStatus(session);
    aggregate[status] = (aggregate[status] ?? 0) + 1;
  }
  const nextActions = [];
  if (sessions.some((session) => sessionStatus(session) === "planned")) nextActions.push("create");
  if (sessions.some((session) => ["created", "running", "waiting"].includes(sessionStatus(session)))) nextActions.push("wait");
  if (sessions.some((session) => sessionStatus(session) === "passed")) nextActions.push("integrate");
  if (sessions.some((session) => ["failed", "blocked", "needs_input", "conflict"].includes(sessionStatus(session)))) nextActions.push("controller-attention");
  aggregate.nextActions = [...new Set([...(orchestration.nextActions ?? []), ...nextActions])];
  orchestration.aggregate = aggregate;
  if (sessions.length === 0 && orchestration.status === "non_parallel") return orchestration;
  if (sessions.some((session) => ["failed", "blocked", "needs_input", "conflict"].includes(sessionStatus(session)))) orchestration.status = "attention_required";
  else if (sessions.length > 0 && sessions.every((session) => sessionStatus(session) === "integrated")) orchestration.status = "integrated";
  else if (sessions.some((session) => ["passed", "integrating"].includes(sessionStatus(session)))) orchestration.status = "ready_to_integrate";
  else if (sessions.some((session) => ["created", "running", "waiting"].includes(sessionStatus(session)))) orchestration.status = "running";
  else if (sessions.length > 0) orchestration.status = "planned";
  return orchestration;
}

function normalizeCapabilities(input = {}) {
  const capabilities = input.capabilities ?? input;
  const normalized = {
    create: Boolean(capabilities.create ?? capabilities.createThread ?? capabilities.create_thread),
    send: Boolean(capabilities.send ?? capabilities.sendMessage ?? capabilities.send_message),
    wait: Boolean(capabilities.wait ?? capabilities.waitThreads ?? capabilities.wait_threads),
    read: Boolean(capabilities.read ?? capabilities.readThread ?? capabilities.read_thread),
    worktree: Boolean(capabilities.worktree ?? capabilities.worktrees ?? capabilities.isolatedWorktree),
    source: capabilities.source ?? "host",
  };
  return { ...capabilities, ...normalized };
}

function validateCapabilitiesFallback(input) {
  const capabilities = normalizeCapabilities(input);
  const missing = ["create", "send", "wait", "read", "worktree"].filter((key) => capabilities[key] !== true);
  assert(missing.length === 0, "ORCHESTRATION_CAPABILITY_UNAVAILABLE", "Host does not provide the capabilities required for isolated orchestration.", { errors: missing.map((key) => `Missing capability: ${key}`) });
  return capabilities;
}

function executionBatchesFallback(plan) {
  const tasks = plan?.tasks ?? [];
  const byStage = new Map();
  for (const task of tasks) {
    if (!byStage.has(task.stage)) byStage.set(task.stage, []);
    byStage.get(task.stage).push(task);
  }
  return [...byStage.entries()].sort(([left], [right]) => left - right).map(([stage, stageTasks]) => ({
    stage,
    tasks: stageTasks,
    parallel: stageTasks.length > 1,
    reason: stageTasks.length > 1 ? null : "Only one safe task is available in this stage.",
  }));
}

function orchestrationActions(batches, controller = null, sharedContract = null, lane = "standard") {
  const sessions = batches.flatMap((batch) => batch.tasks ?? []).map((task) => {
    const profile = profileForDispatch({ role: task.route, deliveryVersion: 3, lane });
    const contractFiles = sharedContract?.files?.map((item) => typeof item === "string" ? item : item.path).filter(Boolean) ?? [];
    return ({
    sessionId: `session-${task.id}`,
    subtaskId: task.id,
    stage: task.stage,
    task,
    profile,
    prompt: {
      kind: "openatdd-orchestration-session",
      controller,
      subtaskId: task.id,
      writeScope: task.writeScope,
      doNotTouch: [...new Set([...(task.doNotTouch ?? []), ...contractFiles])],
      expectedResult: task.expectedResult,
      verification: task.verification,
      firstArtifact: task.firstArtifact,
      leaf: true,
      canSpawnAgents: false,
      runtime: profile,
      sharedContract,
    },
    worktree: { required: true, unique: true, sharedCheckout: false },
  });
  });
  const actions = [];
  for (const item of sessions) actions.push({ type: "create", action: "create", ...item });
  for (const item of sessions) actions.push({ type: "send", action: "send", sessionId: item.sessionId, subtaskId: item.subtaskId, prompt: item.prompt });
  for (const batch of batches.filter((item) => (item.tasks ?? []).length > 0)) {
    actions.push({ type: "wait", action: "wait", stage: batch.stage, sessionIds: (batch.tasks ?? []).map((task) => `session-${task.id}`) });
    actions.push({ type: "read", action: "read", stage: batch.stage, sessionIds: (batch.tasks ?? []).map((task) => `session-${task.id}`) });
  }
  return { sessions, actions };
}

function validateRecordedSessionIdentities(orchestration, controllerRoot, lane = "standard") {
  const sessions = Object.values(orchestration.sessions ?? {});
  const threads = new Set();
  const worktrees = new Set();
  const branches = new Set();
  for (const session of sessions) {
    if (!["created", "running", "waiting", "passed", "failed", "blocked", "needs_input", "integrating", "integrated", "conflict"].includes(sessionStatus(session))) continue;
    assert(session.threadId?.trim(), "ORCHESTRATION_THREAD_ID_REQUIRED", `Session ${session.sessionId} needs a host threadId.`);
    assert(session.worktree?.trim(), "ORCHESTRATION_WORKTREE_REQUIRED", `Session ${session.sessionId} needs an isolated worktree.`);
    assert(session.branch?.trim(), "ORCHESTRATION_BRANCH_REQUIRED", `Session ${session.sessionId} needs a branch identity.`);
    const resolvedWorktree = path.resolve(session.worktree);
    assert(resolvedWorktree !== path.resolve(controllerRoot), "ORCHESTRATION_SHARED_WORKTREE", "A session worktree cannot be the controller checkout.");
    assert(!threads.has(session.threadId), "ORCHESTRATION_DUPLICATE_THREAD", `Duplicate thread id: ${session.threadId}.`);
    assert(!worktrees.has(resolvedWorktree), "ORCHESTRATION_DUPLICATE_WORKTREE", `Duplicate worktree path: ${resolvedWorktree}.`);
    assert(!branches.has(session.branch), "ORCHESTRATION_DUPLICATE_BRANCH", `Duplicate branch: ${session.branch}.`);
    threads.add(session.threadId);
    worktrees.add(resolvedWorktree);
    branches.add(session.branch);
    session.worktree = resolvedWorktree;
    session.parentControllerId ??= orchestration.controller?.id ?? null;
    assert(session.parentControllerId === orchestration.controller?.id, "ORCHESTRATION_PARENT_MISMATCH", `Session ${session.sessionId} is not owned by the controller.`);
    assert(session.leaf !== false && session.canSpawnAgents !== true, "ORCHESTRATION_LEAF_REQUIRED", "Development sessions must be leaf runtimes.");
    const task = orchestrationTask(orchestration, session.subtaskId);
    assert(task, "UNKNOWN_EXECUTION_TASK", `Unknown execution task: ${session.subtaskId}.`);
    const expected = profileForDispatch({ role: task.route, deliveryVersion: 3, lane });
    session.runtimeAttestation = validateRuntimeAttestation(expected, session.runtimeAttestation);
  }
}

function normalizeOrchestrationBatches(value, plan) {
  const source = Array.isArray(value) ? value : (value?.batches ?? []);
  const byId = new Map((plan?.tasks ?? []).map((task) => [task.id, task]));
  return source.map((batch, index) => {
    const rawTasks = batch.tasks ?? batch.taskIds ?? [];
    const tasks = rawTasks.map((task) => typeof task === "string" ? byId.get(task) : task).filter(Boolean);
    return {
      ...batch,
      id: batch.id ?? `batch-${index + 1}`,
      stage: batch.stage ?? tasks[0]?.stage ?? index + 1,
      tasks,
      parallel: batch.parallel !== false && tasks.length > 1,
      reason: batch.reason ?? (tasks.length > 1 ? null : "Only one safe task is available in this stage."),
    };
  });
}

function actualPathWithinScope(file, scope) {
  return scope.some((allowed) => file === allowed || file.startsWith(`${allowed}/`));
}

async function runFrozenSharedContract(root, preparation) {
  if (!preparation?.required) return null;
  const contract = preparation.sharedContract;
  const fileDigests = [];
  for (const relative of contract.files) {
    const target = path.resolve(root, relative);
    assert(await pathExists(target), "ORCHESTRATION_SHARED_CONTRACT_FILE_MISSING", `Shared contract file does not exist: ${relative}.`);
    fileDigests.push({ path: relative, sha256: sha256(await readFile(target)) });
  }
  const results = [];
  for (const command of contract.commands) {
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(command.argv[0], command.argv.slice(1), {
        cwd: root,
        encoding: "utf8",
        timeout: command.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      });
      results.push({
        id: command.id,
        argv: command.argv,
        status: "passed",
        durationMs: Math.max(0, Date.now() - startedAt),
        summary: String(stdout || stderr || "passed").trim().slice(-2000),
      });
    } catch (error) {
      assert(false, "ORCHESTRATION_SHARED_CONTRACT_FAILED", `Shared contract command failed before dispatch: ${command.id}.`, {
        errors: [String(error?.stdout ?? error?.stderr ?? error?.message ?? error).trim().slice(-4000)],
      });
    }
  }
  return {
    schemaVersion: 1,
    status: "passed",
    taskIds: contract.taskIds,
    files: fileDigests,
    commands: results,
    digest: sha256(canonicalJson({ contract, fileDigests })),
    verifiedAt: new Date().toISOString(),
  };
}

async function assertFrozenSharedContract(root, orchestration) {
  const frozen = orchestration.contract;
  const required = (orchestration.batches ?? []).some(
    (batch) => batch.parallel !== false && (batch.tasks ?? []).length > 1,
  );
  if (!required && !frozen) return null;
  assert(frozen?.status === "passed" && Array.isArray(frozen.files) && frozen.files.length > 0, "ORCHESTRATION_SHARED_CONTRACT_NOT_FROZEN", "Orchestration needs a passed frozen shared contract.");
  const drift = [];
  for (const item of frozen.files) {
    const target = path.resolve(root, item.path);
    if (!(await pathExists(target))) {
      drift.push(`${item.path}:missing`);
      continue;
    }
    const current = sha256(await readFile(target));
    if (current !== item.sha256) drift.push(`${item.path}:${item.sha256}->${current}`);
  }
  assert(drift.length === 0, "ORCHESTRATION_SHARED_CONTRACT_DRIFT", "Frozen shared contract changed after worker dispatch.", { errors: drift });
  return frozen;
}

export async function orchestrationStart(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  await assertSolutionIntegrity(files, state);
  const directive = state.execution?.directive ?? null;
  if (directive) {
    assert(directive.mode === "parallel", "INVALID_PARALLEL_DIRECTIVE", "Unknown execution directive mode.");
    assert(directive.solutionSha256 === state.solution.sha256, "PARALLEL_DIRECTIVE_STALE", "The parallel approval directive is stale for the current solution.");
    assert(directive.consumed !== true, "PARALLEL_DIRECTIVE_CONSUMED", "The parallel execution directive has already been consumed.");
  }
  assert(state.execution?.planStatus === "planned" && state.execution.plan, "EXECUTION_PLAN_REQUIRED", "Create a validated execution plan before starting orchestration.");

  const contracts = await orchestrationContracts();
  let capabilityCheck;
  try {
    capabilityCheck = contracts.validateOrchestrationCapabilities
      ? contractValidationResult(contracts.validateOrchestrationCapabilities(input.capabilities ?? input), "ORCHESTRATION_CAPABILITY_UNAVAILABLE", "Host orchestration capabilities are invalid.")
      : validateCapabilitiesFallback(input.capabilities ?? input);
  } catch (error) {
    if (error?.code === "ORCHESTRATION_CAPABILITY_UNAVAILABLE") throw error;
    assert(false, "ORCHESTRATION_CAPABILITY_UNAVAILABLE", "Host does not provide the capabilities required for isolated orchestration.", {
      errors: [`${error?.code ?? "ORCHESTRATION_CAPABILITY_INVALID"}: ${error?.message ?? "invalid capabilities"}`],
    });
  }
  const capabilities = capabilityCheck ?? normalizeCapabilities(input.capabilities ?? input);
  const plan = state.execution.plan;
  const plannedBatches = contracts.planOrchestrationBatches
    ? contractValidationResult(contracts.planOrchestrationBatches(plan, input.options ?? input), "ORCHESTRATION_PLAN_INVALID", "Execution plan cannot be safely split into orchestration batches.")
    : executionBatchesFallback(plan);
  const batches = normalizeOrchestrationBatches(plannedBatches, plan);
  const safeBatches = batches.filter((batch) => (batch.tasks ?? batch.taskIds ?? []).length > 0);
  const parallelTasks = safeBatches.filter((batch) => batch.parallel !== false && (batch.tasks ?? []).length > 1).flatMap((batch) => batch.tasks ?? []);
  const orchestration = ensureOrchestration(state);
  const now = isoNow(clock);
  if (safeBatches.length === 0) {
    orchestration.status = "non_parallel";
    orchestration.plan = { schemaVersion: 1, batches: safeBatches };
    orchestration.capabilities = capabilities;
    orchestration.aggregate.explanation = "No safe isolated Worker task is available; continue sequentially in the controller.";
    orchestration.aggregate.nextActions = ["controller-sequential"];
    orchestration.nextActions = ["controller-sequential"];
    orchestration.updatedAt = now;
    state.execution.planStatus = "controller-sequential";
    state.execution.fallbackReason = { code: "no-safe-worker-task", message: orchestration.aggregate.explanation, details: [] };
    state.execution.nextActions = ["controller-sequential"];
    if (directive) state.execution.directive = { ...directive, consumed: true, consumedAt: now };
    appendHistory(state, "ORCHESTRATION_NOT_PARALLEL", now, { explanation: orchestration.aggregate.explanation });
    const saved = await saveTask(files, state, clock);
    return { ...saved, orchestration, batches: safeBatches, actions: [], capabilities, parallel: false, explanation: orchestration.aggregate.explanation };
  }

  const preparation = contracts.validateOrchestrationPreparation
    ? contractValidationResult(
      contracts.validateOrchestrationPreparation(plan, plannedBatches),
      "ORCHESTRATION_PREPARATION_INVALID",
      "Parallel orchestration preparation is invalid.",
    )
    : { required: parallelTasks.length >= 2, sharedContract: null, integrationBudgetMs: orchestrationDefaults().integration.budgetMs };
  if (parallelTasks.length >= 2) {
    assert(preparation?.required === true, "ORCHESTRATION_SHARED_CONTRACT_REQUIRED", "Parallel orchestration requires a frozen executable shared contract before dispatch.");
  }
  const frozenContract = preparation?.required ? await runFrozenSharedContract(root, preparation) : null;

  const controllerInput = input.controller ?? {};
  assert(controllerInput.id?.trim() || input.controllerId?.trim(), "ORCHESTRATION_CONTROLLER_ID_REQUIRED", "The host must provide the controller id.");
  assert(controllerInput.threadId?.trim() || input.controllerThreadId?.trim(), "ORCHESTRATION_CONTROLLER_THREAD_REQUIRED", "The host must provide the controller threadId.");
  const controllerGit = await gitWorktreeIdentity(root);
  const controller = {
    id: controllerInput.id ?? input.controllerId,
    threadId: controllerInput.threadId ?? input.controllerThreadId,
    hostId: input.controller?.hostId ?? input.hostId ?? capabilities.hostId ?? capabilities.source ?? null,
    worktreePath: controllerInput.worktreePath ?? input.controllerWorktreePath ?? controllerGit.topLevel,
    branch: controllerInput.branch ?? input.controllerBranch ?? controllerGit.branchIdentity,
  };
  orchestration.controller = controller;
  orchestration.status = orchestration.status === "idle" ? "planned" : orchestration.status;
  orchestration.plan ??= { schemaVersion: 1, batches: safeBatches };
  orchestration.capabilities ??= capabilities;
  orchestration.contract = frozenContract;
  orchestration.integration = {
    ...orchestrationDefaults().integration,
    ...(orchestration.integration ?? {}),
    budgetMs: preparation?.integrationBudgetMs ?? orchestrationDefaults().integration.budgetMs,
    budgetStartedAt: null,
    deadlineAt: null,
    elapsedMs: 0,
    budgetStatus: "not_started",
  };
  const runnable = new Set(plan.tasks
    .filter((task) => task.dependsOn.every((dependencyId) => state.execution.results?.[dependencyId]?.status === "passed"))
    .map((task) => task.id));
  const allSessionPlan = orchestrationActions(
    safeBatches,
    controller,
    frozenContract,
    state.routing?.lane,
  );
  const actionPlan = orchestrationActions(
    safeBatches
      .map((batch) => ({ ...batch, tasks: (batch.tasks ?? []).filter((task) => runnable.has(task.id)) }))
      .filter((batch) => batch.tasks.length > 0),
    controller,
    frozenContract,
    state.routing?.lane,
  );
  for (const item of allSessionPlan.sessions) {
    orchestration.sessions[item.sessionId] ??= {
      ...sessionState("planned"),
      sessionId: item.sessionId,
      subtaskId: item.subtaskId,
      parentControllerId: controller.id,
      writeScope: item.task.writeScope,
      doNotTouch: item.prompt.doNotTouch,
      verification: item.task.verification,
      leaf: true,
      canSpawnAgents: false,
      plannedAt: now,
    };
  }
  orchestration.batches = safeBatches;
  orchestration.serialTasks = plannedBatches.serial ?? plannedBatches.serialTasks ?? [];
  orchestration.reasons = plannedBatches.reasons ?? [];
  orchestration.nextActions = actionPlan.actions;
  refreshOrchestrationAggregate(orchestration);
  orchestration.updatedAt = now;
  state.execution.nextActions = [];
  if (directive) state.execution.directive = { ...directive, consumed: true, consumedAt: now };
  appendHistory(state, "ORCHESTRATION_STARTED", now, { sessions: actionPlan.sessions.map((item) => item.sessionId), batches: safeBatches.length, parallel: parallelTasks.length >= 2, contractDigest: frozenContract?.digest ?? null, integrationBudgetMs: preparation?.integrationBudgetMs ?? orchestrationDefaults().integration.budgetMs });
  const saved = await saveTask(files, state, clock);
  return { ...saved, orchestration, batches: safeBatches, actions: actionPlan.actions, capabilities, parallel: parallelTasks.length >= 2 };
}

async function applyOrchestrationEventFallback(orchestration, event) {
  const eventId = orchestrationEventId(event);
  assert(eventId, "ORCHESTRATION_EVENT_ID_REQUIRED", "Orchestration events require eventId.");
  const expectedRevision = orchestrationRevision(event.expectedRevision);
  assert(expectedRevision !== null, "ORCHESTRATION_REVISION_REQUIRED", "Orchestration events require expectedRevision.");
  if ((orchestration.eventIds ?? []).includes(eventId)) return { orchestration, idempotent: true };
  assert(expectedRevision === (orchestration.revision ?? 0), "STALE_ORCHESTRATION_REVISION", "Orchestration event revision is stale.", { expectedRevision, actualRevision: orchestration.revision ?? 0 });
  const sessionId = orchestrationSessionId(event);
  const status = event.status ?? event.session?.status;
  if (sessionId) {
    const previous = orchestration.sessions[sessionId] ?? sessionState("planned");
    orchestration.sessions[sessionId] = {
      ...previous,
      ...(event.session ?? {}),
      ...(event.data ?? {}),
      sessionId,
      ...(status ? { status } : {}),
      updatedAt: event.at ?? new Date().toISOString(),
    };
  }
  orchestration.eventIds = [...(orchestration.eventIds ?? []), eventId];
  orchestration.events = [...(orchestration.events ?? []), { ...event, eventId }];
  orchestration.revision = (orchestration.revision ?? 0) + 1;
  refreshOrchestrationAggregate(orchestration);
  return { orchestration, idempotent: false };
}

export async function recordOrchestrationSession(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  const orchestration = ensureOrchestration(state);
  assert(["planned", "running", "ready_to_integrate", "attention_required"].includes(orchestration.status), "ORCHESTRATION_NOT_ACTIVE", "Orchestration is not active for this task.");
  const event = input?.event ?? input;
  const contracts = await orchestrationContracts();
  const eventId = orchestrationEventId(event);
  if (eventId && (orchestration.eventIds ?? []).includes(eventId)) {
    return { state, files, orchestration, event, idempotent: true };
  }
  const targetStatus = event.status ?? event.state ?? event.session?.status ?? event.session?.state;
  const normalizedEvent = event.type
    ? event
    : {
      ...event,
      type: "SESSION_STATE",
      state: targetStatus,
      sessionId: orchestrationSessionId(event),
    };
  let applied;
  if (contracts.applyOrchestrationEvent) {
    let result;
    try {
      result = contracts.applyOrchestrationEvent(orchestration, normalizedEvent);
    } catch (error) {
      if (error?.code === "ORCHESTRATION_STALE_REVISION") {
        assert(false, "STALE_ORCHESTRATION_REVISION", error.message, error.details);
      }
      throw error;
    }
    applied = result?.orchestration ? result : { orchestration: result, idempotent: false };
    assert(applied.orchestration, "INVALID_ORCHESTRATION_EVENT", "Orchestration event did not return state.");
    state.execution.orchestration = applied.orchestration;
  } else {
    applied = await applyOrchestrationEventFallback(orchestration, event);
  }
  const sessionId = orchestrationSessionId(event);
  const existingSession = sessionId ? orchestration.sessions?.[sessionId] : null;
  const requestedWorktree = event.worktree ?? event.session?.worktree;
  const requestedThreadId = event.threadId ?? event.session?.threadId;
  const requestedBranch = event.branch ?? event.session?.branch;
  if (existingSession) {
    if (existingSession.worktree && requestedWorktree) {
      assert(path.resolve(String(requestedWorktree)) === path.resolve(existingSession.worktree), "ORCHESTRATION_WORKTREE_IDENTITY_IMMUTABLE", "A session worktree identity cannot change after binding.");
    }
    if (existingSession.threadId && requestedThreadId) {
      assert(String(requestedThreadId) === existingSession.threadId, "ORCHESTRATION_THREAD_IDENTITY_IMMUTABLE", "A session thread identity cannot change after binding.");
    }
  }
  if (sessionId) {
    const session = ensureOrchestration(state).sessions[sessionId] ?? sessionState(event.status ?? "planned");
    const worktree = requestedWorktree ?? session.worktree;
    if (worktree) {
      const resolvedWorktree = await pathExists(String(worktree))
        ? await realpath(String(worktree))
        : path.resolve(String(worktree));
      if (session.worktree) {
        assert(resolvedWorktree === path.resolve(session.worktree), "ORCHESTRATION_WORKTREE_IDENTITY_IMMUTABLE", "A session worktree identity cannot change after binding.");
      }
      session.worktree = resolvedWorktree;
      assert(session.worktree !== path.resolve(root), "ORCHESTRATION_SHARED_WORKTREE", "A session worktree cannot be the controller checkout.");
      if (["created", "running", "waiting", "passed"].includes(targetStatus)) {
        assert(await pathExists(session.worktree), "ORCHESTRATION_WORKTREE_NOT_FOUND", `Session worktree does not exist: ${session.worktree}`);
      }
      if (await pathExists(session.worktree)) {
        const controllerGit = await gitWorktreeIdentity(root);
        const sessionGit = await gitWorktreeIdentity(session.worktree);
        if (controllerGit.git) {
          assert(sessionGit.git, "ORCHESTRATION_WORKTREE_NOT_GIT", "A Git controller requires every development session to use a Git worktree.");
          assert(sessionGit.commonDir === controllerGit.commonDir, "ORCHESTRATION_GIT_COMMON_DIR_MISMATCH", "Session worktree must belong to the controller repository.");
          assert(sessionGit.topLevel === session.worktree, "ORCHESTRATION_WORKTREE_IDENTITY_MISMATCH", "Recorded session worktree does not match its Git top-level identity.");
          if (requestedBranch) {
            assert([sessionGit.branch, sessionGit.branchIdentity].includes(String(requestedBranch)), "ORCHESTRATION_BRANCH_IDENTITY_MISMATCH", "Recorded session branch does not match the Git worktree identity.");
          }
          if (session.branch) {
            assert(session.branch === sessionGit.branchIdentity, "ORCHESTRATION_BRANCH_IDENTITY_IMMUTABLE", "A session branch identity cannot change after binding.");
          }
          session.branch = sessionGit.branchIdentity;
          session.gitIdentity = sessionGit;
          session.baseRevision = sessionGit.head;
        }
        if (!session.base?.files) {
          session.base = await fingerprintProject(session.worktree, { include: ["**/*"] });
          session.baseRevision ??= session.base.fingerprint;
          session.protectedContractFingerprint = await protectedContractFingerprint(session.worktree);
          session.authorityFingerprint = authorityFingerprint(state);
        }
      }
    }
    if (!session.mainBaseline?.files) {
      const include = session.writeScope.length
        ? session.writeScope.flatMap((item) => [item, `${item}/**`])
        : ["**/*"];
      session.mainBaseline = await fingerprintProject(root, { include });
    }
    if (event.writeScope) session.writeScope = [...event.writeScope];
    if (event.doNotTouch) session.doNotTouch = [...event.doNotTouch];
    if (requestedThreadId) session.threadId = String(requestedThreadId);
    if (event.hostId ?? event.session?.hostId) session.hostId = String(event.hostId ?? event.session.hostId);
    if (requestedBranch && !session.gitIdentity) {
      if (session.branch) assert(String(requestedBranch) === session.branch, "ORCHESTRATION_BRANCH_IDENTITY_IMMUTABLE", "A session branch identity cannot change after binding.");
      session.branch = String(requestedBranch);
    }
    session.runtimeAttestation = event.runtimeAttestation ?? event.runtime ?? event.session?.runtimeAttestation ?? event.session?.runtime ?? session.runtimeAttestation;
    session.parentControllerId ??= ensureOrchestration(state).controller?.id ?? null;
    session.leaf = event.leaf ?? event.session?.leaf ?? session.leaf ?? true;
    session.canSpawnAgents = event.canSpawnAgents ?? event.session?.canSpawnAgents ?? session.canSpawnAgents ?? false;
    session.status = targetStatus ?? sessionStatus(session);
    session.state = session.status;
    ensureOrchestration(state).sessions[sessionId] = session;
  }
  validateRecordedSessionIdentities(ensureOrchestration(state), root, state.routing?.lane);
  refreshOrchestrationAggregate(ensureOrchestration(state));
  const now = isoNow(clock);
  appendHistory(state, "ORCHESTRATION_SESSION_RECORDED", now, { eventId: orchestrationEventId(event), sessionId, status: event.status ?? null, idempotent: applied.idempotent === true });
  const saved = await saveTask(files, state, clock);
  return { ...saved, orchestration: ensureOrchestration(state), event, idempotent: applied.idempotent === true };
}

function inventoryByPath(files) {
  return new Map((files ?? []).map((item) => [item.path, item]));
}

async function persistOrchestrationEvidenceReceipt(root, files, session, result, clock) {
  const receiptPath = path.join(
    files.evidence,
    "orchestration",
    `${session.subtaskId}-${result.candidateFingerprint}.json`,
  );
  const receipt = {
    schemaVersion: 1,
    taskId: result.taskId,
    sessionId: result.sessionId,
    subtaskId: session.subtaskId,
    recordedAt: result.recordedAt,
    baseRevision: session.baseRevision ?? session.base?.fingerprint ?? null,
    candidateFingerprint: result.candidateFingerprint,
    changedPaths: result.changedPaths,
    verification: result.verification,
    reportedEvidence: result.reportedEvidence,
  };
  await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return captureEvidence(root, [artifactLocator(root, receiptPath)], result.recordedAt, clock);
}

async function sessionWorktreeDiff(session) {
  assert(session.worktree, "SESSION_WORKTREE_REQUIRED", "Session result requires a recorded worktree.");
  assert(await pathExists(session.worktree), "SESSION_WORKTREE_NOT_FOUND", `Session worktree does not exist: ${session.worktree}`);
  const current = await fingerprintProject(session.worktree, { include: ["**/*"] });
  const baseline = session.base ?? session.localBaseline;
  assert(baseline?.files, "SESSION_BASELINE_REQUIRED", "Session result requires a recorded local baseline.");
  const before = inventoryByPath(baseline.files);
  const after = inventoryByPath(current.files);
  const changedPaths = [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => JSON.stringify(before.get(file)) !== JSON.stringify(after.get(file)))
    .sort();
  return { current, baseline, changedPaths };
}

export async function recordOrchestrationSessionResult(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  const orchestration = ensureOrchestration(state);
  const sessionId = orchestrationSessionId(input);
  assert(sessionId, "SESSION_ID_REQUIRED", "Session result requires sessionId.");
  const session = orchestration.sessions[sessionId];
  assert(session, "SESSION_NOT_FOUND", `Unknown orchestration session: ${sessionId}.`);
  const task = orchestrationTask(orchestration, session.subtaskId);
  assert(task, "UNKNOWN_EXECUTION_TASK", `Unknown execution task: ${session.subtaskId}.`);
  session.verification ??= [...(task.verification ?? [])];
  await assertFrozenSharedContract(root, orchestration);
  const deterministicEventId = input.eventId ?? (input.candidateFingerprint ? `result-${sessionId}-${input.candidateFingerprint}` : null);
  if (deterministicEventId && (orchestration.eventIds ?? []).includes(deterministicEventId)) {
    return {
      state,
      files,
      result: session.result,
      orchestration,
      idempotent: true,
    };
  }
  assert(session.authorityFingerprint === authorityFingerprint(state), "SESSION_SHARED_STATE_MUTATION", "Acceptance, solution, authorization, routing, or execution contracts changed after session creation.");
  assert(session.protectedContractFingerprint === await protectedContractFingerprint(session.worktree), "SESSION_CONTRACT_MUTATION", "Session modified protected OpenATDD requirement contracts.");
  if (input.eventId && (orchestration.eventIds ?? []).includes(input.eventId)) {
    return {
      state,
      files,
      result: session.result,
      orchestration,
      idempotent: true,
    };
  }
  const diff = await sessionWorktreeDiff(session);
  const outOfScope = diff.changedPaths.filter((file) => !actualPathWithinScope(file, session.writeScope ?? []));
  const forbidden = diff.changedPaths.filter((file) => actualPathWithinScope(file, session.doNotTouch ?? []));
  assert(outOfScope.length === 0, "SESSION_ACTUAL_SCOPE_VIOLATION", "Session changed files outside its authorized writeScope.", { errors: outOfScope });
  assert(forbidden.length === 0, "SESSION_DO_NOT_TOUCH_VIOLATION", "Session changed files in doNotTouch.", { errors: forbidden });
  const candidateFingerprint = diff.current.fingerprint;
  const eventId = input.eventId ?? `result-${sessionId}-${candidateFingerprint}`;
  if ((orchestration.eventIds ?? []).includes(eventId)) {
    return {
      state,
      files,
      result: session.result,
      orchestration,
      idempotent: true,
    };
  }
  const resultInput = { ...input, changedPaths: diff.changedPaths, actualChangedPaths: diff.changedPaths, candidateFingerprint, worktreeFingerprint: candidateFingerprint };
  const contracts = await orchestrationContracts();
  const normalized = contracts.validateSessionResultContract
    ? contractValidationResult(contracts.validateSessionResultContract(session, resultInput), "INVALID_SESSION_RESULT", "Session result contract is invalid.")
    : null;
  const status = normalized?.status ?? input.status;
  assert(["passed", "failed", "blocked", "needs_input"].includes(status), "INVALID_SESSION_RESULT_STATUS", "Session result status must be passed, failed, blocked, or needs_input.");
  assert(input.summary?.trim(), "SESSION_RESULT_SUMMARY_REQUIRED", "Session result requires a summary.");
  if (status === "passed") {
    assert(diff.changedPaths.length > 0, "SESSION_CHANGED_PATHS_REQUIRED", "A passed session must change at least one authorized file.");
    assert(Array.isArray(input.verification) && input.verification.length > 0, "SESSION_VERIFICATION_REQUIRED", "A passed session requires verification entries.");
    assert((input.verification ?? []).every((item) => item?.status === "passed"), "SESSION_VERIFICATION_FAILED", "A passed session requires all verification entries to pass.");
    assert(asArray(input.evidence).length > 0, "SESSION_EVIDENCE_REQUIRED", "A passed session requires evidence.");
    if (input.candidateFingerprint !== undefined) assert(input.candidateFingerprint === candidateFingerprint, "STALE_SESSION_CANDIDATE", "Session result candidate fingerprint is stale.");
  }
  const now = isoNow(clock);
  const verification = normalized?.verification ?? input.verification ?? [];
  const reportedEvidence = normalized?.evidence ?? input.evidence ?? [];
  const result = {
    ...(normalized ?? input),
    taskId,
    sessionId,
    status,
    summary: String(input.summary).trim(),
    changedPaths: diff.changedPaths,
    verification,
    evidence: reportedEvidence,
    reportedEvidence,
    candidateFingerprint,
    worktreeFingerprint: candidateFingerprint,
    recordedAt: now,
  };
  const event = {
    eventId,
    expectedRevision: input.expectedRevision ?? orchestration.revision,
    type: "SESSION_RESULT",
    sessionId,
    result: { ...result, evidence: reportedEvidence, baseRevision: session.baseRevision ?? session.base?.fingerprint ?? undefined },
    session: { result: { ...result, evidence: reportedEvidence }, status, durationMs: input.durationMs ?? null },
    at: now,
  };
  const applied = contracts.applyOrchestrationEvent
    ? (() => {
      const value = contracts.applyOrchestrationEvent(orchestration, event);
      return value?.orchestration ? value : { orchestration: value, idempotent: false };
    })()
    : await applyOrchestrationEventFallback(orchestration, event);
  if (status === "passed") result.evidence = await persistOrchestrationEvidenceReceipt(root, files, session, result, clock);
  state.execution.orchestration = applied.orchestration;
  state.execution.orchestration.sessions[sessionId] = {
    ...state.execution.orchestration.sessions[sessionId],
    ...session,
    status,
    state: status,
    result,
    durationMs: input.durationMs ?? session.durationMs ?? null,
    updatedAt: now,
  };
  refreshOrchestrationAggregate(state.execution.orchestration);
  const integration = state.execution.orchestration.integration;
  if (integrationBatchReady(state.execution.orchestration, session.subtaskId) && !integration.budgetStartedAt) {
    integration.budgetStartedAt = now;
    integration.deadlineAt = new Date(new Date(now).getTime() + integration.budgetMs).toISOString();
    integration.elapsedMs = 0;
    integration.budgetStatus = "within_budget";
  }
  appendHistory(state, "ORCHESTRATION_SESSION_RESULT", now, { sessionId, status, changedPaths: diff.changedPaths });
  const saved = await saveTask(files, state, clock);
  return { ...saved, result, orchestration: state.execution.orchestration, idempotent: applied.idempotent === true };
}

async function readWorktreeFile(worktree, relative) {
  const target = path.resolve(worktree, relative);
  const relativeTarget = path.relative(path.resolve(worktree), target);
  assert(relativeTarget === "" || (!relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget)), "SESSION_PATH_ESCAPE", `Session path escapes worktree: ${relative}`);
  try {
    return await readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function pathInventoryDigest(files, file) {
  return inventoryByPath(files).get(file)?.sha256 ?? null;
}

function orderedSessions(orchestration, sessionIds = undefined) {
  const selected = new Set(sessionIds ?? Object.keys(orchestration.sessions ?? {}));
  const planTasks = new Map((orchestration.plan?.tasks ?? orchestration.plan?.batches?.flatMap((batch) => batch.tasks ?? []) ?? []).map((task) => [task.id, task]));
  return Object.values(orchestration.sessions ?? {})
    .filter((session) => selected.has(session.sessionId) && sessionStatus(session) === "passed")
    .sort((left, right) => (planTasks.get(left.subtaskId)?.stage ?? 0) - (planTasks.get(right.subtaskId)?.stage ?? 0));
}

function integrationBatchReady(orchestration, subtaskId) {
  const batch = (orchestration.batches ?? []).find((item) => (item.tasks ?? []).some((task) => task.id === subtaskId));
  if (!batch) return false;
  const sessions = (batch.tasks ?? [])
    .map((task) => Object.values(orchestration.sessions ?? {}).find((session) => session.subtaskId === task.id))
    .filter(Boolean);
  const terminal = new Set(["passed", "failed", "blocked", "needs_input", "integrated", "conflict"]);
  return sessions.length === (batch.tasks ?? []).length
    && sessions.every((session) => terminal.has(sessionStatus(session)))
    && sessions.some((session) => sessionStatus(session) === "passed");
}

export async function integrateOrchestration(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  const orchestration = ensureOrchestration(state);
  const candidates = orderedSessions(orchestration, input.sessionIds);
  assert(candidates.length > 0, "NO_VERIFIED_SESSIONS", "No verified passed sessions are ready for integration.");
  await assertFrozenSharedContract(root, orchestration);
  const currentMain = await fingerprintProject(root, { include: ["**/*"] });
  const contracts = await orchestrationContracts();
  if (contracts.evaluateIntegrationBudget) {
    const evaluatedAt = clock();
    orchestration.integration.budgetStartedAt ??= isoNow(() => evaluatedAt);
    const budget = contractValidationResult(contracts.evaluateIntegrationBudget({
      ...orchestration.integration,
      budgetMs: orchestration.integration?.budgetMs,
      budgetStartedAt: orchestration.integration.budgetStartedAt,
    }, evaluatedAt, input.overrunAction ?? null), "ORCHESTRATION_INTEGRATION_BUDGET_INVALID", "Integration budget state is invalid.");
    orchestration.integration = { ...orchestration.integration, ...budget };
    if (budget.exceeded && budget.allowed) {
      orchestration.status = "attention_required";
      orchestration.integration.status = "budget_exceeded";
      orchestration.nextActions = [budget.selectedAction];
      orchestration.aggregate.nextActions = [budget.selectedAction];
      appendHistory(state, "ORCHESTRATION_INTEGRATION_BUDGET_EXCEEDED", isoNow(() => evaluatedAt), { action: budget.selectedAction, elapsedMs: budget.elapsedMs, budgetMs: budget.budgetMs });
      const saved = await saveTask(files, state, clock);
      return { ...saved, integrated: [], conflicts: [], orchestration, actions: [{ type: budget.selectedAction, action: budget.selectedAction }] };
    }
    assert(budget.allowed === true, "ORCHESTRATION_INTEGRATION_BUDGET_EXCEEDED", "Controller integration exceeded its time budget; choose minimal-contract-repair, controller-sequential, or replan instead of expanding scope.", { errors: budget.overrunActions });
  }
  if (contracts.validateIntegrationPreconditions) {
    for (const session of candidates) {
      contractValidationResult(contracts.validateIntegrationPreconditions({
        ...input,
        orchestration,
        sessionId: session.sessionId,
        changedPaths: session.result?.changedPaths ?? [],
        baseRevision: session.baseRevision ?? session.base?.fingerprint,
        candidateFingerprint: currentMain.fingerprint,
      }), "INTEGRATION_PRECONDITIONS_FAILED", "Integration preconditions are not satisfied.");
    }
  }
  const conflicts = [];
  const integrated = [];
  const integratedSubtasks = new Set(Object.values(orchestration.sessions ?? {})
    .filter((session) => sessionStatus(session) === "integrated")
    .map((session) => session.subtaskId));
  orchestration.integration.status = "integrating";
  orchestration.integration.startedAt = isoNow(clock);
  for (const session of candidates) {
    const task = orchestrationTask(orchestration, session.subtaskId);
    const pendingDependencies = (task?.dependsOn ?? []).filter((dependencyId) => {
      if (integratedSubtasks.has(dependencyId)) return false;
      const dependencySession = Object.values(orchestration.sessions ?? {}).find((item) => item.subtaskId === dependencyId);
      if (dependencySession) return sessionStatus(dependencySession) !== "integrated";
      return state.execution.results?.[dependencyId]?.status !== "passed";
    });
    assert(pendingDependencies.length === 0, "ORCHESTRATION_DEPENDENCY_NOT_READY", `Session ${session.sessionId} dependencies are not integrated: ${pendingDependencies.join(", ")}.`);
    const result = session.result;
    const changedPaths = result.changedPaths ?? [];
    const baselineFiles = session.mainBaseline?.files ?? [];
    const baselineByPath = inventoryByPath(baselineFiles);
    const drift = changedPaths.filter((file) => pathInventoryDigest(currentMain.files, file) !== (baselineByPath.get(file)?.sha256 ?? null));
    if (drift.length > 0) {
      session.status = "conflict";
      session.state = "conflict";
      conflicts.push({ sessionId: session.sessionId, paths: drift, reason: "main-candidate-drift" });
      continue;
    }
    const worktreeCurrent = await fingerprintProject(session.worktree, { include: ["**/*"] });
    if (worktreeCurrent.fingerprint !== result.worktreeFingerprint && worktreeCurrent.fingerprint !== result.candidateFingerprint) {
      session.status = "conflict";
      session.state = "conflict";
      conflicts.push({ sessionId: session.sessionId, paths: changedPaths, reason: "worktree-drift" });
      continue;
    }
    const writes = [];
    for (const relative of changedPaths) {
      const bytes = await readWorktreeFile(session.worktree, relative);
      const target = path.resolve(root, relative);
      const rel = path.relative(path.resolve(root), target);
      assert(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)), "INTEGRATION_PATH_ESCAPE", `Integration path escapes project root: ${relative}`);
      if (bytes === null) writes.push({ target, delete: true });
      else writes.push({ target, content: bytes });
    }
    if (writes.length > 0) await atomicWriteBatch(root, writes, clock);
    const integratedAt = isoNow(clock);
    session.status = "integrated";
    session.state = "integrated";
    session.integratedAt = integratedAt;
    state.execution.results[session.subtaskId] = {
      ...result,
      status: "passed",
      integrationStatus: "integrated",
      integratedAt,
    };
    integrated.push(session.sessionId);
    integratedSubtasks.add(session.subtaskId);
    const nextMain = await fingerprintProject(root, { include: ["**/*"] });
    Object.assign(currentMain, nextMain);
  }
  orchestration.integration.integratedSessionIds = [...new Set([...(orchestration.integration.integratedSessionIds ?? []), ...integrated])];
  orchestration.integration.sessionIds = candidates.map((session) => session.sessionId);
  orchestration.integration.conflicts = conflicts;
  orchestration.integration.status = conflicts.length > 0 ? (integrated.length > 0 ? "partial" : "conflict") : "integrated";
  orchestration.integration.candidateFingerprint = (await fingerprintProject(root, { include: ["**/*"] })).fingerprint;
  orchestration.integration.completedAt = isoNow(clock);
  const nextBatches = (orchestration.batches ?? [])
    .map((batch) => ({
      ...batch,
      tasks: (batch.tasks ?? []).filter((task) => {
        const session = Object.values(orchestration.sessions ?? {}).find((item) => item.subtaskId === task.id);
        if (!session || sessionStatus(session) !== "planned") return false;
        return (task.dependsOn ?? []).every((dependencyId) => integratedSubtasks.has(dependencyId) || state.execution.results?.[dependencyId]?.status === "passed");
      }),
    }))
    .filter((batch) => batch.tasks.length > 0);
  const nextActionPlan = orchestrationActions(nextBatches, orchestration.controller, orchestration.contract, state.routing?.lane);
  orchestration.nextActions = nextActionPlan.actions;
  if (nextActionPlan.actions.length > 0) {
    orchestration.integration.budgetStartedAt = null;
    orchestration.integration.deadlineAt = null;
    orchestration.integration.elapsedMs = 0;
    orchestration.integration.budgetStatus = "not_started";
    orchestration.integration.selectedAction = null;
  }
  refreshOrchestrationAggregate(orchestration);
  const now = isoNow(clock);
  appendHistory(state, "ORCHESTRATION_INTEGRATED", now, { integrated, conflicts });
  const saved = await saveTask(files, state, clock);
  return { ...saved, integrated, conflicts, orchestration, actions: nextActionPlan.actions };
}

function parseNulPaths(buffer) {
  return Buffer.from(buffer ?? []).toString("utf8").split("\0").filter(Boolean).map((item) => toPosix(item));
}

async function gitCleanupInventory(worktree) {
  const options = { cwd: worktree, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 };
  const [{ stdout: changed }, { stdout: ignored }] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], options),
    execFileAsync("git", ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], options),
  ]);
  const entries = [];
  const fields = Buffer.from(changed ?? []).toString("utf8").split("\0").filter(Boolean);
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const status = field.slice(0, 2);
    const relative = field.slice(3);
    if (status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") {
      const original = fields[index + 1];
      if (original) {
        entries.push({ status, path: toPosix(original) });
        index += 1;
      }
    }
    entries.push({ status, path: toPosix(relative) });
  }
  return { entries, ignoredPaths: parseNulPaths(ignored) };
}

async function gitWorktreeRemovalBlocker(controllerRoot, worktree) {
  const { stdout: listed } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: controllerRoot, encoding: "utf8" });
  const blocks = listed.trim().split(/\n\n+/).map((block) => block.split(/\r?\n/));
  const target = blocks.find((block) => block.some((line) => line === `worktree ${worktree}`));
  if (!target) return "worktree-not-registered";
  if (target.some((line) => line === "locked" || line.startsWith("locked "))) return "worktree-locked";
  const { stdout: submodules } = await execFileAsync("git", ["submodule", "status", "--recursive"], { cwd: worktree, encoding: "utf8" });
  if (submodules.trim()) return "submodule-present";
  return null;
}

async function cleanupPathSnapshot(worktree, relative) {
  const target = path.resolve(worktree, relative);
  const relativeTarget = path.relative(path.resolve(worktree), target);
  assert(relativeTarget === "" || (!relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget)), "WORKTREE_CLEANUP_PATH_ESCAPE", `Cleanup path escapes worktree: ${relative}`);
  try {
    const info = await lstat(target);
    if (info.isDirectory()) return { type: "directory", mode: info.mode & 0o777, sha256: null };
    if (info.isSymbolicLink()) return { type: "symlink", mode: info.mode & 0o777, sha256: sha256(`symlink:${await readlink(target)}`) };
    return { type: "file", mode: info.mode & 0o777, sha256: sha256(await readFile(target)) };
  } catch (error) {
    if (error?.code === "ENOENT") return { type: "missing", mode: 0, sha256: sha256("missing") };
    throw error;
  }
}

function sameCleanupSnapshot(left, right) {
  return left?.type === right?.type && left?.mode === right?.mode && left?.sha256 === right?.sha256;
}

function cleanupItem(session, status, reason, details = {}) {
  return {
    sessionId: session.sessionId,
    subtaskId: session.subtaskId ?? null,
    worktree: session.worktree ?? null,
    status,
    reason,
    ...details,
  };
}

async function cleanupIntegratedWorktree(root, state, orchestration, session, contracts) {
  if (sessionStatus(session) !== "integrated") return cleanupItem(session, "retained", "session-not-integrated");
  if (!session.worktree?.trim()) return cleanupItem(session, "retained", "worktree-not-recorded");
  const recordedPath = path.resolve(session.worktree);
  if (recordedPath === path.resolve(root)) return cleanupItem(session, "retained", "controller-checkout-protected");
  if (!(await pathExists(recordedPath))) {
    const previous = orchestration.cleanup?.items?.find((item) => item.sessionId === session.sessionId && item.status === "cleaned");
    return previous
      ? cleanupItem(session, "cleaned", "already-cleaned", { worktree: recordedPath, idempotent: true })
      : cleanupItem(session, "retained", "worktree-not-present", { worktree: recordedPath });
  }
  let controllerGit;
  let sessionGit;
  try {
    controllerGit = await gitWorktreeIdentity(root);
    sessionGit = await gitWorktreeIdentity(recordedPath);
  } catch (error) {
    return cleanupItem(session, "failed", "git-identity-check-failed", { error: error.message });
  }
  const sameCommonDir = controllerGit.git && sessionGit.git && controllerGit.commonDir === sessionGit.commonDir;
  if (controllerGit.git && recordedPath === controllerGit.topLevel) return cleanupItem(session, "retained", "controller-checkout-protected");
  const identityMatches = sessionGit.git
    && sessionGit.topLevel === recordedPath
    && session.gitIdentity?.commonDir === sessionGit.commonDir
    && session.gitIdentity?.topLevel === sessionGit.topLevel
    && session.gitIdentity?.head === sessionGit.head
    && session.branch === sessionGit.branchIdentity;
  if (!sameCommonDir) return cleanupItem(session, "retained", "foreign-repository");
  if (!identityMatches) return cleanupItem(session, "retained", "identity-drift");
  try {
    const blocker = await gitWorktreeRemovalBlocker(root, recordedPath);
    if (blocker) return cleanupItem(session, "retained", blocker);
  } catch (error) {
    return cleanupItem(session, "failed", "worktree-preflight-failed", { error: error.message });
  }
  let inventory;
  try {
    inventory = await gitCleanupInventory(recordedPath);
  } catch (error) {
    return cleanupItem(session, "failed", "git-inventory-failed", { error: error.message });
  }
  const cleanupPaths = [...new Set(inventory.entries.map((item) => item.path))].sort();
  if (inventory.ignoredPaths.length > 0) return cleanupItem(session, "retained", "ignored-content", { paths: inventory.ignoredPaths });
  const unsupportedStatuses = inventory.entries.filter((item) => /[RCU]/.test(item.status));
  if (unsupportedStatuses.length > 0) return cleanupItem(session, "retained", "unsupported-git-status", { paths: unsupportedStatuses.map((item) => item.path) });
  const baseline = inventoryByPath(session.base?.files ?? []);
  const deliveredPaths = new Set(session.result?.changedPaths ?? []);
  const unknownPaths = [];
  const untrackedPaths = [];
  for (const relative of cleanupPaths) {
    const entry = inventory.entries.find((item) => item.path === relative);
    const worktreeSnapshot = await cleanupPathSnapshot(recordedPath, relative);
    const baselineItem = baseline.get(relative);
    const unchangedFromCreation = baselineItem
      && baselineItem.type === worktreeSnapshot.type
      && baselineItem.mode === worktreeSnapshot.mode
      && baselineItem.sha256 === worktreeSnapshot.sha256;
    const controllerEquivalent = sameCleanupSnapshot(worktreeSnapshot, await cleanupPathSnapshot(root, relative));
    const knownSource = unchangedFromCreation || deliveredPaths.has(relative);
    if (!knownSource || !controllerEquivalent) unknownPaths.push(relative);
    if (entry?.status === "??") {
      if (worktreeSnapshot.type === "directory") unknownPaths.push(relative);
      else untrackedPaths.push(relative);
    }
  }
  if (unknownPaths.length > 0) return cleanupItem(session, "retained", "unknown-content", { paths: unknownPaths });
  try {
    contractValidationResult(contracts.validateWorktreeCleanupCandidate?.({
      sessionId: session.sessionId,
      worktree: recordedPath,
      controllerWorktree: controllerGit.topLevel ?? path.resolve(root),
      taskDelivered: state.phase === PHASES.DELIVERED,
      sessionStatus: sessionStatus(session),
      sameCommonDir,
      identityMatches,
      unknownPaths,
      ignoredPaths: inventory.ignoredPaths,
      mainEquivalent: unknownPaths.length === 0,
    }), "WORKTREE_CLEANUP_UNSAFE", "Worktree cleanup candidate is unsafe.");
  } catch (error) {
    return cleanupItem(session, "retained", error.code ?? "cleanup-contract-rejected", { error: error.message });
  }
  try {
    const trackedPaths = cleanupPaths.filter((relative) => !untrackedPaths.includes(relative));
    if (trackedPaths.length > 0) {
      await execFileAsync("git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...trackedPaths], {
        cwd: recordedPath,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    }
    for (const relative of untrackedPaths) {
      const target = path.resolve(recordedPath, relative);
      const rel = path.relative(recordedPath, target);
      assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel), "WORKTREE_CLEANUP_PATH_ESCAPE", `Cleanup path escapes worktree: ${relative}`);
      await rm(target);
    }
    const remaining = await gitCleanupInventory(recordedPath);
    if (remaining.entries.length > 0 || remaining.ignoredPaths.length > 0) {
      return cleanupItem(session, "retained", "worktree-still-dirty", { paths: [...remaining.entries.map((item) => item.path), ...remaining.ignoredPaths] });
    }
    await execFileAsync("git", ["worktree", "remove", "--", recordedPath], { cwd: root, encoding: "utf8" });
    return cleanupItem(session, "cleaned", "safe-integrated-worktree-removed", { worktree: recordedPath, cleanedPaths: cleanupPaths });
  } catch (error) {
    return cleanupItem(session, "failed", "worktree-remove-failed", { error: error.message });
  }
}

export async function cleanupOrchestrationWorktrees(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assert(state.phase === PHASES.DELIVERED, "WORKTREE_CLEANUP_TASK_NOT_DELIVERED", "Worktree cleanup is allowed only after task delivery.");
  const orchestration = ensureOrchestration(state);
  const contracts = await orchestrationContracts();
  const selected = input.sessionIds ? new Set(input.sessionIds) : null;
  const previouslyCleaned = new Set((orchestration.cleanup?.items ?? []).filter((item) => item.status === "cleaned").map((item) => item.sessionId));
  const sessions = Object.values(orchestration.sessions ?? {}).filter((session) => {
    if (selected && !selected.has(session.sessionId)) return false;
    return Boolean(session.worktree?.trim()) || previouslyCleaned.has(session.sessionId);
  });
  const attemptedAt = isoNow(clock);
  const items = [];
  for (const session of sessions) items.push(await cleanupIntegratedWorktree(root, state, orchestration, session, contracts));
  const summary = contracts.summarizeWorktreeCleanup
    ? contractValidationResult(contracts.summarizeWorktreeCleanup(items), "WORKTREE_CLEANUP_SUMMARY_INVALID", "Worktree cleanup summary is invalid.")
    : {
      total: items.length,
      cleaned: items.filter((item) => item.status === "cleaned").length,
      retained: items.filter((item) => item.status === "retained").length,
      failed: items.filter((item) => item.status === "failed").length,
      complete: items.every((item) => item.status === "cleaned"),
    };
  orchestration.cleanup = {
    status: summary.failed > 0 ? "failed" : summary.retained > 0 ? "partial" : "completed",
    attemptedAt,
    completedAt: isoNow(clock),
    items,
    summary,
  };
  appendHistory(state, "ORCHESTRATION_WORKTREES_CLEANED", orchestration.cleanup.completedAt, { summary, items: items.map((item) => ({ sessionId: item.sessionId, status: item.status, reason: item.reason })) });
  const saved = await saveTask(files, state, clock);
  await writeReport(root, taskId);
  return { ...saved, cleanup: orchestration.cleanup, orchestration };
}

export async function recordAgentDispatch(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.SOLUTION_DRAFT, PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED], "Agent dispatch recording");
  assert(input.role?.trim(), "AGENT_ROLE_REQUIRED", "Agent role is required.");
  assert(["planned", "running", "passed", "failed", "blocked"].includes(input.status), "INVALID_AGENT_STATUS", "Agent status is invalid.");
  const role = input.role.trim();
  const implementationRole = IMPLEMENTATION_ROUTES.includes(role);
  if (implementationRole) {
    assertPhase(state, [PHASES.IMPLEMENTING, PHASES.REPAIRING, PHASES.BLOCKED], "Implementation Agent dispatch recording");
    assert(input.subtaskId?.trim(), "AGENT_SUBTASK_REQUIRED", "Implementation Agent dispatches must reference a planned subtask.");
    assert(state.execution?.planStatus === "planned", "EXECUTION_PLAN_REQUIRED", "Implementation Agent dispatch requires a validated execution plan.");
    const task = executionTask(state, input.subtaskId.trim());
    assert(task, "UNKNOWN_EXECUTION_TASK", `Unknown execution task: ${input.subtaskId.trim()}.`);
    assert(task.route === role, "EXECUTION_ROUTE_MISMATCH", `Execution task ${task.id} is routed to ${task.route}, not ${role}.`);
  }
  if (state.deliveryVersion >= 3 && state.routing?.status === "assessed") {
    assert(
      state.routing.agents.roles.includes(role),
      "AGENT_NOT_ALLOWED_FOR_LANE",
      `Agent role ${role} is not allowed for the ${state.routing.lane} lane.`,
    );
  }
  const id = input.id?.trim() || `AGENT-${String(state.agents.dispatches.length + 1).padStart(3, "0")}`;
  const previous = state.agents.dispatches.find((item) => item.id === id);
  assert(!previous || previous.role === role, "AGENT_DISPATCH_ROLE_MISMATCH", `Agent dispatch ${id} is already bound to role ${previous?.role}.`);
  assert(!previous || previous.subtaskId === (input.subtaskId?.trim() || null), "AGENT_DISPATCH_SUBTASK_MISMATCH", `Agent dispatch ${id} is already bound to subtask ${previous?.subtaskId}.`);
  assert(!previous || !["passed", "failed", "blocked"].includes(previous.status), "AGENT_DISPATCH_TERMINAL", `Agent dispatch ${id} is already terminal with status ${previous?.status}.`);
  const recommended = profileForDispatch({
    role,
    deliveryVersion: state.deliveryVersion,
    lane: state.routing?.lane,
    riskSignals: state.routing?.assessment?.riskSignals ?? [],
    repairAttempts: state.repair?.attempts ?? [],
  });
  const configured = previous?.profile ? previous : recommended;
  const reviewControl = role === "independent-review"
    ? assertIndependentReviewDispatchAllowed(state, id, currentIndependentReviewPlan(state, await readUtf8(files.requirement)))
    : null;
  for (const [property, label] of [
    ["profile", "profile"],
    ["model", "model"],
    ["reasoningEffort", "reasoning effort"],
    ["forkTurns", "fork turns"],
    ["sandbox", "sandbox"],
  ]) {
    if (input[property] !== undefined) {
      assert(
        String(input[property]).trim() === String(configured[property]),
        "AGENT_PROFILE_MISMATCH",
        `Agent ${label} ${input[property]} does not match ${role} profile ${configured[property]}.`,
      );
    }
  }
  const runtimeFailure = state.deliveryVersion >= 3 && ["failed", "blocked"].includes(input.status) && input.runtimeAttestation?.verified === false
    ? validateRuntimeFailure(input.runtimeAttestation)
    : previous?.runtimeFailure ?? null;
  const runtimeAttestation = state.deliveryVersion >= 3 && input.status !== "planned" && !runtimeFailure
    ? validateRuntimeAttestation(configured, input.runtimeAttestation)
    : previous?.runtimeAttestation ?? null;
  if (role === "independent-review" && ["failed", "blocked"].includes(input.status)) {
    assert(runtimeFailure, "INDEPENDENT_REVIEW_RUNTIME_FAILURE_REQUIRED", "A non-passed independent-review dispatch must record a concrete unverified runtime failure; actionable review findings use a passed dispatch plus a failed solution review verdict.");
  }
  const prepared = state.deliveryVersion >= 3
    ? await loadContextForState(root, state, files, {
      surface: input.surface ?? contextSurfaceForRole(role),
    })
    : null;
  const now = isoNow(clock);
  if (implementationRole && input.status === "passed") {
    assert(previous?.status === "running", "IMPLEMENTATION_AGENT_MUST_RUN", `Implementation Agent ${id} must enter running before passed.`);
  }
  if (implementationRole && input.status === "running" && previous?.status !== "running") {
    const otherRunning = state.agents.dispatches.find((item) => item.id !== id && IMPLEMENTATION_ROUTES.includes(item.role) && item.status === "running");
    assert(!otherRunning, "CONCURRENT_WRITE_AGENT_UNSUPPORTED", `Writable Agent ${otherRunning?.id} is already running. Use isolated worktrees before enabling concurrent write Agents.`);
  }
  const candidateBaseline = implementationRole && input.status === "running" && !previous?.candidateBaseline
    ? await fingerprintProject(root, { include: ["**/*"] })
    : previous?.candidateBaseline ?? null;
  const metric = (value, label, integer = false) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    assert(Number.isFinite(parsed) && parsed >= 0 && (!integer || Number.isInteger(parsed)), "INVALID_AGENT_METRIC", `${label} must be a non-negative ${integer ? "integer" : "number"}.`);
    return parsed;
  };
  const suppliedMetrics = {
    inputTokens: metric(input.inputTokens, "Agent input tokens", true),
    cachedInputTokens: metric(input.cachedInputTokens, "Agent cached input tokens", true),
    outputTokens: metric(input.outputTokens, "Agent output tokens", true),
    durationMs: metric(input.durationMs, "Agent duration"),
  };
  if (role === "independent-review" && input.status === "passed") {
    assert(suppliedMetrics.durationMs !== undefined, "INDEPENDENT_REVIEW_DURATION_REQUIRED", "A passed independent reviewer must record its actual duration.");
    assert(suppliedMetrics.durationMs <= reviewControl.timeoutMs, "INDEPENDENT_REVIEW_TIMEOUT_EXCEEDED", `The independent reviewer exceeded its ${reviewControl.timeoutMs} ms budget and cannot be recorded as passed.`);
  }
  const startedAt = previous?.startedAt ?? now;
  const terminal = ["passed", "failed", "blocked"].includes(input.status);
  const inputTokens = suppliedMetrics.inputTokens ?? previous?.inputTokens ?? null;
  const cachedInputTokens = suppliedMetrics.cachedInputTokens ?? previous?.cachedInputTokens ?? null;
  assert(inputTokens === null || cachedInputTokens === null || cachedInputTokens <= inputTokens, "INVALID_AGENT_METRIC", "Agent cached input tokens cannot exceed total input tokens.");
  const dispatch = {
    id,
    role,
    subtaskId: input.subtaskId?.trim() || null,
    status: input.status,
    summary: input.summary?.trim() || "",
    profile: configured.profile,
    model: configured.model,
    reasoningEffort: configured.reasoningEffort,
    forkTurns: configured.forkTurns,
    sandbox: configured.sandbox,
    writable: configured.writable ?? false,
    leaf: configured.leaf ?? true,
    canSpawnAgents: configured.canSpawnAgents ?? false,
    authority: configured.authority ?? null,
    runtimeAttestation,
    runtimeFailure,
    reviewControl,
    candidateBaseline,
    escalation: configured.escalation ?? null,
    inputTokens,
    cachedInputTokens,
    outputTokens: suppliedMetrics.outputTokens ?? previous?.outputTokens ?? null,
    durationMs: suppliedMetrics.durationMs
      ?? previous?.durationMs
      ?? (terminal ? Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime()) : null),
    context: prepared ? {
      surface: prepared.surface,
      digest: prepared.context.digest,
      path: state.context.path,
      referenceCount: prepared.references.length,
    } : null,
    startedAt,
    updatedAt: now,
  };
  const index = state.agents.dispatches.findIndex((item) => item.id === id);
  if (index === -1) state.agents.dispatches.push(dispatch);
  else state.agents.dispatches[index] = dispatch;
  if (role === "independent-review") {
    state.reviews.independent.initialSolutionSha256 ??= reviewControl.solutionSha256;
    if (reviewControl.round === "recheck") state.reviews.independent.recheckSolutionSha256 ??= reviewControl.solutionSha256;
    const attempts = independentReviewDispatches(state, reviewControl.solutionSha256, reviewControl.round);
    const permanentCapabilityFailure = ["model_identity", "permission"].includes(dispatch.runtimeFailure?.failureClass);
    if (["failed", "blocked"].includes(dispatch.status) && (permanentCapabilityFailure || attempts.length >= INDEPENDENT_REVIEW_MAX_ATTEMPTS)) {
      const key = `${reviewControl.round}:${reviewControl.solutionSha256}`;
      if (!state.reviews.independent.unavailable.some((item) => item.key === key)) {
        state.reviews.independent.unavailable.push({
          key,
          round: reviewControl.round,
          solutionSha256: reviewControl.solutionSha256,
          reason: permanentCapabilityFailure ? dispatch.runtimeFailure.failureClass : "runtime-attempts-exhausted",
          recordedAt: now,
        });
      }
    }
  }
  appendHistory(state, "AGENT_DISPATCH_RECORDED", now, {
    id,
    role: dispatch.role,
    status: dispatch.status,
    profile: dispatch.profile,
    model: dispatch.model,
    reasoningEffort: dispatch.reasoningEffort,
    subtaskId: dispatch.subtaskId,
    durationMs: dispatch.durationMs,
  });
  const saved = await saveTask(files, state, clock);
  return {
    ...saved,
    dispatch,
    scopedContext: prepared ? {
      surface: prepared.surface,
      digest: prepared.context.digest,
      references: prepared.references,
      warnings: prepared.context.warnings,
    } : null,
  };
}

export async function recordRepairAttempt(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.IMPLEMENTING, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.PRE_UAT], "Repair attempt recording");
  assert(input.hypothesis?.trim(), "REPAIR_HYPOTHESIS_REQUIRED", "A credible repair hypothesis is required.");
  assert(["progress", "no-progress", "failed"].includes(input.outcome), "INVALID_REPAIR_OUTCOME", "Repair outcome is invalid.");
  const prepared = state.deliveryVersion >= 3
    ? await loadContextForState(root, state, files, { surface: "implementation" })
    : null;
  const now = isoNow(clock);
  const fingerprintValue = input.progressFingerprint?.trim() || null;
  const hypothesis = input.hypothesis.trim();
  const newHypothesis = hypothesis !== state.repair.lastHypothesis;
  const progressed = input.outcome === "progress"
    || (fingerprintValue && fingerprintValue !== state.repair.lastProgressFingerprint);
  const attempt = {
    id: `REPAIR-${String(state.repair.attempts.length + 1).padStart(3, "0")}`,
    issueId: input.issueId?.trim() || null,
    hypothesis,
    outcome: input.outcome,
    summary: input.summary?.trim() || "",
    progressFingerprint: fingerprintValue,
    contextDigest: prepared?.context.digest ?? null,
    contextReferenceCount: prepared?.references.length ?? 0,
    recordedAt: now,
  };
  state.repair.attempts.push(attempt);
  if (progressed) {
    state.repair.lastProgressFingerprint = fingerprintValue ?? state.repair.lastProgressFingerprint;
    state.repair.consecutiveNoProgress = 0;
  } else {
    state.repair.consecutiveNoProgress = newHypothesis ? 1 : state.repair.consecutiveNoProgress + 1;
  }
  state.repair.lastHypothesis = hypothesis;
  if (state.repair.consecutiveNoProgress >= 3) {
    setPhase(state, PHASES.BLOCKED, now);
    state.repair.blockedReason = "Three attempts made no progress without a new credible hypothesis.";
  } else {
    delete state.repair.blockedReason;
  }
  appendHistory(state, "REPAIR_ATTEMPT_RECORDED", now, { attemptId: attempt.id, outcome: attempt.outcome, progressed });
  return saveTask(files, state, clock);
}

export async function approveAcceptance(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.ACCEPTANCE_DRAFT, PHASES.ACCEPTANCE_APPROVED], "Acceptance approval");
  const document = await readUtf8(files.requirement);
  const markdown = acceptanceContract(document);
  const validation = validateAcceptance(markdown);
  validationFailure("INVALID_ACCEPTANCE", "Acceptance card is not ready for approval.", validation);
  if (state.deliveryVersion >= 3) {
    assert(state.routing?.status === "assessed", "TASK_NOT_ASSESSED", "Assess task depth before approving acceptance.");
    const pending = blockingDecisions(state.decisions);
    assert(pending.length === 0, "BLOCKING_DECISIONS_PENDING", "Resolve every blocking human or authorization decision before approving acceptance.", {
      errors: pending.map((decision) => `${decision.id}: ${decision.question}`),
    });
  }
  const digest = acceptanceFingerprint(document);

  if (state.acceptance.sha256 === digest && state.acceptance.approvedAt) {
    return { state, files, warnings: validation.warnings, unchanged: true };
  }

  const now = isoNow(clock);
  state.acceptance = {
    approvedAt: now,
    sha256: digest,
    items: validation.parsed.criteria,
  };
  setPhase(state, PHASES.ACCEPTANCE_APPROVED, now);
  state.readyAt = null;
  appendHistory(state, "ACCEPTANCE_APPROVED", now, { sha256: digest });
  await saveTask(files, state, clock);
  await refreshKnowledgeGraph(root, clock);
  return { state, files, warnings: validation.warnings, unchanged: false };
}

export async function draftSolution(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.ACCEPTANCE_APPROVED, PHASES.SOLUTION_DRAFT], "Solution drafting");
  await assertAcceptanceIntegrity(files, state);
  const document = await readUtf8(files.requirement);
  if (!solutionContract(document).trim()) {
    await atomicWrite(files.requirement, replaceRequirementSection(document, "solution", solutionTemplate(taskId, state.acceptance.items)));
  }
  if (state.phase !== PHASES.SOLUTION_DRAFT) {
    const now = isoNow(clock);
    appendHistory(state, "SOLUTION_DRAFTED", now);
    setPhase(state, PHASES.SOLUTION_DRAFT, now);
    await saveTask(files, state, clock);
  }
  return { state, files };
}

function pathsOverlap(left, right) {
  const a = normalizeImpactPath(left);
  const b = normalizeImpactPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

async function taskIds(root) {
  const files = projectFiles(root);
  try {
    const entries = await readdir(files.requirements, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name.slice(0, -3)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function markAffectedDependencies(root, currentState, approvedAt, clock) {
  const dependencies = [];
  const semanticImpacts = new Map((await safeImpactAnalysis(root, {
    taskId: currentState.taskId,
    impactPaths: currentState.solution.impactPaths,
  })).map((impact) => [impact.taskId, impact]));
  for (const otherId of await taskIds(root)) {
    if (otherId === currentState.taskId) continue;
    const other = await loadTask(root, otherId);
    const prior = other.state;
    if (!prior.solution?.approvedAt || prior.solution.approvedAt >= approvedAt) continue;
    const overlaps = [];
    for (const currentPath of currentState.solution.impactPaths) {
      for (const previousPath of prior.solution.impactPaths ?? []) {
        if (pathsOverlap(currentPath, previousPath)) overlaps.push([currentPath, previousPath]);
      }
    }
    const semantic = semanticImpacts.get(otherId);
    if (overlaps.length === 0 && !semantic) continue;

    const acceptanceIds = overlaps.length > 0
      ? prior.acceptance.items.map((item) => item.id)
      : semantic.acceptanceIds;
    if (acceptanceIds.length === 0) continue;
    for (const acceptanceId of acceptanceIds) {
      const previous = prior.results[acceptanceId];
      prior.results[acceptanceId] = {
        ...(previous ?? {}),
        acceptanceId,
        status: "affected",
        previousStatus: previous?.status ?? "unverified",
        summary: `Affected by ${currentState.taskId} through ${overlaps.length > 0 ? "shared impact paths" : "semantic relationships"}.`,
        evidence: [],
        verifiedAt: null,
        affectedAt: approvedAt,
        affectedBy: currentState.taskId,
      };
    }
    for (const check of Object.values(prior.checks)) {
      if (check.status === "passed") {
        check.previousStatus = check.status;
        check.status = "affected";
        check.evidence = [];
        check.verifiedAt = null;
        check.affectedAt = approvedAt;
        check.affectedBy = currentState.taskId;
      }
    }
    for (const batch of Object.values(prior.uat?.batches ?? {})) {
      if (batch.status === "passed") {
        batch.previousStatus = batch.status;
        batch.status = "affected";
        batch.evidence = [];
        batch.verifiedAt = null;
      }
    }
    if (prior.preflight?.status === "passed") prior.preflight.status = "affected";
    prior.handoff = { status: "not_prepared", preparedAt: null };
    advanceEpoch(prior, approvedAt, `affected by ${currentState.taskId}`);
    prior.readyAt = null;
    setPhase(prior, PHASES.PRE_UAT, approvedAt);
    appendHistory(prior, "ACCEPTANCE_AFFECTED", approvedAt, {
      byTask: currentState.taskId,
      overlaps,
      reasons: semantic?.reasons ?? [],
      acceptanceIds,
    });
    await saveTask(other.files, prior, clock);
    dependencies.push({
      taskId: otherId,
      acceptanceIds,
      overlaps,
      reasons: semantic?.reasons ?? [],
      notBefore: approvedAt,
    });
  }
  return dependencies;
}

/**
 * Read the project's additional authorization overlays from
 * `.openatdd/config.yaml`. The flat top-level `authorization_overlays` key can
 * only extend the built-in requirement with known risk overlays.
 */
async function projectAuthorizationOverlays(root) {
  const files = projectFiles(root);
  if (!(await pathExists(files.config))) return [];
  const overlays = [];
  for (const line of (await readUtf8(files.config)).split(/\r?\n/)) {
    const match = /^authorization_overlays:\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[1];
    const comment = value.search(/(^|\s)#/);
    if (comment !== -1) value = value.slice(0, comment);
    for (const overlay of value.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean)) {
      assert(
        RISK_OVERLAYS.includes(overlay),
        "INVALID_AUTHORIZATION_CONFIG",
        `Unknown risk overlay in authorization_overlays: ${overlay}.`,
      );
      overlays.push(overlay);
    }
  }
  return [...new Set(overlays)];
}

export async function approveSolution(root, taskId, inputOrClock = {}, maybeClock = () => new Date()) {
  const input = typeof inputOrClock === "function" ? {} : (inputOrClock ?? {});
  const clock = typeof inputOrClock === "function" ? inputOrClock : maybeClock;
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.SOLUTION_DRAFT, PHASES.CONTRACT_APPROVED, PHASES.IMPLEMENTING], "Solution approval");
  await assertAcceptanceIntegrity(files, state);
  const document = await readUtf8(files.requirement);
  const markdown = solutionContract(document);
  const validation = validateSolution(markdown, state.acceptance.items, { progressive: state.deliveryVersion >= 3 });
  validationFailure("INVALID_SOLUTION", "Solution card is not ready for approval.", validation);
  const digest = solutionFingerprint(document);
  if (state.phase === PHASES.IMPLEMENTING) {
    assert(input.parallel === true, "SOLUTION_ALREADY_IMPLEMENTING", "An implementing task can only persist a previously explicit parallel directive for its unchanged approved solution.");
    assert(state.solution?.approvedAt && state.solution.sha256 === digest, "PARALLEL_DIRECTIVE_STALE", "The implementing task solution no longer matches its approved solution.");
  }
  if (input.parallel === true) {
    assert(state.routing?.lane !== "quick", "PARALLEL_QUICK_UNSUPPORTED", "Quick tasks remain direct and cannot request multi-session orchestration.");
  }
  if (state.deliveryVersion >= 3) {
    const pending = blockingDecisions(state.decisions);
    assert(pending.length === 0, "BLOCKING_DECISIONS_PENDING", "Resolve every blocking decision before approving the solution.", {
      errors: pending.map((decision) => `${decision.id}: ${decision.question}`),
    });
    const review = state.reviews?.solution;
    assert(
      review?.status === "passed" && review.solutionSha256 === digest,
      "SOLUTION_REVIEW_REQUIRED",
      "Record a passed simplicity and project-fit review for the current solution before approval.",
    );
    if (state.routing?.lane === "deep") {
      if (review.reviewer !== "independent") {
        const eligibility = independentReviewFallbackEligibility(state, digest);
        const dangerous = authorizationOverlays(state.routing, await projectAuthorizationOverlays(root));
        assert(eligibility.eligible, "INDEPENDENT_REVIEW_REQUIRED", "Deep tasks require an independent solution review unless its bounded runtime or two-round review budget is exhausted.");
        if (dangerous.length > 0) {
          const decision = state.reviews?.independent?.fallbackDecision;
          assert(
            decision?.status === "approved" && decision.humanConfirmed === true && decision.solutionSha256 === digest,
            "INDEPENDENT_REVIEW_HUMAN_DECISION_REQUIRED",
            "Independent review is unavailable for a dangerous Deep task; record an explicit human fallback decision instead of silently falling back.",
            { errors: dangerous.map((overlay) => `risk overlay ${overlay} requires explicit human fallback approval`) },
          );
        }
        assert(review.fallbackReason, "INDEPENDENT_REVIEW_FALLBACK_REASON_REQUIRED", "Main-review fallback must state why bounded independent review was unavailable.");
      }
    }
    const overlays = authorizationOverlays(state.routing, await projectAuthorizationOverlays(root));
    if (overlays.length > 0) {
      const covered = new Set((state.decisions ?? [])
        .filter((decision) => decision.owner === "authorization" && decision.status === "resolved")
        .flatMap((decision) => decision.coversOverlays ?? []));
      const uncovered = overlays.filter((signal) => !covered.has(signal));
      assert(
        uncovered.length === 0,
        "AUTHORIZATION_DECISION_REQUIRED",
        "A dangerous or externally mutating change requires a resolved authorization decision covering every active risk overlay before product code is modified.",
        { errors: uncovered.map((signal) => `risk overlay ${signal} requires explicit authorization coverage`) },
      );
    }
  }

  if (state.solution.sha256 === digest && state.solution.approvedAt) {
    if (input.parallel === true && state.execution.directive?.solutionSha256 !== digest) {
      const now = isoNow(clock);
      const directiveInput = {
        mode: "parallel",
        source: input.source ?? "human-solution-approval",
        solutionSha256: digest,
        requestedAt: now,
      };
      const contracts = await orchestrationContracts();
      state.execution.directive = contracts.validateParallelDirective
        ? contractValidationResult(
          contracts.validateParallelDirective(directiveInput, digest),
          "INVALID_PARALLEL_DIRECTIVE",
          "Parallel execution directive is invalid.",
        )
        : directiveInput;
      appendHistory(state, "PARALLEL_DIRECTIVE_RECORDED", now, { solutionSha256: digest });
      await saveTask(files, state, clock);
    }
    return { state, files, warnings: validation.warnings, unchanged: true, affectedDependencies: state.affectedDependencies };
  }

  const now = isoNow(clock);
  if (input.parallel === true) {
    const directiveInput = {
      mode: "parallel",
      source: input.source ?? "human-solution-approval",
      solutionSha256: digest,
      requestedAt: now,
    };
    const contracts = await orchestrationContracts();
    const validated = contracts.validateParallelDirective
      ? contractValidationResult(
        contracts.validateParallelDirective(directiveInput, digest),
        "INVALID_PARALLEL_DIRECTIVE",
        "Parallel execution directive is invalid.",
      )
      : directiveInput;
    state.execution.directive = validated ?? directiveInput;
  } else if (state.execution.directive?.solutionSha256 && state.execution.directive.solutionSha256 !== digest) {
    state.execution.directive = null;
  }
  state.solution = {
    approvedAt: now,
    sha256: digest,
    impactPaths: validation.parsed.impactPaths.map(normalizeImpactPath),
    trace: validation.parsed.trace,
  };
  if (input.parallel !== true && state.execution.directive?.solutionSha256 !== digest) state.execution.directive = null;
  setPhase(state, PHASES.CONTRACT_APPROVED, now);
  advanceEpoch(state, now, "solution approved");
  state.readyAt = null;
  appendHistory(state, "SOLUTION_APPROVED", now, { sha256: digest });
  state.affectedDependencies = await markAffectedDependencies(root, state, now, clock);
  await saveTask(files, state, clock);
  await refreshKnowledgeGraph(root, clock);
  return {
    state,
    files,
    warnings: validation.warnings,
    unchanged: false,
    affectedDependencies: state.affectedDependencies,
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function workerVerificationCommand(command) {
  const argv = (command?.argv ?? []).map(shellQuote).join(" ");
  if (!argv) return null;
  return command.cwd ? `cd ${shellQuote(command.cwd)} && ${argv}` : argv;
}

async function prepareDefaultExecutionRouting(root, state, clock) {
  if (state.routing?.lane === "quick" || ["planned", "controller-sequential"].includes(state.execution?.planStatus)) return;
  let verification = [];
  let manifestError = null;
  try {
    const manifestInfo = await loadFinalizationManifest(root, state.taskId);
    const checks = manifestInfo.manifest?.checks ?? [];
    const group = checks.find((item) => item.scope === "focused")
      ?? checks.find((item) => item.scope === "module")
      ?? checks.find((item) => item.scope === "broad");
    verification = (group?.commands ?? []).map(workerVerificationCommand).filter(Boolean);
  } catch (error) {
    manifestError = `${error.code ?? "FINALIZATION_MANIFEST_UNAVAILABLE"}: ${error.message}`;
  }
  const routing = deriveDefaultExecutionPlan({
    acceptanceIds: state.acceptance.items.map((item) => item.id),
    impactPaths: state.solution.impactPaths,
    lane: state.routing?.lane,
    requirement: state.requirement,
    verification,
    protectedPaths: [".git", ".openatdd/requirements", ".env.openatdd.local"],
  });
  const now = isoNow(clock);
  if (routing.status === "planned") {
    state.execution = {
      ...state.execution,
      planStatus: "planned",
      plannedAt: now,
      plan: routing.plan,
      results: {},
      fallbackReason: null,
      nextActions: ["dispatch-worker"],
      orchestration: orchestrationDefaults(),
    };
    appendHistory(state, "EXECUTION_PLANNED", now, { source: "approved-solution-default", taskCount: routing.plan.tasks.length, stages: 1 });
    return;
  }
  state.execution = {
    ...state.execution,
    planStatus: "controller-sequential",
    plannedAt: now,
    plan: null,
    fallbackReason: {
      ...routing.reason,
      details: [...(routing.reason?.details ?? []), ...(manifestError ? [manifestError] : [])],
    },
    nextActions: ["controller-sequential"],
  };
  appendHistory(state, "EXECUTION_CONTROLLER_SEQUENTIAL", now, state.execution.fallbackReason);
}

export async function beginImplementation(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.CONTRACT_APPROVED, PHASES.IMPLEMENTING], "Implementation");
  await assertContractIntegrity(files, state);
  if (state.phase !== PHASES.IMPLEMENTING) {
    const now = isoNow(clock);
    const baseline = await fingerprintProject(root, { include: ["**/*"] });
    state.implementationBaseline = {
      recordedAt: now,
      fingerprint: baseline.fingerprint,
      files: baseline.files,
    };
    appendHistory(state, "IMPLEMENTATION_STARTED", now);
    setPhase(state, PHASES.IMPLEMENTING, now);
    await saveTask(files, state, clock);
  }
  if (state.deliveryVersion < 3) return { state, files };
  await prepareDefaultExecutionRouting(root, state, clock);
  const prepared = await loadContextForState(root, state, files, { surface: "implementation" });
  const context = prepared.context;
  appendHistory(state, "SCOPED_CONTEXT_PREPARED", isoNow(clock), {
    lane: context.lane,
    persisted: prepared.persisted,
    implementationReferences: context.implementation.length,
    verificationReferences: context.verification.length,
  });
  const saved = await saveTask(files, state, clock);
  return { ...saved, context };
}

/**
 * Run the Quick lane's compact autonomous approval chain in one invocation:
 * acceptance approval, solution draft, the structured main review, solution
 * approval, and implementation start. Every persisted gate keeps its own
 * validation and error; only the round trips between the commands are removed.
 * Standard and Deep keep two separate human confirmations and must use the
 * individual gate commands.
 */
export async function advanceQuickTask(root, taskId, input = {}, clock = () => new Date()) {
  const initial = await loadTask(root, taskId);
  assert(
    initial.state.routing?.lane === "quick",
    "ADVANCE_REQUIRES_QUICK",
    "advance merges the compact autonomous Quick approvals; Standard and Deep tasks keep their two separate human confirmations.",
  );
  assertPhase(initial.state, [
    PHASES.ACCEPTANCE_DRAFT,
    PHASES.ACCEPTANCE_APPROVED,
    PHASES.SOLUTION_DRAFT,
    PHASES.CONTRACT_APPROVED,
    PHASES.IMPLEMENTING,
  ], "Advance");
  const steps = [];
  const warnings = [];
  let phase = initial.state.phase;
  let affectedDependencies = initial.state.affectedDependencies ?? [];

  if ([PHASES.ACCEPTANCE_DRAFT, PHASES.ACCEPTANCE_APPROVED].includes(phase)) {
    const acceptance = await approveAcceptance(root, taskId, clock);
    warnings.push(...acceptance.warnings);
    steps.push({ step: "approve-acceptance", performed: true, unchanged: acceptance.unchanged });
    phase = acceptance.state.phase;
  } else steps.push({ step: "approve-acceptance", performed: false });

  if ([PHASES.ACCEPTANCE_APPROVED, PHASES.SOLUTION_DRAFT].includes(phase)) {
    const drafted = await draftSolution(root, taskId, clock);
    steps.push({ step: "draft-solution", performed: phase === PHASES.ACCEPTANCE_APPROVED });
    phase = drafted.state.phase;
  } else steps.push({ step: "draft-solution", performed: false });

  if (phase === PHASES.SOLUTION_DRAFT) {
    const { state, files } = await loadTask(root, taskId);
    const document = await readUtf8(files.requirement);
    const markdown = solutionContract(document);
    const validation = validateSolution(markdown, state.acceptance.items, { progressive: state.deliveryVersion >= 3 });
    validationFailure("INVALID_SOLUTION", "Solution card is not ready for autonomous approval.", validation);
    const review = state.reviews?.solution;
    if (review?.status === "passed" && review.solutionSha256 === solutionFingerprint(document)) {
      steps.push({ step: "review-solution", performed: false });
    } else {
      await recordSolutionReview(root, taskId, {
        status: "passed",
        reviewer: "main",
        summary: input.summary,
        findings: input.findings,
        checks: "all",
      }, clock);
      steps.push({ step: "review-solution", performed: true });
    }
    const approved = await approveSolution(root, taskId, clock);
    warnings.push(...approved.warnings);
    affectedDependencies = approved.affectedDependencies;
    steps.push({ step: "approve-solution", performed: true, unchanged: approved.unchanged });
  } else {
    steps.push({ step: "review-solution", performed: false }, { step: "approve-solution", performed: false });
  }

  const begun = await beginImplementation(root, taskId, clock);
  steps.push({ step: "begin", performed: true });
  return { state: begun.state, files: begun.files, context: begun.context ?? null, steps, warnings, affectedDependencies };
}

export async function resumeTask(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  if (state.solution?.approvedAt) await assertContractIntegrity(files, state);
  const contextPhases = new Set([
    PHASES.IMPLEMENTING,
    PHASES.REPAIRING,
    PHASES.BLOCKED,
    PHASES.PRE_UAT,
    ...DELIVERY_TERMINAL_PHASES,
  ]);
  let prepared = null;
  if (state.deliveryVersion >= 3 && contextPhases.has(state.phase)) {
    const surface = state.phase === PHASES.PRE_UAT || isDeliveryTerminalPhase(state.phase)
      ? "verification"
      : "implementation";
    prepared = await loadContextForState(root, state, files, { surface });
  }
  const now = isoNow(clock);
  appendHistory(state, "TASK_RESUMED", now, {
    phase: state.phase,
    contextSurface: prepared?.surface ?? null,
    contextDigest: prepared?.context.digest ?? null,
  });
  const saved = await saveTask(files, state, clock);
  return {
    ...saved,
    scopedContext: prepared ? {
      surface: prepared.surface,
      digest: prepared.context.digest,
      references: prepared.references,
      warnings: prepared.context.warnings,
    } : null,
  };
}

export async function preflightTask(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.CONTRACT_APPROVED, PHASES.IMPLEMENTING, PHASES.REPAIRING, PHASES.PRE_UAT, PHASES.BLOCKED],
    "Environment preflight",
  );
  await assertContractIntegrity(files, state);
  state.deliveryVersion = Math.max(state.deliveryVersion ?? 1, 2);
  const environment = input.environment?.trim() || state.preflight?.environment || "local";
  let preflight;
  try {
    preflight = await runEnvironmentPreflight(root, environment, { ...input, notBefore: evidenceBoundary(state) }, clock);
  } catch (error) {
    preflight = {
      result: {
        schemaVersion: 1,
        environment,
        profile: `.openatdd/environments/${environment}.yaml`,
        status: "failed",
        checkedAt: isoNow(clock),
        durationMs: 0,
        checks: [{ name: "configuration", status: "failed", detail: error.message }],
        warnings: [],
        credentialVariables: [],
      },
      profile: null,
    };
  }
  state.preflight = preflight.result;
  state.preflight.environment = environment;
  state.readyAt = null;
  const now = preflight.result.checkedAt;
  appendHistory(state, "ENVIRONMENT_PREFLIGHT", now, {
    environment,
    status: preflight.result.status,
    failed: preflight.result.checks.filter((check) => check.status === "failed").map((check) => check.name),
  });
  await writeJson(files.preflight, preflight.result);
  await saveTask(files, state, clock);
  assert(preflight.result.status === "passed", "PREFLIGHT_FAILED", "Environment preflight failed; formal UAT cannot start.", {
    errors: preflight.result.checks.filter((check) => check.status === "failed").map((check) => `${check.name}: ${check.detail}`),
  });
  return { state, files, profile: preflight.profile };
}

export async function beginPreUat(root, taskId, clock = () => new Date()) {
  let { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.REPAIRING, PHASES.PRE_UAT, PHASES.BLOCKED],
    "Pre-UAT",
  );
  await assertContractIntegrity(files, state);
  const preflightStale = new Date(state.preflight?.checkedAt ?? 0).getTime() < new Date(evidenceBoundary(state) ?? 0).getTime();
  if (state.deliveryVersion >= 2 && (state.preflight?.status !== "passed" || preflightStale)) {
    await preflightTask(root, taskId, { environment: state.preflight?.environment || "local" }, clock);
    ({ state, files } = await loadTask(root, taskId));
  }
  if (state.phase !== PHASES.PRE_UAT) {
    const now = isoNow(clock);
    appendHistory(state, "PRE_UAT_STARTED", now);
    setPhase(state, PHASES.PRE_UAT, now);
    await saveTask(files, state, clock);
  }
  return { state, files };
}

function defaultUatPlan(state, profile, executionInput = {}) {
  const items = state.acceptance.items;
  const groups = items.length <= 2
    ? [items]
    : [[items[0]], items.slice(1, -1), [items.at(-1)]];
  const names = items.length <= 2
    ? ["complete approved journey"]
    : ["setup and entry", "primary business journey", "final readback and evidence"];
  const batches = groups.filter((group) => group.length > 0).map((group, index) => ({
    id: `batch-${index + 1}`,
    name: names[index],
    reuseSession: index > 0,
    steps: group.map((criterion, stepIndex) => ({
      id: `${criterion.id.toLowerCase()}-${stepIndex + 1}`,
      acceptanceId: criterion.id,
      action: criterion.when,
      expected: criterion.then,
      checkpoint: stepIndex === group.length - 1,
    })),
  }));
  return {
    schemaVersion: 1,
    environment: profile.environment,
    entryUrl: profile.entry_url === "n/a" ? null : profile.entry_url,
    execution: verificationExecutionProfile({
      surface: profile.surface ?? (profile.entry_url === "n/a" ? "cli" : "web"),
      ...executionInput,
    }),
    batches,
    estimatedRoundTrips: batches.length * 2,
    failureRecovery: "Narrow and rerun only the failed batch for diagnosis; after repair, rerun the complete journey in a fresh epoch.",
  };
}

export function validateUatPlan(state, plan) {
  const errors = [];
  if (plan?.schemaVersion !== 1) errors.push("UAT plan schemaVersion must be 1.");
  if (!Array.isArray(plan?.batches) || plan.batches.length === 0) errors.push("UAT plan requires at least one batch.");
  if ((plan?.batches?.length ?? 0) > 5) errors.push("UAT plan must use no more than five cohesive batches.");
  if (plan?.execution !== undefined) {
    if (!["deterministic", "browser-low", "human"].includes(plan.execution?.mode)) errors.push("UAT execution mode must be deterministic, browser-low, or human.");
    if (plan.execution?.mode === "browser-low") {
      if (plan.execution.model !== "gpt-5.6-luna" || plan.execution.reasoningEffort !== "low") errors.push("Low-model browser execution must use gpt-5.6-luna with low reasoning.");
      if (plan.execution.forkTurns !== "none" || plan.execution.reuseSession !== true) errors.push("Low-model browser execution must use a clean context and one reused session.");
      if (plan.execution.screenshotPolicy !== "checkpoint-or-failure") errors.push("Low-model browser execution must capture screenshots only at checkpoints or failure.");
    }
  }
  const ids = new Set();
  const covered = new Map();
  for (const batch of plan?.batches ?? []) {
    if (!batch.id || ids.has(batch.id)) errors.push(`UAT batch ID must be unique: ${batch.id || "missing"}.`);
    ids.add(batch.id);
    if (!Array.isArray(batch.steps) || batch.steps.length === 0) errors.push(`UAT batch ${batch.id} requires steps.`);
    for (const step of batch.steps ?? []) {
      if (!step.action?.trim() || !step.expected?.trim()) errors.push(`UAT step ${step.id || "unnamed"} requires one action and an expected result.`);
      if (!state.acceptance.items.some((criterion) => criterion.id === step.acceptanceId)) errors.push(`UAT step references unknown acceptance: ${step.acceptanceId}.`);
      covered.set(step.acceptanceId, (covered.get(step.acceptanceId) ?? 0) + 1);
    }
  }
  for (const criterion of state.acceptance.items) {
    if (!covered.has(criterion.id)) errors.push(`UAT plan does not cover ${criterion.id}.`);
  }
  return { valid: errors.length === 0, errors };
}

export async function prepareUatPlan(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED], "UAT planning");
  await assertContractIntegrity(files, state);
  assert(state.preflight?.status === "passed", "PREFLIGHT_REQUIRED", "Successful environment preflight is required before UAT planning.");
  const { profile } = await loadEnvironmentProfile(root, state.preflight.environment || "local");
  const plan = input.plan ?? defaultUatPlan(state, profile, input.execution ?? {});
  const validation = validateUatPlan(state, plan);
  assert(validation.valid, "INVALID_UAT_PLAN", "UAT plan is invalid.", { errors: validation.errors });
  const budget = Number(profile.browser_round_trip_budget || 12);
  const warnings = Number(plan.estimatedRoundTrips ?? 0) > budget
    ? [`Estimated browser round trips (${plan.estimatedRoundTrips}) exceed budget (${budget}).`]
    : [];
  await writeJson(files.uatPlan, plan);
  state.deliveryVersion = Math.max(state.deliveryVersion ?? 1, 2);
  state.uat = { planStatus: "planned", plannedAt: isoNow(clock), batches: {}, warnings, estimatedRoundTrips: plan.estimatedRoundTrips ?? null };
  appendHistory(state, "UAT_PLANNED", state.uat.plannedAt, { batches: plan.batches.length, warnings });
  await saveTask(files, state, clock);
  return { state, files, plan, warnings };
}

export async function recordUatBatch(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED], "UAT batch recording");
  await assertContractIntegrity(files, state);
  assert(state.preflight?.status === "passed", "PREFLIGHT_REQUIRED", "Successful preflight is required before browser UAT.");
  assert(state.uat?.planStatus === "planned", "UAT_PLAN_REQUIRED", "Prepare a validated UAT plan before recording batches.");
  const plan = await readJson(files.uatPlan);
  const batch = plan.batches.find((item) => item.id === input.batchId);
  assert(batch, "UNKNOWN_UAT_BATCH", `Unknown UAT batch: ${input.batchId}`);
  assert(["passed", "failed", "blocked"].includes(input.status), "INVALID_BATCH_STATUS", "Batch status must be passed, failed, or blocked.");
  if (input.status === "passed") assert(!state.issues.some((issue) => issue.status === "open"), "OPEN_ISSUE_BLOCKS_PASS", "Resolve open issues before recording a passed formal UAT batch.");
  const evidence = input.status === "passed"
    ? await captureEvidence(files.root, input.evidence, evidenceBoundary(state), clock)
    : await optionalEvidence(files.root, input.evidence, evidenceBoundary(state), clock);
  const now = isoNow(clock);
  state.uat.batches[batch.id] = { id: batch.id, status: input.status, summary: input.summary?.trim() || batch.name, evidence, verifiedAt: now, epoch: state.verification.epoch };
  if (input.status === "failed") setPhase(state, PHASES.REPAIRING, now);
  else if (input.status === "blocked") setPhase(state, PHASES.BLOCKED, now);
  appendHistory(state, "UAT_BATCH_RECORDED", now, { batchId: batch.id, status: input.status });
  return saveTask(files, state, clock);
}

export function evidenceBoundary(state) {
  const values = [state.solution.approvedAt, state.verificationNotBefore, state.verification?.startedAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return values.length === 0 ? null : new Date(Math.max(...values)).toISOString();
}

async function optionalEvidence(root, value, boundary, clock) {
  return asArray(value).length > 0 ? captureEvidence(root, value, boundary, clock) : [];
}

export async function recordAcceptanceResult(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, ...DELIVERY_TERMINAL_PHASES],
    "Acceptance recording",
  );
  await assertContractIntegrity(files, state);
  const criterion = state.acceptance.items.find((item) => item.id === input.acceptanceId);
  assert(criterion, "UNKNOWN_ACCEPTANCE", `Unknown acceptance criterion: ${input.acceptanceId}`);
  const allowed = ["passed", "failed", "blocked", "manual", "affected", "deferred", "cancelled"];
  assert(allowed.includes(input.status), "INVALID_RESULT_STATUS", `Invalid acceptance status: ${input.status}`);
  if (input.humanConfirmed === true) {
    assert(criterion.classification !== "AUTO", "AUTO_CANNOT_BE_HUMAN_CONFIRMED", `${criterion.id} is automatic and does not accept a human confirmation flag.`);
    assert(input.status === "manual", "HUMAN_CONFIRMATION_REQUIRES_MANUAL", "Human confirmation must preserve the manual result classification.");
  }
  if (input.status === "passed") {
    assert(!state.issues.some((issue) => issue.status === "open"), "OPEN_ISSUE_BLOCKS_PASS", "Resolve every open issue before recording formal passed acceptance evidence.");
  }

  if (input.status === "passed") {
    assert(criterion.classification !== "MANUAL", "MANUAL_CANNOT_AUTO_PASS", `${criterion.id} requires human judgment.`);
    if (state.deliveryVersion >= 3) {
      assert(criterion.classification !== "ASSISTED", "ASSISTED_REQUIRES_HUMAN_JUDGMENT", `${criterion.id} requires prepared evidence plus explicit human judgment.`);
    }
  }
  if (input.status === "manual") {
    assert(
      criterion.classification === "MANUAL" || criterion.classification === "ASSISTED",
      "AUTO_CANNOT_BE_MANUAL",
      `${criterion.id} is automatic and cannot be left for manual judgment.`,
    );
  }
  if (["deferred", "cancelled"].includes(input.status)) {
    assert(!criterion.blocking, "BLOCKING_CANNOT_BE_SKIPPED", `${criterion.id} is blocking and cannot be ${input.status}.`);
  }

  const needsEvidence = input.status === "passed"
    || (input.status === "manual" && criterion.classification === "ASSISTED" && input.humanConfirmed !== true);
  const boundary = evidenceBoundary(state);
  const evidence = input.humanConfirmed === true && asArray(input.evidence).length === 0
    ? (state.results[criterion.id]?.evidence ?? [])
    : needsEvidence
      ? await captureEvidence(files.root, input.evidence, boundary, clock)
      : await optionalEvidence(files.root, input.evidence, boundary, clock);
  const now = isoNow(clock);
  state.results[criterion.id] = {
    acceptanceId: criterion.id,
    classification: criterion.classification,
    blocking: criterion.blocking,
    status: input.status,
    summary: input.summary?.trim() || criterion.title,
    evidence,
    verifiedAt: now,
    epoch: state.verification.epoch,
    ...(input.humanConfirmed === true ? { humanStatus: "passed", humanConfirmedAt: now } : {}),
  };
  state.readyAt = null;
  if (input.status === "failed") setPhase(state, PHASES.REPAIRING, now);
  else if (input.status === "blocked") setPhase(state, PHASES.BLOCKED, now);
  else if (input.humanConfirmed !== true && (isDeliveryTerminalPhase(state.phase) || state.phase === PHASES.BLOCKED)) setPhase(state, PHASES.PRE_UAT, now);
  appendHistory(state, input.humanConfirmed === true ? "HUMAN_ACCEPTANCE_CONFIRMED" : "ACCEPTANCE_RECORDED", now, { acceptanceId: criterion.id, status: input.status });
  const saved = await saveTask(files, state, clock);
  if (input.humanConfirmed === true && await pathExists(files.handoff)) {
    const handoff = await readJson(files.handoff);
    const document = await readUtf8(files.requirement);
    await atomicWrite(files.requirement, renderRequirementDocument(document, state, handoff));
  }
  return saved;
}

function checkKey(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "check";
}

function invalidateForSourceChange(state, now, previous, current) {
  for (const result of Object.values(state.results)) {
    if (["passed", "manual"].includes(result.status)) {
      result.previousStatus = result.status;
      result.status = "affected";
      result.summary = "Source fingerprint changed; formal acceptance must be rerun.";
      result.evidence = [];
      result.verifiedAt = null;
    }
  }
  for (const check of Object.values(state.checks)) {
    if (check.status === "passed") {
      check.previousStatus = check.status;
      check.status = "affected";
      check.summary = "Source fingerprint changed; check must be rerun.";
      check.evidence = [];
      check.verifiedAt = null;
    }
  }
  for (const batch of Object.values(state.uat?.batches ?? {})) {
    if (batch.status === "passed") {
      batch.previousStatus = batch.status;
      batch.status = "affected";
      batch.evidence = [];
      batch.verifiedAt = null;
    }
  }
  if (state.preflight?.status === "passed") state.preflight.status = "affected";
  state.handoff = { status: "not_prepared", preparedAt: null };
  advanceEpoch(state, now, `source fingerprint changed from ${previous} to ${current}`);
}

export async function recordCheck(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, ...DELIVERY_TERMINAL_PHASES],
    "Check recording",
  );
  await assertContractIntegrity(files, state);
  assert(input.name?.trim(), "CHECK_NAME_REQUIRED", "Check name is required.");
  assert(input.command?.trim(), "CHECK_COMMAND_REQUIRED", "The executed check command is required.");
  assert(["passed", "failed", "blocked", "affected"].includes(input.status), "INVALID_CHECK_STATUS", `Invalid check status: ${input.status}`);
  const scope = input.scope?.trim() || "broad";
  assert(["focused", "module", "broad"].includes(scope), "INVALID_CHECK_SCOPE", "Check scope must be focused, module, or broad.");
  if (input.status === "passed") {
    assert(!state.issues.some((issue) => issue.status === "open"), "OPEN_ISSUE_BLOCKS_PASS", "Resolve every open issue before recording a passed project check.");
  }
  const now = isoNow(clock);
  const sourceFingerprint = input.sourceFingerprint?.trim() || state.sourceFingerprint || "unspecified";
  if (state.sourceFingerprint && state.sourceFingerprint !== sourceFingerprint) {
    invalidateForSourceChange(state, now, state.sourceFingerprint, sourceFingerprint);
  }
  state.sourceFingerprint = sourceFingerprint;
  const boundary = evidenceBoundary(state);
  const evidence = input.status === "passed"
    ? await captureEvidence(files.root, input.evidence, boundary, clock)
    : await optionalEvidence(files.root, input.evidence, boundary, clock);
  const key = checkKey(input.name);
  state.checks[key] = {
    id: key,
    name: input.name.trim(),
    command: input.command.trim(),
    status: input.status,
    scope,
    sourceFingerprint,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null,
    summary: input.summary?.trim() || "",
    evidence,
    verifiedAt: now,
    epoch: state.verification.epoch,
  };
  state.checkSequence.push({ id: key, scope, status: input.status, sourceFingerprint, verifiedAt: now, epoch: state.verification.epoch });
  state.readyAt = null;
  if (input.status === "failed") setPhase(state, PHASES.REPAIRING, now);
  else if (input.status === "blocked") setPhase(state, PHASES.BLOCKED, now);
  else if (isDeliveryTerminalPhase(state.phase) || state.phase === PHASES.BLOCKED) setPhase(state, PHASES.PRE_UAT, now);
  appendHistory(state, "CHECK_RECORDED", now, { check: key, status: input.status });
  return saveTask(files, state, clock);
}

function splitValues(value) {
  return asArray(value)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function nextIssueId(state) {
  const numbers = state.issues.map((issue) => Number(issue.id.match(/(\d+)$/)?.[1] ?? 0));
  return `ISSUE-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

function renderIssues(state) {
  const lines = [`# Issues: ${state.taskId}`, ""];
  if (state.issues.length === 0) return `${lines.join("\n")}No issues recorded.\n`;
  for (const issue of state.issues) {
    lines.push(`## ${issue.id} [${issue.status}] ${issue.acceptanceId}`, "", `- Symptom: ${issue.symptom}`);
    if (issue.rootCause) lines.push(`- Root cause: ${issue.rootCause}`);
    if (issue.regression) lines.push(`- Regression protection: ${issue.regression}`);
    if (issue.invariant) lines.push(`- Invariant: ${issue.invariant}`);
    if (issue.memoryId) lines.push(`- Memory: ${issue.memoryId}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function createIncident(root, state, issue, input, now) {
  const files = projectFiles(root);
  const index = await readJson(files.memoryIndex);
  const year = new Date(now).getUTCFullYear();
  const sequence = index.incidents.filter((item) => item.id.startsWith(`INC-${year}-`)).length + 1;
  const invariantSequence = Math.max(0, ...index.incidents
    .map((item) => Number(item.invariantId?.match(new RegExp(`^INV-${year}-(\\d+)$`))?.[1] ?? 0))) + 1;
  const id = `INC-${year}-${String(sequence).padStart(3, "0")}`;
  const invariantText = input.invariant.trim();
  const invariantKey = invariantText.replace(/\s+/g, " ").toLowerCase();
  const existingInvariant = index.incidents.find((item) => (
    String(item.invariant ?? "").trim().replace(/\s+/g, " ").toLowerCase() === invariantKey
    && item.invariantId
  ));
  const invariantId = existingInvariant?.invariantId ?? `INV-${year}-${String(invariantSequence).padStart(3, "0")}`;
  const safeName = issue.symptom.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "incident";
  const relativeFile = `incidents/${id}-${safeName}.md`;
  const incidentPath = path.join(files.memory, relativeFile);
  const paths = splitValues(input.paths).map(normalizeImpactPath);
  const tags = splitValues(input.tags);
  const entry = {
    id,
    title: issue.symptom,
    area: input.area?.trim() || paths[0] || state.taskId,
    rootCause: input.rootCause.trim(),
    invariantId,
    invariant: invariantText,
    tests: splitValues(input.regression),
    paths,
    tags,
    sourceTask: state.taskId,
    sourceIssue: issue.id,
    createdAt: now,
    file: relativeFile,
  };
  const body = `# ${id}: ${issue.symptom}\n\n- Area: ${entry.area}\n- Source task: ${state.taskId}\n- Source issue: ${issue.id}\n- Created: ${now}\n\n## Root cause\n\n${entry.rootCause}\n\n## Invariant\n\n${invariantId}: ${entry.invariant}\n\n## Regression protection\n\n${entry.tests.map((test) => `- ${test}`).join("\n")}\n\n## Impact paths\n\n${paths.map((item) => `- \`${item}\``).join("\n") || "- Not recorded"}\n`;
  await atomicWrite(incidentPath, body);
  index.incidents.push(entry);
  await writeJson(files.memoryIndex, index);
  const invariants = await readUtf8(files.invariants);
  if (!invariants.includes(entry.invariant)) {
    await atomicWrite(files.invariants, `${invariants.trimEnd()}\n\n## ${invariantId}\n\n${entry.invariant}\n\nProtection: ${entry.tests.join(", ")}\n`);
  }
  return entry;
}

function invalidateVerification(state, now, issueId) {
  for (const [acceptanceId, result] of Object.entries(state.results)) {
    if (!["deferred", "cancelled"].includes(result.status)) {
      state.results[acceptanceId] = {
        ...result,
        previousStatus: result.status,
        status: "affected",
        summary: `Reverification required after resolving ${issueId}.`,
        evidence: [],
        verifiedAt: null,
        affectedAt: now,
        affectedBy: issueId,
      };
    }
  }
  for (const check of Object.values(state.checks)) {
    if (check.status === "passed") {
      check.previousStatus = check.status;
      check.status = "affected";
      check.summary = `Reverification required after resolving ${issueId}.`;
      check.evidence = [];
      check.verifiedAt = null;
      check.affectedAt = now;
      check.affectedBy = issueId;
    }
  }
  for (const batch of Object.values(state.uat?.batches ?? {})) {
    if (batch.status === "passed") {
      batch.previousStatus = batch.status;
      batch.status = "affected";
      batch.summary = `Reverification required after resolving ${issueId}.`;
      batch.evidence = [];
      batch.verifiedAt = null;
    }
  }
  state.handoff = { status: "not_prepared", preparedAt: null };
  advanceEpoch(state, now, `resolved ${issueId}`);
  state.readyAt = null;
  setPhase(state, PHASES.PRE_UAT, now);
}

export async function recordIssue(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, ...DELIVERY_TERMINAL_PHASES],
    "Issue recording",
  );
  await assertContractIntegrity(files, state);
  assert(["open", "resolved"].includes(input.status), "INVALID_ISSUE_STATUS", "Issue status must be open or resolved.");
  const now = isoNow(clock);

  if (input.status === "open") {
    assert(input.acceptanceId, "ACCEPTANCE_REQUIRED", "An affected acceptance ID is required for a new issue.");
    assert(state.acceptance.items.some((item) => item.id === input.acceptanceId), "UNKNOWN_ACCEPTANCE", `Unknown acceptance criterion: ${input.acceptanceId}`);
    assert(input.symptom?.trim(), "SYMPTOM_REQUIRED", "A reproducible symptom is required.");
    const id = input.id || nextIssueId(state);
    assert(!state.issues.some((issue) => issue.id === id), "ISSUE_EXISTS", `Issue already exists: ${id}`);
    const evidence = await optionalEvidence(files.root, input.evidence, evidenceBoundary(state), clock);
    state.issues.push({
      id,
      acceptanceId: input.acceptanceId,
      status: "open",
      symptom: input.symptom.trim(),
      evidence,
      openedAt: now,
    });
    state.results[input.acceptanceId] = {
      acceptanceId: input.acceptanceId,
      status: "failed",
      summary: input.symptom.trim(),
      evidence,
      verifiedAt: now,
      epoch: state.verification.epoch,
    };
    state.verification.clean = false;
    setPhase(state, PHASES.REPAIRING, now);
    state.readyAt = null;
    appendHistory(state, "ISSUE_OPENED", now, { issueId: id, acceptanceId: input.acceptanceId });
  } else {
    assert(input.id, "ISSUE_ID_REQUIRED", "Issue ID is required when resolving an issue.");
    const issue = state.issues.find((item) => item.id === input.id);
    assert(issue, "ISSUE_NOT_FOUND", `Issue does not exist: ${input.id}`);
    assert(issue.status === "open", "ISSUE_ALREADY_RESOLVED", `Issue is already resolved: ${input.id}`);
    assert(input.rootCause?.trim(), "ROOT_CAUSE_REQUIRED", "Root cause is required to resolve an issue.");
    assert(splitValues(input.regression).length > 0, "REGRESSION_REQUIRED", "Regression protection is required to resolve an issue.");
    assert(input.invariant?.trim(), "INVARIANT_REQUIRED", "A durable invariant is required to resolve an issue.");
    assert(splitValues(input.paths).length > 0, "IMPACT_PATH_REQUIRED", "At least one affected path is required to resolve an issue.");
    const evidence = await captureEvidence(files.root, input.evidence, evidenceBoundary(state), clock);
    Object.assign(issue, {
      status: "resolved",
      rootCause: input.rootCause.trim(),
      regression: splitValues(input.regression),
      invariant: input.invariant.trim(),
      paths: splitValues(input.paths).map(normalizeImpactPath),
      evidence,
      resolvedAt: now,
    });
    const incident = await createIncident(root, state, issue, input, now);
    issue.memoryId = incident.id;
    invalidateVerification(state, now, issue.id);
    appendHistory(state, "ISSUE_RESOLVED", now, { issueId: issue.id, memoryId: incident.id });
  }

  await atomicWrite(files.issues, renderIssues(state));
  const saved = await saveTask(files, state, clock);
  if (input.status === "resolved") await refreshKnowledgeGraph(root, clock);
  return saved;
}

function invalidateForReopen(state, now, reason) {
  for (const result of Object.values(state.results)) {
    result.previousStatus = result.status;
    result.status = "affected";
    result.summary = `Contract reopened: ${reason}`;
    result.evidence = [];
    result.verifiedAt = null;
  }
  for (const check of Object.values(state.checks)) {
    check.previousStatus = check.status;
    check.status = "affected";
    check.summary = `Contract reopened: ${reason}`;
    check.evidence = [];
    check.verifiedAt = null;
  }
  for (const batch of Object.values(state.uat?.batches ?? {})) {
    batch.previousStatus = batch.status;
    batch.status = "affected";
    batch.evidence = [];
    batch.verifiedAt = null;
  }
  if (state.preflight?.status === "passed") state.preflight.status = "affected";
  state.handoff = { status: "not_prepared", preparedAt: null };
  advanceEpoch(state, now, `contract reopened: ${reason}`);
  state.readyAt = null;
}

export async function reopenAcceptance(root, taskId, reason, clock = () => new Date()) {
  assert(reason?.trim(), "REASON_REQUIRED", "A reason is required to reopen acceptance.");
  const { state, files } = await loadTask(root, taskId);
  assert(state.acceptance.approvedAt, "ACCEPTANCE_NOT_APPROVED", "Acceptance is not currently approved.");
  const now = isoNow(clock);
  invalidateForReopen(state, now, reason.trim());
  state.acceptance.approvedAt = null;
  state.acceptance.sha256 = null;
  state.solution = { approvedAt: null, sha256: null, impactPaths: [], trace: [], stale: true };
  state.reviews = { solution: null, independent: { initialSolutionSha256: null, recheckSolutionSha256: null, lastVerdict: null, unavailable: [] } };
  state.context = { status: "stale", path: state.context?.path ?? null, digest: null, sourceDigests: {} };
  state.affectedDependencies = [];
  state.execution ??= {};
  state.execution.directive = null;
  state.execution.orchestration = orchestrationDefaults();
  const reopenedAuthorizations = [];
  for (const decision of state.decisions ?? []) {
    if (decision.owner !== "authorization" || decision.status !== "resolved") continue;
    // Reopened acceptance means the authorized user-visible behavior may have
    // changed; the authorization must be confirmed again before re-approval.
    decision.status = "pending";
    decision.resolution = null;
    delete decision.resolvedAt;
    delete decision.downstreamInvalidation;
    reopenedAuthorizations.push(decision.id);
  }
  if (reopenedAuthorizations.length > 0) {
    appendHistory(state, "AUTHORIZATION_REOPENED", now, { decisions: reopenedAuthorizations });
  }
  setPhase(state, PHASES.ACCEPTANCE_DRAFT, now);
  appendHistory(state, "ACCEPTANCE_REOPENED", now, { reason: reason.trim() });
  return saveTask(files, state, clock);
}

export async function reopenSolution(root, taskId, reason, clock = () => new Date()) {
  assert(reason?.trim(), "REASON_REQUIRED", "A reason is required to reopen the solution.");
  const { state, files } = await loadTask(root, taskId);
  await assertAcceptanceIntegrity(files, state);
  assert(state.solution.approvedAt, "SOLUTION_NOT_APPROVED", "Solution is not currently approved.");
  const now = isoNow(clock);
  invalidateForReopen(state, now, reason.trim());
  state.solution = { approvedAt: null, sha256: null, impactPaths: [], trace: [], stale: true };
  state.reviews = { solution: null, independent: { initialSolutionSha256: null, recheckSolutionSha256: null, lastVerdict: null, unavailable: [] } };
  state.context = { status: "stale", path: state.context?.path ?? null, digest: null, sourceDigests: {} };
  state.affectedDependencies = [];
  state.execution ??= {};
  state.execution.directive = null;
  state.execution.orchestration = orchestrationDefaults();
  setPhase(state, PHASES.SOLUTION_DRAFT, now);
  appendHistory(state, "SOLUTION_REOPENED", now, { reason: reason.trim() });
  return saveTask(files, state, clock);
}

async function contractErrors(files, state) {
  const errors = [];
  const warnings = [];
  if (state.deliveryVersion >= 3 && state.acceptance.approvedAt) {
    if (state.routing?.status !== "assessed") errors.push("Task depth was not assessed before acceptance approval.");
    const pending = blockingDecisions(state.decisions);
    for (const decision of pending) errors.push(`Blocking decision remains pending: ${decision.id}.`);
  }
  const document = await readUtf8(files.requirement);
  if (state.acceptance.approvedAt) {
    const markdown = acceptanceContract(document);
    const validation = validateAcceptance(markdown);
    errors.push(...validation.errors.map((item) => `Acceptance: ${item}`));
    warnings.push(...validation.warnings.map((item) => `Acceptance: ${item}`));
    if (acceptanceFingerprint(document) !== state.acceptance.sha256) errors.push("Acceptance contract hash does not match the approved version.");
  }
  if (state.solution.approvedAt) {
    const markdown = solutionContract(document);
    const validation = validateSolution(markdown, state.acceptance.items, { progressive: state.deliveryVersion >= 3 });
    errors.push(...validation.errors.map((item) => `Solution: ${item}`));
    warnings.push(...validation.warnings.map((item) => `Solution: ${item}`));
    if (solutionFingerprint(document) !== state.solution.sha256) errors.push("Solution contract hash does not match the approved version.");
    if (state.deliveryVersion >= 3) {
      const review = state.reviews?.solution;
      if (review?.status !== "passed" || review.solutionSha256 !== state.solution.sha256) {
        errors.push("The approved solution lacks a passed review for its current hash.");
      }
      if (state.routing?.lane === "deep" && review?.reviewer !== "independent") {
        const eligibility = independentReviewFallbackEligibility(state, state.solution.sha256);
        const dangerous = authorizationOverlays(state.routing, await projectAuthorizationOverlays(files.root));
        const fallbackDecision = state.reviews?.independent?.fallbackDecision;
        const fallbackAllowed = eligibility.eligible
          && Boolean(review?.fallbackReason)
          && (dangerous.length === 0 || (fallbackDecision?.status === "approved" && fallbackDecision.humanConfirmed === true && fallbackDecision.solutionSha256 === state.solution.sha256));
        if (!fallbackAllowed) errors.push("A Deep task requires an independent solution review or an eligible recorded fallback.");
      }
    }
  }
  return { errors, warnings };
}

async function evidenceErrors(root, state) {
  const errors = [];
  const boundary = evidenceBoundary(state);
  for (const result of Object.values(state.results)) {
    if (["passed", "manual"].includes(result.status) && (result.evidence?.length ?? 0) > 0) {
      errors.push(...(await verifyCapturedEvidence(root, result.evidence, boundary)).map((item) => `${result.acceptanceId}: ${item}`));
    }
  }
  for (const check of Object.values(state.checks)) {
    if (check.status === "passed") {
      errors.push(...(await verifyCapturedEvidence(root, check.evidence, boundary)).map((item) => `Check ${check.name}: ${item}`));
    }
  }
  const executionResults = state.execution?.results ?? {};
  for (const [taskId, result] of Object.entries(executionResults)) {
    const captured = Array.isArray(result.evidence)
      && result.evidence.length > 0
      && result.evidence.every((item) => item && typeof item === "object" && item.path && item.sha256);
    if (result.status === "passed" && captured) {
      errors.push(...(await verifyCapturedEvidence(root, result.evidence, result.recordedAt)).map((item) => `Execution ${taskId}: ${item}`));
    }
  }
  return errors;
}

export async function validateTask(root, taskId) {
  const { state, files } = await loadTask(root, taskId);
  const contract = await contractErrors(files, state);
  const errors = [...contract.errors, ...(await evidenceErrors(files.root, state))];
  return {
    valid: errors.length === 0,
    errors,
    warnings: contract.warnings,
    state,
  };
}

function taskRelativeTarget(files, absolute) {
  const relative = path.relative(path.dirname(files.requirement), absolute).split(path.sep).join("/");
  return relative || path.basename(files.requirement);
}

async function detectedVersion(root, profile) {
  if (profile.application_version && profile.application_version !== "n/a") return profile.application_version;
  try {
    return (await readJson(path.join(root, "package.json"))).version ?? "unspecified";
  } catch (error) {
    if (error?.code !== "FILE_NOT_FOUND") throw error;
    return "unspecified";
  }
}

export async function validateHandoff(state, handoff, files) {
  const errors = [];
  const context = handoff?.context ?? {};
  for (const field of ["version", "environment", "role", "accountReference", "entryPoint", "estimatedMinutes"]) {
    if (context[field] === undefined || context[field] === null || context[field] === "") errors.push(`Handoff context requires ${field}.`);
  }
  if (!Array.isArray(context.prerequisites)) errors.push("Handoff context requires prerequisites.");
  const steps = handoff?.steps ?? [];
  const covered = new Set();
  if (!Array.isArray(steps) || steps.length === 0) errors.push("Handoff requires ordered acceptance steps.");
  for (const [index, step] of steps.entries()) {
    if (step.number !== index + 1) errors.push(`Handoff step ${index + 1} has an invalid number.`);
    if (!step.action?.trim() || !step.expected?.trim()) errors.push(`Handoff step ${index + 1} requires one action and an expected result.`);
    if (!step.checkbox?.includes("Pass") || !step.checkbox?.includes("Fail")) errors.push(`Handoff step ${index + 1} requires pass/fail checkboxes.`);
    covered.add(step.acceptanceId);
  }
  for (const criterion of state.acceptance.items) if (!covered.has(criterion.id)) errors.push(`Handoff does not cover ${criterion.id}.`);
  const links = handoff?.links ?? [];
  if (!Array.isArray(links) || links.length === 0) errors.push("Handoff requires consolidated links.");
  const labels = new Set();
  for (const link of links) {
    if (!link.label || labels.has(link.label)) errors.push(`Handoff link labels must be descriptive and unique: ${link.label || "missing"}.`);
    labels.add(link.label);
    if (link.applicable === false) {
      if (!link.reason?.trim()) errors.push(`Non-applicable link ${link.label} requires a reason.`);
      continue;
    }
    if (!link.target?.trim()) {
      errors.push(`Applicable link ${link.label} requires a target.`);
      continue;
    }
    if (/^https?:\/\//i.test(link.target)) {
      try { new URL(link.target); } catch { errors.push(`Handoff link ${link.label} is not a valid URL.`); }
      continue;
    }
    if (/^(?:git|project):/.test(link.target)) {
      let absolute;
      try { absolute = resolveArtifactPath(files.root, link.target); } catch (error) {
        errors.push(`Handoff link ${link.label} is invalid: ${error.message}`);
        continue;
      }
      if (!(await pathExists(absolute))) errors.push(`Handoff link ${link.label} does not exist: ${link.target}.`);
      continue;
    }
    const absolute = path.resolve(path.dirname(files.requirement), link.target);
    const relative = path.relative(files.root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) errors.push(`Handoff link ${link.label} leaves the project root.`);
    else if (!(await pathExists(absolute))) errors.push(`Handoff link ${link.label} does not exist: ${link.target}.`);
  }
  return { valid: errors.length === 0, errors };
}

export async function prepareHandoff(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, ...DELIVERY_TERMINAL_PHASES], "Handoff preparation");
  await assertContractIntegrity(files, state);
  const environment = input.environment || state.preflight?.environment || "local";
  const { profile } = await loadEnvironmentProfile(root, environment);
  const language = inferHumanLanguage(solutionContract(await readUtf8(files.requirement)), state.requirement);
  const zh = language === "zh-CN";
  const credentialVariables = splitProfileList(profile.credential_variables);
  const evidenceLinks = [];
  for (const criterion of state.acceptance.items) {
    for (const item of state.results[criterion.id]?.evidence ?? []) {
      evidenceLinks.push({
        label: `${criterion.id} ${zh ? "证据" : "evidence"}: ${path.basename(item.path)}`,
        target: item.path,
        applicable: true,
      });
    }
  }
  const links = [
    { label: zh ? "唯一需求交付文档" : "Single requirement delivery document", target: path.basename(files.requirement), applicable: true },
    { label: `${environment} ${zh ? "环境档案" : "environment profile"}`, target: taskRelativeTarget(files, path.join(files.environments, `${environment}.yaml`)), applicable: true },
  ];
  const packageFile = path.join(files.root, "package.json");
  links.push(await pathExists(packageFile)
    ? { label: zh ? "构建与版本元数据" : "Build and version metadata", target: taskRelativeTarget(files, packageFile), applicable: true }
    : { label: zh ? "构建与版本元数据" : "Build and version metadata", target: null, applicable: false, reason: zh ? "项目没有 package.json 元数据。" : "This project has no package.json metadata." });
  let source = null;
  for (const item of state.solution.impactPaths) {
    if (await pathExists(path.join(files.root, item))) { source = item; break; }
  }
  links.push(source && await pathExists(path.join(files.root, source))
    ? { label: zh ? "主要变更代码" : "Primary changed code", target: taskRelativeTarget(files, path.join(files.root, source)), applicable: true }
    : { label: zh ? "主要变更代码" : "Primary changed code", target: null, applicable: false, reason: zh ? "没有可直接链接的本地影响路径。" : "No local impact path is available as a direct link." });
  const readme = path.join(files.root, "README.md");
  links.push(await pathExists(readme)
    ? { label: zh ? "项目文档" : "Project documentation", target: taskRelativeTarget(files, readme), applicable: true }
    : { label: zh ? "项目文档" : "Project documentation", target: null, applicable: false, reason: zh ? "项目没有 README.md。" : "No README.md is present." });
  links.push(profile.entry_url && profile.entry_url !== "n/a"
    ? { label: `${environment} ${zh ? "应用入口" : "application entry"}`, target: profile.entry_url, applicable: true }
    : { label: `${environment} ${zh ? "应用入口" : "application entry"}`, target: null, applicable: false, reason: zh ? "此任务没有浏览器入口 URL。" : "This task has no browser entry URL." });
  links.push(...evidenceLinks);

  const prerequisites = [];
  if (profile.start_command && profile.start_command !== "n/a") prerequisites.push(`${zh ? "启动或验证命令" : "Start the application with"}: ${profile.start_command}`);
  if (profile.fixture && profile.fixture !== "n/a") prerequisites.push(`${zh ? "准备测试数据" : "Prepare fixture"}: ${profile.fixture}`);
  if (profile.integration && profile.integration !== "n/a") prerequisites.push(`${zh ? "验证集成" : "Verify integration"}: ${profile.integration}`);
  if (prerequisites.length === 0) prerequisites.push(zh ? "使用 OpenATDD 已验证的本地工作区与证据。" : "Use the verified local workspace and evidence already prepared by OpenATDD.");
  const handoff = {
    schemaVersion: 1,
    taskId,
    preparedAt: isoNow(clock),
    context: {
      language,
      version: input.version || await detectedVersion(files.root, profile),
      environment,
      role: profile.role || "n/a",
      prerequisites,
      accountReference: credentialVariables.length > 0 ? credentialVariables.join(", ") : "n/a (no login required)",
      entryPoint: profile.entry_url && profile.entry_url !== "n/a" ? profile.entry_url : (zh ? "打开下方详细交付报告。" : "Open the detailed delivery report link below."),
      estimatedMinutes: Number(input.estimatedMinutes ?? Math.max(5, state.acceptance.items.length * 2)),
    },
    steps: state.acceptance.items.map((criterion, index) => ({
      number: index + 1,
      acceptanceId: criterion.id,
      title: criterion.title,
      precondition: criterion.given,
      action: criterion.when,
      expected: criterion.then,
      checkbox: "[ ] Pass  [ ] Fail",
      evidence: (state.results[criterion.id]?.evidence ?? []).map((item) => item.path),
      judgment: criterion.classification === "AUTO"
        ? (zh ? "确认准备的证据与预期结果一致。" : "Confirm the prepared evidence matches the expected result.")
        : (zh ? "此项需要人工判断。" : "A person must make this judgment."),
    })),
    links,
  };
  const validation = await validateHandoff(state, handoff, files);
  assert(validation.valid, "INVALID_HANDOFF", "Detailed delivery handoff is invalid.", { errors: validation.errors });
  await writeJson(files.handoff, handoff);
  state.handoff = { status: "prepared", preparedAt: handoff.preparedAt, estimatedMinutes: handoff.context.estimatedMinutes };
  appendHistory(state, "HANDOFF_PREPARED", handoff.preparedAt, { steps: handoff.steps.length, links: handoff.links.length });
  await saveTask(files, state, clock);
  return { state, files, handoff };
}

export async function readinessErrorsForState(root, state, files, options = {}) {
  const contract = await contractErrors(files, state);
  const errors = [...contract.errors, ...(await evidenceErrors(files.root, state))];
  const boundary = evidenceBoundary(state);

  for (const criterion of state.acceptance.items) {
    const result = state.results[criterion.id];
    if (!result) {
      errors.push(`${criterion.id} has no recorded result.`);
      continue;
    }
    if (["failed", "blocked", "affected"].includes(result.status)) {
      errors.push(`${criterion.id} is ${result.status}.`);
      continue;
    }
    if (criterion.classification === "AUTO" && criterion.blocking && result.status !== "passed") {
      errors.push(`${criterion.id} is a blocking automatic criterion and must pass.`);
    }
    if (criterion.classification === "ASSISTED" && criterion.blocking && (
      state.deliveryVersion >= 3 ? result.status !== "manual" : !["passed", "manual"].includes(result.status)
    )) {
      errors.push(`${criterion.id} is blocking assisted acceptance and must be explicitly handed to human judgment.`);
    }
    if (criterion.classification === "MANUAL" && result.status !== "manual") {
      errors.push(`${criterion.id} must be explicitly handed to human UAT.`);
    }
    if (new Date(result.verifiedAt ?? 0).getTime() < new Date(boundary ?? 0).getTime()) {
      errors.push(`${criterion.id} was not verified after the latest contract or repair boundary.`);
    }
    if (state.deliveryVersion >= 2 && result.epoch !== state.verification.epoch) {
      errors.push(`${criterion.id} belongs to verification epoch ${result.epoch}; current epoch is ${state.verification.epoch}.`);
    }
  }

  const checks = Object.values(state.checks);
  if (checks.length === 0) errors.push("At least one relevant project check must be recorded.");
  for (const check of checks) {
    if (check.status !== "passed") errors.push(`Project check ${check.name} is ${check.status}.`);
    if (state.deliveryVersion >= 2 && check.epoch !== state.verification.epoch) errors.push(`Project check ${check.name} is from a stale verification epoch.`);
  }
  if (state.issues.some((issue) => issue.status === "open")) errors.push("One or more issues remain open.");
  if (state.deliveryVersion >= 2) {
    if (state.preflight?.status !== "passed") errors.push("Automatic environment preflight has not passed.");
    else if (new Date(state.preflight.checkedAt ?? 0).getTime() < new Date(boundary ?? 0).getTime()) errors.push("Automatic environment preflight is stale for the current verification epoch.");
    if (state.handoff?.status !== "prepared" || (!options.handoff && !(await pathExists(files.handoff)))) errors.push("Detailed delivery handoff has not been prepared.");
    else {
      const validation = await validateHandoff(state, options.handoff ?? await readJson(files.handoff), files);
      errors.push(...validation.errors.map((item) => `Handoff: ${item}`));
    }
    if (!checks.some((check) => check.status === "passed" && check.scope === "broad" && check.epoch === state.verification.epoch)) {
      errors.push("A broad project check from the current verification epoch is required after code freeze.");
    }
    const scopeRank = { focused: 0, module: 1, broad: 2 };
    const currentSequence = state.checkSequence.filter((check) => check.epoch === state.verification.epoch && check.status === "passed");
    for (let index = 1; index < currentSequence.length; index += 1) {
      if (scopeRank[currentSequence[index].scope] < scopeRank[currentSequence[index - 1].scope]) {
        errors.push("Project checks must run in focused → module → broad order within the current verification epoch.");
        break;
      }
    }
    const { profile } = await loadEnvironmentProfile(root, state.preflight?.environment || "local");
    if (profile.surface === "web") {
      if (state.uat?.planStatus !== "planned" || !(await pathExists(files.uatPlan))) errors.push("A validated browser UAT plan is required.");
      else {
        const plan = await readJson(files.uatPlan);
        const validation = validateUatPlan(state, plan);
        errors.push(...validation.errors.map((item) => `UAT plan: ${item}`));
        for (const batch of plan.batches) {
          const result = state.uat.batches[batch.id];
          const requiredStatus = batch.runner === "internal" ? "manual" : "passed";
          if (!result || result.status !== requiredStatus || result.epoch !== state.verification.epoch) {
            errors.push(`UAT batch ${batch.id} has not reached ${requiredStatus} in the current epoch.`);
          }
        }
      }
    }
    const credentials = state.preflight?.scope === "project"
      ? await loadScanOnlyCredentials(root, profile.credential_variables)
      : await loadLocalCredentials(root, profile.credential_variables);
    const leaks = await scanEnvironmentArtifacts(root, credentials.secretValues);
    for (const leak of leaks) errors.push(`Secret-like runtime value leaked into persisted artifact: ${path.relative(files.root, leak.path)}.`);
  }

  for (const dependency of state.affectedDependencies) {
    const prior = options.dependencyStates?.get(dependency.taskId) ?? await loadTask(root, dependency.taskId);
    for (const acceptanceId of dependency.acceptanceIds) {
      const result = prior.state.results[acceptanceId];
      if (!result || !["passed", "manual"].includes(result.status)) {
        errors.push(`Affected task ${dependency.taskId}/${acceptanceId} has not been reverified.`);
        continue;
      }
      if (new Date(result.verifiedAt ?? 0).getTime() < new Date(dependency.notBefore).getTime()) {
        errors.push(`Affected task ${dependency.taskId}/${acceptanceId} lacks fresh reverification.`);
      }
      errors.push(...(await verifyCapturedEvidence(files.root, result.evidence, dependency.notBefore)).map(
        (item) => `Affected task ${dependency.taskId}/${acceptanceId}: ${item}`,
      ));
    }
    for (const check of Object.values(prior.state.checks)) {
      if (check.status !== "passed") {
        errors.push(`Affected task ${dependency.taskId} check ${check.name} is ${check.status}.`);
        continue;
      }
      if (new Date(check.verifiedAt ?? 0).getTime() < new Date(dependency.notBefore).getTime()) {
        errors.push(`Affected task ${dependency.taskId} check ${check.name} lacks fresh reverification.`);
      }
      errors.push(...(await verifyCapturedEvidence(files.root, check.evidence, dependency.notBefore)).map(
        (item) => `Affected task ${dependency.taskId} check ${check.name}: ${item}`,
      ));
    }
    if (prior.state.issues.some((issue) => issue.status === "open")) {
      errors.push(`Affected task ${dependency.taskId} still has an open issue.`);
    }
  }
  return errors;
}

function resultTable(state, language = "en") {
  const zh = language === "zh-CN";
  const lines = [zh ? "| 验收 | 类型 | 阻塞 | 状态 | 证据 |" : "| Acceptance | Class | Blocking | Status | Evidence |", "|---|---|---:|---|---|"];
  for (const criterion of state.acceptance.items) {
    const result = state.results[criterion.id];
    const evidence = (result?.evidence ?? []).map((item) => `\`${item.path}\``).join(", ") || "-";
    lines.push(`| ${criterion.id} | ${criterion.classification} | ${criterion.blocking ? (zh ? "是" : "yes") : (zh ? "否" : "no")} | ${result?.status ?? (zh ? "未验证" : "unverified")} | ${evidence} |`);
  }
  return lines.join("\n");
}

function deliveryResultTable(state, language = "en") {
  const zh = language === "zh-CN";
  const lines = [zh ? "| 验收 | 类型 | 状态 | 结果摘要 |" : "| Acceptance | Class | Status | Result summary |", "|---|---|---|---|"];
  for (const criterion of state.acceptance.items) {
    const result = state.results[criterion.id];
    const summary = result?.summary?.replace(/\|/g, "\\|") || (zh ? "尚未验证" : "Not verified yet");
    lines.push(`| ${criterion.id} | ${criterion.classification} | ${result?.status ?? (zh ? "未验证" : "unverified")} | ${summary} |`);
  }
  return lines.join("\n");
}

function renderChineseTaskReport(state, handoff = null) {
  const checks = Object.values(state.checks);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const manualIds = new Set(state.acceptance.items
    .filter((item) => item.classification !== "AUTO" && item.blocking)
    .map((item) => item.id));
  const manualSteps = (handoff?.steps ?? []).filter((step) => manualIds.has(step.acceptanceId));
  const lines = [`# 交付报告：${state.taskId}`, ""];
  if (handoff) {
    lines.push(
      "## 从这里开始",
      "",
      `- 版本：${handoff.context.version}`,
      `- 环境：${handoff.context.environment}`,
      `- 角色：${handoff.context.role}`,
      `- 安全账户引用：${handoff.context.accountReference}`,
      `- 入口：${/^https?:\/\//.test(handoff.context.entryPoint) ? `[打开应用](${handoff.context.entryPoint})` : handoff.context.entryPoint}`,
      `- 预计时间：${handoff.context.estimatedMinutes} 分钟`,
      `- 验证 epoch：${state.verification.epoch}`,
      "",
      "### 前置条件",
      "",
      ...handoff.context.prerequisites.map((item) => `- ${item}`),
      "",
    );
    if (manualSteps.length > 0) {
      lines.push(
        "## 建议人工 UAT",
        "",
        "以下结果无法由 AI 完整判断。请按顺序检查；全部符合无需回复，任何一步失败时请返回步骤号、实际结果和相关截图。",
        "",
      );
      for (const step of manualSteps) {
        lines.push(
          `### 第 ${step.number} 步 — ${step.acceptanceId}：${step.title}`,
          "",
          `- 前提：${step.precondition}`,
          `- 操作：${step.action}`,
          `- 预期结果：${step.expected}`,
          `- 检查记录：${step.checkbox}`,
          `- 判断方式：${step.judgment}`,
          `- 已准备证据：${step.evidence.length > 0 ? step.evidence.map((target) => `\`${target}\``).join(", ") : "无独立证据文件；请判断上述可观察结果。"}`,
          "",
        );
      }
    } else {
      lines.push(
        "## 自动验证已完成",
        "",
        "本次交付没有必须由人重复执行的 UAT 步骤。请按需查看下方实际结果与证据；没有异议无需回复。",
        "",
      );
    }
    lines.push("## 相关链接", "");
    for (const link of handoff.links) {
      lines.push(link.applicable === false ? `- ${link.label}：不适用 — ${link.reason}` : `- [${link.label}](${link.target})`);
    }
    lines.push("", "## 交付证据摘要", "");
  }
  lines.push(
    `- 需求：${state.requirement}`,
    `- 阶段：${state.phase}`,
    `- 验收批准时间：${state.acceptance.approvedAt}`,
    `- 方案批准时间：${state.solution.approvedAt}`,
    `- 交付时间：${state.readyAt ?? "尚未交付"}`,
    "",
    "### 验收结果",
    "",
    resultTable(state, "zh-CN"),
    "",
    "### 项目检查",
    "",
  );
  if (checks.length === 0) lines.push("没有记录项目检查。");
  else for (const check of checks) lines.push(`- ${check.name} [${check.scope}]：**${check.status}** — \`${check.command}\`${check.durationMs === null ? "" : ` — ${check.durationMs} ms`}`);
  lines.push("", "### 修复", "");
  const resolved = state.issues.filter((issue) => issue.status === "resolved");
  if (resolved.length === 0) lines.push("本次交付未解决已记录缺陷。");
  else for (const issue of resolved) lines.push(`- ${issue.id}：${issue.rootCause}（${issue.memoryId}）`);
  lines.push("", "### 受影响的历史验收", "");
  if (state.affectedDependencies.length === 0) lines.push("没有历史任务受到影响。");
  else for (const item of state.affectedDependencies) lines.push(`- ${item.taskId}：${item.acceptanceIds.join(", ")}`);
  lines.push("", "### 人工关注项", "");
  if (manual.length === 0) lines.push("没有需要人工判断的验收项。");
  else for (const item of manual) lines.push(`- ${item.id} [${item.classification}]：${item.title}`);
  lines.push("", "### 性能观察", "");
  lines.push(`- 环境预检：${state.preflight?.durationMs ?? "未记录"} ms`);
  lines.push(`- 预计浏览器往返：${state.uat?.estimatedRoundTrips ?? "未记录"}`);
  const stageTiming = projectStageTiming(state, state.readyAt ?? state.updatedAt);
  for (const [stage, timing] of Object.entries(stageTiming.stages)) lines.push(`- ${stage}：${timing.durationMs} ms`);
  lines.push(`- Reviewer 归因：${stageTiming.attribution.reviewerDurationMs} ms`);
  lines.push(`- Worker 归因：${stageTiming.attribution.workerDurationMs} ms`);
  lines.push(`- Finalization 归因：${stageTiming.attribution.finalizationDurationMs} ms`);
  for (const warning of [...(state.preflight?.warnings ?? []), ...(state.uat?.warnings ?? [])]) lines.push(`- 警告：${warning}`);
  for (const phase of state.timing?.phases ?? []) lines.push(`- ${phase.phase}：${phase.durationMs} ms`);
  return `${lines.join("\n")}\n`;
}

export function renderTaskReport(state, handoff = null) {
  const language = handoff?.context?.language ?? inferHumanLanguage(state.requirement, state.acceptance.items.map((item) => item.title));
  if (language === "zh-CN") return renderChineseTaskReport(state, handoff);
  const checks = Object.values(state.checks);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const manualIds = new Set(state.acceptance.items
    .filter((item) => item.classification !== "AUTO" && item.blocking)
    .map((item) => item.id));
  const manualSteps = (handoff?.steps ?? []).filter((step) => manualIds.has(step.acceptanceId));
  const lines = [
    `# Delivery report: ${state.taskId}`,
    "",
  ];
  if (handoff) {
    lines.push(
      "## Start here",
      "",
      `- Version: ${handoff.context.version}`,
      `- Environment: ${handoff.context.environment}`,
      `- Role: ${handoff.context.role}`,
      `- Safe account reference: ${handoff.context.accountReference}`,
      `- Entry point: ${/^https?:\/\//.test(handoff.context.entryPoint) ? `[open application](${handoff.context.entryPoint})` : handoff.context.entryPoint}`,
      `- Estimated time: ${handoff.context.estimatedMinutes} minutes`,
      `- Verification epoch: ${state.verification.epoch}`,
      "",
      "### Prerequisites",
      "",
      ...handoff.context.prerequisites.map((item) => `- ${item}`),
      "",
    );
    if (manualSteps.length > 0) {
      lines.push(
        "## Suggested human UAT",
        "",
        "AI cannot fully judge the following outcomes. Check them in order; no reply is needed when all pass. If one fails, return its step number, the observed result, and any screenshot.",
        "",
      );
      for (const step of manualSteps) {
        lines.push(
          `### Step ${step.number} — ${step.acceptanceId}: ${step.title}`,
          "",
          `- Precondition: ${step.precondition}`,
          `- Action: ${step.action}`,
          `- Expected result: ${step.expected}`,
          `- Check record: ${step.checkbox}`,
          `- Judgment: ${step.judgment}`,
          `- Prepared evidence: ${step.evidence.length > 0 ? step.evidence.map((target) => `\`${target}\``).join(", ") : "No separate evidence file; judge the stated observable result."}`,
          "",
        );
      }
    } else {
      lines.push(
        "## Automatic verification complete",
        "",
        "This delivery has no UAT step that a person must repeat. Inspect the results and evidence below as needed; no reply is required when there is no objection.",
        "",
      );
    }
    lines.push("## Relevant links", "");
    for (const link of handoff.links) {
      lines.push(link.applicable === false ? `- ${link.label}: not applicable — ${link.reason}` : `- [${link.label}](${link.target})`);
    }
    lines.push("", "## Delivery evidence summary", "");
  }
  lines.push(
    `- Requirement: ${state.requirement}`,
    `- Phase: ${state.phase}`,
    `- Acceptance approved: ${state.acceptance.approvedAt}`,
    `- Solution approved: ${state.solution.approvedAt}`,
    `- Delivered at: ${state.readyAt ?? "not delivered"}`,
    "",
    "### Acceptance results",
    "",
    resultTable(state),
    "",
    "### Project checks",
    "",
  );
  if (checks.length === 0) lines.push("No checks recorded.");
  else {
    for (const check of checks) lines.push(`- ${check.name} [${check.scope}]: **${check.status}** — \`${check.command}\`${check.durationMs === null ? "" : ` — ${check.durationMs} ms`}`);
  }
  lines.push("", "### Repairs", "");
  const resolved = state.issues.filter((issue) => issue.status === "resolved");
  if (resolved.length === 0) lines.push("No recorded defects were resolved during this delivery.");
  else {
    for (const issue of resolved) lines.push(`- ${issue.id}: ${issue.rootCause} (${issue.memoryId})`);
  }
  lines.push("", "### Affected historical acceptance", "");
  if (state.affectedDependencies.length === 0) lines.push("No historical tasks were affected.");
  else {
    for (const item of state.affectedDependencies) lines.push(`- ${item.taskId}: ${item.acceptanceIds.join(", ")}`);
  }
  lines.push("", "### Human attention", "");
  if (manual.length === 0) lines.push("No acceptance criteria require human judgment.");
  else {
    for (const item of manual) lines.push(`- ${item.id} [${item.classification}]: ${item.title}`);
  }
  lines.push("", "### Performance observations", "");
  lines.push(`- Environment preflight: ${state.preflight?.durationMs ?? "not recorded"} ms`);
  lines.push(`- Estimated browser round trips: ${state.uat?.estimatedRoundTrips ?? "not recorded"}`);
  const stageTiming = projectStageTiming(state, state.readyAt ?? state.updatedAt);
  for (const [stage, timing] of Object.entries(stageTiming.stages)) lines.push(`- ${stage}: ${timing.durationMs} ms`);
  lines.push(`- Reviewer attribution: ${stageTiming.attribution.reviewerDurationMs} ms`);
  lines.push(`- Worker attribution: ${stageTiming.attribution.workerDurationMs} ms`);
  lines.push(`- Finalization attribution: ${stageTiming.attribution.finalizationDurationMs} ms`);
  for (const warning of [...(state.preflight?.warnings ?? []), ...(state.uat?.warnings ?? [])]) lines.push(`- Warning: ${warning}`);
  for (const phase of state.timing?.phases ?? []) lines.push(`- ${phase.phase}: ${phase.durationMs} ms`);
  return `${lines.join("\n")}\n`;
}

function mergeRecommendation(state) {
  const humanPending = state.acceptance.items.some((item) => (
    item.blocking
    && item.classification !== "AUTO"
    && state.results[item.id]?.humanStatus !== "passed"
  ));
  const scopeDrift = state.delivery?.scopeDrift ?? [];
  if (scopeDrift.length > 0) return { humanPending, mergeable: false, reason: "scope-drift" };
  if (!isDeliveryTerminalPhase(state.phase)) return { humanPending, mergeable: false, reason: "not-delivered" };
  return { humanPending, mergeable: !humanPending, reason: humanPending ? "human-acceptance" : "ready" };
}

export function renderDeliverySection(state, handoff = null) {
  const language = handoff?.context?.language ?? inferHumanLanguage(state.requirement, state.acceptance.items.map((item) => item.title));
  const zh = language === "zh-CN";
  const recommendation = mergeRecommendation(state);
  const humanIds = new Set(state.acceptance.items.filter((item) => item.blocking && item.classification !== "AUTO").map((item) => item.id));
  const humanSteps = (handoff?.steps ?? []).filter((step) => humanIds.has(step.acceptanceId));
  const changedFiles = state.delivery?.changedFiles ?? [];
  const scopeDrift = state.delivery?.scopeDrift ?? [];
  const checks = Object.values(state.checks ?? {});
  const status = recommendation.humanPending
    ? (zh ? "等待人工验收" : "Waiting for human acceptance")
    : isDeliveryTerminalPhase(state.phase)
      ? (zh ? "已验收" : "Accepted")
      : (zh ? "交付处理中" : "Delivery in progress");
  const merge = recommendation.reason === "scope-drift"
    ? (zh ? "不可合并：存在计划外变更" : "Do not merge: scope drift exists")
    : recommendation.humanPending
      ? (zh ? "人工验收通过后可合并" : "Merge after human acceptance passes")
      : recommendation.mergeable
        ? (zh ? "可以合并" : "Ready to merge")
        : (zh ? "暂不可合并" : "Do not merge yet");
  const lines = [
    zh ? "## 状态与合并建议" : "## Status and merge recommendation",
    "",
    `- ${zh ? "状态" : "Status"}：${status}`,
    `- ${zh ? "合并建议" : "Merge recommendation"}：${merge}`,
    "",
    zh ? "## 交付结论" : "## Delivery conclusion",
    "",
    isDeliveryTerminalPhase(state.phase)
      ? (zh ? `自动验证已完成，验证 epoch 为 ${state.verification.epoch}。` : `Automatic verification is complete for epoch ${state.verification.epoch}.`)
      : (zh ? "需求正在按批准契约实施和验证。" : "The requirement is being implemented and verified against the approved contracts."),
    "",
    zh ? "## 人工验收入口" : "## Human acceptance entry",
    "",
  ];
  if (humanSteps.length > 0 && handoff) {
    lines.push(
      `- ${zh ? "环境" : "Environment"}：${handoff.context.environment}`,
      `- ${zh ? "入口" : "Entry point"}：${handoff.context.entryPoint}`,
      `- ${zh ? "身份" : "Identity / role"}：${handoff.context.role}`,
      `- ${zh ? "凭据变量" : "Credential variables"}：${handoff.context.accountReference}`,
      `- ${zh ? "预计时间" : "Estimated time"}：${handoff.context.estimatedMinutes} ${zh ? "分钟" : "minutes"}`,
      "",
      zh ? "### 前置条件" : "### Prerequisites",
      "",
      ...handoff.context.prerequisites.map((item) => `- ${item}`),
      "",
      zh ? "### 操作步骤" : "### Ordered steps",
      "",
    );
    for (const step of humanSteps) {
      lines.push(
        `${step.number}. **${step.acceptanceId} — ${step.title}**`,
        `   - ${zh ? "操作" : "Action"}：${step.action}`,
        `   - ${zh ? "预期" : "Expected"}：${step.expected}`,
        `   - ${zh ? "人工判断" : "Human judgment"}：${step.judgment}`,
      );
    }
    lines.push("", zh ? "失败反馈：请回复失败步骤、实际结果和必要截图，任务会沿同一 issue/repair 链路重新打开。" : "Failure feedback: report the failed step, observed result, and any necessary screenshot; the same task will reopen through its issue/repair flow.", "");
  } else {
    lines.push(zh ? "本次没有阻塞的 MANUAL 或 ASSISTED 项，无需人工重复自动测试。" : "There are no blocking MANUAL or ASSISTED items; a person does not need to repeat the automatic tests.", "");
  }
  lines.push(
    zh ? "## Reviewer 重点" : "## Reviewer focus",
    "",
    `- ${zh ? "范围漂移" : "Scope drift"}：${scopeDrift.length ? scopeDrift.join(", ") : (zh ? "无计划外变更" : "none")}`,
    `- ${zh ? "未完成检查" : "Incomplete checks"}：${checks.filter((item) => item.status !== "passed").map((item) => item.name).join(", ") || (zh ? "无" : "none")}`,
    `- ${zh ? "回滚" : "Rollback"}：${zh ? "还原下方实际变更文件，并删除本需求的 Git 私有运行目录。" : "Revert the actual changed files below and remove this task's Git-private runtime directory."}`,
    "",
    zh ? "## 实际变更与验收摘要" : "## Actual changes and acceptance summary",
    "",
  );
  if (changedFiles.length) lines.push(...changedFiles.map((item) => `- ${typeof item === "string" ? item : `${item.status ?? "M"} ${item.path}`}`));
  else lines.push(zh ? "- 尚未记录产品文件变更。" : "- No product-file changes have been recorded yet.");
  const cleanup = state.execution?.orchestration?.cleanup;
  if (cleanup?.attemptedAt) {
    lines.push(
      "",
      zh ? "### Worktree 清理" : "### Worktree cleanup",
      "",
      `- ${zh ? "结果" : "Result"}：${cleanup.status}`,
      `- ${zh ? "汇总" : "Summary"}：cleaned ${cleanup.summary?.cleaned ?? 0}, retained ${cleanup.summary?.retained ?? 0}, failed ${cleanup.summary?.failed ?? 0}`,
    );
    for (const item of cleanup.items ?? []) lines.push(`- ${item.status}: ${item.worktree ?? item.sessionId} (${item.reason})`);
  }
  lines.push("", deliveryResultTable(state, language));
  return `${lines.join("\n")}\n`;
}

export function renderRequirementDocument(document, state, handoff = null) {
  return replaceRequirementSection(document, "delivery", renderDeliverySection(state, handoff));
}

export function renderTaskNotification(state, handoff = null) {
  const automatic = state.acceptance.items.filter((item) => item.classification === "AUTO" && item.blocking);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const manualUat = state.acceptance.items.filter((item) => item.classification === "MANUAL" && item.blocking);
  const context = handoff?.context;
  const language = context?.language ?? inferHumanLanguage(state.requirement, state.acceptance.items.map((item) => item.title));
  if (language === "zh-CN") {
    return `# 交付通知草稿\n\n${state.taskId} 已完成 AI 验证并交付。\n\n- 需求：${state.requirement}\n- 版本：${context?.version ?? "见报告"}\n- 环境 / 角色：${context ? `${context.environment} / ${context.role}` : "见报告"}\n- 入口：${context?.entryPoint ?? "见报告"}\n- 自动阻塞项：${automatic.length}/${automatic.length} 已通过\n- [打开交付报告](report.md)\n- 人工关注项：${manual.length}\n- 建议人工 UAT 步骤：${manualUat.length}\n\n${manualUat.length > 0 ? "请按需完成报告中的人工 UAT；全部符合无需回复，发现问题时请返回步骤和实际结果。" : "无需重复自动测试；没有异议无需回复，发现问题时请直接描述实际结果。"}\n这是一份草稿；只有在已有授权的渠道中才可发送。\n`;
  }
  return `# Delivery notification draft\n\n${state.taskId} has completed AI verification and been delivered.\n\n- Requirement: ${state.requirement}\n- Version: ${context?.version ?? "see report"}\n- Environment / role: ${context ? `${context.environment} / ${context.role}` : "see report"}\n- Entry point: ${context?.entryPoint ?? "see report"}\n- Automatic blockers: ${automatic.length}/${automatic.length} passed\n- [Open the delivery report](report.md)\n- Human-attention items: ${manual.length}\n- Suggested human UAT steps: ${manualUat.length}\n\n${manualUat.length > 0 ? "Complete the human UAT as needed; no reply is required when all steps pass. Report the step and observed result when one fails." : "Do not repeat the automatic tests; no reply is required when there is no objection. Describe the observed result if a problem appears."}\nThis is a draft; send it only through an already-authorized channel.\n`;
}

export async function markReady(root, taskId, clock = () => new Date()) {
  let { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.PRE_UAT, ...DELIVERY_TERMINAL_PHASES], "Delivery readiness");
  await assertContractIntegrity(files, state);
  if (state.deliveryVersion >= 2 && (state.handoff?.status !== "prepared" || !(await pathExists(files.handoff)))) {
    await prepareHandoff(root, taskId, {}, clock);
    ({ state, files } = await loadTask(root, taskId));
  }
  const errors = await readinessErrorsForState(root, state, files);
  assert(errors.length === 0, "READINESS_BLOCKED", "Task is not ready for delivery.", { errors });
  const now = isoNow(clock);
  setPhase(state, PHASES.DELIVERED, now);
  state.readyAt = now;
  appendHistory(state, "DELIVERED", now);
  await saveTask(files, state, clock);
  const handoff = state.deliveryVersion >= 2 ? await readJson(files.handoff) : null;
  const document = await readUtf8(files.requirement);
  await atomicWrite(files.requirement, renderRequirementDocument(document, state, handoff));
  await atomicWrite(files.notification, renderTaskNotification(state, handoff));
  return { state, files };
}

export async function writeReport(root, taskId) {
  const { state, files } = await loadTask(root, taskId);
  const handoff = await pathExists(files.handoff) ? await readJson(files.handoff) : null;
  const document = await readUtf8(files.requirement);
  await atomicWrite(files.requirement, renderRequirementDocument(document, state, handoff));
  if (isDeliveryTerminalPhase(state.phase)) await atomicWrite(files.notification, renderTaskNotification(state, handoff));
  return { state, files };
}

export async function recordEnvironmentObservation(root, environment, input, clock = () => new Date()) {
  await initProject(root);
  const result = await observeEnvironment(root, environment, input, clock);
  await refreshKnowledgeGraph(root, clock);
  return result;
}

export async function rebuildKnowledgeGraph(root, clock = () => new Date()) {
  await initProject(root);
  return buildGraph(root, { persist: true, clock });
}

export async function searchKnowledgeGraph(root, query, options = {}) {
  await initProject(root);
  const graph = await loadGraph(root);
  const projectTruth = graph.nodes.find((node) => node.type === "ProjectTruth" && !node.stale);
  return {
    graph: {
      schemaVersion: graph.schemaVersion,
      builtAt: graph.builtAt,
      contentDigest: graph.contentDigest,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      warnings: graph.warnings,
      loadStatus: graph.loadStatus,
      projectTruth: projectTruth?.source?.path ? {
        title: projectTruth.title,
        path: projectTruth.source.path,
        sha256: projectTruth.source.sha256,
        size: projectTruth.source.size,
      } : null,
    },
    ...queryGraph(graph, query, options),
  };
}

export async function analyzeKnowledgeImpact(root, taskId, impactPaths = []) {
  await initProject(root);
  return safeImpactAnalysis(root, { taskId, impactPaths });
}

export async function prepareTaskContext(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  const lane = input.lane ?? state.routing?.lane ?? "standard";
  const persist = input.persist ?? lane !== "quick";
  const context = await buildScopedContext(root, taskId, {
    lane,
    query: input.query,
    persist,
    clock,
  });
  state.context = {
    status: "prepared",
    path: persist ? artifactLocator(files.root, files.contextFile) : null,
    digest: context.digest,
    sourceDigests: context.sourceDigests,
  };
  appendHistory(state, "SCOPED_CONTEXT_PREPARED", isoNow(clock), {
    lane: context.lane,
    persisted: persist,
    implementationReferences: context.implementation.length,
    verificationReferences: context.verification.length,
  });
  await saveTask(files, state, clock);
  return { state, files, context };
}

export async function getTaskContext(root, taskId, input = {}) {
  const { state } = await loadTask(root, taskId);
  const lane = input.lane ?? state.routing?.lane ?? "standard";
  return loadScopedContext(root, taskId, {
    lane,
    persist: Boolean(input.persist),
  });
}

export async function searchMemory(root, query, limit = 10) {
  await initProject(root);
  const files = projectFiles(root);
  const index = await readJson(files.memoryIndex);
  const terms = tokenize(query);
  const matches = index.incidents
    .map((incident) => {
      const searchable = JSON.stringify(incident).toLowerCase();
      const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
      return { score, ...incident };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
  const observations = await readJson(files.environmentObservations);
  const environmentMatches = observations.observations
    .map((observation) => {
      const searchable = JSON.stringify(observation).toLowerCase();
      const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
      return { score, ...observation };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.last_verified_at.localeCompare(left.last_verified_at))
    .slice(0, limit);
  return { query, terms, matches, environmentMatches };
}

/**
 * Return the memory and graph hits relevant to a requirement so `new` and
 * `assess` can inline them instead of costing two extra query round trips.
 * Knowledge lookup failure degrades to empty matches with a warning; it never
 * blocks routing or delivery.
 */
export async function relatedKnowledge(root, query, limit = 5) {
  const knowledge = {
    query,
    memory: { matches: [], environmentMatches: [] },
    graph: { matches: [], projectTruth: null },
    warnings: [],
  };
  try {
    const memory = await searchMemory(root, query, limit);
    knowledge.memory = { matches: memory.matches, environmentMatches: memory.environmentMatches };
  } catch (error) {
    knowledge.warnings.push(`Memory lookup unavailable: ${error.message}`);
  }
  try {
    const graph = await searchKnowledgeGraph(root, query, { limit });
    knowledge.graph = {
      matches: graph.matches.filter((match) => match.node.type !== "ProjectTruth"),
      projectTruth: graph.graph.projectTruth,
    };
  } catch (error) {
    knowledge.warnings.push(`Graph lookup unavailable: ${error.message}`);
  }
  return knowledge;
}

export function summarizeState(state) {
  const orchestration = state.execution?.orchestration ?? orchestrationDefaults();
  return {
    taskId: state.taskId,
    requirement: state.requirement,
    phase: state.phase,
    acceptanceApproved: Boolean(state.acceptance.approvedAt),
    solutionApproved: Boolean(state.solution.approvedAt),
    routing: state.routing,
    decisions: state.decisions,
    solutionReview: state.reviews?.solution ?? null,
    independentReview: state.reviews?.independent ?? null,
    agents: state.agents,
    execution: state.execution,
    directive: state.execution?.directive ?? null,
    orchestration: summarizeOrchestrationFallback(orchestration),
    context: state.context,
    repair: state.repair,
    acceptance: state.acceptance.items.map((item) => ({
      id: item.id,
      classification: item.classification,
      blocking: item.blocking,
      status: state.results[item.id]?.status ?? "unverified",
    })),
    checks: Object.values(state.checks).map((check) => ({
      name: check.name,
      status: check.status,
      scope: check.scope,
      sourceFingerprint: check.sourceFingerprint,
      durationMs: check.durationMs,
      epoch: check.epoch,
    })),
    schemaVersion: state.schemaVersion,
    deliveryVersion: state.deliveryVersion,
    verificationEpoch: state.verification?.epoch,
    preflight: state.preflight,
    uat: state.uat,
    handoff: state.handoff,
    timing: state.timing,
    stageTiming: projectStageTiming(state),
    openIssues: state.issues.filter((issue) => issue.status === "open").map((issue) => issue.id),
    affectedDependencies: state.affectedDependencies,
    readyAt: state.readyAt,
  };
}
