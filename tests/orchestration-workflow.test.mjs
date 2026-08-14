import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  approveAcceptance,
  approveSolution,
  assessTask,
  beginImplementation,
  cleanupOrchestrationWorktrees,
  createTask,
  draftSolution,
  integrateOrchestration,
  loadTask,
  orchestrationStart,
  planExecution,
  recordOrchestrationSession,
  recordOrchestrationSessionResult,
  recordSolutionReview,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";
import { replaceRequirementSection } from "../skills/openatdd/scripts/contracts.mjs";
import {
  acceptanceMarkdown,
  criterion,
  clock,
  solutionMarkdown,
  temporaryProject,
  writeAcceptance,
  writeSolution,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");

async function prepareParallelTask(root, taskId, options = {}) {
  const criteria = [criterion("AC-01"), criterion("AC-02")];
  await createTask(root, taskId, "Deliver two isolated changes", clock("2026-01-01T00:00:00.000Z"));
  await assessTask(root, taskId, {
    scope: "cross-module",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "medium",
  }, clock("2026-01-01T00:00:01.000Z"));
  await writeAcceptance(root, taskId, criteria);
  await approveAcceptance(root, taskId, clock("2026-01-01T00:00:02.000Z"));
  await draftSolution(root, taskId, clock("2026-01-01T00:00:03.000Z"));
  await writeSolution(root, taskId, criteria, ["src/one", "src/two"]);
  await recordSolutionReview(root, taskId, {
    status: "passed",
    reviewer: "main",
    summary: "The two changes are isolated and independently verifiable.",
    checks: "all",
  }, clock("2026-01-01T00:00:04.000Z"));
  await approveSolution(root, taskId, { parallel: true }, clock("2026-01-01T00:00:05.000Z"));
  await beginImplementation(root, taskId, clock("2026-01-01T00:00:06.000Z"));
  const contractFile = "tests/orchestration-shared-contract.test.mjs";
  if (options.includeContract !== false) {
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, contractFile), options.contractBody ?? [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      '',
      'test("shared session event shape is frozen", () => {',
      '  assert.deepEqual({ type: "SESSION_STATE", state: "created" }, { type: "SESSION_STATE", state: "created" });',
      '});',
      '',
    ].join("\n"));
  }
  await planExecution(root, taskId, {
    schemaVersion: 1,
    ...(options.includeContract === false ? {} : {
      orchestration: {
        integrationBudgetMs: options.integrationBudgetMs ?? 15 * 60 * 1000,
        sharedContract: {
          schemaVersion: 1,
          taskIds: ["ST-01", "ST-02"],
          files: [contractFile],
          commands: [{ id: "shared-contract", argv: options.contractCommand ?? [process.execPath, "--test", contractFile], timeoutMs: 30_000 }],
        },
      },
    }),
    tasks: [
      {
        id: "ST-01",
        acceptanceIds: ["AC-01"],
        task: "Implement the first isolated change",
        stage: 1,
        dependsOn: [],
        writeScope: ["src/one"],
        doNotTouch: ["src/two"],
        expectedResult: "The first isolated change exists",
        verification: ["node --check src/one/index.mjs"],
        firstArtifact: "src/one/index.mjs",
        route: "bounded-implementation",
      },
      {
        id: "ST-02",
        acceptanceIds: ["AC-02"],
        task: "Implement the second isolated change",
        stage: 1,
        dependsOn: [],
        writeScope: ["src/two"],
        doNotTouch: ["src/one"],
        expectedResult: "The second isolated change exists",
        verification: ["node --check src/two/index.mjs"],
        firstArtifact: "src/two/index.mjs",
        route: "bounded-implementation",
      },
    ],
  }, clock("2026-01-01T00:00:07.000Z"));
}

async function git(root, args) {
  return execFileAsync("git", args, { cwd: root });
}

async function initializeGitProject(root) {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "openatdd@example.test"]);
  await git(root, ["config", "user.name", "OpenATDD Test"]);
  await writeFile(path.join(root, "seed.txt"), "seed\n");
  await git(root, ["add", "seed.txt"]);
  await git(root, ["commit", "-m", "seed"]);
}

const capabilities = {
  create: true,
  send: true,
  wait: true,
  read: true,
  worktree: true,
  source: "test-host",
};

const controller = {
  id: "controller-test",
  threadId: "controller-thread",
  hostId: "host-1",
};

