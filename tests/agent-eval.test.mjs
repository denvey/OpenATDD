import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDeliveryPrompt, buildFullContractPrompt, buildFullImplementationPrompt, codexExecArgv, commandEvents, minimalCodexConfig, validateFullContractChanges } from "../skills/openatdd/scripts/codex-agent-adapter.mjs";
import {
  agentEvalVersions,
  compareDeliverySummaryObjects,
  createCodexAdapter,
  createCommandAdapter,
  createMockAdapter,
  runAgentEvaluation,
  runDeliveryEvaluation,
  summarizeDeliveryEvaluationReports,
  verifyAgentEvaluationReport,
} from "../skills/openatdd/scripts/agent-eval.mjs";

const scenariosRoot = path.resolve("evals", "agent", "scenarios");

async function scenario(name) {
  const scenarioPath = path.join(scenariosRoot, name);
  return { scenarioPath, value: JSON.parse(await readFile(scenarioPath, "utf8")) };
}

test("versioned mock scenarios measure routing, interaction, acceptance, repeatability, tokens, and time", async (t) => {
  assert.deepEqual(agentEvalVersions, { scenario: 1, deliveryScenario: 2, deliveryReport: 2, rubric: 1 });
  const names = (await readdir(scenariosRoot)).filter((name) => name.endsWith(".v1.json")).sort();
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
  const isolated = createCodexAdapter({ model: "gpt-5.6-terra", reasoningEffort: "medium", isolateUserConfig: true });
  assert.equal(primary.realModel, true);
  assert.equal(primary.name, "codex-openatdd");
  assert.equal(primary.provenance, "bundled-codex-exec-adapter");
  assert.equal(primary.model, "gpt-5.6-terra");
  assert.equal(primary.reasoningEffort, "medium");
  assert.equal(primary.configMode, "user");
  assert(primary.argv.includes("gpt-5.6-terra"));
  assert(primary.argv.includes("medium"));
  assert.equal(primary.argv[primary.argv.indexOf("--timeout-ms") + 1], "240000");
  assert.equal(baseline.realModel, true);
  assert.equal(baseline.name, "codex-bare");
  assert.equal(baseline.model, primary.model);
  assert.equal(baseline.reasoningEffort, primary.reasoningEffort);
  assert.equal(baseline.configMode, "user");
  assert.equal(isolated.configMode, "isolated");
  assert(isolated.argv.includes("--isolated-config"));
  const delivery = createCodexAdapter({ evaluationMode: "delivery", profile: "thin-atdd" });
  assert.equal(delivery.argv[delivery.argv.indexOf("--timeout-ms") + 1], "600000");
  assert.equal(delivery.configMode, "user-provider-minimal");
});

test("bundled Codex exec loads user config by default and isolates only when requested", () => {
  const configured = codexExecArgv("/tmp/schema.json", "/tmp/output.json", { reasoningEffort: "medium" });
  const isolated = codexExecArgv("/tmp/schema.json", "/tmp/output.json", {
    reasoningEffort: "medium",
    isolateUserConfig: true,
  });

  assert(!configured.includes("--ignore-user-config"));
  assert(isolated.includes("--ignore-user-config"));
  assert(configured.includes("--ignore-rules"));
});

test("delivery prompts keep the bare profile free of OpenATDD answer cues", () => {
  const request = "Implement the requested local feature.";
  const bare = buildDeliveryPrompt(request, "bare");
  const thin = buildDeliveryPrompt(request, "thin-atdd", "THIN_PROFILE_MARKER");
  const full = buildDeliveryPrompt(request, "full-openatdd", "FULL_SKILL_MARKER");

  assert.match(bare, /Implement the requested local feature/);
  assert.doesNotMatch(bare, /Quick|Standard|Deep|retention-policy|hidden check|OpenATDD/i);
  assert.match(thin, /THIN_PROFILE_MARKER/);
  assert.doesNotMatch(thin, /FULL_SKILL_MARKER/);
  assert.match(full, /FULL_SKILL_MARKER/);
  assert.match(full, /authorized.*autonomous continuation/i);
  const deliveryArgv = codexExecArgv(null, "/tmp/output.json", { reasoningEffort: "medium" });
  assert(!deliveryArgv.includes("--output-schema"));
  const minimalDeliveryArgv = codexExecArgv(null, "/tmp/output.json", { reasoningEffort: "medium", minimalRuntime: true });
  assert(minimalDeliveryArgv.includes("plugins"));
  assert(minimalDeliveryArgv.includes("remote_plugin"));
  assert(minimalDeliveryArgv.includes("skill_search"));
});

