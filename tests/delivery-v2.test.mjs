import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  beginImplementation,
  beginPreUat,
  initProject,
  loadTask,
  markReady,
  preflightTask,
  prepareHandoff,
  prepareUatPlan,
  recordAcceptanceResult,
  recordCheck,
  recordEnvironmentObservation,
  recordIssue,
  recordUatBatch,
  searchMemory,
  taskFiles,
  validateHandoff,
} from "../skills/openatdd/scripts/workflow.mjs";
import {
  loadEnvironmentProfile,
  loadLocalCredentials,
  parseRestrictedDotenv,
  renderFlatYaml,
  runEnvironmentPreflight,
  scanEnvironmentArtifacts,
} from "../skills/openatdd/scripts/profiles.mjs";
import {
  criterion,
  prepareApprovedTask,
  temporaryProject,
  writeEvidence,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);

async function writeProfile(root, changes) {
  const { files, profile } = await loadEnvironmentProfile(root, "local");
  Object.assign(profile, changes);
  await writeFile(files.profile, renderFlatYaml(profile));
  return files;
}

test("legacy schema states are rejected without migration", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "legacy-migration");
  const files = taskFiles(root, "legacy-migration");
  const legacy = JSON.parse(await readFile(files.state, "utf8"));
  legacy.schemaVersion = 1;
  for (const key of ["deliveryVersion", "verification", "checkSequence", "preflight", "uat", "handoff", "timing", "routing", "decisions", "reviews", "agents", "context", "repair"]) delete legacy[key];
  await writeFile(files.state, `${JSON.stringify(legacy, null, 2)}\n`);

  await assert.rejects(() => loadTask(root, "legacy-migration"), (error) => error.code === "UNSUPPORTED_STATE");
  assert.equal(JSON.parse(await readFile(files.state, "utf8")).schemaVersion, 1);
});

test("environment facts accumulate with stale history while credentials remain local and scannable", async (t) => {
  const root = await temporaryProject(t);
  await initProject(root);
  let evidence = await writeEvidence(root, "profile-memory", "version-1.txt", "observed version 1");
  await recordEnvironmentObservation(root, "local", { key: "application_version", value: "1.0.0", source: "package metadata", evidence });
  evidence = await writeEvidence(root, "profile-memory", "version-2.txt", "observed version 2");
  const updated = await recordEnvironmentObservation(root, "local", { key: "application_version", value: "2.0.0", source: "package metadata", evidence });
  assert(updated.stale.some((item) => item.key === "application_version" && item.value === "1.0.0"));
  const memory = await searchMemory(root, "local application_version 2.0.0");
  assert.equal(memory.environmentMatches[0].value, "2.0.0");

  evidence = await writeEvidence(root, "profile-memory", "credentials.txt", "variable names verified");
  await recordEnvironmentObservation(root, "local", {
    key: "credential_variables",
    value: "OPENATDD_TEST_USERNAME, OPENATDD_TEST_PASSWORD",
    source: "local UAT account contract",
    evidence,
  });
  const dotenv = path.join(root, ".env.openatdd.local");
  await writeFile(dotenv, "OPENATDD_TEST_USERNAME=tester@example.test\n");
  await assert.rejects(
    () => loadLocalCredentials(root, "OPENATDD_TEST_USERNAME, OPENATDD_TEST_PASSWORD"),
    (error) => error.code === "MISSING_CREDENTIAL_VARIABLE",
  );
  await writeFile(dotenv, "OPENATDD_TEST_USERNAME=tester@example.test\nOPENATDD_TEST_PASSWORD=correct-horse\n");
  const credentials = await loadLocalCredentials(root, "OPENATDD_TEST_USERNAME, OPENATDD_TEST_PASSWORD");
  assert.equal(credentials.values.OPENATDD_TEST_PASSWORD, "correct-horse");
  assert(!((await readFile(updated.files.profile, "utf8")).includes("correct-horse")));
  assert.match(await readFile(path.join(root, ".gitignore"), "utf8"), /^\.env\.openatdd\.local$/m);
  assert.throws(() => parseRestrictedDotenv("PASSWORD=$(whoami)\n"), (error) => error.code === "UNSAFE_DOTENV");

  await writeFile(path.join(root, ".openatdd", "leak.json"), '{"value":"correct-horse"}\n');
  assert.equal((await scanEnvironmentArtifacts(root, credentials.secretValues)).length, 1);
});

