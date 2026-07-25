import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  asArray,
  assert,
  assertTaskId,
  atomicWrite,
  captureEvidence,
  inferHumanLanguage,
  isoNow,
  normalizeImpactPath,
  pathExists,
  readJson,
  readUtf8,
  tokenize,
  verifyCapturedEvidence,
  writeJson,
} from "./lib.mjs";
import {
  acceptanceTemplate,
  fingerprint,
  solutionTemplate,
  validateAcceptance,
  validateSolution,
} from "./contracts.mjs";
import { classifyTask } from "./routing.mjs";
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
  observeEnvironment,
  runEnvironmentPreflight,
  scanEnvironmentArtifacts,
  splitProfileList,
} from "./profiles.mjs";

export const PHASES = Object.freeze({
  ACCEPTANCE_DRAFT: "ACCEPTANCE_DRAFT",
  ACCEPTANCE_APPROVED: "ACCEPTANCE_APPROVED",
  SOLUTION_DRAFT: "SOLUTION_DRAFT",
  CONTRACT_APPROVED: "CONTRACT_APPROVED",
  IMPLEMENTING: "IMPLEMENTING",
  PRE_UAT: "PRE_UAT",
  REPAIRING: "REPAIRING",
  BLOCKED: "BLOCKED",
  READY_FOR_UAT: "READY_FOR_UAT",
});

export const SOLUTION_REVIEW_CHECKS = Object.freeze([
  "simplicity",
  "project-fit",
  "summary-detail-consistency",
  "hidden-material-choices",
  "acceptance-trace",
  "unnecessary-infrastructure",
]);

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
`;

const INVARIANTS_TEMPLATE = `# Project invariants

Record durable rules discovered while resolving real defects. Keep this file
small; use the incident index for details.
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
    routing: { status: "not_assessed", lane: null, reasons: [], investigation: { externalResearch: false }, agents: { roles: [] } },
    decisions: [],
    reviews: { solution: null },
    agents: { dispatches: [] },
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

