import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  advanceQuickTask,
  approveAcceptance,
  assessTask,
  beginImplementation,
  beginPreUat,
  createTask,
  draftSolution,
  initProject,
  isDeliveryTerminalPhase,
  loadTask,
  markReady,
  PHASES,
  recordAcceptanceResult,
  recordCheck,
  recordIssue,
  recordSolutionReview,
  recordTaskDecision,
  searchMemory,
  projectFiles,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";
import {
  acceptanceMarkdown,
  clock,
  criterion,
  prepareApprovedTask,
  temporaryProject,
  writeAcceptance,
  writeEvidence,
  writeSolution,
} from "./helpers.mjs";
import { acceptanceContract, replaceRequirementSection, solutionContract } from "../skills/openatdd/scripts/contracts.mjs";

const execFileAsync = promisify(execFile);

test("project initialization creates and preserves one compact project truth file", async (t) => {
  const root = await temporaryProject(t);
  await initProject(root);
  const files = projectFiles(root);
  const template = await readFile(files.projectTruth, "utf8");
  assert.match(template, /## Product rules/);
  assert.match(template, /## Architecture boundaries/);
  assert.match(template, /## Technical decisions/);

  const maintained = `${template}\n- Payments remain inside the billing module.\n`;
  await writeFile(files.projectTruth, maintained);
  await initProject(root);
  assert.equal(await readFile(files.projectTruth, "utf8"), maintained);
});

test("enforces acceptance approval before solution and solution approval before implementation", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01")];
  const { createTask, approveSolution } = await import("../skills/openatdd/scripts/workflow.mjs");
  await createTask(root, "gate-order", "Deliver a gated feature", clock("2020-01-01T00:00:00.000Z"));
  await assessTask(root, "gate-order", {
    scope: "local",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "low",
  }, clock("2020-01-01T00:00:30.000Z"));

  await assert.rejects(() => draftSolution(root, "gate-order"), (error) => error.code === "INVALID_PHASE");
  await writeAcceptance(root, "gate-order", criteria);
  await approveAcceptance(root, "gate-order", clock("2020-01-01T00:01:00.000Z"));
  await draftSolution(root, "gate-order");
  await assert.rejects(() => beginImplementation(root, "gate-order"), (error) => error.code === "INVALID_PHASE");

  const files = taskFiles(root, "gate-order");
  const { solutionMarkdown } = await import("./helpers.mjs");
  await writeFile(files.requirement, replaceRequirementSection(await readFile(files.requirement, "utf8"), "solution", solutionMarkdown("gate-order", criteria)));
  await recordSolutionReview(root, "gate-order", {
    status: "passed",
    reviewer: "main",
    summary: "The solution is concise and follows the established project architecture.",
    checks: "all",
  }, clock("2020-01-01T00:01:30.000Z"));
  await approveSolution(root, "gate-order", clock("2020-01-01T00:02:00.000Z"));
  const started = await beginImplementation(root, "gate-order");
  assert.equal(started.state.phase, "IMPLEMENTING");
});

test("detects silent changes to an approved contract", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "contract-drift");
  const files = taskFiles(root, "contract-drift");
  const document = await readFile(files.requirement, "utf8");
  await writeFile(files.requirement, replaceRequirementSection(document, "acceptance", `${acceptanceContract(document)}\nSilent change.\n`));

  await assert.rejects(
    () => beginImplementation(root, "contract-drift"),
    (error) => error.code === "ACCEPTANCE_DRIFT",
  );
});

