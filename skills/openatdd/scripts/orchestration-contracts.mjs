import { assert } from "./lib.mjs";
import { MAX_IMPLEMENTATION_WORKERS } from "./routing.mjs";
import {
  executionPathsOverlap,
  normalizeExecutionPath,
  validateExecutionPlan,
} from "./execution-contracts.mjs";

const SESSION_STATES = Object.freeze([
  "planned", "creating", "created", "running", "waiting",
  "passed", "failed", "blocked", "needs_input", "integrating",
  "integrated", "conflict",
]);

const TERMINAL_SESSION_STATES = new Set(["passed", "failed", "blocked", "needs_input", "integrated", "conflict"]);
const LEGAL_SESSION_TRANSITIONS = Object.freeze({
  planned: new Set(["creating", "created", "failed", "blocked"]),
  creating: new Set(["created", "failed", "blocked"]),
  created: new Set(["running", "waiting", "passed", "failed", "blocked", "needs_input"]),
  running: new Set(["waiting", "passed", "failed", "blocked", "needs_input"]),
  waiting: new Set(["passed", "failed", "blocked", "needs_input"]),
  passed: new Set(["integrating"]),
  integrating: new Set(["integrated", "conflict", "failed"]),
  failed: new Set(),
  blocked: new Set(),
  needs_input: new Set(),
  integrated: new Set(),
  conflict: new Set(),
});