const runtimeAttestation = {
  verified: true,
  source: "test-host-runtime",
  profile: "luna-max-worker",
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  forkTurns: "none",
  sandbox: "workspace-write",
  leaf: true,
  canSpawnAgents: false,
};

test("parallel approval is solution-bound and orchestration-start returns host actions", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-start");

  const loaded = await loadTask(root, "parallel-start");
  assert.equal(loaded.state.execution.directive.mode, "parallel");
  assert.equal(loaded.state.execution.directive.solutionSha256, loaded.state.solution.sha256);

  const started = await orchestrationStart(root, "parallel-start", { capabilities, controller }, clock("2026-01-01T00:00:08.000Z"));
  assert.equal(started.parallel, true);
  assert.equal(started.orchestration.aggregate.total, 2);
  assert.equal(started.actions.filter((item) => item.type === "create").length, 2);
  assert.equal(started.actions.filter((item) => item.type === "send").length, 2);
  assert.equal(started.actions.filter((item) => item.type === "wait").length, 1);
  assert.equal(started.actions.filter((item) => item.type === "read").length, 1);
  assert.equal(started.orchestration.contract.status, "passed");
  assert.equal(started.orchestration.integration.budgetMs, 15 * 60 * 1000);
  assert.equal(started.orchestration.integration.budgetStartedAt, null);
  const send = started.actions.find((item) => item.type === "send");
  assert.equal(send.prompt.sharedContract.status, "passed");
  assert(send.prompt.doNotTouch.includes("tests/orchestration-shared-contract.test.mjs"));
});

test("parallel planning fails before dispatch without a frozen shared contract", async (t) => {
  const root = await temporaryProject(t);
  await assert.rejects(
    () => prepareParallelTask(root, "parallel-contract-required", { includeContract: false }),
    (error) => error.code === "ORCHESTRATION_PREPARATION_REQUIRED",
  );
});

test("a failing executable shared contract blocks orchestration before host actions", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-contract-fails", {
    contractBody: [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      '',
      'test("shared event shape", () => {',
      '  assert.equal("status", "state", "incompatible event shape");',
      '});',
      '',
    ].join("\n"),
    contractCommand: [process.execPath, "-e", "process.exit(7)"],
  });
  await assert.rejects(
    () => orchestrationStart(root, "parallel-contract-fails", { capabilities, controller }),
    (error) => error.code === "ORCHESTRATION_SHARED_CONTRACT_FAILED",
  );
  const loaded = await loadTask(root, "parallel-contract-fails");
  assert.equal(loaded.state.execution.directive.consumed, false);
  assert.equal(loaded.state.execution.orchestration.status, "idle");
});

test("an already implementing task can persist the previously explicit parallel directive only", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-late-directive");
  const loaded = await loadTask(root, "parallel-late-directive");
  loaded.state.execution.directive = null;
  await writeFile(taskFiles(root, "parallel-late-directive").state, `${JSON.stringify(loaded.state, null, 2)}\n`);
  const restored = await approveSolution(root, "parallel-late-directive", { parallel: true }, clock("2026-01-01T00:00:09.000Z"));
  assert.equal(restored.state.execution.directive.mode, "parallel");
  assert.equal(restored.state.execution.directive.solutionSha256, restored.state.solution.sha256);
  await assert.rejects(
    () => approveSolution(root, "parallel-late-directive", {}, clock("2026-01-01T00:00:10.000Z")),
    (error) => error.code === "SOLUTION_ALREADY_IMPLEMENTING",
  );
});

test("orchestration-start fails closed when the host cannot prove isolated capabilities", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-capability-gate");
  await assert.rejects(
    () => orchestrationStart(root, "parallel-capability-gate", { capabilities: { create: true }, controller }),
    (error) => error.code === "ORCHESTRATION_CAPABILITY_UNAVAILABLE",
  );
});

test("session events are controller-only, idempotent, and revision guarded", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-events");
  const worktree = path.join(root, "session-one");
  await mkdir(path.join(worktree, "src", "one"), { recursive: true });
  const started = await orchestrationStart(root, "parallel-events", { capabilities, controller });
  const event = {
    eventId: "event-1",
    expectedRevision: started.orchestration.revision,
    sessionId: "session-ST-01",
    status: "created",
    worktree,
    branch: "codex/session-one",
    threadId: "thread-1",
    hostId: "host-1",
    runtimeAttestation,
  };
  const first = await recordOrchestrationSession(root, "parallel-events", event);
  assert.equal(first.idempotent, false);
  const duplicate = await recordOrchestrationSession(root, "parallel-events", event);
  assert.equal(duplicate.idempotent, true);
  await assert.rejects(
    () => recordOrchestrationSession(root, "parallel-events", {
      ...event,
      eventId: "event-stale",
      expectedRevision: 0,
      status: "running",
    }),
    (error) => error.code === "STALE_ORCHESTRATION_REVISION",
  );
});