test("delivery v2 profiles stay bounded and full delivery no longer embeds the complete Skill", async () => {
  const thin = await readFile(path.resolve("evals", "agent", "profiles", "thin-atdd.v2.md"), "utf8");
  const full = await readFile(path.resolve("evals", "agent", "profiles", "full-openatdd-runtime.v2.md"), "utf8");
  const skill = await readFile(path.resolve("skills", "openatdd", "SKILL.md"), "utf8");
  assert(Buffer.byteLength(thin) <= 1024);
  assert(Buffer.byteLength(full) <= 4096);
  assert.match(thin, /do not read other Skills/i);
  assert.match(full, /host enforces two clean phases/i);
  assert(!full.includes(skill));
  const contractPrompt = buildFullContractPrompt("Implement search.", full);
  assert.match(contractPrompt, /Phase 1 only/);
  assert.match(contractPrompt, /implementation is forbidden/);
  const implementationPrompt = buildFullImplementationPrompt("Implement search.", full, "ACCEPTANCE", "PLAN");
  assert.match(implementationPrompt, /host approved and froze/i);
  assert.match(implementationPrompt, /Do not rewrite the contracts/);
  assert.match(implementationPrompt, /<seed-project>/);
  assert.match(implementationPrompt, /cover every frozen acceptance criterion with an executed assertion/i);
  assert.match(full, /Assert exact values and boundary\/denial side effects directly/i);
  assert.match(implementationPrompt, /ACCEPTANCE/);
  assert.match(implementationPrompt, /PLAN/);

  const complexScenario = JSON.parse(await readFile(path.resolve("evals", "agent", "scenarios", "delivery-complex.v2.json"), "utf8"));
  assert.match(complexScenario.prompt, /now.*always a JavaScript `Date`/);
  assert.match(complexScenario.prompt, /ISO strings that round-trip to the exact instants/);
  assert.match(complexScenario.prompt, /successful request, restore, and account purge state transition appends exactly one audit event/);
  assert.match(complexScenario.prompt, /Repeating it while already pending returns a safe copy of the same unchanged pending account/);
  assert.match(complexScenario.prompt, /sets name and email to `null`/);
  assert.match(complexScenario.prompt, /repeated purge returns an empty array/);
});

test("Codex command lifecycle events collapse to one real invocation without hiding retries", () => {
  const line = (id, command, status, exitCode = null) => JSON.stringify({
    item: { id, type: "command_execution", command, status, exit_code: exitCode },
  });
  const observed = commandEvents([
    line("cmd-1", "npm test", "in_progress"),
    line("cmd-1", "npm test", "completed", 0),
    line("cmd-2", "npm test", "in_progress"),
    line("cmd-2", "npm test", "failed", 1),
    line(null, "node smoke.mjs", "in_progress"),
    line(null, "node smoke.mjs", "completed", 0),
    line(null, "node smoke.mjs", "completed", 0),
  ].join("\n"));
  assert.deepEqual(observed, [
    { command: "npm test", status: "completed", exitCode: 0 },
    { command: "npm test", status: "failed", exitCode: 1 },
    { command: "node smoke.mjs", status: "completed", exitCode: 0 },
    { command: "node smoke.mjs", status: "completed", exitCode: 0 },
  ]);
});