function migrateState(persisted) {
  assert([1, 2, 3].includes(persisted.schemaVersion), "UNSUPPORTED_STATE", `Unsupported task state version: ${persisted.schemaVersion}`);
  const state = structuredClone(persisted);
  const legacy = state.schemaVersion === 1;
  const boundary = state.verificationNotBefore ?? state.solution?.approvedAt ?? state.createdAt;
  state.schemaVersion = 3;
  state.deliveryVersion ??= legacy ? 1 : 2;
  state.verification ??= { epoch: 1, startedAt: boundary, clean: !state.issues?.some((issue) => issue.status === "open") };
  state.verification.epoch ??= 1;
  state.verification.startedAt ??= boundary;
  state.verification.clean ??= !state.issues?.some((issue) => issue.status === "open");
  state.results ??= {};
  state.checks ??= {};
  for (const result of Object.values(state.results)) result.epoch ??= state.verification.epoch;
  for (const check of Object.values(state.checks)) {
    check.epoch ??= state.verification.epoch;
    check.scope ??= "broad";
    check.sourceFingerprint ??= "legacy";
  }
  state.checkSequence ??= Object.values(state.checks).map((check) => ({
    id: check.id,
    scope: check.scope,
    status: check.status,
    verifiedAt: check.verifiedAt,
    sourceFingerprint: check.sourceFingerprint,
    epoch: check.epoch,
  }));
  state.preflight ??= legacy
    ? { status: "not_required", environment: "local", checkedAt: null, warnings: [] }
    : { status: "not_run", environment: "local", checkedAt: null, warnings: [] };
  state.uat ??= { planStatus: legacy ? "not_required" : "not_planned", batches: {}, warnings: [] };
  state.uat.batches ??= {};
  state.uat.warnings ??= [];
  state.handoff ??= legacy
    ? { status: "legacy", preparedAt: null }
    : { status: "not_prepared", preparedAt: null };
  state.timing ??= { currentPhase: state.phase, phaseStartedAt: state.updatedAt ?? state.createdAt, phases: [] };
  state.timing.phases ??= [];
  state.finalization ??= { status: "not_started", version: 1 };
  state.routing ??= { status: "not_assessed", lane: null, reasons: [], investigation: { externalResearch: false }, agents: { roles: [] } };
  state.routing.reasons ??= [];
  state.routing.investigation ??= { externalResearch: false };
  state.routing.agents ??= { roles: [] };
  state.decisions ??= [];
  state.reviews ??= { solution: null };
  state.reviews.solution ??= null;
  state.agents ??= { dispatches: [] };
  state.agents.dispatches ??= [];
  state.context ??= { status: "not_prepared", path: null, digest: null, sourceDigests: {} };
  state.context.sourceDigests ??= {};
  state.repair ??= { attempts: [], lastProgressFingerprint: null, lastHypothesis: null, consecutiveNoProgress: 0 };
  state.repair.attempts ??= [];
  state.repair.lastHypothesis ??= null;
  state.repair.consecutiveNoProgress ??= 0;
  state.history ??= [];
  return state;
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
  return {
    root: projectRoot,
    openatdd,
    config: path.join(openatdd, "config.yaml"),
    tasks: path.join(openatdd, "tasks"),
    memory: path.join(openatdd, "memory"),
    incidents: path.join(openatdd, "memory", "incidents"),
    invariants: path.join(openatdd, "memory", "invariants.md"),
    memoryIndex: path.join(openatdd, "memory", "index.json"),
    knowledge: path.join(openatdd, "knowledge"),
    standards: path.join(openatdd, "knowledge", "standards"),
    research: path.join(openatdd, "knowledge", "research"),
    knowledgeGraph: path.join(openatdd, "knowledge", "graph.json"),
    environments: path.join(openatdd, "environments"),
    environmentObservations: path.join(openatdd, "environments", "observations.json"),
    dotenv: path.join(projectRoot, ".env.openatdd.local"),
    dotenvExample: path.join(projectRoot, ".env.openatdd.example"),
    finalizationManifest: path.join(openatdd, "finalization.json"),
    transactions: path.join(openatdd, "transactions"),
    reverificationIndex: path.join(openatdd, "reverification", "index.json"),
  };
}