test("requires fresh evidence and a passing project check before readiness", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "evidence-gate");
  await beginImplementation(root, "evidence-gate");
  await beginPreUat(root, "evidence-gate");

  await assert.rejects(
    () => markReady(root, "evidence-gate"),
    (error) => error.code === "READINESS_BLOCKED" && error.details.errors.length >= 2,
  );

  const acceptanceEvidence = await writeEvidence(root, "evidence-gate", "ac-01.txt", "user journey passed");
  const checkEvidence = await writeEvidence(root, "evidence-gate", "tests.txt", "all tests passed");
  await recordAcceptanceResult(root, "evidence-gate", {
    acceptanceId: "AC-01",
    status: "passed",
    summary: "Observed expected outcome",
    evidence: acceptanceEvidence,
  });
  await recordCheck(root, "evidence-gate", {
    name: "tests",
    command: "node --test",
    status: "passed",
    evidence: checkEvidence,
  });

  const ready = await markReady(root, "evidence-gate");
  assert.equal(ready.state.phase, "DELIVERED");
  const report = await readFile(ready.files.requirement, "utf8");
  assert.match(report, /^# Requirement delivery:/);
  assert.match(report, /AC-01/);

  await writeFile(path.resolve(root, acceptanceEvidence), "mutated after recording\n");
  const validation = await import("../skills/openatdd/scripts/workflow.mjs").then(({ validateTask }) => validateTask(root, "evidence-gate"));
  assert.equal(validation.valid, false);
  assert(validation.errors.some((error) => error.includes("changed after it was recorded")));
});

test("delivery is final by default and a later objection reopens repair", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "objection-reopens");
  await beginImplementation(root, "objection-reopens");
  await beginPreUat(root, "objection-reopens");
  let evidence = await writeEvidence(root, "objection-reopens", "acceptance.txt", "journey passed");
  await recordAcceptanceResult(root, "objection-reopens", { acceptanceId: "AC-01", status: "passed", evidence });
  evidence = await writeEvidence(root, "objection-reopens", "tests.txt", "tests passed");
  await recordCheck(root, "objection-reopens", { name: "tests", command: "node --test", status: "passed", evidence });
  assert.equal((await markReady(root, "objection-reopens")).state.phase, "DELIVERED");

  const reopened = await recordIssue(root, "objection-reopens", {
    acceptanceId: "AC-01",
    status: "open",
    symptom: "The delivered response omits the requested field",
  });
  assert.equal(reopened.state.phase, "REPAIRING");
  assert.equal(reopened.state.readyAt, null);
  assert.equal(reopened.state.issues[0].status, "open");
});

test("only the current delivery phase is recognized as terminal", () => {
  assert.equal(isDeliveryTerminalPhase(PHASES.DELIVERED), true);
  assert.equal(isDeliveryTerminalPhase("READY_FOR_UAT"), false);
  assert.equal(isDeliveryTerminalPhase(PHASES.PRE_UAT), false);
});

test("schema v3 assisted acceptance cannot be self-declared passed", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01", {
    classification: "ASSISTED",
    title: "A person judges the prepared experience",
  })];
  await prepareApprovedTask(root, "assisted-boundary", { criteria });
  await beginImplementation(root, "assisted-boundary");
  await beginPreUat(root, "assisted-boundary");
  const evidence = await writeEvidence(root, "assisted-boundary", "prepared.txt", "prepared evidence");
  await assert.rejects(
    () => recordAcceptanceResult(root, "assisted-boundary", { acceptanceId: "AC-01", status: "passed", evidence }),
    (error) => error.code === "ASSISTED_REQUIRES_HUMAN_JUDGMENT",
  );
  const recorded = await recordAcceptanceResult(root, "assisted-boundary", {
    acceptanceId: "AC-01",
    status: "manual",
    summary: "Prepared for explicit human judgment",
    evidence,
  });
  assert.equal(recorded.state.results["AC-01"].status, "manual");
});

