import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOrchestrationEvent,
  createOrchestrationState,
  evaluateIntegrationBudget,
  planOrchestrationBatches,
  summarizeOrchestration,
  summarizeWorktreeCleanup,
  validateIntegrationPreconditions,
  validateOrchestrationCapabilities,
  validateOrchestrationPreparation,
  validateParallelDirective,
  validateSessionResultContract,
  validateWorktreeCleanupCandidate,
} from "../skills/openatdd/scripts/orchestration-contracts.mjs";
import { validateExecutionPlan } from "../skills/openatdd/scripts/execution-contracts.mjs";

const task = (overrides = {}) => ({
  id: "ST-001",
  acceptanceIds: ["AC-01"],
  task: "Implement one bounded change",
  stage: 1,
  dependsOn: [],
  writeScope: ["src/one"],
  doNotTouch: [],
  expectedResult: "The bounded change works",
  verification: ["node --check src/one/index.mjs"],
  firstArtifact: "src/one/index.mjs",
  route: "bounded-implementation",
  ...overrides,
});

const plan = () => ({
  schemaVersion: 1,
  tasks: [
    task(),
    task({ id: "ST-002", acceptanceIds: ["AC-02"], writeScope: ["src/two"], firstArtifact: "src/two/index.mjs" }),
    task({ id: "ST-003", acceptanceIds: ["AC-03"], stage: 2, dependsOn: ["ST-001"], writeScope: ["src/one"], firstArtifact: "src/one/follow-up.mjs" }),
  ],
});

const capabilities = () => ({
  hostId: "host-1",
  capabilities: ["create", "send", "wait", "read"],
  isolatedWorktree: true,
  worktreeIsolation: { proven: true, mechanism: "git-worktree" },
});

const session = (overrides = {}) => ({
  sessionId: "S-001",
  subtaskId: "ST-001",
  parentControllerId: "CTRL-001",
  threadId: "THREAD-001",
  worktreePath: "/tmp/openatdd-wt-1",
  branch: "codex/st-001",
  baseRevision: "base-1",
  writeScope: ["src/one"],
  verification: ["node --check src/one/index.mjs"],
  ...overrides,
});

function state(overrides = {}) {
  return createOrchestrationState({
    controller: { id: "CTRL-001", threadId: "THREAD-CONTROLLER", hostId: "host-1" },
    capabilities: capabilities(),
    sessions: [session()],
    ...overrides,
  });
}

test("legacy schemaVersion 1 plans remain valid and preserve additive metadata", () => {
  const legacy = validateExecutionPlan(["AC-01"], { schemaVersion: 1, tasks: [task()] });
  assert.deepEqual(legacy, { schemaVersion: 1, tasks: [task()] });
  const extended = validateExecutionPlan(["AC-01"], {
    schemaVersion: 1,
    orchestration: { isolation: "required" },
    tasks: [task({ session: { profile: "luna-max" }, isolation: { worktree: true } })],
  });
  assert.equal(extended.orchestration.isolation, "required");
  assert.deepEqual(extended.tasks[0].session, { profile: "luna-max" });
  const crossStageOverlap = validateExecutionPlan(["AC-01"], {
    schemaVersion: 1,
    tasks: [
      task(),
      task({ id: "ST-002", stage: 2, dependsOn: ["ST-001"], writeScope: ["src/one"], firstArtifact: "src/one/follow-up.mjs" }),
    ],
  });
  assert.equal(crossStageOverlap.tasks.length, 2);
});

test("parallel planner selects only same-stage independent tasks and explains serial work", () => {
  const result = planOrchestrationBatches(plan(), { acceptanceIds: ["AC-01", "AC-02", "AC-03"] });
  assert.deepEqual(result.parallel, [{ stage: 1, taskIds: ["ST-001", "ST-002"] }]);
  assert.deepEqual(result.serial, ["ST-003"]);
  assert.equal(result.canParallel, true);
  assert(result.reasons.some((reason) => reason.taskId === "ST-003"));

  const serialOnly = planOrchestrationBatches({ schemaVersion: 1, tasks: [task()] });
  assert.equal(serialOnly.canParallel, false);
  assert.deepEqual(serialOnly.serial, ["ST-001"]);
});