test("preflight reports workspace, service, login, organization, integration, and fixture failures", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "preflight-contract");
  await beginImplementation(root, "preflight-contract");
  await writeProfile(root, {
    workspace: "../wrong-project",
    surface: "web",
    service_urls: "http://127.0.0.1:1",
    entry_url: "http://127.0.0.1:1/app",
    role: "admin",
    organization: "qa-org",
    integration: "sandbox connector",
    fixture: "sample-order-42",
  });
  await assert.rejects(
    () => preflightTask(root, "preflight-contract", { timeoutMs: 50 }),
    (error) => error.code === "PREFLIGHT_FAILED" && ["workspace", "login", "organization", "integration", "fixture"].every((name) => error.details.errors.some((item) => item.includes(name))),
  );
  assert.equal((await loadTask(root, "preflight-contract")).state.preflight.status, "failed");

  await writeProfile(root, { workspace: ".", surface: "cli", service_urls: "n/a", entry_url: "n/a" });
  const assertionEvidence = await writeEvidence(root, "preflight-contract", "project-assertions.txt", "login, organization, integration, and fixture verified");
  const passed = await preflightTask(root, "preflight-contract", {
    assertions: Object.fromEntries(["login", "organization", "integration", "fixture"].map((name) => [name, { status: "passed", summary: `${name} verified`, evidence: assertionEvidence }])),
  });
  assert.equal(passed.state.preflight.status, "passed");
});

test("project-scoped preflight retains project checks while skipping live environment requirements", async (t) => {
  const root = await temporaryProject(t);
  await initProject(root);
  await writeProfile(root, {
    service_urls: "http://127.0.0.1:1",
    entry_url: "http://127.0.0.1:1/app",
    role: "admin",
    organization: "qa-org",
    integration: "live-api",
    fixture: "sample-order",
    credential_variables: "OPENATDD_TEST_PASSWORD",
  });
  const reason = "The component harness has no live environment dependency.";
  const result = await runEnvironmentPreflight(root, "local", { scope: "project", reason, persist: false });
  assert.equal(result.result.status, "passed");
  assert.equal(result.result.scope, "project");
  assert.equal(result.result.checks.find((item) => item.name === "workspace").status, "passed");
  assert.equal(result.result.checks.find((item) => item.name === "project").status, "passed");
  assert.equal(result.result.checks.find((item) => item.name === "login").detail, reason);
  assert(result.result.checks.filter((item) => ["services", "entry_url", "credential_variables", "login", "organization", "integration", "fixture", "known_workarounds"].includes(item.name)).every((item) => item.status === "not_applicable"));
});

test("open issues reject passed evidence and resolution advances a clean verification epoch", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "epoch-repair", { impactPaths: ["src/epoch"] });
  await beginImplementation(root, "epoch-repair");
  await beginPreUat(root, "epoch-repair");
  const before = (await loadTask(root, "epoch-repair")).state.verification.epoch;
  await recordIssue(root, "epoch-repair", { acceptanceId: "AC-01", status: "open", symptom: "Observed value is stale" });
  let evidence = await writeEvidence(root, "epoch-repair", "premature.txt", "would otherwise pass");
  await assert.rejects(
    () => recordAcceptanceResult(root, "epoch-repair", { acceptanceId: "AC-01", status: "passed", evidence }),
    (error) => error.code === "OPEN_ISSUE_BLOCKS_PASS",
  );
  evidence = await writeEvidence(root, "epoch-repair", "repair.txt", "regression now passes");
  await recordIssue(root, "epoch-repair", {
    id: "ISSUE-001",
    status: "resolved",
    rootCause: "Cache generation was not advanced",
    regression: "epoch_advances_after_repair",
    invariant: "Formal evidence always belongs to the latest clean epoch",
    paths: "src/epoch",
    evidence,
  });
  const repaired = (await loadTask(root, "epoch-repair")).state;
  assert.equal(repaired.verification.epoch, before + 1);
  assert.equal(repaired.verification.clean, true);
  assert.equal(repaired.results["AC-01"].status, "affected");
});

test("a changed source fingerprint invalidates formal results and preflight", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "source-change");
  await beginImplementation(root, "source-change");
  await beginPreUat(root, "source-change");
  let evidence = await writeEvidence(root, "source-change", "acceptance.txt", "journey passed");
  await recordAcceptanceResult(root, "source-change", { acceptanceId: "AC-01", status: "passed", evidence });
  evidence = await writeEvidence(root, "source-change", "focused.txt", "focused passed");
  await recordCheck(root, "source-change", { name: "focused", scope: "focused", command: "node --test focused", sourceFingerprint: "source-v1", status: "passed", evidence });
  const before = (await loadTask(root, "source-change")).state.verification.epoch;
  evidence = await writeEvidence(root, "source-change", "module.txt", "module passed after edit");
  await recordCheck(root, "source-change", { name: "module", scope: "module", command: "node --test module", sourceFingerprint: "source-v2", status: "passed", evidence });
  const changed = (await loadTask(root, "source-change")).state;
  assert.equal(changed.verification.epoch, before + 1);
  assert.equal(changed.results["AC-01"].status, "affected");
  assert.equal(changed.checks.focused.status, "affected");
  assert.equal(changed.preflight.status, "affected");
});

