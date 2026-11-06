import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, symlink, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fastFinalize, validateFinalizationPlan } from "../skills/openatdd/scripts/finalization.mjs";
import { beginImplementation, loadTask, readinessErrorsForState, reopenSolution, resumeTask, orchestrationStart } from "../skills/openatdd/scripts/workflow.mjs";
import { criterion, prepareApprovedTask, temporaryProject } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
const command = (id, script) => ({ id, argv: [process.execPath, "-e", script], timeoutMs: 10000 });

async function fixture(t, options = {}) {
  const root = await temporaryProject(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/value.json"), "false\n");
  const taskId = "acceptance-gate";
  const criteria = options.criteria ?? [criterion("AC-01")];
  const approved = await prepareApprovedTask(root, taskId, { legacy: false, criteria, impactPaths: ["src", "tests", ".openatdd"] });
  await mkdir(path.join(root, "tests"));
  const runner = `import { readFileSync } from "node:fs";
const ok = JSON.parse(readFileSync("src/value.json", "utf8"));
console.log(JSON.stringify({ schemaVersion: 1, results: [{acceptanceId:"AC-01", status:ok?"passed":"failed", ...(ok?{}:{failureClass:"assertion"}), summary:ok?"approved value observed":"expected true, observed false"}]}));
process.exitCode = ok ? 0 : 1;
`;
  if (!options.manual) await writeFile(path.join(root, "tests/journey.mjs"), options.runner ?? runner);
  const batch = options.manual ? { id: "journey", name: "Human journey", acceptanceIds: ["AC-01"], runner: "internal" }
    : { id: "journey", name: "Approved journey", acceptanceIds: ["AC-01"], testFiles: ["tests/journey.mjs"], commands: [{ id: "journey", argv: [process.execPath, "tests/journey.mjs"], timeoutMs: 10000 }] };
  const manifest = {
    schemaVersion: 1, surface: "cli", environment: "local", source: { include: ["**/*"] },
    preflight: { scope: "project", reason: "Disposable local CLI fixtures with no live dependencies." },
    dryRun: { commands: [command("smoke", "process.stdout.write('ok')")], checkHttpLinks: false },
    checks: [{ id: "broad", scope: "broad", commands: [command("broad", "process.stdout.write('ok')")] }],
    uat: { batches: [batch], estimatedRoundTrips: 1 }, acceptance: { "AC-01": ["batch:journey"] },
    history: { mode: "deferred", overrides: [] },
  };
  const manifestPath = path.join(root, ".openatdd/finalization.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, taskId, files: approved.files, manifest, manifestPath, runner };
}

test("AC-01 new tasks cannot begin without an executable acceptance plan", async (t) => {
  const root = await temporaryProject(t);
  const approved = await prepareApprovedTask(root, "missing-plan", { legacy: false });
  assert.equal(approved.state.deliveryVersion, 4);
  await assert.rejects(() => beginImplementation(root, "missing-plan"), { code: "FINALIZATION_MANIFEST_NOT_FOUND" });
  assert.equal((await loadTask(root, "missing-plan")).state.phase, "CONTRACT_APPROVED");
});

test("AC-01 AC-02 begin records an assertion baseline without recording formal passes", async (t) => {
  const f = await fixture(t);
  const begun = await beginImplementation(f.root, f.taskId);
  assert.equal(begun.state.phase, "IMPLEMENTING");
  assert.equal(begun.state.acceptanceBaseline.outcome, "missing_behavior");
  assert.equal(begun.state.acceptanceBaseline.results[0].status, "failed");
  assert(begun.state.acceptanceBaseline.evidence.length > 0);
  assert.deepEqual(begun.state.results, {});
  const baseline = begun.state.acceptanceBaseline;
  assert.deepEqual((await beginImplementation(f.root, f.taskId)).state.acceptanceBaseline, baseline);
});

test("AC-02 already satisfied behavior is a valid baseline", async (t) => {
  const f = await fixture(t, { runner: `console.log(JSON.stringify({schemaVersion:1,results:[{acceptanceId:"AC-01",status:"passed",summary:"Existing CLI behavior satisfies acceptance"}]}))` });
  assert.equal((await beginImplementation(f.root, f.taskId)).state.acceptanceBaseline.outcome, "already_satisfied");
});

test("AC-02 startup, environment, timeout and malformed outcomes cannot count as assertion failures", async (t) => {
  for (const runner of [
    "throw new Error('broken setup')",
    `console.log(JSON.stringify({schemaVersion:1,results:[{acceptanceId:"AC-01",status:"failed",failureClass:"environment",summary:"offline"}]}));process.exitCode=1`,
    "console.log('{}');process.exitCode=1",
    "setTimeout(()=>{},10000)",
    `console.log(JSON.stringify({schemaVersion:1,results:[{acceptanceId:"AC-01",status:"passed",summary:"ok"}]}));process.exitCode=1`,
  ]) {
    const f = await fixture(t, { runner });
    f.manifest.uat.batches[0].commands[0].timeoutMs = 100;
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await assert.rejects(() => beginImplementation(f.root, f.taskId));
    const state = (await loadTask(f.root, f.taskId)).state;
    assert.equal(state.phase, "CONTRACT_APPROVED");
    assert(!state.acceptanceBaseline);
  }
});

test("AC-03 code changes before begin cannot be presented as a tests-first baseline", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "src/value.json"), "true\n");
  await assert.rejects(() => beginImplementation(f.root, f.taskId), { code: "IMPLEMENTATION_BEFORE_BASELINE" });
});

