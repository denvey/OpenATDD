import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createMockAdapter, runAgentEvaluation } from "../skills/openatdd/scripts/agent-eval.mjs";
import {
  buildStrategyRetrospective,
  capabilityProfile,
  renderStrategyRetrospective,
  writeStrategyRetrospective,
} from "../skills/openatdd/scripts/strategy.mjs";
import { beginImplementation, loadTask, taskFiles } from "../skills/openatdd/scripts/workflow.mjs";
import { prepareApprovedTask, temporaryProject } from "./helpers.mjs";

const execFileAsync = promisify(execFile);

async function simplicityScenario() {
  const target = path.resolve("evals", "agent", "scenarios", "simplicity.v1.json");
  return { target, value: JSON.parse(await readFile(target, "utf8")) };
}

test("retrospective separates selected capabilities, observed execution, and unused options", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "strategy-standard", {
    requirement: "完成后回溯本次采用的能力",
    assessment: {
      scope: "cross-module",
      projectPattern: "established",
      reversibility: "reversible",
      uncertainty: "medium",
    },
  });
  await beginImplementation(root, "strategy-standard");
  const { state } = await loadTask(root, "strategy-standard");
  const result = buildStrategyRetrospective(state, [], () => new Date("2026-07-24T00:00:00.000Z"));

  assert.equal(result.language, "zh-CN");
  assert.equal(result.lane, "standard");
  assert(result.summary.selectedCapabilities.includes("scoped-context-recovery"));
  assert(result.summary.observedCapabilities.includes("progressive-solution-review"));
  assert(result.summary.notUsedCapabilities.includes("conditional-agents"));
  assert(result.summary.notUsedCapabilities.includes("risk-research"));
  assert.equal(result.metrics.approvals, 2);
  assert.equal(result.metrics.agents.total, 0);
  assert.match(renderStrategyRetrospective(result), /借鉴来源/);
  assert.match(renderStrategyRetrospective(result), /不表示运行外部框架/);

  const quickState = structuredClone(state);
  quickState.routing.lane = "quick";
  quickState.routing.reasons = ["local-scope", "established-project-pattern", "low-uncertainty", "reversible"];
  quickState.routing.investigation.externalResearch = false;
  quickState.routing.agents = { policy: "none", roles: [] };
  quickState.context = { status: "not_prepared", path: null, digest: null, sourceDigests: {} };
  const quick = buildStrategyRetrospective(quickState);
  assert(!quick.summary.selectedCapabilities.includes("scoped-context-recovery"));
  assert(!quick.summary.selectedCapabilities.includes("conditional-agents"));

  const deepState = structuredClone(state);
  deepState.routing.lane = "deep";
  deepState.routing.reasons = ["hard-escalator:privacy"];
  deepState.routing.investigation.externalResearch = true;
  deepState.routing.agents = { policy: "required", roles: ["independent-review", "external-research"] };
  const deep = buildStrategyRetrospective(deepState);
  assert(deep.summary.selectedCapabilities.includes("risk-research"));
  assert(deep.summary.selectedCapabilities.includes("conditional-agents"));
});

test("retrospective is generated only when explicitly requested and leaves task state unchanged", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "manual-retrospect", { requirement: "手动生成回溯" });
  await beginImplementation(root, "manual-retrospect");
  const files = taskFiles(root, "manual-retrospect");
  const before = await readFile(files.state, "utf8");
  await assert.rejects(() => readFile(files.retrospective, "utf8"), (error) => error.code === "ENOENT");

  const loaded = await loadTask(root, "manual-retrospect");
  const generated = await writeStrategyRetrospective(root, loaded.state, loaded.files);
  assert.match(generated.summary, /策略回溯/);
  assert.match(await readFile(files.retrospective, "utf8"), /一屏结论/);
  assert.equal(JSON.parse(await readFile(files.retrospectiveJson, "utf8")).taskId, "manual-retrospect");
  assert.equal(await readFile(files.state, "utf8"), before);
});

test("evaluation profiles preserve cached tokens and compare capability ablations", async (t) => {
  const loaded = await simplicityScenario();
  const primary = structuredClone(loaded.value.mock.primary);
  primary.metrics = { inputTokens: 100, cachedInputTokens: 60, outputTokens: 10, durationMs: 10 };
  const baseline = structuredClone(primary);
  baseline.metrics = { inputTokens: 80, cachedInputTokens: 50, outputTokens: 10, durationMs: 8 };
  const ablated = structuredClone(loaded.value.mock.bareAgent);
  ablated.metrics = { inputTokens: 70, cachedInputTokens: 40, outputTokens: 12, durationMs: 7 };

  const report = await runAgentEvaluation({
    scenarioPath: loaded.target,
    adapter: createMockAdapter(primary),
    baselineAdapter: createMockAdapter(baseline, { name: "bare-equal-quality" }),
    strategyProfile: capabilityProfile("full"),
    ablationAdapters: [{
      capabilityId: "progressive-solution-review",
      profile: capabilityProfile("without-progressive-solution-review", ["progressive-solution-review"]),
      adapter: createMockAdapter(ablated, { name: "without-review" }),
    }],
    repetitions: 2,
    reportPath: false,
  });

  assert.equal(report.primary.summary.inputTokens, 200);
  assert.equal(report.primary.summary.cachedInputTokens, 120);
  assert.equal(report.primary.summary.uncachedInputTokens, 80);
  assert.equal(report.ablations[0].profile.disabledCapabilities[0], "progressive-solution-review");
  assert.equal(report.ablationComparisons[0].passRateDelta, 1);
  assert.equal(report.claims.fixtureOnly, true);
});

test("real CLI writes an on-demand retrospective with an optional evaluation report", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "cli-retrospect", { requirement: "完成后查看策略回溯" });
  await beginImplementation(root, "cli-retrospect");
  const scenario = await simplicityScenario();
  const reportPath = path.join(root, "agent-eval.json");
  await runAgentEvaluation({
    scenarioPath: scenario.target,
    adapter: createMockAdapter(scenario.value.mock.primary),
    reportPath,
    repetitions: 1,
  });

  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  const observed = await execFileAsync(process.execPath, [
    cli,
    "retrospect",
    "cli-retrospect",
    "--root",
    root,
    "--eval-report",
    "agent-eval.json",
    "--json",
  ]);
  const result = JSON.parse(observed.stdout);
  assert.equal(result.taskId, "cli-retrospect");
  assert.equal(result.metrics.evaluationGroups.length, 1);
  assert(result.summary.observedCapabilities.includes("agent-evaluation"));
  const markdown = await readFile(taskFiles(root, "cli-retrospect").retrospective, "utf8");
  assert.match(markdown, /agent-eval\.json/);
});