test("CLI check forwards scope, source fingerprint, and duration", async (t) => {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "cli-check-options");
  await beginImplementation(root, "cli-check-options");
  await beginPreUat(root, "cli-check-options");
  const evidence = await writeEvidence(root, "cli-check-options", "focused.txt", "focused passed");
  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  await execFileAsync(process.execPath, [
    cli,
    "check",
    "cli-check-options",
    "--root",
    root,
    "--name",
    "focused CLI",
    "--scope",
    "focused",
    "--status",
    "passed",
    "--command",
    "node --test focused",
    "--source-fingerprint",
    "source-v1",
    "--duration-ms",
    "42",
    "--evidence",
    evidence,
  ]);
  const recorded = (await loadTask(root, "cli-check-options")).state.checks["focused-cli"];
  assert.equal(recorded.scope, "focused");
  assert.equal(recorded.sourceFingerprint, "source-v1");
  assert.equal(recorded.durationMs, 42);
});

test("browser plans use cohesive batches, warn on round-trip budgets, and isolate failed batches", async (t) => {
  const root = await temporaryProject(t);
  const criteria = Array.from({ length: 7 }, (_, index) => criterion(`AC-${String(index + 1).padStart(2, "0")}`));
  await prepareApprovedTask(root, "browser-batches", { criteria });
  await beginImplementation(root, "browser-batches");
  await writeProfile(root, { surface: "web", browser_round_trip_budget: "2" });
  await preflightTask(root, "browser-batches");
  await beginPreUat(root, "browser-batches");
  const planned = await prepareUatPlan(root, "browser-batches");
  assert.equal(planned.plan.batches.length, 3);
  assert.equal(planned.plan.execution.mode, "browser-low");
  assert.equal(planned.plan.execution.model, "gpt-5.6-luna");
  assert.equal(planned.plan.execution.reuseSession, true);
  assert.equal(planned.plan.execution.screenshotPolicy, "checkpoint-or-failure");
  assert.equal(new Set(planned.plan.batches.flatMap((batch) => batch.steps.map((step) => step.acceptanceId))).size, 7);
  assert.equal(planned.warnings.length, 1);

  let evidence = await writeEvidence(root, "browser-batches", "batch-1.txt", "setup passed");
  await recordUatBatch(root, "browser-batches", { batchId: "batch-1", status: "passed", evidence });
  evidence = await writeEvidence(root, "browser-batches", "batch-2.txt", "primary flow failed");
  await recordUatBatch(root, "browser-batches", { batchId: "batch-2", status: "failed", evidence });
  const state = (await loadTask(root, "browser-batches")).state;
  assert.equal(state.uat.batches["batch-1"].status, "passed");
  assert.equal(state.uat.batches["batch-2"].status, "failed");
});

test("focused, module, and broad checks preserve order and automatic handoff avoids repeated UAT", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01"), criterion("AC-02")];
  await prepareApprovedTask(root, "detailed-handoff", { criteria, impactPaths: ["README.md"] });
  await beginImplementation(root, "detailed-handoff");
  await beginPreUat(root, "detailed-handoff");
  for (const item of criteria) {
    const evidence = await writeEvidence(root, "detailed-handoff", `${item.id}.txt`, `${item.id} approved journey passed`);
    await recordAcceptanceResult(root, "detailed-handoff", {
      acceptanceId: item.id,
      status: "passed",
      evidence: item.id === "AC-02" ? [evidence, taskFiles(root, "detailed-handoff").environmentObservations] : evidence,
    });
  }
  for (const [scope, durationMs] of [["focused", 10], ["module", 20], ["broad", 30]]) {
    const evidence = await writeEvidence(root, "detailed-handoff", `${scope}.txt`, `${scope} checks passed`);
    await recordCheck(root, "detailed-handoff", {
      name: `${scope} tests`,
      scope,
      command: `npm run ${scope}`,
      sourceFingerprint: "frozen-source-v1",
      durationMs,
      status: "passed",
      evidence,
    });
  }
  const prepared = await prepareHandoff(root, "detailed-handoff", { estimatedMinutes: 7 });
  assert.deepEqual(prepared.state.checkSequence.slice(-3).map((item) => item.scope), ["focused", "module", "broad"]);
  const valid = await validateHandoff(prepared.state, prepared.handoff, prepared.files);
  assert.equal(valid.valid, true);

  const broken = structuredClone(prepared.handoff);
  broken.links.push({ label: "Missing local evidence", target: "evidence/does-not-exist.txt", applicable: true });
  assert.equal((await validateHandoff(prepared.state, broken, prepared.files)).valid, false);

  const ready = await markReady(root, "detailed-handoff");
  const report = await readFile(ready.files.requirement, "utf8");
  const notification = await readFile(ready.files.notification, "utf8");
  assert.equal(ready.state.phase, "DELIVERED");
  assert.match(report, /## Status and merge recommendation/);
  assert.match(report, /## Human acceptance entry/);
  assert.doesNotMatch(report, /### Step 1/);
  assert.doesNotMatch(report, /\[ \] Pass  \[ \] Fail/);
  assert.match(report, /no blocking MANUAL or ASSISTED items/i);
  assert.match(notification, /has completed AI verification and been delivered/);
  assert.match(notification, /no reply is required when there is no objection/);
  assert.doesNotMatch(notification, /First action/);
});
