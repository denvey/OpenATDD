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
} from "./helpers.mjs";

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
  await writeFile(files.solution, solutionMarkdown("hard-gates", criteria));
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
  await writeFile(files.solution, `${await readFile(files.solution, "utf8")}\n<!-- clarified without changing behavior -->\n`);
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

  await recordRepairAttempt(root, "resume-context", {
    hypothesis: "The persisted recovery boundary was missing",
    outcome: "progress",
    progressFingerprint: "context-restored",
  });
  const state = (await loadTask(root, "resume-context")).state;
  assert.equal(state.repair.attempts[0].contextDigest, state.context.digest);
  assert(state.repair.attempts[0].contextReferenceCount > 0);
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
  await writeFile(files.solution, solutionMarkdown("cli-intelligence", criteria, ["src/export"]));
  await run(root, "agent-dispatch", "cli-intelligence", "--id", "AGENT-009", "--role", "independent-review", "--status", "passed", "--summary", "Review completed");
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
  assert.equal(JSON.parse(context.stdout).lane, "deep");

  const scenario = path.resolve("evals/agent/scenarios/simplicity.v1.json");
  const report = path.join(root, "agent-report.json");
  const evaluated = await run(root, "agent-eval", "--scenario", scenario, "--adapter", "mock", "--bare-agent", "--runs", "1", "--report", report, "--json");
  assert.equal(JSON.parse(evaluated.stdout).primary.summary.runs, 1);
  assert.equal(JSON.parse(await readFile(report, "utf8")).baseline.adapter.name, "bare-mock");

  const state = (await loadTask(root, "cli-intelligence")).state;
  assert.equal(state.routing.lane, "deep");
  assert.deepEqual(state.routing.assessment.riskSignals, ["privacy", "external-service"]);
  assert.equal(state.decisions[0].resolution.rationale, "Approved product boundary");
  assert.deepEqual(state.reviews.solution.findings, ["No unnecessary infrastructure.", "Every acceptance row is traced."]);
  assert.equal(state.reviews.solution.agentId, "AGENT-009");
  assert.equal(state.agents.dispatches[0].context.surface, "verification");
  assert(state.agents.dispatches[0].context.digest);
  assert.equal(state.agents.dispatches[0].id, "AGENT-009");
  assert.equal(state.repair.attempts[0].progressFingerprint, "repair-v2");
  assert.equal(state.context.path, ".openatdd/tasks/cli-intelligence/context.json");
});