test("parallel preparation freezes controller-owned executable interface contracts", () => {
  const executionPlan = {
    ...plan(),
    orchestration: {
      integrationBudgetMs: 900_000,
      sharedContract: {
        taskIds: ["ST-001", "ST-002"],
        files: ["tests/shared-contract.test.mjs"],
        commands: [{ id: "shared-contract", argv: ["node", "--test", "tests/shared-contract.test.mjs"] }],
      },
    },
  };
  const batches = planOrchestrationBatches(executionPlan);
  const preparation = validateOrchestrationPreparation(executionPlan, batches);
  assert.equal(preparation.required, true);
  assert.equal(preparation.integrationBudgetMs, 900_000);
  assert.deepEqual(preparation.sharedContract.taskIds, ["ST-001", "ST-002"]);
  assert.throws(
    () => validateOrchestrationPreparation({ ...executionPlan, orchestration: undefined }, batches),
    (error) => error.code === "ORCHESTRATION_PREPARATION_REQUIRED",
  );
  assert.throws(
    () => validateOrchestrationPreparation({
      ...executionPlan,
      orchestration: {
        ...executionPlan.orchestration,
        sharedContract: { ...executionPlan.orchestration.sharedContract, files: ["src/one/shared.mjs"] },
      },
    }, batches),
    (error) => error.code === "ORCHESTRATION_SHARED_CONTRACT_NOT_CONTROLLER_OWNED",
  );
});

test("large stages are capped at two Workers and unsafe same-stage plans are rejected", () => {
  const tasks = Array.from({ length: 5 }, (_, index) => task({
    id: `ST-${index}`, writeScope: [`src/part-${index}`],
  }));
  const result = planOrchestrationBatches({ schemaVersion: 1, tasks });
  assert.deepEqual(result.batches.map((batch) => batch.tasks.length), [2, 2, 1]);
  assert.deepEqual(result.tasks.map((item) => item.id), tasks.map((item) => item.id));
  assert.throws(() => planOrchestrationBatches({ schemaVersion: 1, tasks: [task(), task({ id: "ST-002" })] }),
    (error) => error.code === "EXECUTION_SCOPE_OWNER_CONFLICT");
});