export function taskFiles(root, taskId) {
  assertTaskId(taskId);
  const project = projectFiles(root);
  const task = path.join(project.tasks, taskId);
  return {
    ...project,
    task,
    acceptance: path.join(task, "acceptance.md"),
    solution: path.join(task, "solution.md"),
    state: path.join(task, "state.json"),
    issues: path.join(task, "issues.md"),
    evidence: path.join(task, "evidence"),
    report: path.join(task, "report.md"),
    notification: path.join(task, "notification.md"),
    preflight: path.join(task, "preflight.json"),
    uatPlan: path.join(task, "uat-plan.json"),
    handoff: path.join(task, "handoff.json"),
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
  await mkdir(files.tasks, { recursive: true });
  await mkdir(files.incidents, { recursive: true });
  await mkdir(files.standards, { recursive: true });
  await mkdir(files.research, { recursive: true });
  if (!(await pathExists(files.config))) await atomicWrite(files.config, CONFIG_TEMPLATE);
  if (!(await pathExists(files.invariants))) await atomicWrite(files.invariants, INVARIANTS_TEMPLATE);
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
  assert(!(await pathExists(files.task)), "TASK_EXISTS", `Task already exists: ${taskId}`);
  await mkdir(files.evidence, { recursive: true });
  const now = isoNow(clock);
  await atomicWrite(files.acceptance, acceptanceTemplate(taskId, requirement.trim()));
  await atomicWrite(files.issues, renderIssues(initialState(taskId, requirement.trim(), now)));
  await writeJson(files.state, initialState(taskId, requirement.trim(), now));
  return loadTask(root, taskId);
}

export async function adoptTask(root, taskId, requirement, clock = () => new Date()) {
  assertTaskId(taskId);
  assert(requirement?.trim(), "REQUIREMENT_REQUIRED", "A one-line requirement is required.");
  await initProject(root);
  const files = taskFiles(root, taskId);
  assert(await pathExists(files.acceptance), "ACCEPTANCE_NOT_FOUND", `Cannot adopt ${taskId} without acceptance.md.`);
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
  assert(await pathExists(files.state), "TASK_NOT_FOUND", `OpenATDD task does not exist: ${taskId}`);
  const persisted = await readJson(files.state);
  const state = migrateState(persisted);
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

async function loadContextForState(root, state, files, input = {}) {
  const lane = input.lane ?? state.routing?.lane ?? "standard";
  const persist = input.persist ?? lane !== "quick";
  const surface = input.surface ?? "implementation";
  assert(["implementation", "verification"].includes(surface), "INVALID_CONTEXT_SURFACE", `Unknown context surface: ${surface}`);
  const context = await loadScopedContext(root, state.taskId, { lane, persist });
  state.context = {
    status: "prepared",
    path: persist ? path.relative(files.root, files.contextFile).split(path.sep).join("/") : null,
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
  const markdown = await readUtf8(files.acceptance);
  assert(
    fingerprint(markdown) === state.acceptance.sha256,
    "ACCEPTANCE_DRIFT",
    "acceptance.md changed after approval. Reopen acceptance before changing it.",
  );
  return markdown;
}

async function assertSolutionIntegrity(files, state) {
  assert(state.solution.approvedAt, "SOLUTION_NOT_APPROVED", "Solution has not been approved.");
  const markdown = await readUtf8(files.solution);
  assert(
    fingerprint(markdown) === state.solution.sha256,
    "SOLUTION_DRIFT",
    "solution.md changed after approval. Reopen the solution before changing it.",
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
  assertPhase(state, Object.values(PHASES).filter((phase) => phase !== PHASES.READY_FOR_UAT), "Task assessment");
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
    assert(independentDispatch.context?.digest, "INDEPENDENT_REVIEW_CONTEXT_REQUIRED", "The independent reviewer must receive recorded scoped context.");
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
    solutionSha256: fingerprint(await readUtf8(files.solution)),
  };
  state.readyAt = null;
  appendHistory(state, "SOLUTION_REVIEWED", now, { status: input.status, reviewer: input.reviewer });
  return saveTask(files, state, clock);
}

export async function recordAgentDispatch(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.SOLUTION_DRAFT, PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED], "Agent dispatch recording");
  assert(input.role?.trim(), "AGENT_ROLE_REQUIRED", "Agent role is required.");
  assert(["planned", "running", "passed", "failed", "blocked"].includes(input.status), "INVALID_AGENT_STATUS", "Agent status is invalid.");
  if (state.deliveryVersion >= 3 && state.routing?.status === "assessed") {
    assert(
      state.routing.agents.roles.includes(input.role.trim()),
      "AGENT_NOT_ALLOWED_FOR_LANE",
      `Agent role ${input.role.trim()} is not allowed for the ${state.routing.lane} lane.`,
    );
  }
  const prepared = state.deliveryVersion >= 3
    ? await loadContextForState(root, state, files, {
      surface: input.surface ?? contextSurfaceForRole(input.role.trim()),
    })
    : null;
  const now = isoNow(clock);
  const id = input.id?.trim() || `AGENT-${String(state.agents.dispatches.length + 1).padStart(3, "0")}`;
  const previous = state.agents.dispatches.find((item) => item.id === id);
  const dispatch = {
    id,
    role: input.role.trim(),
    status: input.status,
    summary: input.summary?.trim() || "",
    context: prepared ? {
      surface: prepared.surface,
      digest: prepared.context.digest,
      path: state.context.path,
      referenceCount: prepared.references.length,
    } : null,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
  };
  const index = state.agents.dispatches.findIndex((item) => item.id === id);
  if (index === -1) state.agents.dispatches.push(dispatch);
  else state.agents.dispatches[index] = dispatch;
  appendHistory(state, "AGENT_DISPATCH_RECORDED", now, { id, role: dispatch.role, status: dispatch.status });
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
  const markdown = await readUtf8(files.acceptance);
  const validation = validateAcceptance(markdown);
  validationFailure("INVALID_ACCEPTANCE", "Acceptance card is not ready for approval.", validation);
  if (state.deliveryVersion >= 3) {
    assert(state.routing?.status === "assessed", "TASK_NOT_ASSESSED", "Assess task depth before approving acceptance.");
    const pending = blockingDecisions(state.decisions);
    assert(pending.length === 0, "BLOCKING_DECISIONS_PENDING", "Resolve every blocking human or authorization decision before approving acceptance.", {
      errors: pending.map((decision) => `${decision.id}: ${decision.question}`),
    });
  }
  const digest = fingerprint(markdown);

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
  if (!(await pathExists(files.solution))) {
    await atomicWrite(files.solution, solutionTemplate(taskId, state.acceptance.items));
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
    const entries = await readdir(files.tasks, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
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

export async function approveSolution(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.SOLUTION_DRAFT, PHASES.CONTRACT_APPROVED], "Solution approval");
  await assertAcceptanceIntegrity(files, state);
  const markdown = await readUtf8(files.solution);
  const validation = validateSolution(markdown, state.acceptance.items, { progressive: state.deliveryVersion >= 3 });
  validationFailure("INVALID_SOLUTION", "Solution card is not ready for approval.", validation);
  const digest = fingerprint(markdown);
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
      assert(review.reviewer === "independent", "INDEPENDENT_REVIEW_REQUIRED", "Deep tasks require an independent solution review before approval.");
    }
  }

  if (state.solution.sha256 === digest && state.solution.approvedAt) {
    return { state, files, warnings: validation.warnings, unchanged: true, affectedDependencies: state.affectedDependencies };
  }

  const now = isoNow(clock);
  state.solution = {
    approvedAt: now,
    sha256: digest,
    impactPaths: validation.parsed.impactPaths.map(normalizeImpactPath),
    trace: validation.parsed.trace,
  };
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

export async function beginImplementation(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.CONTRACT_APPROVED, PHASES.IMPLEMENTING], "Implementation");
  await assertContractIntegrity(files, state);
  if (state.phase !== PHASES.IMPLEMENTING) {
    const now = isoNow(clock);
    appendHistory(state, "IMPLEMENTATION_STARTED", now);
    setPhase(state, PHASES.IMPLEMENTING, now);
    await saveTask(files, state, clock);
  }
  if (state.deliveryVersion < 3) return { state, files };
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

