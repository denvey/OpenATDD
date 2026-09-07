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
  createTask,
  draftSolution,
  INDEPENDENT_REVIEW_BUDGETS,
  INDEPENDENT_REVIEW_MAX_ATTEMPTS,
  loadTask,
  recordSolutionReview,
  recordAgentDispatch,
  recordIndependentReviewFallbackDecision,
  recordRepairAttempt,
  recordTaskDecision,
  reopenAcceptance,
  resumeTask,
  resolveTaskDecision,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";
import {
  clock,
  criterion,
  prepareApprovedTask,
  solutionMarkdown,
  temporaryProject,
  writeAcceptance,
  writeSolution,
} from "./helpers.mjs";
import { replaceRequirementSection, solutionContract } from "../skills/openatdd/scripts/contracts.mjs";
import { fingerprintProject } from "../skills/openatdd/scripts/manifest.mjs";
import { writeEvidence } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");

async function run(root, ...argv) {
  return execFileAsync(process.execPath, [cli, ...argv, "--root", root]);
}

test("schema v3 hard gates require assessment, resolved blocking decisions, and a current solution review", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01")];
  await createTask(root, "hard-gates", "Deliver the smallest approved change", clock("2026-01-01T00:00:00.000Z"));
  await writeAcceptance(root, "hard-gates", criteria);
  await assert.rejects(() => approveAcceptance(root, "hard-gates"), (error) => error.code === "TASK_NOT_ASSESSED");

  await assessTask(root, "hard-gates", {
    scope: "local",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "low",
  });
  await recordTaskDecision(root, "hard-gates", {
    owner: "human",
    question: "Which visible label should be retained?",
    options: [
      { id: "current", label: "Current label", consequence: "Keeps the existing product wording." },
      { id: "new", label: "New label", consequence: "Changes the visible product wording." },
    ],
    recommendation: "current",
    recommendationBasis: "The requirement does not ask for a wording change.",
  });
  await assert.rejects(() => approveAcceptance(root, "hard-gates"), (error) => error.code === "BLOCKING_DECISIONS_PENDING");
  await resolveTaskDecision(root, "hard-gates", "DEC-001", "current");
  await approveAcceptance(root, "hard-gates");
  await draftSolution(root, "hard-gates");
  const files = taskFiles(root, "hard-gates");
  await writeSolution(root, "hard-gates", criteria);
  await assert.rejects(() => approveSolution(root, "hard-gates"), (error) => error.code === "SOLUTION_REVIEW_REQUIRED");
  await assert.rejects(
    () => recordSolutionReview(root, "hard-gates", {
      status: "passed",
      reviewer: "main",
      summary: "Unstructured self-attestation is insufficient.",
    }),
    (error) => error.code === "SOLUTION_REVIEW_INCOMPLETE",
  );
  await recordSolutionReview(root, "hard-gates", {
    status: "passed",
    reviewer: "main",
    summary: "The solution is concise and follows the established path.",
    checks: "all",
  });
  const hardDocument = await readFile(files.requirement, "utf8");
  await writeFile(files.requirement, replaceRequirementSection(hardDocument, "solution", `${solutionContract(hardDocument)}\n<!-- clarified without changing behavior -->\n`));
  await assert.rejects(() => approveSolution(root, "hard-gates"), (error) => error.code === "SOLUTION_REVIEW_REQUIRED");
  await recordSolutionReview(root, "hard-gates", {
    status: "passed",
    reviewer: "main",
    summary: "The current solution hash remains concise and project-fitting.",
    checks: "all",
  });
  await approveSolution(root, "hard-gates");
  await beginImplementation(root, "hard-gates");
  await assert.rejects(
    () => recordAgentDispatch(root, "hard-gates", { role: "independent-review", status: "planned" }),
    (error) => error.code === "AGENT_NOT_ALLOWED_FOR_LANE",
  );
  for (let index = 0; index < 3; index += 1) {
    await recordRepairAttempt(root, "hard-gates", {
      hypothesis: "The same unproductive repair hypothesis",
      outcome: "no-progress",
    });
  }
  assert.equal((await loadTask(root, "hard-gates")).state.phase, "BLOCKED");
});