test("session-result validates the actual worktree diff and integration preserves the controller checkout", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-integrate");
  const worktree = path.join(root, "session-one");
  await mkdir(path.join(worktree, "src", "one"), { recursive: true });
  const started = await orchestrationStart(root, "parallel-integrate", { capabilities, controller });
  await recordOrchestrationSession(root, "parallel-integrate", {
    eventId: "event-created",
    expectedRevision: started.orchestration.revision,
    sessionId: "session-ST-01",
    status: "created",
    worktree,
    branch: "codex/session-one",
    threadId: "thread-1",
    hostId: "host-1",
    runtimeAttestation,
  });
  await writeFile(path.join(worktree, "src", "one", "index.mjs"), "export const one = true;\n");
  const result = await recordOrchestrationSessionResult(root, "parallel-integrate", {
    sessionId: "session-ST-01",
    status: "passed",
    summary: "The first isolated change passed its verification.",
    verification: [{ command: "node --check src/one/index.mjs", status: "passed", summary: "syntax valid" }],
    evidence: ["test-evidence.txt"],
  });
  assert.deepEqual(result.result.changedPaths, ["src/one/index.mjs"]);
  assert.equal(result.result.status, "passed");
  const duplicate = await recordOrchestrationSessionResult(root, "parallel-integrate", {
    sessionId: "session-ST-01",
    status: "passed",
    summary: "The first isolated change passed its verification.",
    verification: [{ command: "node --check src/one/index.mjs", status: "passed", summary: "syntax valid" }],
    evidence: ["test-evidence.txt"],
  });
  assert.equal(duplicate.idempotent, true);

  const integrated = await integrateOrchestration(root, "parallel-integrate", {});
  assert.deepEqual(integrated.integrated, ["session-ST-01"]);
  assert.deepEqual(integrated.conflicts, []);
  assert.equal(await readFile(path.join(root, "src", "one", "index.mjs"), "utf8"), "export const one = true;\n");
});

test("shared contract drift rejects worker results before controller reconciliation", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-contract-drift");
  const worktree = path.join(root, "session-contract-drift");
  await mkdir(path.join(worktree, "src", "one"), { recursive: true });
  const started = await orchestrationStart(root, "parallel-contract-drift", { capabilities, controller }, clock("2026-01-01T00:00:08.000Z"));
  await recordOrchestrationSession(root, "parallel-contract-drift", {
    eventId: "event-contract-drift-created",
    expectedRevision: started.orchestration.revision,
    sessionId: "session-ST-01",
    status: "created",
    worktree,
    branch: "codex/session-contract-drift",
    threadId: "thread-contract-drift",
    hostId: "host-1",
    runtimeAttestation,
  });
  await writeFile(path.join(worktree, "src", "one", "index.mjs"), "export const one = true;\n");
  await writeFile(path.join(root, "tests", "orchestration-shared-contract.test.mjs"), "// drifted after dispatch\n");
  await assert.rejects(
    () => recordOrchestrationSessionResult(root, "parallel-contract-drift", {
      sessionId: "session-ST-01",
      status: "passed",
      summary: "The worker used a stale interface contract.",
      verification: [{ command: "node --check src/one/index.mjs", status: "passed", summary: "syntax valid" }],
      evidence: ["test-evidence.txt"],
    }),
    (error) => error.code === "ORCHESTRATION_SHARED_CONTRACT_DRIFT",
  );
});