test("resolving an issue writes memory and invalidates the complete verification chain", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01"), criterion("AC-02")];
  await prepareApprovedTask(root, "repair-loop", { criteria, impactPaths: ["src/export"] });
  await beginImplementation(root, "repair-loop");
  await beginPreUat(root, "repair-loop");

  for (const item of criteria) {
    const evidence = await writeEvidence(root, "repair-loop", `${item.id}.txt`, `${item.id} passed`);
    await recordAcceptanceResult(root, "repair-loop", {
      acceptanceId: item.id,
      status: "passed",
      evidence,
    });
  }
  const tests = await writeEvidence(root, "repair-loop", "tests.txt", "tests passed");
  await recordCheck(root, "repair-loop", { name: "tests", command: "npm test", status: "passed", evidence: tests });

  await recordIssue(root, "repair-loop", {
    acceptanceId: "AC-01",
    status: "open",
    symptom: "The final page is omitted from the export",
  });
  const fix = await writeEvidence(root, "repair-loop", "fix.txt", "regression test passes");
  await recordIssue(root, "repair-loop", {
    id: "ISSUE-001",
    status: "resolved",
    rootCause: "Pagination stopped before consuming the final cursor",
    regression: "export_includes_final_page",
    invariant: "Every matching row is exported exactly once",
    paths: "src/export",
    tags: "pagination,export",
    evidence: fix,
  });

  const { state } = await loadTask(root, "repair-loop");
  assert.equal(state.results["AC-01"].status, "affected");
  assert.equal(state.results["AC-02"].status, "affected");
  assert.equal(state.checks.tests.status, "affected");
  assert.equal(state.issues[0].memoryId, "INC-2026-001");
  const memory = await searchMemory(root, "pagination src/export");
  assert.equal(memory.matches[0].id, "INC-2026-001");
});

test("shared impact paths mark old acceptance affected and block the new handoff", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "old-feature", {
    createdAt: "2020-01-01T00:00:00.000Z",
    acceptanceAt: "2020-01-01T00:01:00.000Z",
    solutionAt: "2020-01-01T00:02:00.000Z",
    impactPaths: ["src/shared"],
  });
  await beginImplementation(root, "old-feature");
  await beginPreUat(root, "old-feature");
  let evidence = await writeEvidence(root, "old-feature", "old-ac.txt", "old acceptance passed");
  await recordAcceptanceResult(root, "old-feature", { acceptanceId: "AC-01", status: "passed", evidence });
  evidence = await writeEvidence(root, "old-feature", "old-tests.txt", "old tests passed");
  await recordCheck(root, "old-feature", { name: "tests", command: "npm test", status: "passed", evidence });
  await markReady(root, "old-feature");

  const current = await prepareApprovedTask(root, "new-feature", {
    createdAt: "2021-01-01T00:00:00.000Z",
    acceptanceAt: "2021-01-01T00:01:00.000Z",
    solutionAt: "2021-01-01T00:02:00.000Z",
    impactPaths: ["src/shared/service"],
  });
  assert.equal(current.state.affectedDependencies[0].taskId, "old-feature");
  assert.equal((await loadTask(root, "old-feature")).state.results["AC-01"].status, "affected");

  await beginImplementation(root, "new-feature");
  await beginPreUat(root, "new-feature");
  evidence = await writeEvidence(root, "new-feature", "new-ac.txt", "new acceptance passed");
  await recordAcceptanceResult(root, "new-feature", { acceptanceId: "AC-01", status: "passed", evidence });
  evidence = await writeEvidence(root, "new-feature", "new-tests.txt", "new tests passed");
  await recordCheck(root, "new-feature", { name: "tests", command: "npm test", status: "passed", evidence });
  await assert.rejects(() => markReady(root, "new-feature"), (error) => error.code === "READINESS_BLOCKED");

  evidence = await writeEvidence(root, "old-feature", "old-ac-rerun.txt", "old acceptance rerun passed");
  await recordAcceptanceResult(root, "old-feature", { acceptanceId: "AC-01", status: "passed", evidence });
  evidence = await writeEvidence(root, "old-feature", "old-tests-rerun.txt", "old tests rerun passed");
  await recordCheck(root, "old-feature", { name: "tests", command: "npm test", status: "passed", evidence });
  assert.equal((await markReady(root, "new-feature")).state.phase, "DELIVERED");
});