test("host-gated full delivery allows only frozen contract artifacts before implementation", () => {
  const before = { "src/app.mjs": "source-v1" };
  const contracts = { ...before, "ACCEPTANCE.md": "acceptance", "TECHNICAL_PLAN.md": "plan" };
  assert.deepEqual(validateFullContractChanges(before, contracts), ["ACCEPTANCE.md", "TECHNICAL_PLAN.md"]);
  assert.throws(
    () => validateFullContractChanges(before, { ...contracts, "src/app.mjs": "source-v2" }),
    /changed product files: src\/app\.mjs/,
  );
  assert.throws(
    () => validateFullContractChanges(before, { ...before, "TECHNICAL_PLAN.md": "plan" }),
    /must create ACCEPTANCE\.md and TECHNICAL_PLAN\.md/,
  );
});

test("delivery optimization comparison enforces cost reductions without trading away quality", () => {
  const quality = {
    runs: 6,
    passedRuns: 6,
    passRate: 1,
    falseReadyRate: 0,
    selfVerificationRate: 1,
    technicalPlanRate: 1,
    handoffCompleteRate: 1,
  };
  const baseline = {
    schemaVersion: 1,
    totals: {
      bare: { ...quality, inputTokens: 100, durationMs: 100 },
      "thin-atdd": { ...quality, inputTokens: 200, durationMs: 200 },
      "full-openatdd": { ...quality, inputTokens: 1000, durationMs: 1000 },
    },
  };
  const candidate = {
    schemaVersion: 1,
    totals: {
      bare: { ...quality, inputTokens: 100, durationMs: 100 },
      "thin-atdd": { ...quality, inputTokens: 160, durationMs: 170 },
      "full-openatdd": { ...quality, inputTokens: 180, durationMs: 400 },
    },
  };
  const passing = compareDeliverySummaryObjects(baseline, candidate, { clock: () => new Date("2026-07-29T00:00:00.000Z") });
  assert.equal(passing.passed, true);
  assert.equal(passing.profiles[0].inputTokensReduction, 0.2);
  assert.equal(passing.profiles[1].candidateBareInputMultiple, 1.8);
  const failing = compareDeliverySummaryObjects(baseline, {
    ...candidate,
    totals: { ...candidate.totals, "full-openatdd": { ...candidate.totals["full-openatdd"], passRate: 0.5 } },
  });
  assert.equal(failing.passed, false);
  assert.equal(failing.checks.find((check) => check.id === "full-openatdd-quality").passed, false);
});

test("delivery runtime keeps the configured provider without loading unrelated MCP servers", () => {
  const minimal = minimalCodexConfig(`model_provider = "custom"\nmodel = "ignored"\n\n[mcp_servers.required-remote]\nurl = "https://example.invalid"\n\n[model_providers.custom]\nname = "custom"\nwire_api = "responses"\nbase_url = "http://provider.test/v1"\nexperimental_bearer_token = "fixture-token"\n\n[notice]\nvalue = true\n`);
  assert.match(minimal, /^model_provider = "custom"/);
  assert.match(minimal, /\[model_providers\.custom\]/);
  assert.match(minimal, /fixture-token/);
  assert.doesNotMatch(minimal, /mcp_servers|required-remote|\[notice\]/);
});