test("a dangerous risk overlay requires resolved authorization before product code changes", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01")];
  await createTask(root, "overlay-authorization", "Purge expired accounts in production", clock("2026-02-01T00:00:00.000Z"));
  const routing = await assessTask(root, "overlay-authorization", {
    scope: "local",
    projectPattern: "established",
    reversibility: "irreversible",
    uncertainty: "low",
    riskSignals: ["deletion", "production"],
  });
  // Depth still measures complexity only; the overlay is a safety requirement.
  assert.equal(routing.state.routing.lane, "quick");
  await writeAcceptance(root, "overlay-authorization", criteria);
  await approveAcceptance(root, "overlay-authorization");
  await draftSolution(root, "overlay-authorization");
  const files = taskFiles(root, "overlay-authorization");
  await writeSolution(root, "overlay-authorization", criteria);
  await recordSolutionReview(root, "overlay-authorization", {
    status: "passed",
    reviewer: "main",
    summary: "The deletion path is the smallest project-fitting change.",
    checks: "all",
  });
  await assert.rejects(
    () => approveSolution(root, "overlay-authorization"),
    (error) => error.code === "AUTHORIZATION_DECISION_REQUIRED"
      && error.details.errors.some((item) => item.includes("deletion"))
      && error.details.errors.some((item) => item.includes("production")),
  );

  await recordTaskDecision(root, "overlay-authorization", {
    owner: "authorization",
    coversOverlays: ["deletion", "production"],
    question: "May the irreversible production purge run in this delivery?",
    options: [
      { id: "authorize", label: "Authorize the purge", consequence: "Expired accounts are erased irreversibly." },
      { id: "defer", label: "Defer to a reversible soft delete", consequence: "No data is erased in this delivery." },
    ],
    recommendation: "defer",
    recommendationBasis: "The retention rule is not yet recorded for this project.",
    status: "resolved",
    resolution: { optionId: "authorize", rationale: "The owner authorized the purge in writing." },
  });
  // A resolved authorization only satisfies the overlays it explicitly covers.
  await assert.rejects(
    () => approveSolution(root, "overlay-authorization"),
    (error) => error.code === "AUTHORIZATION_DECISION_REQUIRED"
      && error.details.errors.some((item) => item.includes("irreversible"))
      && !error.details.errors.some((item) => item.includes("deletion")),
  );

  await recordTaskDecision(root, "overlay-authorization", {
    owner: "authorization",
    coversOverlays: ["irreversible"],
    question: "May the purge skip a recoverable retention window?",
    options: [
      { id: "authorize", label: "Authorize the irreversible purge", consequence: "No recovery window remains." },
      { id: "retain", label: "Keep a recovery window", consequence: "Deletion becomes reversible for 30 days." },
    ],
    recommendation: "retain",
    recommendationBasis: "A recovery window is the safer default without a retention rule.",
    status: "resolved",
    resolution: { optionId: "authorize", rationale: "The owner accepted the irreversible purge in writing." },
  });
  const approved = await approveSolution(root, "overlay-authorization");
  assert.equal(approved.state.phase, "CONTRACT_APPROVED");
});

test("a verification-only risk overlay never adds an authorization pause", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "overlay-verification-only", {
    assessment: {
      scope: "local",
      projectPattern: "established",
      reversibility: "costly",
      uncertainty: "low",
      riskSignals: ["security", "authentication", "privacy"],
    },
  });
  const { state } = await loadTask(root, "overlay-verification-only");
  assert.equal(state.phase, "CONTRACT_APPROVED");
  assert.deepEqual(state.routing.riskOverlays, ["authentication", "privacy", "security"]);
  assert.deepEqual(state.decisions, []);
});

async function solutionReadyTask(root, taskId, assessment) {
  const criteria = [criterion("AC-01")];
  await createTask(root, taskId, `Deliver ${taskId}`, clock("2026-02-01T00:00:00.000Z"));
  await assessTask(root, taskId, assessment);
  await writeAcceptance(root, taskId, criteria);
  await approveAcceptance(root, taskId);
  await draftSolution(root, taskId);
  await writeSolution(root, taskId, criteria);
  await recordSolutionReview(root, taskId, {
    status: "passed",
    reviewer: "main",
    summary: "The smallest project-fitting change covers the approved acceptance.",
    checks: "all",
  });
  return criteria;
}

const reviewRuntime = () => ({
  verified: true,
  source: "test-host",
  profile: "astra-critical-review",
  model: "gpt-6-astra",
  reasoningEffort: "high",
  forkTurns: "none",
  sandbox: "read-only",
  leaf: true,
  canSpawnAgents: false,
});

const reviewRuntimeFailure = (blocker = "Reviewer timed out") => ({
  verified: false,
  source: "test-host",
  failureClass: "runtime",
  blocker,
});

test("acceptance dispatch binds runtime, concerns and candidate without granting formal acceptance", async (t) => {
  const root = await temporaryProject(t);
  const taskId = "acceptance-runtime";
  await prepareApprovedTask(root, taskId);
  await beginImplementation(root, taskId);
  const before = (await loadTask(root, taskId)).state;
  const concerns = ["Concurrent updates may be lost"];
  const input = { id: "AC-REVIEW", role: "acceptance-review", status: "running", concerns };
  await assert.rejects(() => recordAgentDispatch(root, taskId, input),
    (error) => error.code === "RUNTIME_ATTESTATION_REQUIRED");
  await assert.rejects(() => recordAgentDispatch(root, taskId, {
    ...input, runtimeAttestation: { ...reviewRuntime(), model: "gpt-5.6-luna" },
  }));
  await assert.rejects(() => recordAgentDispatch(root, taskId, {
    ...input, status: "passed", runtimeAttestation: reviewRuntime(),
  }), (error) => error.code === "ACCEPTANCE_REVIEW_MUST_RUN");
  const started = await recordAgentDispatch(root, taskId, { ...input, runtimeAttestation: reviewRuntime() });
  const dispatch = started.state.agents.dispatches.find((item) => item.id === input.id);
  assert.equal(dispatch.reasoningEffort, "high");
  assert.equal(dispatch.context.surface, "verification");
  assert(dispatch.acceptanceReviewBoundary.sourceFingerprint);
  await assert.rejects(() => recordAgentDispatch(root, taskId, {
    ...input, concerns: ["A different concern"], runtimeAttestation: reviewRuntime(),
  }), (error) => error.code === "ACCEPTANCE_REVIEW_CONCERNS_CHANGED");
  await recordAgentDispatch(root, taskId, { ...input, status: "passed", runtimeAttestation: reviewRuntime() });
  const after = (await loadTask(root, taskId)).state;
  assert.equal(after.phase, before.phase);
  assert.deepEqual(after.acceptance, before.acceptance);
  assert.deepEqual(after.verification, before.verification);

  await recordAgentDispatch(root, taskId, { ...input, id: "AC-STALE", runtimeAttestation: reviewRuntime() });
  await writeFile(path.join(root, "changed-source.js"), "export const changed = true;\n");
  await assert.rejects(() => recordAgentDispatch(root, taskId, {
    ...input, id: "AC-STALE", status: "passed", runtimeAttestation: reviewRuntime(),
  }), (error) => error.code === "ACCEPTANCE_REVIEW_STALE");
});