export async function resumeTask(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  if (state.solution?.approvedAt) await assertContractIntegrity(files, state);
  const contextPhases = new Set([
    PHASES.IMPLEMENTING,
    PHASES.REPAIRING,
    PHASES.BLOCKED,
    PHASES.PRE_UAT,
    PHASES.READY_FOR_UAT,
  ]);
  let prepared = null;
  if (state.deliveryVersion >= 3 && contextPhases.has(state.phase)) {
    const surface = [PHASES.PRE_UAT, PHASES.READY_FOR_UAT].includes(state.phase)
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

function defaultUatPlan(state, profile) {
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
  const plan = input.plan ?? defaultUatPlan(state, profile);
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
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT],
    "Acceptance recording",
  );
  await assertContractIntegrity(files, state);
  const criterion = state.acceptance.items.find((item) => item.id === input.acceptanceId);
  assert(criterion, "UNKNOWN_ACCEPTANCE", `Unknown acceptance criterion: ${input.acceptanceId}`);
  const allowed = ["passed", "failed", "blocked", "manual", "affected", "deferred", "cancelled"];
  assert(allowed.includes(input.status), "INVALID_RESULT_STATUS", `Invalid acceptance status: ${input.status}`);
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

  const needsEvidence = input.status === "passed" || (input.status === "manual" && criterion.classification === "ASSISTED");
  const boundary = evidenceBoundary(state);
  const evidence = needsEvidence
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
  };
  state.readyAt = null;
  if (input.status === "failed") setPhase(state, PHASES.REPAIRING, now);
  else if (input.status === "blocked") setPhase(state, PHASES.BLOCKED, now);
  else if (state.phase === PHASES.READY_FOR_UAT || state.phase === PHASES.BLOCKED) setPhase(state, PHASES.PRE_UAT, now);
  appendHistory(state, "ACCEPTANCE_RECORDED", now, { acceptanceId: criterion.id, status: input.status });
  return saveTask(files, state, clock);
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
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT],
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
  else if (state.phase === PHASES.READY_FOR_UAT || state.phase === PHASES.BLOCKED) setPhase(state, PHASES.PRE_UAT, now);
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
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT],
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
  state.reviews.solution = null;
  state.context = { status: "stale", path: state.context?.path ?? null, digest: null, sourceDigests: {} };
  state.affectedDependencies = [];
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
  state.reviews.solution = null;
  state.context = { status: "stale", path: state.context?.path ?? null, digest: null, sourceDigests: {} };
  state.affectedDependencies = [];
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
  if (state.acceptance.approvedAt) {
    const markdown = await readUtf8(files.acceptance);
    const validation = validateAcceptance(markdown);
    errors.push(...validation.errors.map((item) => `Acceptance: ${item}`));
    warnings.push(...validation.warnings.map((item) => `Acceptance: ${item}`));
    if (fingerprint(markdown) !== state.acceptance.sha256) errors.push("Acceptance contract hash does not match the approved version.");
  }
  if (state.solution.approvedAt) {
    const markdown = await readUtf8(files.solution);
    const validation = validateSolution(markdown, state.acceptance.items, { progressive: state.deliveryVersion >= 3 });
    errors.push(...validation.errors.map((item) => `Solution: ${item}`));
    warnings.push(...validation.warnings.map((item) => `Solution: ${item}`));
    if (fingerprint(markdown) !== state.solution.sha256) errors.push("Solution contract hash does not match the approved version.");
    if (state.deliveryVersion >= 3) {
      const review = state.reviews?.solution;
      if (review?.status !== "passed" || review.solutionSha256 !== state.solution.sha256) {
        errors.push("The approved solution lacks a passed review for its current hash.");
      }
      if (state.routing?.lane === "deep" && review?.reviewer !== "independent") {
        errors.push("A Deep task requires an independent solution review.");
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
  return path.relative(files.task, absolute).split(path.sep).join("/");
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
    const absolute = path.resolve(files.task, link.target);
    const relative = path.relative(files.root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) errors.push(`Handoff link ${link.label} leaves the project root.`);
    else if (path.basename(absolute) !== "report.md" && !(await pathExists(absolute))) errors.push(`Handoff link ${link.label} does not exist: ${link.target}.`);
  }
  return { valid: errors.length === 0, errors };
}

export async function prepareHandoff(root, taskId, input = {}, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT], "Handoff preparation");
  await assertContractIntegrity(files, state);
  const environment = input.environment || state.preflight?.environment || "local";
  const { profile } = await loadEnvironmentProfile(root, environment);
  const language = inferHumanLanguage(await readUtf8(files.solution), state.requirement);
  const zh = language === "zh-CN";
  const credentialVariables = splitProfileList(profile.credential_variables);
  const evidenceLinks = [];
  for (const criterion of state.acceptance.items) {
    for (const item of state.results[criterion.id]?.evidence ?? []) {
      evidenceLinks.push({
        label: `${criterion.id} ${zh ? "证据" : "evidence"}: ${path.basename(item.path)}`,
        target: taskRelativeTarget(files, path.join(files.root, item.path)),
        applicable: true,
      });
    }
  }
  const links = [
    { label: zh ? "详细 UAT 报告" : "Detailed UAT report", target: "report.md", applicable: true },
    { label: zh ? "已批准的验收卡" : "Approved acceptance card", target: "acceptance.md", applicable: true },
    { label: zh ? "已批准的方案卡" : "Approved solution card", target: "solution.md", applicable: true },
    { label: zh ? "问题与修复日志" : "Issue and repair log", target: "issues.md", applicable: true },
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
      entryPoint: profile.entry_url && profile.entry_url !== "n/a" ? profile.entry_url : (zh ? "打开下方详细 UAT 报告。" : "Open the Detailed UAT report link below."),
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
      evidence: (state.results[criterion.id]?.evidence ?? []).map((item) => taskRelativeTarget(files, path.join(files.root, item.path))),
      judgment: criterion.classification === "AUTO"
        ? (zh ? "确认准备的证据与预期结果一致。" : "Confirm the prepared evidence matches the expected result.")
        : (zh ? "此项需要人工判断。" : "A person must make this judgment."),
    })),
    links,
  };
  const validation = await validateHandoff(state, handoff, files);
  assert(validation.valid, "INVALID_HANDOFF", "Detailed UAT handoff is invalid.", { errors: validation.errors });
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
    if (state.handoff?.status !== "prepared" || (!options.handoff && !(await pathExists(files.handoff)))) errors.push("Detailed UAT handoff has not been prepared.");
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
          if (!result || result.status !== "passed" || result.epoch !== state.verification.epoch) errors.push(`UAT batch ${batch.id} has not passed in the current epoch.`);
        }
      }
    }
    const credentials = await loadLocalCredentials(root, profile.credential_variables);
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
  const taskPrefix = `.openatdd/tasks/${state.taskId}/`;
  const taskDirectory = `.openatdd/tasks/${state.taskId}`;
  for (const criterion of state.acceptance.items) {
    const result = state.results[criterion.id];
    const evidence = (result?.evidence ?? []).map((item) => {
      const target = item.path.startsWith(taskPrefix)
        ? item.path.slice(taskPrefix.length)
        : path.posix.relative(taskDirectory, item.path);
      return `[${path.basename(item.path)}](${target})`;
    }).join(", ") || "-";
    lines.push(`| ${criterion.id} | ${criterion.classification} | ${criterion.blocking ? (zh ? "是" : "yes") : (zh ? "否" : "no")} | ${result?.status ?? (zh ? "未验证" : "unverified")} | ${evidence} |`);
  }
  return lines.join("\n");
}

