import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  agentEvalVersions,
  createCodexAdapter,
  createCommandAdapter,
  createMockAdapter,
  runAgentEvaluation,
  verifyAgentEvaluationReport,
} from "../skills/openatdd/scripts/agent-eval.mjs";

const scenariosRoot = path.resolve("evals", "agent", "scenarios");

async function scenario(name) {
  const scenarioPath = path.join(scenariosRoot, name);
  return { scenarioPath, value: JSON.parse(await readFile(scenarioPath, "utf8")) };
}

test("versioned mock scenarios measure routing, interaction, acceptance, repeatability, tokens, and time", async (t) => {
  assert.deepEqual(agentEvalVersions, { scenario: 1, rubric: 1 });
  const names = (await readdir(scenariosRoot)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(names, [
    "graph-impact.v1.json",
    "high-risk-escalation.v1.json",
    "quick-no-research.v1.json",
    "recovery.v1.json",
    "simplicity.v1.json",
  ]);

  const reports = new Map();
  for (const name of names) {
    await t.test(name, async () => {
      const loaded = await scenario(name);
      const report = await runAgentEvaluation({
        scenarioPath: loaded.scenarioPath,
        adapter: createMockAdapter(loaded.value.mock.primary),
        reportPath: false,
        clock: () => new Date("2026-07-24T00:00:00.000Z"),
      });
      reports.set(name, report);
      assert.equal(report.primary.adapter.kind, "mock");
      assert.equal(report.primary.adapter.realModelEvaluated, false);
      assert.equal(report.claims.fixtureOnly, true);
      assert.equal(report.claims.realModelPassClaimed, false);
      assert.equal(report.primary.summary.runs, 2);
      assert.equal(report.primary.summary.passRate, 1);
      assert.equal(report.primary.summary.firstPassAcceptanceRate, 1);
      assert.equal(report.primary.summary.repeatableOutcome, true);
      assert.equal(report.primary.summary.distinctTranscripts, 1);
      assert.equal(report.primary.summary.scoreRange, 0);
      assert(Number.isFinite(report.primary.summary.inputTokens));
      assert(Number.isFinite(report.primary.summary.outputTokens));
      assert(Number.isFinite(report.primary.summary.durationMs));
      assert(report.primary.runs.every((run) => run.transcript.length > 0));
      assert(report.primary.runs.every((run) => run.observation.hiddenChecks.every((check) => check.passed)));
    });
  }

  assert.equal(reports.get("quick-no-research.v1.json").primary.summary.humanTurns, 0);
  assert.equal(reports.get("quick-no-research.v1.json").primary.summary.researchMisroutes, 0);
  assert.equal(reports.get("high-risk-escalation.v1.json").primary.summary.humanTurns, 2);
  assert.equal(reports.get("high-risk-escalation.v1.json").primary.summary.missedDecisions, 0);
  assert.equal(reports.get("simplicity.v1.json").primary.summary.overEngineeringMarkers, 0);
  assert.equal(reports.get("recovery.v1.json").primary.summary.humanTurns, 0);
  assert.equal(reports.get("graph-impact.v1.json").primary.summary.firstPassAcceptanceRate, 1);
});

test("optional bare-agent baseline is scored independently and a JSON report is written", async (t) => {
  const loaded = await scenario("simplicity.v1.json");
  const directory = await mkdtemp(path.join(tmpdir(), "openatdd-agent-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, "simplicity-report.json");
  const report = await runAgentEvaluation({
    scenarioPath: loaded.scenarioPath,
    adapter: createMockAdapter(loaded.value.mock.primary),
    baselineAdapter: createMockAdapter(loaded.value.mock.bareAgent, { name: "bare-mock" }),
    reportPath,
    clock: () => new Date("2026-07-24T00:00:00.000Z"),
  });

  assert.equal(report.primary.summary.passRate, 1);
  assert.equal(report.baseline.summary.passRate, 0);
  assert(report.baseline.summary.unnecessaryQuestions > 0);
  assert(report.baseline.summary.researchMisroutes > 0);
  assert(report.baseline.summary.overEngineeringMarkers > 0);
  assert(report.baseline.summary.contractViolations > 0);
  assert.equal(report.baseline.summary.firstPassAcceptanceRate, 0);
  assert(report.comparison.meanScoreDelta > 0);
  assert.equal(report.claims.realModelPassClaimed, false);

  const persisted = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(persisted.scenario.id, "agent-simplicity-v1");
  assert.equal(persisted.primary.runs[0].transcript[0].type, "recommendation");
  assert.equal(persisted.baseline.adapter.provenance, "deterministic-fixture");
});

test("command adapter receives only the prompt while hidden commands run afterward", async (t) => {
  const loaded = await scenario("quick-no-research.v1.json");
  const child = `
const fs = require("node:fs");
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync("captured-prompt.txt", prompt);
  fs.writeFileSync("agent-result.json", JSON.stringify({ lane: "quick", externalResearch: false, approach: "reuse-shared-tooltip" }));
  process.stdout.write(JSON.stringify({
    transcript: [{ role: "assistant", type: "recommendation", text: "Reuse the shared Tooltip." }],
    actions: [{ type: "route", lane: "quick" }, { type: "local-discovery" }],
    decisions: { raised: [], resolved: [] },
    architecture: ["shared Tooltip component"],
    metrics: { inputTokens: 12, outputTokens: 5 }
  }));
});`;
  const adapter = createCommandAdapter({
    name: "argv-fixture",
    argv: [process.execPath, "-e", child],
    model: "fixture-model",
    reasoningEffort: "low",
  });
  const report = await runAgentEvaluation({
    scenarioPath: loaded.scenarioPath,
    adapter,
    repetitions: 1,
    reportPath: false,
    keepWorkspace: true,
  });
  const workspace = report.primary.runs[0].workspace;
  t.after(() => rm(workspace, { recursive: true, force: true }));

  assert.equal(report.primary.adapter.kind, "command");
  assert.equal(report.primary.adapter.realModelEvaluated, false);
  assert.equal(report.primary.adapter.model, "fixture-model");
  assert.equal(report.primary.adapter.reasoningEffort, "low");
  assert.equal(report.primary.summary.passRate, 1);
  assert.equal(report.primary.summary.inputTokens, 12);
  assert.equal(report.primary.summary.outputTokens, 5);
  assert.equal(report.primary.runs[0].observation.firstPassAcceptance, true);
  assert.equal(report.claims.realModelPassClaimed, false);
  assert.equal(await readFile(path.join(workspace, "captured-prompt.txt"), "utf8"), loaded.value.prompt);
  const serialized = JSON.stringify(report);
  assert(!serialized.includes("fs.readFileSync('agent-result.json'"), "Hidden command source must not be copied into the report or prompt transcript.");
});

test("behavior scoring catches missed human decisions even when hidden implementation checks pass", async () => {
  const loaded = await scenario("high-risk-escalation.v1.json");
  const misleading = {
    transcript: [{ role: "assistant", type: "recommendation", text: "Proceed directly with a local change." }],
    actions: [{ type: "route", lane: "quick" }],
    decisions: { raised: [], resolved: [] },
    architecture: ["existing account service"],
    contractViolations: [],
    writes: {
      "agent-result.json": {
        lane: "deep",
        research: true,
        pendingDecision: "retention-policy",
        productCodeChanged: false
      }
    },
    metrics: { inputTokens: 20, outputTokens: 8, durationMs: 2 }
  };
  const report = await runAgentEvaluation({
    scenarioPath: loaded.scenarioPath,
    adapter: createMockAdapter(misleading),
    repetitions: 1,
    reportPath: false,
  });
  const run = report.primary.runs[0];

  assert.equal(run.observation.firstPassAcceptance, true);
  assert.deepEqual(run.observation.missedDecisions, ["retention-policy"]);
  assert.deepEqual(run.observation.researchMisroutes, ["missing-required-external-research"]);
  assert.deepEqual(run.observation.contractViolations, ["lane:quick->deep"]);
  assert.equal(run.scoring.gates.hiddenChecks, true);
  assert.equal(run.scoring.gates.decisions, false);
  assert.equal(run.scoring.gates.contract, false);
  assert.equal(run.scoring.passed, false);
});

test("real-model claims require a complete pass and bundled reports are mechanically verified", async (t) => {
  const loaded = await scenario("quick-no-research.v1.json");
  const directory = await mkdtemp(path.join(tmpdir(), "openatdd-real-agent-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, "real.json");
  const child = `
const fs = require("node:fs");
process.stdin.resume();
process.stdin.on("end", () => {
  fs.writeFileSync("agent-result.json", JSON.stringify({ lane: "quick", externalResearch: false, approach: "reuse-shared-tooltip" }));
  process.stdout.write(JSON.stringify({
    transcript: ["Reuse the shared Tooltip."],
    actions: [{ type: "route", lane: "quick" }, { type: "local-discovery" }],
    decisions: { raised: [], resolved: [] },
    architecture: ["shared Tooltip component"]
  }));
});`;
  const adapter = createCommandAdapter({
    name: "codex-test-double",
    argv: [process.execPath, "-e", child],
    provenance: "bundled-codex-exec-adapter",
    realModel: true,
  });
  const report = await runAgentEvaluation({
    scenarioPath: loaded.scenarioPath,
    adapter,
    ablationAdapters: [{
      capabilityId: "risk-research",
      profile: { name: "without-risk-research", enabledCapabilities: [], disabledCapabilities: ["risk-research"] },
      adapter,
    }],
    repetitions: 2,
    reportPath,
  });
  assert.equal(report.claims.fixtureOnly, false);
  assert.equal(report.claims.realModelPassClaimed, true);
  const verified = await verifyAgentEvaluationReport(reportPath, { minimumRuns: 2, requiredAblations: ["risk-research"] });
  assert.equal(verified.valid, true);
  assert.equal(verified.primary.runs, 2);
  assert.equal(verified.ablations[0].capabilityId, "risk-research");

  const failing = await runAgentEvaluation({
    scenarioPath: loaded.scenarioPath,
    adapter: createCommandAdapter({
      argv: [process.execPath, "-e", "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({transcript:['No artifact'],actions:[{type:'route',lane:'quick'}]})))"],
      realModel: true,
    }),
    repetitions: 1,
    reportPath: false,
  });
  assert.equal(failing.primary.summary.passRate, 0);
  assert.equal(failing.claims.realModelPassClaimed, false);
});

test("bundled Codex adapters distinguish OpenATDD and bare real-model runs", () => {
  const primary = createCodexAdapter({ model: "gpt-5.6-terra", reasoningEffort: "medium" });
  const baseline = createCodexAdapter({ bare: true, model: "gpt-5.6-terra", reasoningEffort: "medium" });
  assert.equal(primary.realModel, true);
  assert.equal(primary.name, "codex-openatdd");
  assert.equal(primary.provenance, "bundled-codex-exec-adapter");
  assert.equal(primary.model, "gpt-5.6-terra");
  assert.equal(primary.reasoningEffort, "medium");
  assert.deepEqual(primary.argv.slice(-4), ["--model", "gpt-5.6-terra", "--reasoning-effort", "medium"]);
  assert.equal(baseline.realModel, true);
  assert.equal(baseline.name, "codex-bare");
  assert.equal(baseline.model, primary.model);
  assert.equal(baseline.reasoningEffort, primary.reasoningEffort);
});