test("the Skill CLI runs from a copied standalone directory", async (t) => {
  const root = await temporaryProject(t);
  const installRoot = path.join(root, "installed", "openatdd");
  const target = path.join(root, "target-project");
  await cp(path.resolve("skills/openatdd"), installRoot, { recursive: true });
  const script = path.join(installRoot, "scripts", "openatdd.mjs");
  await execFileAsync(process.execPath, [script, "init", "--root", target]);
  await execFileAsync(process.execPath, [script, "new", "portable", "--requirement", "Portable workflow", "--root", target]);
  const { stdout } = await execFileAsync(process.execPath, [script, "status", "portable", "--json", "--root", target]);
  assert.equal(JSON.parse(stdout).phase, "ACCEPTANCE_DRAFT");
  assert.match(await readFile(path.join(target, ".openatdd", "requirements", "portable.md"), "utf8"), /Portable workflow/);
});

test("acceptance validation rejects placeholders and duplicate IDs", async () => {
  const { validateAcceptance } = await import("../skills/openatdd/scripts/contracts.mjs");
  const duplicate = `${acceptanceMarkdown("invalid", [criterion("AC-01")])}\n${acceptanceMarkdown("invalid", [criterion("AC-01")])}`;
  const result = validateAcceptance(duplicate);
  assert(result.errors.some((error) => error.includes("Duplicate acceptance ID")));
  assert(validateAcceptance(acceptanceMarkdown("todo", [criterion("AC-01", { title: "TODO" })])).errors.length > 0);
});