test("CLI acceptance dispatch uses medium by default and explicit concerns select high", async (t) => {
  const root = await temporaryProject(t);
  const taskId = "acceptance-cli";
  await prepareApprovedTask(root, taskId);
  await beginImplementation(root, taskId);
  await run(root, "agent-dispatch", taskId, "--role", "acceptance-review", "--status", "planned", "--id", "DEFAULT");
  await run(root, "agent-dispatch", taskId, "--role", "acceptance-review", "--status", "planned", "--id", "CONCERN", "--concern", "Race condition");
  const { state } = await loadTask(root, taskId);
  assert.equal(state.agents.dispatches.find((item) => item.id === "DEFAULT").reasoningEffort, "medium");
  assert.equal(state.agents.dispatches.find((item) => item.id === "CONCERN").reasoningEffort, "high");
});

async function reviewReadyTask(root, taskId, assessment = {}) {
  const criteria = [criterion("AC-01")];
  await createTask(root, taskId, `Review ${taskId}`);
  await assessTask(root, taskId, {
    scope: "system",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "medium",
    ...assessment,
  });
  await writeAcceptance(root, taskId, criteria);
  await approveAcceptance(root, taskId);
  await draftSolution(root, taskId);
  await writeSolution(root, taskId, criteria, ["src/review"]);
  return { criteria, files: taskFiles(root, taskId) };
}

test("independent review budgets bind attempts to the current solution and stop a third runtime retry", async (t) => {
  const root = await temporaryProject(t);
  await reviewReadyTask(root, "bounded-review-attempts");

  await assert.rejects(
    () => recordAgentDispatch(root, "bounded-review-attempts", {
      id: "AGENT-WRONG-FAIL",
      role: "independent-review",
      status: "failed",
      durationMs: 100,
      runtimeAttestation: reviewRuntime(),
    }),
    (error) => error.code === "INDEPENDENT_REVIEW_RUNTIME_FAILURE_REQUIRED",
  );

  const first = await recordAgentDispatch(root, "bounded-review-attempts", {
    id: "AGENT-R1",
    role: "independent-review",
    status: "failed",
    runtimeAttestation: reviewRuntimeFailure(),
  });
  assert.deepEqual(first.dispatch.reviewControl, {
    solutionSha256: first.state.reviews.independent.initialSolutionSha256,
    round: "initial",
    timeoutMs: INDEPENDENT_REVIEW_BUDGETS.initial,
    attempt: 1,
    maxAttempts: INDEPENDENT_REVIEW_MAX_ATTEMPTS,
  });

  const second = await recordAgentDispatch(root, "bounded-review-attempts", {
    id: "AGENT-R2",
    role: "independent-review",
    status: "blocked",
    runtimeAttestation: reviewRuntimeFailure("Fresh Reviewer failed to attach"),
  });
  assert.equal(second.dispatch.reviewControl.attempt, 2);
  assert.equal(second.state.reviews.independent.unavailable.length, 1);
  await assert.rejects(
    () => recordAgentDispatch(root, "bounded-review-attempts", {
      id: "AGENT-R3",
      role: "independent-review",
      status: "planned",
    }),
    (error) => error.code === "INDEPENDENT_REVIEW_BUDGET_EXHAUSTED",
  );
});

test("permanent Reviewer capability failure becomes unavailable after one pre-dispatch check", async (t) => {
  const root = await temporaryProject(t);
  await reviewReadyTask(root, "reviewer-capability-fast-fail");
  const attestation = path.join(root, "reviewer-capability.json");
  await writeFile(attestation, `${JSON.stringify({
    verified: false,
    source: "test-host-capability-check",
    failureClass: "permission",
    blocker: "The host cannot provide a leaf Reviewer runtime.",
  }, null, 2)}\n`);
  const dispatched = await run(
    root,
    "agent-dispatch",
    "reviewer-capability-fast-fail",
    "--id",
    "AGENT-CAPABILITY",
    "--role",
    "independent-review",
    "--status",
    "blocked",
    "--duration-ms",
    "0",
    "--attestation",
    "reviewer-capability.json",
    "--json",
  );
  assert.equal(JSON.parse(dispatched.stdout).runtimeFailure.failureClass, "permission");
  const failed = (await loadTask(root, "reviewer-capability-fast-fail")).state;
  assert.equal(failed.reviews.independent.unavailable.length, 1);
  assert.equal(failed.reviews.independent.unavailable[0].reason, "permission");
  assert.equal(failed.agents.dispatches.length, 1);
  assert.equal(failed.agents.dispatches.some((item) => item.status === "running"), false);

  await assert.rejects(
    () => run(
      root,
      "agent-dispatch",
      "reviewer-capability-fast-fail",
      "--id",
      "AGENT-CAPABILITY-RETRY",
      "--role",
      "independent-review",
      "--status",
      "planned",
      "--json",
    ),
    (error) => error.stderr.includes("INDEPENDENT_REVIEW_CAPABILITY_UNAVAILABLE"),
  );
  const after = (await loadTask(root, "reviewer-capability-fast-fail")).state;
  assert.equal(after.reviews.independent.unavailable.length, 1);
  assert.equal(after.agents.dispatches.length, 1);

  const fallback = await recordSolutionReview(root, "reviewer-capability-fast-fail", {
    status: "passed",
    reviewer: "main",
    summary: "Main review passed after the host capability check failed closed.",
    checks: "all",
    fallbackReason: "The host cannot provide the required leaf Reviewer runtime.",
  });
  assert.equal(fallback.state.reviews.solution.status, "passed");
});