test("schema-v2 delivery evaluation compares isolated profiles and detects false readiness", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "openatdd-delivery-eval-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const seed = path.join(directory, "seed");
  await mkdir(seed, { recursive: true });
  await writeFile(path.join(seed, "seed.txt"), "seed\n");
  await writeFile(path.join(directory, "rubric.json"), JSON.stringify({
    schemaVersion: 1,
    name: "delivery fixture",
    passScore: 100,
    penalties: {},
    gates: { requireHiddenChecks: true },
  }));
  const scenarioPath = path.join(directory, "delivery.v2.json");
  await writeFile(scenarioPath, JSON.stringify({
    schemaVersion: 2,
    kind: "delivery",
    difficulty: "simple",
    id: "delivery-fixture-v2",
    rubric: "./rubric.json",
    repetitions: 1,
    prompt: "Implement the fixture.",
    seed: { directory: "./seed" },
    hiddenChecks: [{
      id: "done-file",
      argv: [process.execPath, "-e", "const fs=require('node:fs');process.exit(fs.existsSync('done.txt')?0:1)"],
      expect: { exitCode: 0 },
    }],
  }));
  const completedFixture = (profileName, withPlan) => ({
    transcript: [{ role: "assistant", type: "message", text: "Implemented the change. Verification passed. Run npm test to try it." }],
    commands: [{ command: "npm test", status: "completed", exitCode: 0 }],
    profile: { name: profileName, bytes: profileName.length, sha256: profileName },
    writes: {
      "done.txt": "done\n",
      ...(withPlan ? { "TECHNICAL_PLAN.md": "plan\n" } : {}),
    },
    metrics: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, durationMs: 5 },
  });
  const reportPath = path.join(directory, "delivery-report.json");
  const report = await runDeliveryEvaluation({
    scenarioPath,
    profileAdapters: [
      {
        profileName: "bare",
        adapter: createMockAdapter({
          transcript: [{ role: "assistant", type: "message", text: "Implemented and ready. Verification passed. Run it to try." }],
          profile: { name: "bare", bytes: 0, sha256: "bare" },
          metrics: { inputTokens: 8, cachedInputTokens: 2, outputTokens: 3, durationMs: 4 },
        }, { name: "mock-bare" }),
      },
      { profileName: "thin-atdd", adapter: createMockAdapter(completedFixture("thin-atdd", true), { name: "mock-thin" }) },
      { profileName: "full-openatdd", adapter: createMockAdapter(completedFixture("full-openatdd", true), { name: "mock-full" }) },
    ],
    repetitions: 1,
    reportPath,
  });

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.scenario.difficulty, "simple");
  assert.equal(report.profiles.bare.summary.passRate, 0);
  assert.equal(report.profiles.bare.summary.falseReadyRate, 1);
  assert.equal(report.profiles["thin-atdd"].summary.passRate, 1);
  assert.equal(report.profiles["thin-atdd"].summary.selfVerificationRate, 1);
  assert.equal(report.profiles["thin-atdd"].summary.technicalPlanRate, 1);
  assert.equal(report.profiles["thin-atdd"].summary.commandInvocations, 1);
  assert.equal(report.profiles["full-openatdd"].summary.handoffCompleteRate, 1);
  assert.equal(report.comparisons.length, 2);
  assert.equal(report.claims.functionalPassDerivedFromHiddenChecks, true);
  const summary = await summarizeDeliveryEvaluationReports([reportPath], { clock: () => new Date("2026-07-29T00:00:00.000Z") });
  assert.equal(summary.scenarios.length, 1);
  assert.equal(summary.totals.bare.falseReadyRate, 1);
  assert.equal(summary.totals["thin-atdd"].passRate, 1);
  assert.equal(summary.comparisons.length, 2);
  assert.equal(summary.comparisons[0].profile, "thin-atdd");
  assert.equal(summary.comparisons[0].passRateDelta, 1);
  assert.equal(summary.comparisons[0].durationRelativeChange, 0.25);
  assert.equal(summary.comparisons[0].inputTokensRelativeChange, 0.25);

  const diagnostic = await runDeliveryEvaluation({
    scenarioPath,
    profileNames: ["thin-atdd"],
    profileAdapters: [{ profileName: "thin-atdd", adapter: createMockAdapter(completedFixture("thin-atdd", true)) }],
    repetitions: 1,
    reportPath: false,
  });
  assert.deepEqual(Object.keys(diagnostic.profiles), ["thin-atdd"]);
  assert.deepEqual(diagnostic.comparisons, []);
});