function renderChineseTaskReport(state, handoff = null) {
  const checks = Object.values(state.checks);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const lines = [`# UAT 前报告：${state.taskId}`, ""];
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
      "## 分步人工验收",
      "",
      "请按顺序完成。若某一步失败，请返回步骤号、实际结果和相关截图，不要继续猜测。",
      "",
    );
    for (const step of handoff.steps) {
      lines.push(
        `### 第 ${step.number} 步 — ${step.acceptanceId}：${step.title}`,
        "",
        `- 前提：${step.precondition}`,
        `- 操作：${step.action}`,
        `- 预期结果：${step.expected}`,
        `- 结论：${step.checkbox}`,
        `- 判断方式：${step.judgment}`,
        `- 已准备证据：${step.evidence.length > 0 ? step.evidence.map((target) => `[${path.basename(target)}](${target})`).join(", ") : "无独立证据文件；请判断上述可观察结果。"}`,
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
    `- 就绪时间：${state.readyAt ?? "尚未就绪"}`,
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
  if (resolved.length === 0) lines.push("UAT 前未解决任何缺陷。");
  else for (const issue of resolved) lines.push(`- ${issue.id}：${issue.rootCause}（${issue.memoryId}）`);
  lines.push("", "### 受影响的历史验收", "");
  if (state.affectedDependencies.length === 0) lines.push("没有历史任务受到影响。");
  else for (const item of state.affectedDependencies) lines.push(`- ${item.taskId}：${item.acceptanceIds.join(", ")}`);
  lines.push("", "### 人工判断", "");
  if (manual.length === 0) lines.push("没有剩余的人工验收项。");
  else for (const item of manual) lines.push(`- ${item.id} [${item.classification}]：${item.title}`);
  lines.push("", "### 性能观察", "");
  lines.push(`- 环境预检：${state.preflight?.durationMs ?? "未记录"} ms`);
  lines.push(`- 预计浏览器往返：${state.uat?.estimatedRoundTrips ?? "未记录"}`);
  for (const warning of [...(state.preflight?.warnings ?? []), ...(state.uat?.warnings ?? [])]) lines.push(`- 警告：${warning}`);
  for (const phase of state.timing?.phases ?? []) lines.push(`- ${phase.phase}：${phase.durationMs} ms`);
  return `${lines.join("\n")}\n`;
}

export function renderTaskReport(state, handoff = null) {
  const language = handoff?.context?.language ?? inferHumanLanguage(state.requirement, state.acceptance.items.map((item) => item.title));
  if (language === "zh-CN") return renderChineseTaskReport(state, handoff);
  const checks = Object.values(state.checks);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const lines = [
    `# Pre-UAT report: ${state.taskId}`,
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
      "## Step-by-step human acceptance",
      "",
      "Complete the steps in order. If one fails, return its step number, the observed result, and any screenshot; do not continue guessing.",
      "",
    );
    for (const step of handoff.steps) {
      lines.push(
        `### Step ${step.number} — ${step.acceptanceId}: ${step.title}`,
        "",
        `- Precondition: ${step.precondition}`,
        `- Action: ${step.action}`,
        `- Expected result: ${step.expected}`,
        `- Decision: ${step.checkbox}`,
        `- Judgment: ${step.judgment}`,
        `- Prepared evidence: ${step.evidence.length > 0 ? step.evidence.map((target) => `[${path.basename(target)}](${target})`).join(", ") : "No separate evidence file; judge the stated observable result."}`,
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
    `- Ready at: ${state.readyAt ?? "not ready"}`,
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
  if (resolved.length === 0) lines.push("No defects were resolved during pre-UAT.");
  else {
    for (const issue of resolved) lines.push(`- ${issue.id}: ${issue.rootCause} (${issue.memoryId})`);
  }
  lines.push("", "### Affected historical acceptance", "");
  if (state.affectedDependencies.length === 0) lines.push("No historical tasks were affected.");
  else {
    for (const item of state.affectedDependencies) lines.push(`- ${item.taskId}: ${item.acceptanceIds.join(", ")}`);
  }
  lines.push("", "### Human judgment", "");
  if (manual.length === 0) lines.push("No manual acceptance criteria remain.");
  else {
    for (const item of manual) lines.push(`- ${item.id} [${item.classification}]: ${item.title}`);
  }
  lines.push("", "### Performance observations", "");
  lines.push(`- Environment preflight: ${state.preflight?.durationMs ?? "not recorded"} ms`);
  lines.push(`- Estimated browser round trips: ${state.uat?.estimatedRoundTrips ?? "not recorded"}`);
  for (const warning of [...(state.preflight?.warnings ?? []), ...(state.uat?.warnings ?? [])]) lines.push(`- Warning: ${warning}`);
  for (const phase of state.timing?.phases ?? []) lines.push(`- ${phase.phase}: ${phase.durationMs} ms`);
  return `${lines.join("\n")}\n`;
}

export function renderTaskNotification(state, handoff = null) {
  const automatic = state.acceptance.items.filter((item) => item.classification === "AUTO" && item.blocking);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const context = handoff?.context;
  const language = context?.language ?? inferHumanLanguage(state.requirement, state.acceptance.items.map((item) => item.title));
  if (language === "zh-CN") {
    return `# UAT 通知草稿\n\n${state.taskId} 已准备好进行正式人工验收。\n\n- 需求：${state.requirement}\n- 版本：${context?.version ?? "见报告"}\n- 环境 / 角色：${context ? `${context.environment} / ${context.role}` : "见报告"}\n- 入口：${context?.entryPoint ?? "见报告"}\n- 预计时间：${context ? `${context.estimatedMinutes} 分钟` : "见报告"}\n- 自动阻塞项：${automatic.length}/${automatic.length} 已通过\n- [打开详细分步报告](report.md)\n- 剩余人工判断：${manual.length}\n\n第一步：打开报告，完成**第 1 步**并勾选通过或失败。\n已批准旅程、准备好的链接和证据都在任务目录中。\n这是一份草稿；只有在已有授权的渠道中才可发送。\n`;
  }
  return `# UAT notification draft\n\n${state.taskId} is ready for formal human acceptance.\n\n- Requirement: ${state.requirement}\n- Version: ${context?.version ?? "see report"}\n- Environment / role: ${context ? `${context.environment} / ${context.role}` : "see report"}\n- Entry point: ${context?.entryPoint ?? "see report"}\n- Estimated effort: ${context ? `${context.estimatedMinutes} minutes` : "see report"}\n- Automatic blockers: ${automatic.length}/${automatic.length} passed\n- [Open the detailed step-by-step report](report.md)\n- Remaining human judgments: ${manual.length}\n\nFirst action: open the report, complete **Step 1**, and mark Pass or Fail.\nThe approved journey, prepared links, and evidence are in the task directory.\nThis is a draft; send it only through an already-authorized channel.\n`;
}

export async function markReady(root, taskId, clock = () => new Date()) {
  let { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.PRE_UAT, PHASES.READY_FOR_UAT], "Readiness");
  await assertContractIntegrity(files, state);
  if (state.deliveryVersion >= 2 && (state.handoff?.status !== "prepared" || !(await pathExists(files.handoff)))) {
    await prepareHandoff(root, taskId, {}, clock);
    ({ state, files } = await loadTask(root, taskId));
  }
  const errors = await readinessErrorsForState(root, state, files);
  assert(errors.length === 0, "READINESS_BLOCKED", "Task is not ready for human UAT.", { errors });
  const now = isoNow(clock);
  setPhase(state, PHASES.READY_FOR_UAT, now);
  state.readyAt = now;
  appendHistory(state, "READY_FOR_UAT", now);
  await saveTask(files, state, clock);
  const handoff = state.deliveryVersion >= 2 ? await readJson(files.handoff) : null;
  await atomicWrite(files.report, renderTaskReport(state, handoff));
  await atomicWrite(files.notification, renderTaskNotification(state, handoff));
  return { state, files };
}

export async function writeReport(root, taskId) {
  const { state, files } = await loadTask(root, taskId);
  const handoff = await pathExists(files.handoff) ? await readJson(files.handoff) : null;
  await atomicWrite(files.report, renderTaskReport(state, handoff));
  if (state.phase === PHASES.READY_FOR_UAT) await atomicWrite(files.notification, renderTaskNotification(state, handoff));
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
  return {
    graph: {
      schemaVersion: graph.schemaVersion,
      builtAt: graph.builtAt,
      contentDigest: graph.contentDigest,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      warnings: graph.warnings,
      loadStatus: graph.loadStatus,
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
    path: persist ? path.relative(files.root, files.contextFile).split(path.sep).join("/") : null,
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

export function summarizeState(state) {
  return {
    taskId: state.taskId,
    requirement: state.requirement,
    phase: state.phase,
    acceptanceApproved: Boolean(state.acceptance.approvedAt),
    solutionApproved: Boolean(state.solution.approvedAt),
    routing: state.routing,
    decisions: state.decisions,
    solutionReview: state.reviews?.solution ?? null,
    agents: state.agents,
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
    openIssues: state.issues.filter((issue) => issue.status === "open").map((issue) => issue.id),
    affectedDependencies: state.affectedDependencies,
    readyAt: state.readyAt,
  };
}