test("independent review rejects over-budget success and only rechecks a changed solution after actionable findings", async (t) => {
  const root = await temporaryProject(t);
  const { criteria, files } = await reviewReadyTask(root, "bounded-review-recheck");

  await assert.rejects(
    () => recordAgentDispatch(root, "bounded-review-recheck", {
      id: "AGENT-SLOW",
      role: "independent-review",
      status: "passed",
      durationMs: INDEPENDENT_REVIEW_BUDGETS.initial + 1,
      runtimeAttestation: reviewRuntime(),
    }),
    (error) => error.code === "INDEPENDENT_REVIEW_TIMEOUT_EXCEEDED",
  );

  const initial = await recordAgentDispatch(root, "bounded-review-recheck", {
    id: "AGENT-INITIAL",
    role: "independent-review",
    status: "passed",
    durationMs: INDEPENDENT_REVIEW_BUDGETS.initial,
    runtimeAttestation: reviewRuntime(),
  });
  await recordSolutionReview(root, "bounded-review-recheck", {
    status: "failed",
    reviewer: "independent",
    summary: "The solution needs one bounded correction.",
    findings: ["Clarify the failure boundary."],
    checks: "all",
    agentId: initial.dispatch.id,
  });
  await assert.rejects(
    () => recordAgentDispatch(root, "bounded-review-recheck", {
      id: "AGENT-DUPLICATE",
      role: "independent-review",
      status: "planned",
    }),
    (error) => error.code === "INDEPENDENT_REVIEW_ALREADY_COMPLETED",
  );

  await writeSolution(root, "bounded-review-recheck", criteria, ["src/review", "src/review-boundary"]);
  const recheck = await recordAgentDispatch(root, "bounded-review-recheck", {
    id: "AGENT-RECHECK",
    role: "independent-review",
    status: "passed",
    durationMs: INDEPENDENT_REVIEW_BUDGETS.recheck,
    runtimeAttestation: reviewRuntime(),
  });
  assert.equal(recheck.dispatch.reviewControl.round, "recheck");
  assert.equal(recheck.dispatch.reviewControl.timeoutMs, 300_000);
  assert.notEqual(recheck.dispatch.reviewControl.solutionSha256, initial.dispatch.reviewControl.solutionSha256);
  assert.equal(await readFile(files.requirement, "utf8").then((value) => value.includes("src/review-boundary")), true);
});

test("a failed targeted recheck cannot open a third review round and falls back explicitly", async (t) => {
  const root = await temporaryProject(t);
  const { criteria } = await reviewReadyTask(root, "bounded-review-two-rounds");
  const initial = await recordAgentDispatch(root, "bounded-review-two-rounds", {
    id: "AGENT-I",
    role: "independent-review",
    status: "passed",
    durationMs: 100,
    runtimeAttestation: reviewRuntime(),
  });
  await recordSolutionReview(root, "bounded-review-two-rounds", {
    status: "failed",
    reviewer: "independent",
    summary: "Initial review found a bounded issue.",
    findings: ["Clarify recovery."],
    checks: "all",
    agentId: initial.dispatch.id,
  });
  await writeSolution(root, "bounded-review-two-rounds", criteria, ["src/review", "src/recovery"]);
  const recheck = await recordAgentDispatch(root, "bounded-review-two-rounds", {
    id: "AGENT-R",
    role: "independent-review",
    status: "passed",
    durationMs: 100,
    runtimeAttestation: reviewRuntime(),
  });
  await recordSolutionReview(root, "bounded-review-two-rounds", {
    status: "failed",
    reviewer: "independent",
    summary: "The one targeted recheck still found an issue.",
    findings: ["Clarify rollback ownership."],
    checks: "all",
    agentId: recheck.dispatch.id,
  });
  await writeSolution(root, "bounded-review-two-rounds", criteria, ["src/review", "src/recovery", "src/rollback"]);
  await assert.rejects(
    () => recordAgentDispatch(root, "bounded-review-two-rounds", {
      id: "AGENT-THIRD-ROUND",
      role: "independent-review",
      status: "planned",
    }),
    (error) => error.code === "INDEPENDENT_REVIEW_ROUNDS_EXHAUSTED",
  );
  await recordSolutionReview(root, "bounded-review-two-rounds", {
    status: "passed",
    reviewer: "main",
    summary: "Main review resolved the remaining issue after the two-round review budget ended.",
    fallbackReason: "The initial review and one targeted recheck both returned actionable findings.",
    checks: "all",
  });
  assert.equal((await approveSolution(root, "bounded-review-two-rounds")).state.phase, "CONTRACT_APPROVED");
});