test("integration budget blocks ordinary merge and returns only an explicit convergence action", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-budget", { integrationBudgetMs: 900_000 });
  const worktree = path.join(root, "session-budget");
  await mkdir(path.join(worktree, "src", "one"), { recursive: true });
  const started = await orchestrationStart(root, "parallel-budget", { capabilities, controller }, clock("2026-01-01T00:00:08.000Z"));
  await recordOrchestrationSession(root, "parallel-budget", {
    eventId: "event-budget-created",
    expectedRevision: started.orchestration.revision,
    sessionId: "session-ST-01",
    status: "created",
    worktree,
    branch: "codex/session-budget",
    threadId: "thread-budget",
    hostId: "host-1",
    runtimeAttestation,
  });
  await writeFile(path.join(worktree, "src", "one", "index.mjs"), "export const one = true;\n");
  await recordOrchestrationSessionResult(root, "parallel-budget", {
    sessionId: "session-ST-01",
    status: "passed",
    summary: "The first isolated change passed its verification.",
    verification: [{ command: "node --check src/one/index.mjs", status: "passed", summary: "syntax valid" }],
    evidence: ["test-evidence.txt"],
  }, clock("2026-01-01T00:00:10.000Z"));
  const loaded = await loadTask(root, "parallel-budget");
  loaded.state.execution.orchestration.integration.budgetStartedAt = "2026-01-01T00:00:00.000Z";
  loaded.state.execution.orchestration.integration.deadlineAt = "2026-01-01T00:15:00.000Z";
  await writeFile(taskFiles(root, "parallel-budget").state, `${JSON.stringify(loaded.state, null, 2)}\n`);
  await assert.rejects(
    () => integrateOrchestration(root, "parallel-budget", {}, clock("2026-01-01T00:15:01.000Z")),
    (error) => error.code === "ORCHESTRATION_INTEGRATION_BUDGET_EXCEEDED",
  );
  const converged = await integrateOrchestration(root, "parallel-budget", { overrunAction: "controller-sequential" }, clock("2026-01-01T00:15:01.000Z"));
  assert.deepEqual(converged.integrated, []);
  assert.equal(converged.orchestration.integration.status, "budget_exceeded");
  assert.equal(converged.actions[0].type, "controller-sequential");
  await assert.rejects(() => readFile(path.join(root, "src", "one", "index.mjs")), (error) => error.code === "ENOENT");
});

test("CLI orchestration-start emits a host-adapter-friendly JSON payload", async (t) => {
  const root = await temporaryProject(t);
  await prepareParallelTask(root, "parallel-cli");
  const input = path.join(root, "capabilities.json");
  await writeFile(input, `${JSON.stringify({ capabilities, controller }, null, 2)}\n`);
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    "orchestration-start",
    "parallel-cli",
    "--input",
    "capabilities.json",
    "--json",
    "--root",
    root,
  ]);
  const payload = JSON.parse(stdout);
  assert.equal(payload.parallel, true);
  assert.equal(payload.actions.some((item) => item.type === "create"), true);
  assert.equal(payload.orchestration.aggregate.total, 2);
});

test("Git worktree identity is immutable and rejects spoofed branch or worktree replacement", async (t) => {
  const root = await temporaryProject(t);
  await initializeGitProject(root);
  await prepareParallelTask(root, "parallel-git-identity");
  const validWorktree = path.join(path.dirname(root), `${path.basename(root)}-valid-worktree`);
  const foreignRoot = path.join(path.dirname(root), `${path.basename(root)}-foreign-repo`);
  t.after(() => rm(validWorktree, { recursive: true, force: true }));
  t.after(() => rm(foreignRoot, { recursive: true, force: true }));
  await git(root, ["worktree", "add", "-b", "session-one", validWorktree]);
  await mkdir(foreignRoot, { recursive: true });
  await initializeGitProject(foreignRoot);

  const started = await orchestrationStart(root, "parallel-git-identity", { capabilities, controller });
  await assert.rejects(
    () => recordOrchestrationSession(root, "parallel-git-identity", {
      eventId: "spoofed-branch",
      expectedRevision: started.orchestration.revision,
      sessionId: "session-ST-01",
      status: "created",
      worktree: validWorktree,
      branch: "not-the-real-branch",
      threadId: "thread-1",
      hostId: "host-1",
      runtimeAttestation,
    }),
    (error) => error.code === "ORCHESTRATION_BRANCH_IDENTITY_MISMATCH",
  );

  const created = await recordOrchestrationSession(root, "parallel-git-identity", {
    eventId: "valid-created",
    expectedRevision: started.orchestration.revision,
    sessionId: "session-ST-01",
    status: "created",
    worktree: validWorktree,
    branch: "session-one",
    threadId: "thread-1",
    hostId: "host-1",
    runtimeAttestation,
  });
  await assert.rejects(
    () => recordOrchestrationSession(root, "parallel-git-identity", {
      eventId: "swap-worktree",
      expectedRevision: created.orchestration.revision,
      sessionId: "session-ST-01",
      status: "running",
      worktree: foreignRoot,
      threadId: "thread-1",
      runtimeAttestation,
    }),
    (error) => error.code === "ORCHESTRATION_WORKTREE_IDENTITY_IMMUTABLE",
  );
});