test("AC-03 tests and commands stay bound across resume, begin and finalization", async (t) => {
  const f = await fixture(t);
  await beginImplementation(f.root, f.taskId);
  const file = path.join(f.root, "tests/journey.mjs");
  const before = await stat(file);
  await writeFile(file, f.runner.replace("expected true", "expected TRUE"));
  await utimes(file, before.atime, before.mtime);
  await assert.rejects(() => resumeTask(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_DRIFT" });
  await assert.rejects(() => beginImplementation(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_DRIFT" });
  await assert.rejects(() => fastFinalize(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_DRIFT" });
  await writeFile(file, f.runner);
  f.manifest.uat.batches[0].commands[0].argv.push("changed");
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await assert.rejects(() => resumeTask(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_DRIFT" });
});

test("AC-04 the same journey must be green for evidence-backed delivery", async (t) => {
  const f = await fixture(t);
  await beginImplementation(f.root, f.taskId);
  await assert.rejects(() => fastFinalize(f.root, f.taskId));
  await writeFile(path.join(f.root, "src/value.json"), "true\n");
  const delivered = await fastFinalize(f.root, f.taskId);
  assert.equal(delivered.state.phase, "DELIVERED");
  assert.equal(delivered.state.results["AC-01"].status, "passed");
  assert.equal(delivered.state.acceptanceBaseline.outcome, "missing_behavior");
});

test("AC-04 exit zero with failed results cannot produce a green delivery", async (t) => {
  const runner = `console.log(JSON.stringify({schemaVersion:1,results:[{acceptanceId:"AC-01",status:"failed",failureClass:"assertion",summary:"expected success"}]}));process.exitCode = JSON.parse(require('node:fs').readFileSync('src/value.json')) ? 0 : 1`;
  // Use an inline CommonJS runner while retaining a file contract.
  const f = await fixture(t);
  f.manifest.uat.batches[0].commands[0].argv = [process.execPath, "-e", runner];
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await beginImplementation(f.root, f.taskId);
  await writeFile(path.join(f.root, "src/value.json"), "true\n");
  await assert.rejects(() => fastFinalize(f.root, f.taskId), { code: "INVALID_ACCEPTANCE_OUTCOME" });
  assert.equal((await loadTask(f.root, f.taskId)).state.phase, "IMPLEMENTING");
});

test("AC-05 delegated start and manual readiness cannot bypass the baseline", async (t) => {
  const f = await fixture(t);
  const loaded = await loadTask(f.root, f.taskId);
  const errors = await readinessErrorsForState(f.root, loaded.state, loaded.files);
  assert(errors.some((error) => error.includes("acceptance baseline")));
  await assert.rejects(() => orchestrationStart(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_REQUIRED" });
});

test("AC-05 reopen invalidates the frozen baseline; manual-only acceptance remains explicit", async (t) => {
  const f = await fixture(t);
  await beginImplementation(f.root, f.taskId);
  const reopened = await reopenSolution(f.root, f.taskId, "Acceptance runner needs a reviewed correction");
  assert(!reopened.state.acceptanceBaseline);
  const manual = await fixture(t, { manual: true, criteria: [criterion("AC-01", { classification: "MANUAL" })] });
  assert.equal((await beginImplementation(manual.root, manual.taskId)).state.acceptanceBaseline.outcome, "manual_only");
});

test("AC-03 test paths cannot escape the project through symlinks", async (t) => {
  const f = await fixture(t);
  const outside = await temporaryProject(t);
  await writeFile(path.join(outside, "test.mjs"), f.runner);
  await symlink(outside, path.join(f.root, "tests/outside"));
  f.manifest.uat.batches[0].testFiles = ["tests/outside/test.mjs"];
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await assert.rejects(() => beginImplementation(f.root, f.taskId), (error) => error.code === "INVALID_FINALIZATION_MANIFEST" && error.details.errors.some((message) => message.includes("inside the project")));
});

test("AC-06 CLI begin uses the supplied manifest and reports the actual baseline", async (t) => {
  for (const entry of [["begin"], ["advance"], ["approve-solution", "--begin"]]) {
    const f = await fixture(t);
    await rename(f.manifestPath, path.join(f.root, ".openatdd/custom-plan.json"));
    const result = await execFileAsync(process.execPath, [cli, entry[0], f.taskId, ...entry.slice(1), "--manifest", ".openatdd/custom-plan.json", "--root", f.root, "--json"]);
    const state = JSON.parse(result.stdout);
    assert.equal(state.phase, "IMPLEMENTING");
    assert.equal(state.acceptanceBaseline.outcome, "missing_behavior");
    await resumeTask(f.root, f.taskId);
    await writeFile(path.join(f.root, "src/value.json"), "true\n");
    assert.equal((await fastFinalize(f.root, f.taskId)).state.phase, "DELIVERED");
  }
});

test("AC-02 outcomes require complete unique coverage and a valid test plan", async (t) => {
  for (const results of [
    [{acceptanceId:"AC-99",status:"passed",summary:"unknown"}],
    [{acceptanceId:"AC-01",status:"passed",summary:"one"},{acceptanceId:"AC-01",status:"passed",summary:"duplicate"}],
    [],
  ]) {
    const f = await fixture(t, { runner: `console.log(JSON.stringify({schemaVersion:1,results:${JSON.stringify(results)}}))` });
    await assert.rejects(() => beginImplementation(f.root, f.taskId), { code: "INVALID_ACCEPTANCE_OUTCOME" });
  }
  const f = await fixture(t);
  delete f.manifest.uat.batches[0].testFiles;
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  assert.equal((await validateFinalizationPlan(f.root, f.taskId)).valid, false);
  await assert.rejects(() => beginImplementation(f.root, f.taskId), { code: "INVALID_FINALIZATION_MANIFEST" });
});

test("AC-03 baseline evidence and environment are immutable", async (t) => {
  const f = await fixture(t);
  const begun = await beginImplementation(f.root, f.taskId);
  const { resolveArtifactPath } = await import("../skills/openatdd/scripts/lib.mjs");
  const evidence = resolveArtifactPath(f.root, begun.state.acceptanceBaseline.evidence[0].path);
  const original = await readFile(evidence);
  await writeFile(evidence, "changed evidence");
  await assert.rejects(() => resumeTask(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_DRIFT" });
  await writeFile(evidence, original);
  const profile = path.join(f.root, ".openatdd/environments/local.yaml");
  await writeFile(profile, `${await readFile(profile, "utf8")}\n# different context\n`);
  await assert.rejects(() => resumeTask(f.root, f.taskId), { code: "ACCEPTANCE_BASELINE_DRIFT" });
});

test("AC-03 a baseline runner cannot mutate project source", async (t) => {
  const f = await fixture(t, { runner: `import {writeFileSync} from 'node:fs';writeFileSync('src/value.json','true');console.log(JSON.stringify({schemaVersion:1,results:[{acceptanceId:'AC-01',status:'passed',summary:'value observed'}]}))` });
  await assert.rejects(() => beginImplementation(f.root, f.taskId), { code: "SOURCE_CHANGED_DURING_BASELINE" });
  assert(!(await loadTask(f.root, f.taskId)).state.acceptanceBaseline);
});

test("AC-03 baseline journeys may create declared generated artifacts", async (t) => {
  const f = await fixture(t, { runner: `import {writeFileSync} from 'node:fs';writeFileSync('export.csv','order,total\\n1,10\\n');console.log(JSON.stringify({schemaVersion:1,results:[{acceptanceId:'AC-01',status:'passed',summary:'export contents verified'}]}))` });
  f.manifest.source.exclude = ["export.csv"];
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  assert.equal((await beginImplementation(f.root, f.taskId)).state.acceptanceBaseline.outcome, "already_satisfied");
});

test("AC-04 formal commands cannot weaken tests excluded from the source inventory", async (t) => {
  const f = await fixture(t);
  f.manifest.source.include = ["src/**"];
  f.manifest.checks[0].commands = [command("broad", "require('node:fs').appendFileSync('tests/journey.mjs','\\n// weakened\\n')")];
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await beginImplementation(f.root, f.taskId);
  await writeFile(path.join(f.root, "src/value.json"), "true\n");
  await assert.rejects(() => fastFinalize(f.root, f.taskId), { code: "READINESS_BLOCKED" });
  assert.equal((await loadTask(f.root, f.taskId)).state.phase, "IMPLEMENTING");
});