test("bounded review exhaustion permits ordinary fallback and requires explicit human approval for dangerous Deep", async (t) => {
  for (const [taskId, riskSignals, expectedError] of [
    ["review-fallback-ordinary", [], null],
    ["review-fallback-dangerous", ["deletion"], "INDEPENDENT_REVIEW_HUMAN_DECISION_REQUIRED"],
  ]) {
    const root = await temporaryProject(t);
    await reviewReadyTask(root, taskId, { riskSignals });
    for (const id of ["AGENT-F1", "AGENT-F2"]) {
      await recordAgentDispatch(root, taskId, {
        id,
        role: "independent-review",
        status: "blocked",
        runtimeAttestation: reviewRuntimeFailure(),
      });
    }
    await recordSolutionReview(root, taskId, {
      status: "passed",
      reviewer: "main",
      summary: "Main review completed after the bounded independent runtime was unavailable.",
      fallbackReason: "Two independent Reviewer runtime attempts failed without a usable verdict.",
      checks: "all",
    });
    if (expectedError) {
      await assert.rejects(() => approveSolution(root, taskId), (error) => error.code === expectedError);
      await assert.rejects(
        () => recordIndependentReviewFallbackDecision(root, taskId, {
          status: "approved",
          rationale: "The owner accepts main-review fallback.",
        }),
        (error) => error.code === "HUMAN_CONFIRMATION_REQUIRED",
      );
      await recordIndependentReviewFallbackDecision(root, taskId, {
        status: "approved",
        rationale: "The owner accepts main-review fallback after two bounded runtime failures.",
        humanConfirmed: true,
      });
      await recordTaskDecision(root, taskId, {
        owner: "authorization",
        coversOverlays: ["deletion"],
        question: "May this delivery perform the approved deletion behavior?",
        options: [
          { id: "authorize", label: "Authorize deletion", consequence: "The approved deletion path may be implemented." },
          { id: "defer", label: "Defer deletion", consequence: "No deletion behavior is implemented." },
        ],
        recommendation: "defer",
        recommendationBasis: "Deletion remains blocked unless the owner authorizes it explicitly.",
        status: "resolved",
        resolution: { optionId: "authorize", rationale: "The owner separately authorized the deletion behavior." },
      });
      assert.equal((await approveSolution(root, taskId)).state.phase, "CONTRACT_APPROVED");
    } else {
      assert.equal((await approveSolution(root, taskId)).state.phase, "CONTRACT_APPROVED");
    }
  }
});

test("project configuration extends authorization overlays and rejects unknown ones", async (t) => {
  const root = await temporaryProject(t);
  await solutionReadyTask(root, "configured-payment", {
    scope: "local",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "low",
    riskSignals: ["payment"],
  });
  await writeFile(path.join(root, ".openatdd", "config.yaml"), "version: 1\nauthorization_overlays: payment\n");
  await assert.rejects(
    () => approveSolution(root, "configured-payment"),
    (error) => error.code === "AUTHORIZATION_DECISION_REQUIRED"
      && error.details.errors.some((item) => item.includes("payment")),
  );
  await recordTaskDecision(root, "configured-payment", {
    owner: "authorization",
    coversOverlays: ["payment"],
    question: "May the refund path change charge behavior in this delivery?",
    options: [
      { id: "authorize", label: "Authorize the payment change", consequence: "Refund behavior changes for live charges." },
      { id: "defer", label: "Defer the payment change", consequence: "Refund behavior stays unchanged." },
    ],
    recommendation: "authorize",
    recommendationBasis: "The change is covered by the approved acceptance journey.",
    status: "resolved",
    resolution: { optionId: "authorize", rationale: "The owner authorized the payment change." },
  });
  assert.equal((await approveSolution(root, "configured-payment")).state.phase, "CONTRACT_APPROVED");

  // Quoted values and inline comments parse to the same overlay set.
  await writeFile(
    path.join(root, ".openatdd", "config.yaml"),
    'version: 1\nauthorization_overlays: "payment" # includes refund flows\n',
  );
  assert.equal((await approveSolution(root, "configured-payment")).state.phase, "CONTRACT_APPROVED");

  await writeFile(path.join(root, ".openatdd", "config.yaml"), "authorization_overlays: nonsense\n");
  await assert.rejects(
    () => approveSolution(root, "configured-payment"),
    (error) => error.code === "INVALID_AUTHORIZATION_CONFIG",
  );
});

test("reopening acceptance returns resolved authorization decisions to pending", async (t) => {
  const root = await temporaryProject(t);
  await solutionReadyTask(root, "reopen-authorization", {
    scope: "local",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "low",
    riskSignals: ["deletion"],
  });
  await recordTaskDecision(root, "reopen-authorization", {
    owner: "authorization",
    coversOverlays: ["deletion"],
    question: "May stale exports be purged in this delivery?",
    options: [
      { id: "authorize", label: "Authorize the purge", consequence: "Stale exports are removed." },
      { id: "defer", label: "Defer the purge", consequence: "Nothing is removed now." },
    ],
    recommendation: "authorize",
    recommendationBasis: "The exports are regenerated fixtures.",
    status: "resolved",
    resolution: { optionId: "authorize", rationale: "The owner authorized the purge." },
  });
  assert.equal((await approveSolution(root, "reopen-authorization")).state.phase, "CONTRACT_APPROVED");

  await reopenAcceptance(root, "reopen-authorization", "Feedback changed the purge journey");
  const reopened = await loadTask(root, "reopen-authorization");
  const decision = reopened.state.decisions.find((item) => item.owner === "authorization");
  assert.equal(decision.status, "pending");
  assert.equal(decision.resolution, null);
  assert(reopened.state.history.some((item) => item.event === "AUTHORIZATION_REOPENED"));

  // The pending authorization blocks the next approval until it is re-resolved.
  await assert.rejects(
    () => approveAcceptance(root, "reopen-authorization"),
    (error) => error.code === "BLOCKING_DECISIONS_PENDING",
  );
  await resolveTaskDecision(root, "reopen-authorization", decision.id, "authorize", { rationale: "Re-confirmed after the journey change." });
  assert.equal((await approveAcceptance(root, "reopen-authorization")).state.phase, "ACCEPTANCE_APPROVED");
});

