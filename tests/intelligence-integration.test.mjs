import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
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
  loadTask,
  recordSolutionReview,
  recordAgentDispatch,
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
      model: "gpt-5.6-sol",
    }),
    (error) => error.code === "AGENT_PROFILE_MISMATCH",
  );
  const reviewed = await recordAgentDispatch(root, "resume-context", {
    role: "independent-review",
    status: "passed",
    inputTokens: 30,
    cachedInputTokens: 20,
    outputTokens: 10,
    durationMs: 250,
  });
  assert.equal(reviewed.dispatch.model, "gpt-5.6-luna");
  assert.equal(reviewed.dispatch.reasoningEffort, "low");
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
    "default",
    "--model",
    "gpt-5.6-luna",
    "--reasoning-effort",
    "low",
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
  assert.equal(state.agents.dispatches[0].profile, "default");
  assert.equal(state.agents.dispatches[0].model, "gpt-5.6-luna");
  assert.equal(state.agents.dispatches[0].reasoningEffort, "low");
  assert.equal(state.agents.dispatches[0].forkTurns, "none");
  assert.equal(state.agents.dispatches[0].sandbox, "read-only");
  assert.equal(state.agents.dispatches[0].inputTokens, 120);
  assert.equal(state.agents.dispatches[0].cachedInputTokens, 80);
  assert.equal(state.agents.dispatches[0].outputTokens, 40);
  assert.equal(state.agents.dispatches[0].durationMs, 1500);
  assert.equal(state.repair.attempts[0].progressFingerprint, "repair-v2");
  assert.equal(state.context.path, "git:tasks/cli-intelligence/context.json");
});