const HOST_CAPABILITIES = Object.freeze(["create", "send", "wait", "read"]);
const RESULT_STATUSES = new Set(["passed", "failed", "blocked", "needs_input"]);
const DEFAULT_INTEGRATION_BUDGET_MS = 15 * 60 * 1000;
const INTEGRATION_OVERRUN_ACTIONS = Object.freeze([
  "minimal-contract-repair",
  "controller-sequential",
  "replan",
]);
const WORKTREE_CLEANUP_RESULTS = Object.freeze(["cleaned", "retained", "failed"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredString(value, code, message) {
  assert(nonEmpty(value), code, message);
  return value.trim();
}

function optionalString(value, code, message) {
  if (value === undefined || value === null) return null;
  return requiredString(value, code, message);
}

function stringArray(value, code, message, optional = false) {
  if (optional && value === undefined) return [];
  assert(Array.isArray(value) && value.every(nonEmpty), code, message);
  return [...new Set(value.map((item) => item.trim()))];
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function positiveInteger(value, fallback, code, message) {
  const normalized = value === undefined ? fallback : Number(value);
  assert(Number.isInteger(normalized) && normalized > 0, code, message);
  return normalized;
}

function normalizeCapabilities(input) {
  assert(isRecord(input), "ORCHESTRATION_CAPABILITIES_REQUIRED", "Host orchestration capabilities must be an object.");
  const declared = input.capabilities ?? input.actions ?? Object.fromEntries(HOST_CAPABILITIES.map((name) => [name, input[name]]));
  const capabilities = isRecord(declared)
    ? Object.entries(declared).filter(([, value]) => value === true).map(([key]) => key)
    : stringArray(declared, "ORCHESTRATION_CAPABILITIES_REQUIRED", "Host capabilities must list create, send, wait, and read.");
  for (const capability of HOST_CAPABILITIES) assert(capabilities.includes(capability), "ORCHESTRATION_CAPABILITY_MISSING", `Host capability is required: ${capability}.`);
  const isolationInput = input.worktreeIsolation ?? input.worktreeProof ?? input.isolatedWorktreeProof ?? input.worktreeIsolationProof ?? input.worktree ?? (isRecord(input.isolatedWorktree) ? input.isolatedWorktree : null);
  const isolatedWorktree = input.isolatedWorktree === true || input.worktreeProof === true || input.isolatedWorktreeProof === true || input.worktreeIsolationProof === true || isolationInput === true || isolationInput?.proven === true || isolationInput?.isolated === true;
  assert(isolatedWorktree, "ORCHESTRATION_WORKTREE_ISOLATION_REQUIRED", "Host must prove isolated worktree support.");
  const worktreeIsolation = isRecord(isolationInput) ? { ...isolationInput, proven: true } : { proven: true };
  const hostId = optionalString(input.hostId, "ORCHESTRATION_HOST_ID_INVALID", "Host id must be non-empty when provided.");
  return {
    hostId,
    capabilities,
    create: true,
    send: true,
    wait: true,
    read: true,
    isolatedWorktree: true,
    worktreeIsolation,
    ...Object.fromEntries(Object.entries(input).filter(([key]) => !["capabilities", "actions", "isolatedWorktree", "worktreeIsolation", "worktreeProof", "isolatedWorktreeProof", "worktreeIsolationProof", "hostId", ...HOST_CAPABILITIES].includes(key))),
  };
}

export function validateParallelDirective(input, expectedSolutionSha256) {
  assert(isRecord(input), "PARALLEL_DIRECTIVE_REQUIRED", "A parallel execution directive must be an object.");
  assert(input.mode === "parallel", "INVALID_PARALLEL_DIRECTIVE_MODE", "Parallel directive mode must be parallel.");
  assert(nonEmpty(expectedSolutionSha256), "SOLUTION_SHA256_REQUIRED", "A solution SHA is required to validate a parallel directive.");
  assert(input.solutionSha256 === expectedSolutionSha256, "STALE_PARALLEL_DIRECTIVE", "Parallel directive is not bound to the current solution fingerprint.");
  assert(input.consumed !== true, "PARALLEL_DIRECTIVE_CONSUMED", "Parallel directive has already been consumed.");
  const requestedAt = optionalString(input.requestedAt, "PARALLEL_DIRECTIVE_TIMESTAMP_INVALID", "Parallel directive requestedAt must be a non-empty timestamp.");
  return {
    mode: "parallel",
    source: input.source === undefined ? "human-solution-approval" : requiredString(input.source, "PARALLEL_DIRECTIVE_SOURCE_INVALID", "Parallel directive source must be a non-empty string."),
    solutionSha256: expectedSolutionSha256,
    requestedAt,
    consumed: false,
  };
}

export function validateOrchestrationCapabilities(input) {
  return normalizeCapabilities(input);
}

function taskIndependence(left, right) {
  const leftDependencies = left.dependsOn ?? [];
  const rightDependencies = right.dependsOn ?? [];
  const leftScope = left.writeScope ?? [];
  const rightScope = right.writeScope ?? [];
  return !leftDependencies.includes(right.id)
    && !rightDependencies.includes(left.id)
    && !leftScope.some((a) => rightScope.some((b) => executionPathsOverlap(a, b)));
}

export function planOrchestrationBatches(executionPlan, options = {}) {
  assert(isRecord(executionPlan), "INVALID_ORCHESTRATION_PLAN", "Execution plan must be an object.");
  const tasks = executionPlan.tasks ?? [];
  assert(Array.isArray(tasks) && tasks.length > 0, "ORCHESTRATION_TASKS_REQUIRED", "Execution plan needs tasks to form orchestration batches.");
  const normalizedPlan = validateExecutionPlan(options.acceptanceIds
    ?? [...new Set(tasks.flatMap((task) => task.acceptanceIds ?? []))], executionPlan);
  const ordered = [...normalizedPlan.tasks].sort((a, b) => a.stage - b.stage || a.id.localeCompare(b.id));
  const byStage = new Map();
  for (const task of ordered) {
    if (!byStage.has(task.stage)) byStage.set(task.stage, []);
    byStage.get(task.stage).push(task);
  }
  const batches = [...byStage.entries()].flatMap(([stage, stageTasks]) => {
    const chunks = [];
    for (let index = 0; index < stageTasks.length; index += MAX_IMPLEMENTATION_WORKERS) {
      const tasks = stageTasks.slice(index, index + MAX_IMPLEMENTATION_WORKERS);
      chunks.push({ stage, tasks, parallel: tasks.length >= 2 });
    }
    return chunks;
  });
  const serial = [];
  const reasons = [];
  const parallel = batches.filter((batch) => batch.tasks.length >= 2).map((batch) => ({ stage: batch.stage, taskIds: batch.tasks.map((task) => task.id) }));
  for (const batch of batches.filter((item) => item.tasks.length < 2)) {
    for (const task of batch.tasks) {
      if (!serial.includes(task.id)) {
        serial.push(task.id);
        reasons.push({ taskId: task.id, reason: "fewer-than-two-independent-tasks" });
      }
    }
  }
  return { batches, parallel, parallelBatches: parallel, serial, serialTasks: serial, reasons, canParallel: parallel.length > 0, tasks: ordered };
}

function normalizeSharedContract(input) {
  assert(isRecord(input), "ORCHESTRATION_SHARED_CONTRACT_REQUIRED", "Parallel orchestration requires a frozen shared interface contract.");
  assert(input.schemaVersion === undefined || input.schemaVersion === 1, "ORCHESTRATION_SHARED_CONTRACT_VERSION", "Shared contract schemaVersion must be 1.");
  const taskIds = stringArray(input.taskIds ?? input.participants, "ORCHESTRATION_SHARED_CONTRACT_TASKS_REQUIRED", "Shared contract taskIds must list the participating tasks.");
  const files = stringArray(input.files, "ORCHESTRATION_SHARED_CONTRACT_FILES_REQUIRED", "Shared contract files must list controller-owned executable contract files.").map(normalizeExecutionPath);
  assert(taskIds.length > 0, "ORCHESTRATION_SHARED_CONTRACT_TASKS_REQUIRED", "Shared contract must cover at least one task.");
  assert(files.length > 0, "ORCHESTRATION_SHARED_CONTRACT_FILES_REQUIRED", "Shared contract must include at least one controller-owned file.");
  assert(Array.isArray(input.commands) && input.commands.length > 0, "ORCHESTRATION_SHARED_CONTRACT_COMMANDS_REQUIRED", "Shared contract needs at least one executable verification command.");
  const commands = input.commands.map((command, index) => {
    assert(isRecord(command), "ORCHESTRATION_SHARED_CONTRACT_COMMAND_INVALID", `Shared contract command ${index + 1} must be an object.`);
    const argv = stringArray(command.argv, "ORCHESTRATION_SHARED_CONTRACT_ARGV_REQUIRED", `Shared contract command ${index + 1} needs argv.`);
    assert(argv.length > 0, "ORCHESTRATION_SHARED_CONTRACT_ARGV_REQUIRED", `Shared contract command ${index + 1} needs argv.`);
    return {
      id: nonEmpty(command.id) ? command.id.trim() : `shared-contract-${index + 1}`,
      argv,
      timeoutMs: positiveInteger(command.timeoutMs, 60_000, "ORCHESTRATION_SHARED_CONTRACT_TIMEOUT_INVALID", "Shared contract command timeoutMs must be a positive integer."),
    };
  });
  return { schemaVersion: 1, taskIds, files, commands };
}

export function validateOrchestrationPreparation(executionPlan, planned = undefined) {
  assert(isRecord(executionPlan), "INVALID_ORCHESTRATION_PLAN", "Execution plan must be an object.");
  const batches = planned ?? planOrchestrationBatches(executionPlan);
  const parallelTaskIds = [...new Set((batches.parallel ?? batches.parallelBatches ?? [])
    .flatMap((batch) => batch.taskIds ?? batch.tasks?.map((task) => task.id) ?? []))];
  if (parallelTaskIds.length < 2) {
    return { required: false, sharedContract: null, integrationBudgetMs: DEFAULT_INTEGRATION_BUDGET_MS };
  }
  const orchestration = executionPlan.orchestration;
  assert(isRecord(orchestration), "ORCHESTRATION_PREPARATION_REQUIRED", "Parallel execution plans must define orchestration preparation.");
  const sharedContract = normalizeSharedContract(orchestration.sharedContract ?? orchestration.contract);
  for (const taskId of parallelTaskIds) {
    assert(sharedContract.taskIds.includes(taskId), "ORCHESTRATION_SHARED_CONTRACT_COVERAGE", `Shared contract does not cover parallel task ${taskId}.`);
  }
  const byId = new Map((executionPlan.tasks ?? []).map((task) => [task.id, task]));
  for (const taskId of sharedContract.taskIds) assert(byId.has(taskId), "ORCHESTRATION_SHARED_CONTRACT_UNKNOWN_TASK", `Shared contract references unknown task ${taskId}.`);
  for (const contractFile of sharedContract.files) {
    for (const task of executionPlan.tasks ?? []) {
      assert(!(task.writeScope ?? []).some((owned) => executionPathsOverlap(contractFile, owned)), "ORCHESTRATION_SHARED_CONTRACT_NOT_CONTROLLER_OWNED", `Shared contract file ${contractFile} overlaps worker ${task.id} writeScope.`);
    }
  }
  return {
    required: true,
    sharedContract,
    integrationBudgetMs: positiveInteger(orchestration.integrationBudgetMs, DEFAULT_INTEGRATION_BUDGET_MS, "ORCHESTRATION_INTEGRATION_BUDGET_INVALID", "integrationBudgetMs must be a positive integer."),
  };
}

export function evaluateIntegrationBudget(input = {}, now = new Date(), selectedAction = null) {
  assert(isRecord(input), "INTEGRATION_BUDGET_REQUIRED", "Integration budget state must be an object.");
  const budgetMs = positiveInteger(input.budgetMs, DEFAULT_INTEGRATION_BUDGET_MS, "ORCHESTRATION_INTEGRATION_BUDGET_INVALID", "Integration budget must be a positive integer.");
  const current = now instanceof Date ? now : new Date(now);
  assert(!Number.isNaN(current.getTime()), "INTEGRATION_BUDGET_TIME_INVALID", "Integration budget evaluation needs a valid time.");
  const budgetStartedAt = input.budgetStartedAt ?? current.toISOString();
  const started = new Date(budgetStartedAt);
  assert(!Number.isNaN(started.getTime()), "INTEGRATION_BUDGET_START_INVALID", "Integration budget start must be a valid timestamp.");
  const deadlineAt = new Date(started.getTime() + budgetMs).toISOString();
  const elapsedMs = Math.max(0, current.getTime() - started.getTime());
  const exceeded = elapsedMs > budgetMs;
  const allowed = !exceeded || (selectedAction !== null && INTEGRATION_OVERRUN_ACTIONS.includes(selectedAction));
  return {
    ...clone(input),
    budgetMs,
    budgetStartedAt: started.toISOString(),
    deadlineAt,
    elapsedMs,
    budgetStatus: exceeded ? "exceeded" : "within_budget",
    exceeded,
    selectedAction: selectedAction ?? null,
    allowed,
    overrunActions: [...INTEGRATION_OVERRUN_ACTIONS],
  };
}

function normalizeController(input) {
  assert(isRecord(input), "ORCHESTRATION_CONTROLLER_REQUIRED", "Orchestration controller identity is required.");
  return {
    id: requiredString(input.id ?? input.controllerId, "ORCHESTRATION_CONTROLLER_ID_REQUIRED", "Controller id is required."),
    threadId: requiredString(input.threadId ?? input.controllerThreadId, "ORCHESTRATION_CONTROLLER_THREAD_REQUIRED", "Controller threadId is required."),
    hostId: optionalString(input.hostId ?? input.controllerHostId, "ORCHESTRATION_CONTROLLER_HOST_INVALID", "Controller host id must be non-empty when provided."),
    worktreePath: optionalString(input.worktreePath ?? input.worktree, "ORCHESTRATION_CONTROLLER_WORKTREE_INVALID", "Controller worktree must be non-empty when provided."),
    branch: optionalString(input.branch, "ORCHESTRATION_CONTROLLER_BRANCH_INVALID", "Controller branch must be non-empty when provided."),
    ...Object.fromEntries(Object.entries(input).filter(([key]) => !["id", "controllerId", "threadId", "controllerThreadId", "hostId", "controllerHostId", "worktreePath", "worktree", "branch"].includes(key))),
  };
}

function normalizeSessionIdentity(input) {
  assert(isRecord(input), "ORCHESTRATION_SESSION_REQUIRED", "Session identity must be an object.");
  const runtime = isRecord(input.runtime) ? input.runtime : (isRecord(input.runtimeAttestation) ? input.runtimeAttestation : {});
  const state = input.state ?? input.status ?? "planned";
  assert(SESSION_STATES.includes(state), "ORCHESTRATION_STATE_INVALID", `Unknown session state: ${state}.`);
  const identityRequired = state !== "planned";
  const normalized = {
    sessionId: requiredString(input.sessionId ?? input.id, "ORCHESTRATION_SESSION_ID_REQUIRED", "Session id is required."),
    subtaskId: requiredString(input.subtaskId ?? input.taskId, "ORCHESTRATION_SUBTASK_ID_REQUIRED", "Session subtaskId is required."),
    parentControllerId: requiredString(input.parentControllerId ?? input.controllerId, "ORCHESTRATION_PARENT_CONTROLLER_REQUIRED", "Session parent controller id is required."),
    threadId: identityRequired
      ? requiredString(input.threadId ?? input.thread ?? input.hostThreadId, "ORCHESTRATION_THREAD_ID_REQUIRED", "Session threadId is required.")
      : optionalString(input.threadId ?? input.thread ?? input.hostThreadId, "ORCHESTRATION_THREAD_ID_INVALID", "Session threadId must be non-empty when provided."),
    worktreePath: identityRequired
      ? requiredString(input.worktreePath ?? input.worktree?.path ?? input.worktree, "ORCHESTRATION_WORKTREE_REQUIRED", "Session worktreePath is required.")
      : optionalString(input.worktreePath ?? input.worktree?.path ?? input.worktree, "ORCHESTRATION_WORKTREE_INVALID", "Session worktreePath must be non-empty when provided."),
    branch: identityRequired
      ? requiredString(input.branch ?? input.branchName, "ORCHESTRATION_BRANCH_REQUIRED", "Session branch is required.")
      : optionalString(input.branch ?? input.branchName, "ORCHESTRATION_BRANCH_INVALID", "Session branch must be non-empty when provided."),
    baseRevision: identityRequired
      ? requiredString(input.baseRevision ?? input.baseDigest ?? input.baseIdentity ?? input.baseSha256, "ORCHESTRATION_BASE_REVISION_REQUIRED", "Session baseRevision is required.")
      : optionalString(input.baseRevision ?? input.baseDigest ?? input.baseIdentity ?? input.baseSha256, "ORCHESTRATION_BASE_REVISION_INVALID", "Session baseRevision must be non-empty when provided."),
    writeScope: stringArray(input.writeScope, "ORCHESTRATION_WRITE_SCOPE_REQUIRED", "Session writeScope must be a non-empty array.").map(normalizeExecutionPath),
    leaf: input.leaf ?? runtime.leaf ?? true,
    canSpawnAgents: input.canSpawnAgents ?? runtime.canSpawnAgents ?? false,
    model: input.model ?? runtime.model ?? null,
    reasoningEffort: input.reasoningEffort ?? runtime.reasoningEffort ?? null,
    sandbox: input.sandbox ?? runtime.sandbox ?? null,
  };
  assert(normalized.leaf === true && normalized.canSpawnAgents === false, "ORCHESTRATION_LEAF_REQUIRED", "Development sessions must be leaf runtimes.");
  return { ...normalized, state, status: state };
}

function validateUniqueSessions(sessions) {
  const ids = new Set();
  const threads = new Set();
  const worktrees = new Set();
  const branches = new Set();
  for (const session of sessions) {
    assert(!ids.has(session.sessionId), "ORCHESTRATION_DUPLICATE_SESSION", `Duplicate session id: ${session.sessionId}.`);
    if (session.threadId) assert(!threads.has(session.threadId), "ORCHESTRATION_DUPLICATE_THREAD", `Duplicate thread id: ${session.threadId}.`);
    if (session.worktreePath) assert(!worktrees.has(session.worktreePath), "ORCHESTRATION_DUPLICATE_WORKTREE", `Duplicate worktree path: ${session.worktreePath}.`);
    if (session.branch) assert(!branches.has(session.branch), "ORCHESTRATION_DUPLICATE_BRANCH", `Duplicate branch: ${session.branch}.`);
    ids.add(session.sessionId);
    if (session.threadId) threads.add(session.threadId);
    if (session.worktreePath) worktrees.add(session.worktreePath);
    if (session.branch) branches.add(session.branch);
  }
  for (let index = 0; index < sessions.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < sessions.length; otherIndex += 1) {
      const left = sessions[index];
      const right = sessions[otherIndex];
      assert(!left.writeScope.some((a) => right.writeScope.some((b) => executionPathsOverlap(a, b))), "ORCHESTRATION_SESSION_SCOPE_CONFLICT", `Sessions ${left.sessionId} and ${right.sessionId} have overlapping write scopes.`);
    }
  }
}

export function createOrchestrationState(input) {
  assert(isRecord(input), "ORCHESTRATION_STATE_REQUIRED", "Orchestration state input must be an object.");
  const controller = normalizeController(input.controller ?? {
    id: input.controllerId,
    threadId: input.controllerThreadId,
    hostId: input.controllerHostId,
    worktreePath: input.controllerWorktreePath,
    branch: input.controllerBranch,
  });
  const capabilities = validateOrchestrationCapabilities(input.capabilities);
  const rawSessions = input.sessions === undefined
    ? []
    : Array.isArray(input.sessions)
      ? input.sessions
      : isRecord(input.sessions)
        ? Object.entries(input.sessions).map(([sessionId, value]) => ({ ...value, sessionId: value.sessionId ?? sessionId }))
        : null;
  assert(rawSessions !== null, "ORCHESTRATION_SESSIONS_INVALID", "Sessions must be an array or object map.");
  const sessionInputs = rawSessions.map(normalizeSessionIdentity);
  assert(input.status === undefined || ["planned", "running", "partial_failure", "integrated"].includes(input.status), "ORCHESTRATION_STATUS_INVALID", `Unknown orchestration status: ${input.status}.`);
  validateUniqueSessions(sessionInputs);
  for (const session of sessionInputs) assert(session.parentControllerId === controller.id, "ORCHESTRATION_PARENT_MISMATCH", `Session ${session.sessionId} is not owned by the controller.`);
  for (const session of sessionInputs) {
    if (session.threadId) assert(session.threadId !== controller.threadId, "ORCHESTRATION_CONTROLLER_THREAD_CONFLICT", `Session ${session.sessionId} reuses the controller thread.`);
    if (controller.worktreePath && session.worktreePath) assert(session.worktreePath !== controller.worktreePath, "ORCHESTRATION_CONTROLLER_WORKTREE_CONFLICT", `Session ${session.sessionId} reuses the controller worktree.`);
    if (controller.branch && session.branch) assert(session.branch !== controller.branch, "ORCHESTRATION_CONTROLLER_BRANCH_CONFLICT", `Session ${session.sessionId} reuses the controller branch.`);
  }
  const eventIds = Array.isArray(input.eventIds)
    ? [...new Set(input.eventIds.filter(nonEmpty).map((eventId) => eventId.trim()))]
    : (Array.isArray(input.events) ? [...new Set(input.events.map((event) => event.eventId).filter(nonEmpty))] : []);
  const integration = {
    status: "pending",
    conflicts: [],
    integratedSessionIds: [],
    budgetMs: DEFAULT_INTEGRATION_BUDGET_MS,
    budgetStartedAt: null,
    deadlineAt: null,
    elapsedMs: 0,
    budgetStatus: "not_started",
    overrunActions: [...INTEGRATION_OVERRUN_ACTIONS],
    ...(input.integration ?? {}),
  };
  const cleanup = {
    status: "not_started",
    attemptedAt: null,
    completedAt: null,
    items: [],
    summary: { total: 0, cleaned: 0, retained: 0, failed: 0, complete: true },
    ...(input.cleanup ?? {}),
  };
  return {
    schemaVersion: 1,
    status: input.status ?? "planned",
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    controller,
    capabilities,
    sessions: Object.fromEntries(sessionInputs.map((session) => [session.sessionId, session])),
    events: Array.isArray(input.events) ? clone(input.events) : [],
    eventIds,
    aggregate: input.aggregate ?? summarizeAggregate(sessionInputs),
    contract: input.contract ?? null,
    integration,
    cleanup,
  };
}

function summarizeAggregate(sessions) {
  const counts = Object.fromEntries(SESSION_STATES.map((state) => [state, 0]));
  for (const session of sessions) counts[session.state ?? session.status] += 1;
  const failed = counts.failed + counts.blocked + counts.needs_input + counts.conflict;
  return { total: sessions.length, counts, passed: counts.passed + counts.integrated, failed, complete: sessions.length > 0 && counts.integrated === sessions.length };
}

function sessionList(orchestration) {
  return Object.values(orchestration.sessions ?? {});
}

export function applyOrchestrationEvent(orchestration, event) {
  assert(isRecord(orchestration), "ORCHESTRATION_STATE_REQUIRED", "Orchestration state is required.");
  assert(isRecord(event), "ORCHESTRATION_EVENT_REQUIRED", "Orchestration event must be an object.");
  const eventId = requiredString(event.eventId, "ORCHESTRATION_EVENT_ID_REQUIRED", "Event id is required.");
  if ((Array.isArray(orchestration.eventIds) ? orchestration.eventIds.includes(eventId) : orchestration.eventIds?.has?.(eventId)) || (orchestration.events ?? []).some((item) => item.eventId === eventId)) return clone(orchestration);
  assert(event.expectedRevision === orchestration.revision, "ORCHESTRATION_STALE_REVISION", "Orchestration event revision is stale.");
  const next = clone(orchestration);
  next.eventIds = [...new Set([...(Array.isArray(orchestration.eventIds) ? orchestration.eventIds : [...(orchestration.eventIds ?? [])]), eventId])];
  next.events = [...(orchestration.events ?? []), clone(event)];
  next.revision += 1;
  if (event.type === "SESSION_STATE") {
    const sessionId = requiredString(event.sessionId, "ORCHESTRATION_SESSION_ID_REQUIRED", "Session state event needs a sessionId.");
    const session = next.sessions?.[sessionId];
    assert(session, "ORCHESTRATION_SESSION_NOT_FOUND", `Unknown orchestration session: ${sessionId}.`);
    assert(SESSION_STATES.includes(event.state), "ORCHESTRATION_STATE_INVALID", `Unknown session state: ${event.state}.`);
    assert(LEGAL_SESSION_TRANSITIONS[session.state]?.has(event.state), "ORCHESTRATION_ILLEGAL_SESSION_TRANSITION", `Cannot move session ${sessionId} from ${session.state} to ${event.state}.`);
    session.state = event.state;
    session.updatedAt = event.at ?? null;
    if (event.result !== undefined) session.result = clone(event.result);
  } else if (event.type === "SESSION_RESULT") {
    const sessionId = requiredString(event.sessionId, "ORCHESTRATION_SESSION_ID_REQUIRED", "Session result event needs a sessionId.");
    const session = next.sessions?.[sessionId];
    assert(session, "ORCHESTRATION_SESSION_NOT_FOUND", `Unknown orchestration session: ${sessionId}.`);
    session.result = validateSessionResultContract(session, event.result);
    const targetState = session.result.status;
    assert(LEGAL_SESSION_TRANSITIONS[session.state]?.has(targetState), "ORCHESTRATION_ILLEGAL_SESSION_TRANSITION", `Cannot record ${targetState} result for session ${sessionId} in ${session.state}.`);
    session.state = targetState;
  } else if (event.type === "INTEGRATION") {
    next.integration = validateIntegrationPreconditions({ ...event, orchestration: next });
    const integratedSession = next.sessions?.[next.integration.sessionId];
    if (integratedSession.state === "passed") {
      integratedSession.state = "integrating";
      integratedSession.state = "integrated";
    }
    next.integration.integratedSessionIds = [...new Set([...(next.integration.integratedSessionIds ?? []), next.integration.sessionId])];
  } else {
    assert(false, "ORCHESTRATION_EVENT_TYPE_INVALID", `Unknown orchestration event type: ${event.type}.`);
  }
  next.aggregate = summarizeAggregate(sessionList(next));
  next.status = next.aggregate.complete ? "integrated" : next.aggregate.failed > 0 ? "partial_failure" : "running";
  return next;
}

export function summarizeOrchestration(orchestration) {
  assert(isRecord(orchestration), "ORCHESTRATION_STATE_REQUIRED", "Orchestration state is required.");
  const sessions = sessionList(orchestration);
  return {
    status: orchestration.status,
    revision: orchestration.revision,
    controller: clone(orchestration.controller),
    aggregate: summarizeAggregate(sessions),
    sessions: sessions.map((session) => ({ sessionId: session.sessionId, subtaskId: session.subtaskId, state: session.state ?? session.status, durationMs: session.durationMs ?? null, result: clone(session.result) })),
    integration: clone(orchestration.integration),
    cleanup: clone(orchestration.cleanup ?? null),
    nextActions: sessions.filter((session) => !TERMINAL_SESSION_STATES.has(session.state ?? session.status)).map((session) => ({ sessionId: session.sessionId, action: (session.state ?? session.status) === "planned" ? "create" : (session.state ?? session.status) === "created" ? "send" : (session.state ?? session.status) === "running" ? "wait" : "read" })),
  };
}

export function validateSessionResultContract(session, input) {
  assert(isRecord(session), "ORCHESTRATION_SESSION_REQUIRED", "Session identity is required for result validation.");
  assert(isRecord(input), "SESSION_RESULT_REQUIRED", "Session result must be an object.");
  assert(RESULT_STATUSES.has(input.status), "SESSION_RESULT_STATUS_INVALID", "Session result status is invalid.");
  const changedPaths = stringArray(input.changedPaths ?? [], "SESSION_RESULT_CHANGED_PATHS_INVALID", "changedPaths must be an array.", true).map(normalizeExecutionPath);
  assert(changedPaths.every((changed) => session.writeScope.some((allowed) => executionPathsOverlap(changed, allowed))), "SESSION_RESULT_SCOPE_VIOLATION", "Session result changed paths exceed writeScope.");
  const verification = input.verification ?? [];
  assert(Array.isArray(verification) && verification.every((item) => isRecord(item) && nonEmpty(item.command) && ["passed", "failed"].includes(item.status)), "SESSION_RESULT_VERIFICATION_INVALID", "Session result verification entries need command and passed/failed status.");
  const plannedVerification = stringArray(session.verification ?? [], "SESSION_PLANNED_VERIFICATION_INVALID", "Session planned verification must be an array.", true);
  const evidence = stringArray(input.evidence ?? [], "SESSION_RESULT_EVIDENCE_INVALID", "Session result evidence must be an array.", true);
  assert(input.baseRevision === undefined || input.baseRevision === session.baseRevision, "SESSION_RESULT_BASE_STALE", "Session result base revision does not match the session baseline.");
  if (input.status === "passed") {
    assert(changedPaths.length > 0, "SESSION_RESULT_CHANGED_PATHS_REQUIRED", "Passed session results need changedPaths.");
    assert(plannedVerification.length > 0, "SESSION_PLANNED_VERIFICATION_REQUIRED", "Passed session results require a non-empty planned verification contract.");
    assert(verification.every((item) => item.status === "passed"), "SESSION_RESULT_VERIFICATION_INCOMPLETE", "Passed session results cannot contain failed verification.");
    assert(plannedVerification.every((command) => verification.some((item) => item.command.trim() === command && item.status === "passed")), "SESSION_RESULT_VERIFICATION_INCOMPLETE", "Passed session results must cover every planned verification command.");
    assert(evidence.length > 0, "SESSION_RESULT_EVIDENCE_REQUIRED", "Passed session results need evidence.");
  } else assert(nonEmpty(input.blocker), "SESSION_RESULT_BLOCKER_REQUIRED", "Non-passed session results need a blocker.");
  assert(input.contractMutation !== true && input.authorizationMutation !== true && input.acceptanceMutation !== true && input.orchestrationMutation !== true, "SESSION_RESULT_AUTHORITY_VIOLATION", "Session results cannot mutate shared contracts.");
  return { status: input.status, summary: requiredString(input.summary, "SESSION_RESULT_SUMMARY_REQUIRED", "Session result summary is required."), changedPaths, verification: verification.map((item) => ({ command: item.command.trim(), status: item.status, summary: item.summary?.trim() ?? "" })), evidence, blocker: input.blocker?.trim() || null, baseRevision: input.baseRevision ?? session.baseRevision, worktreeFingerprint: input.worktreeFingerprint?.trim() || null };
}

export function validateIntegrationPreconditions(input) {
  assert(isRecord(input), "INTEGRATION_PRECONDITIONS_REQUIRED", "Integration preconditions must be an object.");
  const orchestration = input.orchestration;
  assert(isRecord(orchestration), "INTEGRATION_ORCHESTRATION_REQUIRED", "Integration preconditions need orchestration state.");
  const sessionId = requiredString(input.sessionId, "INTEGRATION_SESSION_ID_REQUIRED", "Integration needs a sessionId.");
  const session = orchestration.sessions?.[sessionId];
  assert(session, "ORCHESTRATION_SESSION_NOT_FOUND", `Unknown orchestration session: ${sessionId}.`);
  assert(input.status === undefined || input.status === "passed", "INTEGRATION_STATUS_INVALID", "Integration preconditions status must be passed when provided.");
  assert((session.state ?? session.status) === "passed" && session.result?.status !== "failed" && session.result?.status !== "blocked" && session.result?.status !== "needs_input", "INTEGRATION_SESSION_NOT_PASSED", "Only passed sessions may be integrated.");
  assert(input.baseRevision === undefined || input.baseRevision === session.baseRevision, "INTEGRATION_BASE_STALE", "Integration base revision is stale.");
  const changedPaths = stringArray(input.changedPaths ?? session.result?.changedPaths ?? [], "INTEGRATION_CHANGED_PATHS_INVALID", "Integration changedPaths must be an array.", true).map(normalizeExecutionPath);
  assert(changedPaths.every((changed) => session.writeScope.some((allowed) => executionPathsOverlap(changed, allowed))), "INTEGRATION_SCOPE_VIOLATION", "Integration changed paths exceed session ownership.");
  const conflicts = stringArray(input.conflicts ?? [], "INTEGRATION_CONFLICTS_INVALID", "Integration conflicts must be an array.", true);
  assert(conflicts.length === 0, "INTEGRATION_CONFLICT", "Integration cannot proceed with conflicts.");
  return { status: "integrated", sessionId, changedPaths, baseRevision: session.baseRevision, conflicts: [], integratedAt: input.integratedAt ?? null };
}

export function validateWorktreeCleanupCandidate(input) {
  assert(isRecord(input), "WORKTREE_CLEANUP_CANDIDATE_REQUIRED", "Worktree cleanup candidate must be an object.");
  const sessionId = requiredString(input.sessionId, "WORKTREE_CLEANUP_SESSION_ID_REQUIRED", "Worktree cleanup needs a sessionId.");
  const worktree = requiredString(input.worktree, "WORKTREE_CLEANUP_PATH_REQUIRED", "Worktree cleanup needs an exact path.");
  const controllerWorktree = requiredString(input.controllerWorktree, "WORKTREE_CLEANUP_CONTROLLER_REQUIRED", "Worktree cleanup needs the controller checkout path.");
  assert(worktree !== controllerWorktree, "WORKTREE_CLEANUP_CONTROLLER_PROTECTED", "The controller checkout cannot be cleaned as a session worktree.");
  assert(input.taskDelivered === true, "WORKTREE_CLEANUP_TASK_NOT_DELIVERED", "Worktree cleanup is allowed only after task delivery.");
  assert(input.sessionStatus === "integrated", "WORKTREE_CLEANUP_SESSION_NOT_INTEGRATED", "Only integrated session worktrees may be cleaned.");
  assert(input.sameCommonDir === true, "WORKTREE_CLEANUP_FOREIGN_REPOSITORY", "Worktree cleanup requires the controller Git common-dir.");
  assert(input.identityMatches === true, "WORKTREE_CLEANUP_IDENTITY_DRIFT", "Worktree identity changed after session binding.");
  assert(input.unknownPaths?.length === 0, "WORKTREE_CLEANUP_UNKNOWN_CONTENT", "Worktree contains content that is not proven delivered.");
  assert(input.ignoredPaths?.length === 0, "WORKTREE_CLEANUP_IGNORED_CONTENT", "Worktree contains ignored content that must be retained.");
  assert(input.mainEquivalent === true, "WORKTREE_CLEANUP_UNDELIVERED_CONTENT", "Worktree content is not fully represented in the delivered controller candidate.");
  return {
    sessionId,
    worktree,
    controllerWorktree,
    taskDelivered: true,
    sessionStatus: "integrated",
    safe: true,
  };
}

export function summarizeWorktreeCleanup(items = []) {
  assert(Array.isArray(items), "WORKTREE_CLEANUP_RESULTS_INVALID", "Worktree cleanup results must be an array.");
  const counts = Object.fromEntries(WORKTREE_CLEANUP_RESULTS.map((status) => [status, 0]));
  for (const item of items) {
    assert(isRecord(item) && WORKTREE_CLEANUP_RESULTS.includes(item.status), "WORKTREE_CLEANUP_RESULT_INVALID", "Each worktree cleanup result needs cleaned, retained, or failed status.");
    counts[item.status] += 1;
  }
  return {
    total: items.length,
    ...counts,
    complete: items.length === 0 || counts.retained + counts.failed === 0,
  };
}

export { DEFAULT_INTEGRATION_BUDGET_MS, HOST_CAPABILITIES, INTEGRATION_OVERRUN_ACTIONS, SESSION_STATES, WORKTREE_CLEANUP_RESULTS };