test("resume and repair automatically restore the scoped context boundary", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "resume-context", {
    assessment: {
      scope: "cross-module",
      projectPattern: "established",
      reversibility: "reversible",
      uncertainty: "medium",
    },
    impactPaths: ["src/export"],
  });
  await beginImplementation(root, "resume-context");
  const files = taskFiles(root, "resume-context");
  await rm(files.contextFile);

  const resumed = await resumeTask(root, "resume-context");
  assert.equal(resumed.scopedContext.surface, "implementation");
  assert(resumed.scopedContext.references.length > 0);
  assert.equal(JSON.parse(await readFile(files.contextFile, "utf8")).digest, resumed.scopedContext.digest);

  await assert.rejects(
    () => recordAgentDispatch(root, "resume-context", {
      role: "independent-review",
      status: "passed",
      model: "gpt-5.6-luna",
    }),
    (error) => error.code === "AGENT_PROFILE_MISMATCH",
  );
  const reviewed = await recordAgentDispatch(root, "resume-context", {
    role: "independent-review",
    status: "passed",
    runtimeAttestation: {
      verified: true,
      source: "test-host",
      profile: "astra-review",
      model: "gpt-6-astra",
      reasoningEffort: "medium",
      forkTurns: "none",
      sandbox: "read-only",
      leaf: true,
      canSpawnAgents: false,
    },
    inputTokens: 30,
    cachedInputTokens: 20,
    outputTokens: 10,
    durationMs: 250,
  });
  assert.equal(reviewed.dispatch.model, "gpt-6-astra");
  assert.equal(reviewed.dispatch.reasoningEffort, "medium");
  assert.equal(reviewed.dispatch.durationMs, 250);

  await recordRepairAttempt(root, "resume-context", {
    hypothesis: "The persisted recovery boundary was missing",
    outcome: "progress",
    progressFingerprint: "context-restored",
  });
  const state = (await loadTask(root, "resume-context")).state;
  assert.equal(state.repair.attempts[0].contextDigest, state.context.digest);
  assert(state.repair.attempts[0].contextReferenceCount > 0);
});

test("legacy delivery tasks can still record their historical execution role", async (t) => {
  const root = await temporaryProject(t);
  const taskId = "legacy-agent-role";
  await prepareApprovedTask(root, taskId);
  await beginImplementation(root, taskId);
  const files = taskFiles(root, taskId);
  const state = JSON.parse(await readFile(files.state, "utf8"));
  state.deliveryVersion = 2;
  await writeFile(files.state, `${JSON.stringify(state, null, 2)}\n`);

  const recorded = await recordAgentDispatch(root, taskId, {
    role: "clean-context-execution",
    status: "passed",
  });
  assert.equal(recorded.dispatch.profile, "clean-context-execution");
  assert.equal(recorded.dispatch.model, "gpt-5.6-terra");
  assert.equal(recorded.dispatch.sandbox, "workspace-write");
});

test("schema v3 routing state receives additive controller, Agent policy, and execution defaults", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "routing-defaults", {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
  });
  const files = taskFiles(root, "routing-defaults");
  const persisted = JSON.parse(await readFile(files.state, "utf8"));
  persisted.routing.controller = {
    profile: "sol-critical-controller",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "none",
    sandbox: "workspace-write",
  };
  persisted.routing.agents = { policy: "optional", roles: ["independent-review"] };
  delete persisted.execution;
  await writeFile(files.state, `${JSON.stringify(persisted, null, 2)}\n`);

  const loaded = (await loadTask(root, "routing-defaults")).state;
  assert.equal(loaded.routing.controller.profile, "astra-controller");
  assert.equal(loaded.routing.controller.model, "gpt-6-astra");
  assert.equal(loaded.routing.controller.reasoningEffort, "medium");
  assert.deepEqual(loaded.routing.agents.roles, ["independent-review", "acceptance-review", "bounded-implementation", "complex-implementation"]);
  assert.deepEqual(loaded.execution, { planStatus: "not_planned", plannedAt: null, plan: null, results: {}, fallbackReason: null, nextActions: [] });
});

test("complex implementation requires Luna max and returns failures for Astra diagnosis", async (t) => {
  const root = await temporaryProject(t);
  const taskId = "complex-luna-worker";
  await prepareApprovedTask(root, taskId, {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
    impactPaths: ["src/complex"],
  });
  await beginImplementation(root, taskId);
  const files = taskFiles(root, taskId);
  const planFile = path.join(files.task, "complex-plan.input.json");
  await writeFile(planFile, `${JSON.stringify({
    schemaVersion: 1,
    tasks: [{
      id: "ST-COMPLEX",
      acceptanceIds: ["AC-01"],
      task: "Implement the approved complex change",
      stage: 1,
      dependsOn: [],
      writeScope: ["src/complex"],
      doNotTouch: [],
      expectedResult: "The complex change is implemented within its approved scope",
      verification: ["node --check src/complex/index.mjs"],
      firstArtifact: "src/complex/index.mjs",
      route: "complex-implementation",
    }],
  }, null, 2)}\n`);
  await run(root, "plan-execution", taskId, "--input", planFile);
  await recordAgentDispatch(root, taskId, {
    id: "AGENT-COMPLEX",
    role: "complex-implementation",
    subtaskId: "ST-COMPLEX",
    status: "planned",
  });
  await assert.rejects(
    () => recordAgentDispatch(root, taskId, {
      id: "AGENT-COMPLEX",
      role: "complex-implementation",
      subtaskId: "ST-COMPLEX",
      status: "running",
      runtimeAttestation: {
        verified: true,
        source: "legacy-terra-host",
        profile: "terra-high-worker",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        forkTurns: "none",
        sandbox: "workspace-write",
        leaf: true,
        canSpawnAgents: false,
      },
    }),
    (error) => error.code === "RUNTIME_PROFILE_MISMATCH",
  );
  const running = await recordAgentDispatch(root, taskId, {
    id: "AGENT-COMPLEX",
    role: "complex-implementation",
    subtaskId: "ST-COMPLEX",
    status: "running",
    runtimeAttestation: {
      verified: true,
      source: "test-host",
      profile: "luna-max-complex-worker",
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
      forkTurns: "none",
      sandbox: "workspace-write",
      leaf: true,
      canSpawnAgents: false,
    },
  });
  assert.equal(running.dispatch.model, "gpt-5.6-luna");
  assert.equal(running.dispatch.reasoningEffort, "max");
  assert.equal(running.dispatch.escalation, "astra-design-diagnosis");
});