test("integration budget stops scope expansion after fifteen minutes", () => {
  const within = evaluateIntegrationBudget({ budgetMs: 900_000, budgetStartedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-01T00:14:59.000Z"));
  assert.equal(within.exceeded, false);
  assert.equal(within.allowed, true);
  const exceeded = evaluateIntegrationBudget({ budgetMs: 900_000, budgetStartedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-01T00:15:01.000Z"));
  assert.equal(exceeded.exceeded, true);
  assert.equal(exceeded.allowed, false);
  const converged = evaluateIntegrationBudget({ budgetMs: 900_000, budgetStartedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-01T00:15:01.000Z"), "controller-sequential");
  assert.equal(converged.allowed, true);
  assert.equal(converged.selectedAction, "controller-sequential");
});

test("parallel directives are one-shot and solution-bound", () => {
  const valid = validateParallelDirective({ mode: "parallel", solutionSha256: "abc", source: "human" }, "abc");
  assert.deepEqual(valid, { mode: "parallel", source: "human", solutionSha256: "abc", requestedAt: null, consumed: false });
  assert.throws(() => validateParallelDirective({ mode: "parallel", solutionSha256: "stale" }, "abc"), (error) => error.code === "STALE_PARALLEL_DIRECTIVE");
  assert.throws(() => validateParallelDirective({ mode: "parallel", solutionSha256: "abc", consumed: true }, "abc"), (error) => error.code === "PARALLEL_DIRECTIVE_CONSUMED");
});

test("host capabilities require create/send/wait/read plus proven isolation", () => {
  assert.equal(validateOrchestrationCapabilities(capabilities()).isolatedWorktree, true);
  assert.equal(validateOrchestrationCapabilities({ capabilities: { create: true, send: true, wait: true, read: true }, worktreeIsolation: { proven: true } }).capabilities.length, 4);
  assert.throws(() => validateOrchestrationCapabilities({ capabilities: ["create", "send", "wait"], isolatedWorktree: true }), (error) => error.code === "ORCHESTRATION_CAPABILITY_MISSING");
  assert.throws(() => validateOrchestrationCapabilities({ capabilities: ["create", "send", "wait", "read"], isolatedWorktree: false }), (error) => error.code === "ORCHESTRATION_WORKTREE_ISOLATION_REQUIRED");
});

test("orchestration state enforces unique ownership and leaf runtime", () => {
  const created = state();
  assert.equal(created.revision, 0);
  assert.equal(created.sessions["S-001"].leaf, true);
  assert.throws(() => state({ sessions: [session(), session({ sessionId: "S-002" })] }), (error) => error.code === "ORCHESTRATION_DUPLICATE_THREAD");
  assert.throws(() => state({ sessions: [session({ canSpawnAgents: true })] }), (error) => error.code === "ORCHESTRATION_LEAF_REQUIRED");
  assert.throws(() => state({ sessions: [session({ parentControllerId: "CTRL-OTHER" })] }), (error) => error.code === "ORCHESTRATION_PARENT_MISMATCH");
  const planned = createOrchestrationState({
    controller: { id: "CTRL-001", threadId: "THREAD-CONTROLLER", hostId: "host-1" },
    capabilities: capabilities(),
    sessions: [{
      sessionId: "S-PLANNED",
      subtaskId: "ST-001",
      parentControllerId: "CTRL-001",
      writeScope: ["src/one"],
      state: "planned",
    }],
  });
  const roundTrip = createOrchestrationState(planned);
  assert.equal(roundTrip.sessions["S-PLANNED"].threadId, null);
  assert.equal(roundTrip.sessions["S-PLANNED"].state, "planned");
});

test("pure reducer applies legal events, is idempotent, and rejects stale revisions", () => {
  const initial = state();
  const creatingEvent = { eventId: "E-1", expectedRevision: 0, type: "SESSION_STATE", sessionId: "S-001", state: "creating" };
  const creating = applyOrchestrationEvent(initial, creatingEvent);
  assert.equal(creating.revision, 1);
  assert.equal(creating.sessions["S-001"].state, "creating");
  const duplicate = applyOrchestrationEvent(creating, creatingEvent);
  assert.equal(duplicate.revision, 1);
  assert.deepEqual(duplicate.sessions, creating.sessions);
  assert.throws(() => applyOrchestrationEvent(creating, { ...creatingEvent, eventId: "E-STALE", expectedRevision: 0 }), (error) => error.code === "ORCHESTRATION_STALE_REVISION");
  assert.throws(() => applyOrchestrationEvent(creating, { eventId: "E-ILLEGAL", expectedRevision: 1, type: "SESSION_STATE", sessionId: "S-001", state: "integrated" }), (error) => error.code === "ORCHESTRATION_ILLEGAL_SESSION_TRANSITION");
});

test("partial failures remain visible in aggregate summary", () => {
  let current = state({ sessions: [session(), session({ sessionId: "S-002", subtaskId: "ST-002", threadId: "THREAD-002", worktreePath: "/tmp/openatdd-wt-2", branch: "codex/st-002", writeScope: ["src/two"] })] });
  current = applyOrchestrationEvent(current, { eventId: "E-C", expectedRevision: 0, type: "SESSION_STATE", sessionId: "S-001", state: "creating" });
  current = applyOrchestrationEvent(current, { eventId: "E-C2", expectedRevision: 1, type: "SESSION_STATE", sessionId: "S-001", state: "created" });
  current = applyOrchestrationEvent(current, { eventId: "E-C3", expectedRevision: 2, type: "SESSION_STATE", sessionId: "S-001", state: "running" });
  current = applyOrchestrationEvent(current, { eventId: "E-F", expectedRevision: 3, type: "SESSION_STATE", sessionId: "S-001", state: "failed" });
  const summary = summarizeOrchestration(current);
  assert.equal(summary.status, "partial_failure");
  assert.equal(summary.aggregate.counts.failed, 1);
  assert.equal(summary.aggregate.counts.planned, 1);
});

test("session result contract enforces ownership, evidence, verification and authority", () => {
  const identity = session();
  const result = validateSessionResultContract(identity, {
    status: "passed",
    summary: "Implemented",
    changedPaths: ["src/one/index.mjs"],
    verification: [{ command: "node --check src/one/index.mjs", status: "passed", summary: "ok" }],
    evidence: ["stdout:ok"],
    baseRevision: "base-1",
  });
  assert.equal(result.status, "passed");
  assert.throws(
    () => validateSessionResultContract({ ...identity, verification: [] }, result),
    (error) => error.code === "SESSION_PLANNED_VERIFICATION_REQUIRED",
  );
  assert.throws(() => validateSessionResultContract(identity, { ...result, changedPaths: ["src/two/index.mjs"] }), (error) => error.code === "SESSION_RESULT_SCOPE_VIOLATION");
  assert.throws(() => validateSessionResultContract(identity, { ...result, contractMutation: true }), (error) => error.code === "SESSION_RESULT_AUTHORITY_VIOLATION");
  assert.throws(() => validateSessionResultContract(identity, { status: "blocked", summary: "Blocked" }), (error) => error.code === "SESSION_RESULT_BLOCKER_REQUIRED");
});

test("integration preconditions allow only passed, in-scope, conflict-free results", () => {
  const orchestration = state();
  orchestration.sessions["S-001"].state = "passed";
  orchestration.sessions["S-001"].result = { changedPaths: ["src/one/index.mjs"] };
  const integrated = validateIntegrationPreconditions({ orchestration, sessionId: "S-001", changedPaths: ["src/one/index.mjs"], baseRevision: "base-1" });
  assert.equal(integrated.status, "integrated");
  assert.throws(() => validateIntegrationPreconditions({ orchestration, sessionId: "S-001", changedPaths: ["src/two/index.mjs"] }), (error) => error.code === "INTEGRATION_SCOPE_VIOLATION");
  assert.throws(() => validateIntegrationPreconditions({ orchestration, sessionId: "S-001", conflicts: ["src/one/index.mjs"] }), (error) => error.code === "INTEGRATION_CONFLICT");
});

test("worktree cleanup contract fails closed and summarizes partial results", () => {
  const candidate = {
    sessionId: "S-001",
    worktree: "/tmp/openatdd-wt-1",
    controllerWorktree: "/tmp/openatdd-controller",
    taskDelivered: true,
    sessionStatus: "integrated",
    sameCommonDir: true,
    identityMatches: true,
    unknownPaths: [],
    ignoredPaths: [],
    mainEquivalent: true,
  };
  const safe = validateWorktreeCleanupCandidate(candidate);
  assert.equal(safe.safe, true);
  assert.throws(
    () => validateWorktreeCleanupCandidate({ ...candidate, worktree: candidate.controllerWorktree }),
    (error) => error.code === "WORKTREE_CLEANUP_CONTROLLER_PROTECTED",
  );
  assert.throws(
    () => validateWorktreeCleanupCandidate({ ...candidate, ignoredPaths: [".env.local"] }),
    (error) => error.code === "WORKTREE_CLEANUP_IGNORED_CONTENT",
  );
  assert.deepEqual(summarizeWorktreeCleanup([
    { status: "cleaned" },
    { status: "retained" },
    { status: "failed" },
  ]), { total: 3, cleaned: 1, retained: 1, failed: 1, complete: false });
});