test("human-facing templates and reports infer Chinese without a language option", async () => {
  const {
    acceptanceTemplate,
    solutionTemplate,
    validateAcceptance,
    validateSolution,
  } = await import("../skills/openatdd/scripts/contracts.mjs");
  const { renderTaskReport } = await import("../skills/openatdd/scripts/workflow.mjs");
  const template = acceptanceTemplate("chinese-flow", "让财务导出筛选后的订单");
  assert.match(template, /## 目标/);
  assert.doesNotMatch(template, /## Goal/);

  const chineseAcceptance = `# 验收卡：chinese-flow

## 目标

让财务导出筛选后的订单。

## 建议用户旅程

1. 财务人员筛选订单。
2. 财务人员导出并核对结果。

## 验收标准

### AC-01 [AUTO] [BLOCKING] 导出全部筛选结果
- 前提：财务人员已经筛选订单。
- 操作：财务人员执行导出。
- 结果：文件包含全部筛选结果且没有重复。
- 证据：解析导出文件并核对行数。

## 边界

- 不增加新的导出基础设施。
`;
  const acceptance = validateAcceptance(chineseAcceptance);
  assert.deepEqual(acceptance.errors, []);
  const solutionDraft = solutionTemplate("chinese-flow", acceptance.parsed.criteria);
  assert.match(solutionDraft, /## 推荐方案/);
  assert.doesNotMatch(solutionDraft, /## Recommendation/);

  const chineseSolution = `# 方案卡：chinese-flow

<!-- openatdd:recommendation -->
## 推荐方案

复用现有订单查询与 CSV 导出路径。
<!-- /openatdd:recommendation -->

<!-- openatdd:rationale -->
## 为什么适合当前项目

- 沿用现有边界，不增加新基础设施。
<!-- /openatdd:rationale -->

<!-- openatdd:changes -->
## 主要改动

- 增加筛选结果导出与确定性验证。
<!-- /openatdd:changes -->

<!-- openatdd:risks -->
## 风险

- 使用分页回归测试避免遗漏最后一页。
<!-- /openatdd:risks -->

<!-- openatdd:exclusions -->
## 明确排除

- 不增加队列或对象存储。
<!-- /openatdd:exclusions -->

## 实现细节

- 将当前筛选条件传给现有导出器。

## 影响路径

- \`src/export\`

## 验收追踪

| 验收 | 实现 | 验证 |
|---|---|---|
| AC-01 | 复用现有导出器 | 解析文件并核对全部行 |
`;
  assert.deepEqual(validateSolution(chineseSolution, acceptance.parsed.criteria, { progressive: true }).errors, []);
  const nonProgressiveOrder = `${chineseSolution
    .replace(/<!-- openatdd:risks -->[\s\S]*?<!-- \/openatdd:exclusions -->\n\n/, "")
    .trimEnd()}\n\n## 风险\n\n- 风险后置。\n\n## 明确排除\n\n- 排除项后置。\n`;
  assert(validateSolution(nonProgressiveOrder, acceptance.parsed.criteria, { progressive: true }).errors.some((error) => error.includes("progressive solution")));

  const state = {
    taskId: "chinese-flow",
    requirement: "让财务导出筛选后的订单",
    phase: "PRE_UAT",
    acceptance: { approvedAt: "2026-01-01T00:00:00.000Z", items: acceptance.parsed.criteria },
    solution: { approvedAt: "2026-01-01T00:01:00.000Z" },
    verification: { epoch: 1 },
    results: {},
    checks: {},
    issues: [],
    affectedDependencies: [],
    preflight: {},
    uat: {},
    timing: { phases: [] },
    readyAt: null,
  };
  const report = renderTaskReport(state);
  assert.match(report, /^# 交付报告：/);
  assert.match(report, /### 验收结果/);
  assert.doesNotMatch(report, /# Delivery report/);
});

async function quickCards(root, taskId, options = {}) {
  const criteria = options.criteria ?? [criterion("AC-01")];
  await createTask(root, taskId, options.requirement ?? `Deliver ${taskId}`, clock("2026-03-01T00:00:00.000Z"));
  await assessTask(root, taskId, {
    scope: "local",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "low",
    ...options.assessment,
  }, clock("2026-03-01T00:00:01.000Z"));
  await writeAcceptance(root, taskId, criteria);
  await writeSolution(root, taskId, criteria);
  return criteria;
}

test("advance runs the whole Quick autonomous approval chain in one invocation", async (t) => {
  const root = await temporaryProject(t);
  await quickCards(root, "quick-advance");
  const result = await advanceQuickTask(root, "quick-advance", {
    summary: "The smallest project-fitting patch covers the approved acceptance.",
  }, clock("2026-03-01T00:00:02.000Z"));
  assert.equal(result.state.phase, "IMPLEMENTING");
  assert.deepEqual(
    result.steps.filter((step) => step.performed).map((step) => step.step),
    ["approve-acceptance", "draft-solution", "review-solution", "approve-solution", "begin"],
  );
  assert.equal(result.state.reviews.solution.reviewer, "main");
  const chain = ["ACCEPTANCE_APPROVED", "SOLUTION_DRAFTED", "SOLUTION_REVIEWED", "SOLUTION_APPROVED", "IMPLEMENTATION_STARTED"];
  assert.deepEqual(result.state.history.map((item) => item.event).filter((event) => chain.includes(event)), chain);

  // Re-running advance is idempotent recovery, not a duplicate approval.
  const repeated = await advanceQuickTask(root, "quick-advance", {}, clock("2026-03-01T00:00:03.000Z"));
  assert.equal(repeated.state.phase, "IMPLEMENTING");
  assert.deepEqual(repeated.steps.filter((step) => step.performed).map((step) => step.step), ["begin"]);
});

test("advance rejects Standard and Deep lanes so both human confirmations stay separate", async (t) => {
  const root = await temporaryProject(t);
  await quickCards(root, "standard-advance", {
    assessment: { scope: "cross-module", uncertainty: "medium" },
  });
  await assert.rejects(
    () => advanceQuickTask(root, "standard-advance", { summary: "A concise review finding." }),
    (error) => error.code === "ADVANCE_REQUIRES_QUICK",
  );
});

test("advance stops at the authorization gate and resumes after the recorded decision", async (t) => {
  const root = await temporaryProject(t);
  await quickCards(root, "quick-advance-authorization", {
    assessment: { riskSignals: ["deletion"] },
  });
  await assert.rejects(
    () => advanceQuickTask(root, "quick-advance-authorization", { summary: "The deletion path is the smallest fitting change." }),
    (error) => error.code === "AUTHORIZATION_DECISION_REQUIRED",
  );
  const { state } = await loadTask(root, "quick-advance-authorization");
  assert.equal(state.phase, "SOLUTION_DRAFT");
  assert.equal(Boolean(state.acceptance.approvedAt), true);

  await recordTaskDecision(root, "quick-advance-authorization", {
    owner: "authorization",
    coversOverlays: ["deletion"],
    question: "May the stale exports be purged in this delivery?",
    options: [
      { id: "authorize", label: "Authorize the purge", consequence: "Stale exports are removed." },
      { id: "defer", label: "Defer to a later delivery", consequence: "Nothing is removed now." },
    ],
    recommendation: "authorize",
    recommendationBasis: "The exports are regenerated fixtures with no retention requirement.",
    status: "resolved",
    resolution: { optionId: "authorize", rationale: "The owner authorized the purge." },
  });
  const resumed = await advanceQuickTask(root, "quick-advance-authorization", {
    summary: "The deletion path is the smallest fitting change.",
  });
  assert.equal(resumed.state.phase, "IMPLEMENTING");
  assert.deepEqual(
    resumed.steps.filter((step) => step.performed).map((step) => step.step),
    ["approve-solution", "begin"],
  );
});

test("CLI new accepts inline assessment and returns related knowledge hits", async (t) => {
  const script = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  const root = await temporaryProject(t);
  await initProject(root);
  await writeFile(projectFiles(root).projectTruth, `# Project truth

## Product rules

- Export button state is deterministic.

## Architecture boundaries

## Technical decisions
`);
  const created = await execFileAsync(process.execPath, [
    script, "new", "one-turn-create", "--requirement", "Fix the export button state",
    "--scope", "local", "--project-pattern", "established",
    "--reversibility", "reversible", "--uncertainty", "low",
    "--json", "--root", root,
  ]);
  const payload = JSON.parse(created.stdout);
  assert.equal(payload.phase, "ACCEPTANCE_DRAFT");
  assert.equal(payload.routing.lane, "quick");
  assert(Array.isArray(payload.knowledge.memory.matches));
  assert(Array.isArray(payload.knowledge.graph.matches));
  assert.equal(payload.knowledge.graph.projectTruth.path, "project:.openatdd/knowledge/project.md");
  assert.deepEqual(Object.keys(payload.knowledge.graph.projectTruth).sort(), ["path", "sha256", "size", "title"]);
  assert(!payload.knowledge.graph.matches.some((match) => match.node.type === "ProjectTruth"));
  assert(!created.stdout.includes("Export button state is deterministic."));
  assert.deepEqual(payload.knowledge.warnings, []);

  // A partial assessment is rejected instead of guessed.
  await assert.rejects(
    () => execFileAsync(process.execPath, [
      script, "new", "partial-assess", "--requirement", "Another change",
      "--scope", "local", "--json", "--root", root,
    ]),
    (error) => error.stderr.includes("--project-pattern"),
  );
});

test("CLI advance and approve-solution --begin remove approval round trips", async (t) => {
  const script = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  const root = await temporaryProject(t);
  await quickCards(root, "cli-advance");
  const advanced = await execFileAsync(process.execPath, [
    script, "advance", "cli-advance",
    "--summary", "The smallest project-fitting patch covers the approved acceptance.",
    "--json", "--root", root,
  ]);
  const payload = JSON.parse(advanced.stdout);
  assert.equal(payload.phase, "IMPLEMENTING");
  assert.equal(payload.steps.filter((step) => step.performed).length, 5);

  const merged = await temporaryProject(t);
  await prepareApprovedTask(merged, "merged-begin");
  const approved = await execFileAsync(process.execPath, [
    script, "approve-solution", "merged-begin", "--begin", "--json", "--root", merged,
  ]);
  assert.equal(JSON.parse(approved.stdout).phase, "IMPLEMENTING");
});