test("planned workers prove runtime identity, actual scoped changes, verification, evidence, and current candidate", async (t) => {
  const root = await temporaryProject(t);
  const taskId = "execution-contract";
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
  await prepareApprovedTask(root, taskId, {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
    impactPaths: ["src/feature"],
  });
  await beginImplementation(root, taskId);
  const files = taskFiles(root, taskId);
  const planFile = path.join(files.task, "execution-plan.input.json");
  await writeFile(planFile, `${JSON.stringify({
    schemaVersion: 1,
    tasks: [{
      id: "ST-001",
      acceptanceIds: ["AC-01"],
      task: "Implement the bounded feature",
      stage: 1,
      dependsOn: [],
      writeScope: ["src/feature"],
      doNotTouch: ["src/other"],
      expectedResult: "A bounded implementation exists",
      verification: ["node --check src/feature/index.mjs"],
      firstArtifact: "src/feature/index.mjs",
      route: "bounded-implementation",
    }],
  }, null, 2)}\n`);
  await run(root, "plan-execution", taskId, "--input", planFile);
  const attestation = {
    verified: true,
    source: "test-host",
    profile: "luna-max-worker",
    model: "gpt-5.6-luna",
    reasoningEffort: "max",
    forkTurns: "none",
    sandbox: "workspace-write",
    leaf: true,
    canSpawnAgents: false,
  };
  const attestationFile = path.join(files.task, "worker-attestation.input.json");
  await writeFile(attestationFile, `${JSON.stringify(attestation, null, 2)}\n`);
  await run(root, "agent-dispatch", taskId, "--id", "AGENT-WORK-001", "--role", "bounded-implementation", "--subtask-id", "ST-001", "--status", "planned");
  await run(root, "agent-dispatch", taskId, "--id", "AGENT-WORK-001", "--role", "bounded-implementation", "--subtask-id", "ST-001", "--status", "running", "--attestation", attestationFile);
  await mkdir(path.join(root, "src", "feature"), { recursive: true });
  await writeFile(path.join(root, "src", "feature", "index.mjs"), "export const implemented = true;\n");
  await run(root, "agent-dispatch", taskId, "--id", "AGENT-WORK-001", "--role", "bounded-implementation", "--subtask-id", "ST-001", "--status", "passed", "--attestation", attestationFile);
  const evidence = await writeEvidence(root, taskId, "worker.txt", "node --check passed");
  const candidate = await fingerprintProject(root, { include: ["**/*"] });
  const resultFile = path.join(files.task, "execution-result.input.json");
  await writeFile(resultFile, `${JSON.stringify({
    taskId: "ST-001",
    status: "passed",
    summary: "Bounded implementation completed",
    changedPaths: ["src/feature/index.mjs"],
    verification: [{ command: "node --check src/feature/index.mjs", status: "passed", summary: "syntax valid" }],
    evidence: [evidence],
    candidateFingerprint: candidate.fingerprint,
    failureClass: "none",
    blocker: null,
  }, null, 2)}\n`);
  const recorded = await run(root, "agent-result", taskId, "--input", resultFile, "--json");
  const result = JSON.parse(recorded.stdout);
  assert.equal(result.status, "passed");
  assert.equal(result.evidence[0].path.startsWith("git:tasks/execution-contract/evidence/"), true);
  assert.deepEqual(result.changedPaths, ["src/feature/index.mjs"]);
});