async function prepareDeliveredCleanupTask(root, taskId, worktree, options = {}) {
  await initializeGitProject(root);
  await prepareParallelTask(root, taskId);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "prepare orchestration task"]);
  await git(root, ["worktree", "add", "-b", `${taskId}-session`, worktree]);
  const started = await orchestrationStart(root, taskId, { capabilities, controller });
  await recordOrchestrationSession(root, taskId, {
    eventId: `${taskId}-created`,
    expectedRevision: started.orchestration.revision,
    sessionId: "session-ST-01",
    status: "created",
    worktree,
    branch: `${taskId}-session`,
    threadId: `${taskId}-thread`,
    hostId: "host-1",
    runtimeAttestation,
  });
  await mkdir(path.join(worktree, "src", "one"), { recursive: true });
  await writeFile(path.join(worktree, "src", "one", "index.mjs"), "export const one = true;\n");
  await recordOrchestrationSessionResult(root, taskId, {
    sessionId: "session-ST-01",
    status: "passed",
    summary: "The first isolated change passed its verification.",
    verification: [{ command: "node --check src/one/index.mjs", status: "passed", summary: "syntax valid" }],
    evidence: ["test-evidence.txt"],
  });
  await integrateOrchestration(root, taskId, {});
  if (options.ignored) {
    await writeFile(path.join(worktree, ".gitignore"), "retained.secret\n");
    await writeFile(path.join(worktree, "retained.secret"), "do not delete\n");
  }
  const loaded = await loadTask(root, taskId);
  loaded.state.phase = "DELIVERED";
  await writeFile(taskFiles(root, taskId).state, `${JSON.stringify(loaded.state, null, 2)}\n`);
}

test("delivered cleanup removes a safe integrated Git worktree and is idempotent", async (t) => {
  const root = await temporaryProject(t);
  const worktree = path.join(path.dirname(root), `${path.basename(root)}-cleanup-safe`);
  t.after(() => rm(worktree, { recursive: true, force: true }));
  await prepareDeliveredCleanupTask(root, "cleanup-safe", worktree);
  const first = await cleanupOrchestrationWorktrees(root, "cleanup-safe", {});
  assert.equal(first.cleanup.status, "completed");
  assert.equal(first.cleanup.items[0].status, "cleaned");
  await assert.rejects(() => readFile(path.join(worktree, "src", "one", "index.mjs")), (error) => error.code === "ENOENT");
  const list = await git(root, ["worktree", "list", "--porcelain"]);
  assert.doesNotMatch(list.stdout, new RegExp(worktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await git(root, ["show-ref", "--verify", "refs/heads/cleanup-safe-session"]);
  const requirement = await readFile(taskFiles(root, "cleanup-safe").requirement, "utf8");
  assert.match(requirement, /Worktree cleanup/);
  assert.match(requirement, /safe-integrated-worktree-removed/);

  const repeated = await cleanupOrchestrationWorktrees(root, "cleanup-safe", {});
  assert.equal(repeated.cleanup.items[0].status, "cleaned");
  assert.equal(repeated.cleanup.items[0].reason, "already-cleaned");
});

test("cleanup retains unsafe or undelivered worktrees without force", async (t) => {
  const root = await temporaryProject(t);
  const worktree = path.join(path.dirname(root), `${path.basename(root)}-cleanup-retained`);
  t.after(() => rm(worktree, { recursive: true, force: true }));
  await prepareDeliveredCleanupTask(root, "cleanup-retained", worktree, { ignored: true });
  const result = await cleanupOrchestrationWorktrees(root, "cleanup-retained", {});
  assert.equal(result.cleanup.status, "partial");
  assert.equal(result.cleanup.items[0].status, "retained");
  assert.equal(result.cleanup.items[0].reason, "ignored-content");
  assert.equal(await readFile(path.join(worktree, "retained.secret"), "utf8"), "do not delete\n");

  const loaded = await loadTask(root, "cleanup-retained");
  loaded.state.phase = "PRE_UAT";
  await writeFile(taskFiles(root, "cleanup-retained").state, `${JSON.stringify(loaded.state, null, 2)}\n`);
  await assert.rejects(
    () => cleanupOrchestrationWorktrees(root, "cleanup-retained", {}),
    (error) => error.code === "WORKTREE_CLEANUP_TASK_NOT_DELIVERED",
  );
});