test("real CLI forwards 1.0 routing, decision, review, agent, repair, graph, context, and eval options", async (t) => {
  const root = await temporaryProject(t);
  await run(root, "new", "cli-intelligence", "--requirement", "Deliver a governed export flow");
  await run(
    root,
    "assess",
    "cli-intelligence",
    "--scope",
    "cross-module",
    "--project-pattern",
    "partial",
    "--reversibility",
    "costly",
    "--uncertainty",
    "medium",
    "--risk",
    "privacy",
    "--risk",
    "external-service",
  );

  const decisionFile = path.join(root, "decision.json");
  await writeFile(decisionFile, `${JSON.stringify({
    owner: "human",
    blocking: true,
    question: "Which export boundary should be public?",
    options: [
      { id: "filtered", label: "Filtered rows", consequence: "Exports only the current filtered result." },
      { id: "all", label: "All rows", consequence: "Exports every row the user can access." },
    ],
    recommendation: "filtered",
    recommendationBasis: "It matches the requested scope and minimizes privacy exposure.",
    invalidationTargets: ["acceptance", "solution", "context", "verification"],
  }, null, 2)}\n`);
  await run(root, "decision", "cli-intelligence", "--input", decisionFile);
  await run(root, "resolve-decision", "cli-intelligence", "--id", "DEC-001", "--option", "filtered", "--rationale", "Approved product boundary");

  const criteria = [criterion("AC-01")];
  await writeAcceptance(root, "cli-intelligence", criteria);
  await run(root, "approve-acceptance", "cli-intelligence");
  await run(root, "draft-solution", "cli-intelligence");
  const files = taskFiles(root, "cli-intelligence");
  await writeSolution(root, "cli-intelligence", criteria, ["src/export"]);
  const attestationFile = path.join(root, "attestation.json");
  await writeFile(attestationFile, `${JSON.stringify({
    verified: true,
    source: "cli-test-host",
    profile: "astra-review",
    model: "gpt-6-astra",
    reasoningEffort: "medium",
    forkTurns: "none",
    sandbox: "read-only",
    leaf: true,
    canSpawnAgents: false,
  }, null, 2)}\n`);
  await run(
    root,
    "agent-dispatch",
    "cli-intelligence",
    "--id",
    "AGENT-009",
    "--role",
    "independent-review",
    "--status",
    "passed",
    "--summary",
    "Review completed",
    "--profile",
    "astra-review",
    "--model",
    "gpt-6-astra",
    "--reasoning-effort",
    "medium",
    "--fork-turns",
    "none",
    "--sandbox",
    "read-only",
    "--input-tokens",
    "120",
    "--cached-input-tokens",
    "80",
    "--output-tokens",
    "40",
    "--duration-ms",
    "1500",
    "--attestation",
    attestationFile,
  );
  await run(
    root,
    "review-solution",
    "cli-intelligence",
    "--status",
    "passed",
    "--reviewer",
    "independent",
    "--summary",
    "The solution is concise and follows the export boundary.",
    "--check",
    "all",
    "--agent-id",
    "AGENT-009",
    "--finding",
    "No unnecessary infrastructure.",
    "--finding",
    "Every acceptance row is traced.",
  );
  await run(root, "approve-solution", "cli-intelligence");
  await run(root, "begin", "cli-intelligence");
  const resumed = await run(root, "resume", "cli-intelligence", "--json");
  assert.equal(JSON.parse(resumed.stdout).scopedContext.surface, "implementation");
  await run(root, "repair-attempt", "cli-intelligence", "--issue-id", "ISSUE-009", "--hypothesis", "The cursor boundary caused the mismatch", "--outcome", "progress", "--summary", "Focused check now passes", "--progress-fingerprint", "repair-v2");

  await run(root, "graph-rebuild");
  const query = await run(root, "graph-query", "export", "--limit", "3", "--json");
  assert.equal(JSON.parse(query.stdout).matches.length <= 3, true);
  await run(root, "graph-impact", "cli-intelligence", "--paths", "src/export", "--json");
  await run(root, "context-build", "cli-intelligence", "--persist", "--query", "export privacy", "--json");
  const context = await run(root, "context-show", "cli-intelligence", "--json");
  assert.equal(JSON.parse(context.stdout).lane, "standard");

  const scenario = path.resolve("evals/agent/scenarios/simplicity.v1.json");
  const report = path.join(root, "agent-report.json");
  const evaluated = await run(root, "agent-eval", "--scenario", scenario, "--adapter", "mock", "--bare-agent", "--runs", "1", "--report", report, "--json");
  assert.equal(JSON.parse(evaluated.stdout).primary.summary.runs, 1);
  assert.equal(JSON.parse(await readFile(report, "utf8")).baseline.adapter.name, "bare-mock");

  const state = (await loadTask(root, "cli-intelligence")).state;
  assert.equal(state.routing.lane, "standard");
  assert.deepEqual(state.routing.assessment.riskSignals, ["privacy", "external-service"]);
  assert.deepEqual(state.routing.riskOverlays, ["privacy", "external-service"]);
  assert.equal(state.decisions[0].resolution.rationale, "Approved product boundary");
  assert.deepEqual(state.reviews.solution.findings, ["No unnecessary infrastructure.", "Every acceptance row is traced."]);
  assert.equal(state.reviews.solution.agentId, "AGENT-009");
  assert.equal(state.agents.dispatches[0].context.surface, "verification");
  assert(state.agents.dispatches[0].context.digest);
  assert.equal(state.agents.dispatches[0].id, "AGENT-009");
  assert.equal(state.agents.dispatches[0].profile, "astra-review");
  assert.equal(state.agents.dispatches[0].model, "gpt-6-astra");
  assert.equal(state.agents.dispatches[0].reasoningEffort, "medium");
  assert.equal(state.agents.dispatches[0].forkTurns, "none");
  assert.equal(state.agents.dispatches[0].sandbox, "read-only");
  assert.equal(state.agents.dispatches[0].inputTokens, 120);
  assert.equal(state.agents.dispatches[0].cachedInputTokens, 80);
  assert.equal(state.agents.dispatches[0].outputTokens, 40);
  assert.equal(state.agents.dispatches[0].durationMs, 1500);
  assert.equal(state.agents.dispatches[0].runtimeAttestation.source, "cli-test-host");
  assert.equal(state.repair.attempts[0].progressFingerprint, "repair-v2");
  assert.equal(state.context.path, "git:tasks/cli-intelligence/context.json");
});
