import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  atomicWriteBatch,
  filesBelow,
  gitPrivateRoot,
  pathExists,
  resolveArtifactPath,
} from "../skills/openatdd/scripts/lib.mjs";
import {
  dryRunFinalization,
  fastFinalize,
  finalizeTask,
  validateFinalizationPlan,
} from "../skills/openatdd/scripts/finalization.mjs";
import {
  fingerprintProject,
  loadFinalizationManifest,
  validateFinalizationManifest,
} from "../skills/openatdd/scripts/manifest.mjs";
import {
  beginImplementation,
  loadTask,
  recordIssue,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";
import {
  clock,
  criterion,
  prepareApprovedTask,
  temporaryProject,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);

function command(id, script = `process.stdout.write(${JSON.stringify(id)})`, extra = {}) {
  return { id, argv: [process.execPath, "-e", script], timeoutMs: 10_000, ...extra };
}

function finalizationManifest(criteria = [criterion("AC-01")], overrides = {}) {
  const batchId = "approved-journey";
  const manifest = {
    schemaVersion: 1,
    surface: "cli",
    environment: "local",
    source: { include: ["**/*"], exclude: [] },
    dryRun: {
      commands: [command("entry-smoke")],
      checkHttpLinks: false,
      linkTimeoutMs: 100,
    },
    checks: [
      { id: "focused", name: "Focused checks", scope: "focused", commands: [command("focused-check")] },
      { id: "module", name: "Module checks", scope: "module", commands: [command("module-check")] },
      { id: "broad", name: "Broad checks", scope: "broad", commands: [command("broad-check")] },
    ],
    uat: {
      estimatedRoundTrips: 1,
      batches: [{
        id: batchId,
        name: "Complete approved journey",
        acceptanceIds: criteria.map((item) => item.id),
        commands: [command("approved-journey", 'process.stdout.write(JSON.stringify({ journey: "passed" }))')],
        reuseSession: true,
      }],
    },
    acceptance: Object.fromEntries(criteria.map((item) => [item.id, ["check:broad", `batch:${batchId}`]])),
    history: { mode: "deferred", overrides: [] },
    handoff: { estimatedMinutes: 5 },
    budgets: {
      wallTimeMs: 60_000,
      commandInvocations: 10,
      browserRoundTrips: 3,
      evidenceWrites: 20,
    },
  };
  return {
    ...manifest,
    ...overrides,
    source: { ...manifest.source, ...overrides.source },
    dryRun: { ...manifest.dryRun, ...overrides.dryRun },
    uat: { ...manifest.uat, ...overrides.uat },
    history: { ...manifest.history, ...overrides.history },
    handoff: { ...manifest.handoff, ...overrides.handoff },
    budgets: { ...manifest.budgets, ...overrides.budgets },
  };
}

async function writeManifest(root, manifest) {
  const target = path.join(root, ".openatdd", "finalization.json");
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

async function writeTaskManifest(root, taskId, manifest) {
  const target = taskFiles(root, taskId).finalizationManifest;
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

async function approvedImplementation(testContext, taskId = "fast-finalize", options = {}) {
  const root = await temporaryProject(testContext);
  const criteria = options.criteria ?? [criterion("AC-01")];
  await prepareApprovedTask(root, taskId, {
    criteria,
    requirement: options.requirement,
    impactPaths: options.impactPaths ?? ["src/shared"],
    createdAt: options.createdAt,
    acceptanceAt: options.acceptanceAt,
    solutionAt: options.solutionAt,
    assessment: options.assessment,
  });
  await beginImplementation(root, taskId);
  const manifest = finalizationManifest(criteria, options.manifest);
  await writeManifest(root, manifest);
  return { root, taskId, criteria, manifest, files: taskFiles(root, taskId) };
}

test("strict manifests require argv commands, ordered scopes, complete UAT, and one broad group", () => {
  const criteria = [criterion("AC-01"), criterion("AC-02")];
  const valid = finalizationManifest(criteria);
  assert.deepEqual(validateFinalizationManifest(valid, criteria).errors, []);

  const invalid = structuredClone(valid);
  invalid.dryRun.commands[0] = { id: "shell-string", command: "npm test", cwd: "../outside" };
  invalid.checks.reverse();
  invalid.checks.push(structuredClone(invalid.checks[0]));
  invalid.uat.batches[0].acceptanceIds = ["AC-01"];
  invalid.acceptance["AC-02"] = ["check:missing"];
  const result = validateFinalizationManifest(invalid, criteria);
  assert.equal(result.valid, false);
  assert(result.errors.some((item) => item.includes("argv")));
  assert(result.errors.some((item) => item.includes("stay inside")));
  assert(result.errors.some((item) => item.includes("focused → module → broad")));
  assert(result.errors.some((item) => item.includes("Exactly one broad")));
  assert(result.errors.some((item) => item.includes("do not cover AC-02")));
  assert(result.errors.some((item) => item.includes("unknown evidence")));

  const unsafeProjectScope = finalizationManifest(criteria, {
    preflight: { scope: "project" },
  });
  assert(validateFinalizationManifest(unsafeProjectScope, criteria).errors.some((item) => item.includes("preflight.reason")));
  unsafeProjectScope.preflight.reason = "Only deterministic component commands run.";
  unsafeProjectScope.checks[0].commands[0].env = ["TEST_SECRET"];
  assert(validateFinalizationManifest(unsafeProjectScope, criteria).errors.some((item) => item.includes("cannot run commands with declared environment variables")));

  const invalidDeterminism = finalizationManifest(criteria);
  invalidDeterminism.checks[0].commands[0].deterministic = "yes";
  assert(validateFinalizationManifest(invalidDeterminism, criteria).errors.some((item) => item.includes("deterministic must be boolean")));

  const duplicated = finalizationManifest(criteria);
  duplicated.checks[1].commands = [{ ...structuredClone(duplicated.checks[0].commands[0]), id: "module-check" }];
  const duplicateValidation = validateFinalizationManifest(duplicated, criteria);
  assert.equal(duplicateValidation.errors.length, 0);
  assert(duplicateValidation.warnings.some((item) => item.includes("identical commands")));
  duplicated.checks[0].commands[0].deterministic = true;
  duplicated.checks[1].commands[0].deterministic = true;
  assert(!validateFinalizationManifest(duplicated, criteria).warnings.some((item) => item.includes("identical commands")));
});

test("project fingerprinting caches unchanged content and tracks stat-visible changes", async (t) => {
  const root = await temporaryProject(t);
  const file = path.join(root, "cached.txt");
  await writeFile(file, "original");
  const first = await fingerprintProject(root, {});
  const repeat = await fingerprintProject(root, {});
  assert.equal(repeat.fingerprint, first.fingerprint);

  await writeFile(file, "changed content with a different size");
  const grown = await fingerprintProject(root, {});
  assert.notEqual(grown.fingerprint, first.fingerprint);

  // A same-size rewrite is still tracked once the modification time moves.
  await writeFile(file, "same-size-content-aa");
  const before = await fingerprintProject(root, {});
  await writeFile(file, "same-size-content-bb");
  await utimes(file, new Date(), new Date(Date.now() + 2000));
  const after = await fingerprintProject(root, {});
  assert.notEqual(after.fingerprint, before.fingerprint);
});

test("task finalization manifest wins over the project default unless an explicit path is supplied", async (t) => {
  const root = await temporaryProject(t);
  const taskId = "manifest-precedence";
  const criteria = [criterion("AC-01")];
  await prepareApprovedTask(root, taskId, { criteria });
  const projectManifest = finalizationManifest(criteria);
  const taskManifest = finalizationManifest(criteria, {
    dryRun: { commands: [command("task-entry-smoke")] },
  });
  const projectPath = await writeManifest(root, projectManifest);
  const taskPath = await writeTaskManifest(root, taskId, taskManifest);

  const resolvedTask = await loadFinalizationManifest(root, taskId);
  assert.equal(resolvedTask.manifestPath, taskPath);
  assert.equal(resolvedTask.manifest.dryRun.commands[0].id, "task-entry-smoke");

  const explicitProject = await loadFinalizationManifest(root, taskId, path.relative(root, projectPath));
  assert.equal(explicitProject.manifestPath, projectPath);
  assert.equal(explicitProject.manifest.dryRun.commands[0].id, "entry-smoke");

  await rm(projectPath);
  await beginImplementation(root, taskId);
  const preview = await dryRunFinalization(root, taskId);
  assert.equal(preview.preview.manifestPath, `git:tasks/${taskId}/finalization.manifest.json`);

  await rm(taskPath);
  await writeManifest(root, projectManifest);
  assert.equal((await loadFinalizationManifest(root, taskId)).manifestPath, projectPath);
});

test("the frozen finalization snapshot never becomes the resolved manifest of a later run", async (t) => {
  const { root, taskId, files } = await approvedImplementation(t, "snapshot-not-input");
  await dryRunFinalization(root, taskId);
  await finalizeTask(root, taskId);
  assert.equal(await pathExists(files.finalization), true);

  const resolved = await loadFinalizationManifest(root, taskId);
  assert.equal(resolved.manifestPath, path.join(root, ".openatdd", "finalization.json"));
  assert.notEqual(resolved.manifestPath, files.finalization);
});

test("static finalization validation executes no commands and writes no preview", async (t) => {
  const marker = "static-validation-must-not-run.txt";
  const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`;
  const { root, taskId, files } = await approvedImplementation(t, "static-finalization", {
    manifest: { dryRun: { commands: [command("must-not-run", script)] } },
  });

  const result = await validateFinalizationPlan(root, taskId);
  assert.equal(result.valid, true);
  assert.equal(result.manifestPath, ".openatdd/finalization.json");
  assert.equal(await pathExists(path.join(root, marker)), false);
  assert.equal(await pathExists(files.finalizePreview), false);
});

test("internal UAT can hand off assisted or manual judgment but cannot satisfy automatic acceptance", () => {
  const automatic = [criterion("AC-01")];
  const invalid = finalizationManifest(automatic, {
    uat: {
      batches: [{ id: "manual-handoff", name: "Manual handoff", runner: "internal", acceptanceIds: ["AC-01"] }],
    },
  });
  invalid.acceptance["AC-01"] = ["check:broad", "batch:manual-handoff"];
  const rejected = validateFinalizationManifest(invalid, automatic);
  assert.equal(rejected.valid, false);
  assert(rejected.errors.some((item) => item.includes("cannot cover automatic acceptance AC-01")));

  const judged = [
    criterion("AC-01", { classification: "ASSISTED" }),
    criterion("AC-02", { classification: "MANUAL" }),
  ];
  const valid = finalizationManifest(judged, {
    uat: {
      batches: [{ id: "manual-handoff", name: "Manual handoff", runner: "internal", acceptanceIds: judged.map((item) => item.id) }],
    },
  });
  valid.acceptance = Object.fromEntries(judged.map((item) => [item.id, ["check:broad", "batch:manual-handoff"]]));
  assert.deepEqual(validateFinalizationManifest(valid, judged).errors, []);
});

test("dry-run executes the real entry point while keeping formal state byte-for-byte unchanged", async (t) => {
  const { root, taskId, files } = await approvedImplementation(t);
  const before = await readFile(files.state);
  const result = await dryRunFinalization(root, taskId);
  assert.equal(result.preview.status, "passed");
  assert.equal(result.unchangedState, true);
  assert.equal(Buffer.compare(before, await readFile(files.state)), 0);
  assert.equal(await pathExists(files.finalization), false);
  assert.equal(await pathExists(files.finalizePreview), true);
  assert.equal(await pathExists(files.previewReport), true);
  assert.equal((await loadTask(root, taskId)).state.phase, "IMPLEMENTING");
});

test("dry-run rejects broken report links without recording a formal pass", async (t) => {
  const { root, taskId, files } = await approvedImplementation(t, "broken-link", {
    manifest: { links: [{ label: "Missing target", target: "missing.md", applicable: true }] },
  });
  const before = await readFile(files.state);
  await assert.rejects(
    () => dryRunFinalization(root, taskId),
    (error) => error.code === "FINALIZATION_DRY_RUN_FAILED" && error.details.errors.some((item) => item.includes("Missing target")),
  );
  assert.equal(Buffer.compare(before, await readFile(files.state)), 0);
  const preview = JSON.parse(await readFile(files.finalizePreview, "utf8"));
  assert.equal(preview.status, "failed");
  assert.equal((await loadTask(root, taskId)).state.results["AC-01"], undefined);
});

test("fingerprints include deliverable changes and exclude credentials, requirements, and private runtime", async (t) => {
  const root = await temporaryProject(t);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, ".openatdd", "requirements"), { recursive: true });
  const runtimeEvidence = path.join(gitPrivateRoot(root), "tasks", "ignored", "evidence");
  await mkdir(runtimeEvidence, { recursive: true });
  await writeFile(path.join(root, "src", "feature.mjs"), "export const value = 1;\n");
  await writeFile(path.join(root, "new-file.txt"), "untracked deliverable\n");
  await writeFile(path.join(root, ".env.openatdd.local"), "PASSWORD=local-only\n");
  await writeFile(path.join(root, ".openatdd", "requirements", "ignored.md"), "# Runtime-neutral requirement\n");
  await writeFile(path.join(runtimeEvidence, "run.txt"), "runtime\n");
  const first = await fingerprintProject(root, { include: ["**/*"] });
  assert(first.files.some((item) => item.path === "src/feature.mjs"));
  assert(first.files.some((item) => item.path === "new-file.txt"));
  assert(!first.files.some((item) => item.path === ".env.openatdd.local"));
  assert(!first.files.some((item) => item.path.startsWith(".openatdd/requirements/")));

  await writeFile(path.join(root, ".env.openatdd.local"), "PASSWORD=changed-local-only\n");
  await writeFile(path.join(runtimeEvidence, "run.txt"), "runtime changed\n");
  assert.equal((await fingerprintProject(root, { include: ["**/*"] })).fingerprint, first.fingerprint);
  await writeFile(path.join(root, "new-file.txt"), "changed deliverable\n");
  assert.notEqual((await fingerprintProject(root, { include: ["**/*"] })).fingerprint, first.fingerprint);
});

test("dry-run detects a command that mutates the candidate source", async (t) => {
  const mutator = `require("node:fs").writeFileSync("deliverable.txt", String(Date.now()))`;
  const { root, taskId, files } = await approvedImplementation(t, "mutating-preview", {
    manifest: { dryRun: { commands: [command("mutating-entry", mutator)] } },
  });
  await writeFile(path.join(root, "deliverable.txt"), "stable\n");
  const before = await readFile(files.state);
  await assert.rejects(
    () => dryRunFinalization(root, taskId),
    (error) => error.code === "FINALIZATION_DRY_RUN_FAILED" && error.details.errors.some((item) => item.includes("Source changed")),
  );
  assert.equal(Buffer.compare(before, await readFile(files.state)), 0);
});

test("formal finalization commits one complete journey and is idempotent for the same fingerprint", async (t) => {
  const { root, taskId, files } = await approvedImplementation(t, "complete-finalize");
  await dryRunFinalization(root, taskId);
  const completed = await finalizeTask(root, taskId);
  assert.equal(completed.unchanged, false);
  assert.equal(completed.state.phase, "DELIVERED");
  assert.equal(completed.state.finalization.status, "complete");
  assert.equal(completed.state.results["AC-01"].status, "passed");
  assert.equal(completed.result.metrics.checkGroupRuns.broad, 1);
  assert.equal(completed.result.metrics.uatJourneyRuns, 1);
  assert.equal(completed.result.metrics.dryRunRuns, 1);
  assert.equal(completed.result.metrics.finalRuns, 1);
  assert(completed.result.metrics.cliInvocations >= 2);
  assert(completed.result.metrics.phaseDurationsMs.checks >= 0);
  assert(completed.result.metrics.evidenceWritesByPhase.checks >= 1);
  assert.equal(await pathExists(files.report), true);
  assert.equal(await pathExists(files.notification), true);
  assert.equal(await pathExists(files.finalizationSnapshot), true);
  const report = await readFile(files.report, "utf8");
  assert.match(report, /^# Delivery report:/);
  assert.match(report, /Automatic verification complete/);
  assert.doesNotMatch(report, /Suggested human UAT/);

  const stateBefore = await readFile(files.state);
  const repeated = await finalizeTask(root, taskId);
  assert.equal(repeated.unchanged, true);
  assert.equal(Buffer.compare(stateBefore, await readFile(files.state)), 0);
  assert.equal(repeated.result.sourceFingerprint, completed.result.sourceFingerprint);
});

test("formal finalization prepares ASSISTED evidence without claiming the human judgment passed", async (t) => {
  const criteria = [criterion("AC-01", {
    classification: "ASSISTED",
    title: "A person judges the concise handoff",
  })];
  const { root, taskId, files } = await approvedImplementation(t, "assisted-finalize", {
    criteria,
    manifest: {
      uat: {
        batches: [{ id: "manual-handoff", name: "Human judgment handoff", runner: "internal", acceptanceIds: ["AC-01"] }],
      },
      acceptance: { "AC-01": ["check:broad", "batch:manual-handoff"] },
    },
  });
  await dryRunFinalization(root, taskId);
  const completed = await finalizeTask(root, taskId);

  assert.equal(completed.state.phase, "DELIVERED");
  assert.equal(completed.state.results["AC-01"].status, "manual");
  assert.match(completed.state.results["AC-01"].summary, /human judgment remains required/);
  assert(completed.state.results["AC-01"].evidence.length > 0);
  assert.equal(completed.state.uat.batches["manual-handoff"].status, "manual");
  assert.match(completed.state.uat.batches["manual-handoff"].summary, /no automatic journey was executed/);
  assert.equal(completed.result.metrics.uatJourneyRuns, 0);
  const report = await readFile(files.report, "utf8");
  assert.match(report, /Human attention/);
  assert.match(report, /Suggested human UAT/);
  const requirement = await readFile(files.requirement, "utf8");
  assert.match(requirement, /Status：Waiting for human acceptance/);
  assert.match(requirement, /Credential variables/);
  assert.match(requirement, /Ordered steps/);
  await import("../skills/openatdd/scripts/workflow.mjs").then(({ recordAcceptanceResult }) => recordAcceptanceResult(root, taskId, {
    acceptanceId: "AC-01",
    status: "manual",
    humanConfirmed: true,
    summary: "A person completed the acceptance chain successfully.",
  }));
  assert.match(await readFile(files.requirement, "utf8"), /Status：Accepted/);
});

test("blocking MANUAL acceptance adds human UAT without adding an approval gate", async (t) => {
  const criteria = [criterion("AC-01", {
    classification: "MANUAL",
    title: "A person observes the physical device result",
  })];
  const { root, taskId, files } = await approvedImplementation(t, "manual-delivery", {
    criteria,
    manifest: {
      uat: {
        batches: [{ id: "manual-handoff", name: "Physical observation", runner: "internal", acceptanceIds: ["AC-01"] }],
      },
      acceptance: { "AC-01": ["check:broad", "batch:manual-handoff"] },
    },
  });
  await dryRunFinalization(root, taskId);
  const completed = await finalizeTask(root, taskId);

  assert.equal(completed.state.phase, "DELIVERED");
  const report = await readFile(files.report, "utf8");
  assert.match(report, /Suggested human UAT/);
  assert.match(report, /no reply is needed when all pass/i);
  assert.doesNotMatch(report, /ready for formal human acceptance/i);
});

test("a failed formal command leaves no passed result or READY state", async (t) => {
  const guarded = command(
    "broad-guarded",
    `if (process.env.OPENATDD_FINAL_FAIL === "1") process.exit(7); process.stdout.write("broad")`,
    { env: ["OPENATDD_FINAL_FAIL"] },
  );
  const { root, taskId, files } = await approvedImplementation(t, "failed-finalize", {
    manifest: {
      checks: [
        { id: "focused", scope: "focused", commands: [command("focused-pass")] },
        { id: "module", scope: "module", commands: [command("module-pass")] },
        { id: "broad", scope: "broad", commands: [guarded] },
      ],
    },
  });
  await dryRunFinalization(root, taskId);
  const before = await readFile(files.state);
  process.env.OPENATDD_FINAL_FAIL = "1";
  try {
    await assert.rejects(() => finalizeTask(root, taskId), (error) => error.code === "FINALIZATION_COMMAND_FAILED");
  } finally {
    delete process.env.OPENATDD_FINAL_FAIL;
  }
  assert.equal(Buffer.compare(before, await readFile(files.state)), 0);
  assert.equal((await loadTask(root, taskId)).state.phase, "IMPLEMENTING");
  assert.equal(await pathExists(files.finalizeResult), false);
});

test("loaded local credentials are redacted from preview commands and reports", async (t) => {
  const secret = "local-test-password-4831";
  const { root, taskId, files } = await approvedImplementation(t, "redacted-preview", {
    manifest: {
      dryRun: {
        commands: [command("credential-smoke", `process.stdout.write(process.env.OPENATDD_TEST_PASSWORD)`, { env: ["OPENATDD_TEST_PASSWORD"] })],
      },
    },
  });
  const profile = path.join(root, ".openatdd", "environments", "local.yaml");
  const profileText = await readFile(profile, "utf8");
  await writeFile(profile, profileText.replace('credential_variables: ""', "credential_variables: OPENATDD_TEST_PASSWORD"));
  await writeFile(path.join(root, ".env.openatdd.local"), `OPENATDD_TEST_PASSWORD=${secret}\n`);
  const loginEvidence = path.join(files.evidence, "login.txt");
  await writeFile(loginEvidence, "local test login verified\n");
  await dryRunFinalization(root, taskId, {
    assertions: {
      login: {
        status: "passed",
        summary: "local test login verified",
        evidence: loginEvidence,
      },
    },
  });
  const persisted = (await Promise.all((await filesBelow(files.task)).map((file) => readFile(file, "utf8")))).join("\n");
  assert(!persisted.includes(secret));
  assert(persisted.includes("[REDACTED]"));
});

test("formal preflight accepts reusable assertion evidence from the current repair boundary without a one-second race", async (t) => {
  const { root, taskId, files } = await approvedImplementation(t, "stable-preflight-boundary");
  const profile = path.join(root, ".openatdd", "environments", "local.yaml");
  const profileText = await readFile(profile, "utf8");
  await writeFile(profile, profileText.replace("role: n/a", "role: tester"));
  const evidence = path.join(files.evidence, "login.txt");
  await writeFile(evidence, "authenticated local tester\n");
  const olderThanFormalEpoch = new Date(Date.now() - 10_000);
  await utimes(evidence, olderThanFormalEpoch, olderThanFormalEpoch);
  const assertions = {
    login: {
      status: "passed",
      summary: "authenticated local tester",
      evidence,
    },
  };

  await dryRunFinalization(root, taskId, { assertions });
  const completed = await finalizeTask(root, taskId, { assertions });

  assert.equal(completed.state.preflight.status, "passed");
  assert(new Date(completed.state.preflight.checkedAt) >= new Date(completed.state.verification.startedAt));
});

test("manifest preflight commands generate fresh formal assertions inside the verification epoch", async (t) => {
  const payload = {
    login: { status: "passed", summary: "fresh login succeeded" },
    organization: { status: "passed", summary: "qa organization selected" },
    integration: { status: "passed", summary: "local integration responded" },
    fixture: { status: "passed", summary: "fixture is available" },
  };
  const { root, taskId } = await approvedImplementation(t, "command-preflight", {
    manifest: {
      preflight: {
        commands: [command("runtime-assertions", `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`)],
      },
    },
  });
  const profile = path.join(root, ".openatdd", "environments", "local.yaml");
  const profileText = await readFile(profile, "utf8");
  await writeFile(profile, profileText
    .replace("role: n/a", "role: tester")
    .replace("organization: n/a", "organization: qa-org")
    .replace("integration: n/a", "integration: local-api")
    .replace("fixture: n/a", "fixture: sample"));

  await dryRunFinalization(root, taskId);
  const completed = await finalizeTask(root, taskId);
  const assertions = completed.state.preflight.checks.filter((item) => payload[item.name]);

  assert.equal(assertions.length, 4);
  assert(assertions.every((item) => item.status === "passed"));
  assert(assertions.every((item) => item.evidence[0].path.includes("preflight-runtime-assertions.md")));
  assert(completed.result.metrics.commandInvocations >= 3);
});

test("a Quick lane skips frozen check groups that map to no acceptance evidence while Standard keeps the ladder", async (t) => {
  const quick = await approvedImplementation(t, "quick-check-ladder");
  await dryRunFinalization(quick.root, quick.taskId);
  const quickResult = await finalizeTask(quick.root, quick.taskId);
  assert.equal(quickResult.state.routing.lane, "quick");
  assert.deepEqual(quickResult.result.metrics.skippedCheckGroups, ["focused", "module"]);
  assert.deepEqual(quickResult.result.metrics.checkGroupRuns, { focused: 0, module: 0, broad: 1 });
  assert.equal(quickResult.state.checks.broad.status, "passed");
  assert.equal(quickResult.state.checks.focused, undefined);

  const standard = await approvedImplementation(t, "standard-check-ladder", {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
  });
  await dryRunFinalization(standard.root, standard.taskId);
  const standardResult = await finalizeTask(standard.root, standard.taskId);
  assert.equal(standardResult.state.routing.lane, "standard");
  assert.deepEqual(standardResult.result.metrics.skippedCheckGroups, []);
  assert.deepEqual(standardResult.result.metrics.checkGroupRuns, { focused: 1, module: 1, broad: 1 });
});

test("a Quick lane still runs a narrow group that carries acceptance or history evidence", async (t) => {
  const criteria = [criterion("AC-01")];
  const { root, taskId } = await approvedImplementation(t, "referenced-check-group", {
    criteria,
    manifest: {
      acceptance: { "AC-01": ["check:focused", "check:broad", "batch:approved-journey"] },
    },
  });
  await dryRunFinalization(root, taskId);
  const result = await finalizeTask(root, taskId);
  assert.deepEqual(result.result.metrics.skippedCheckGroups, ["module"]);
  assert.deepEqual(result.result.metrics.checkGroupRuns, { focused: 1, module: 0, broad: 1 });
});

test("a formal run reuses evidence for identical narrower commands and never substitutes the broad group", async (t) => {
  const script = 'process.stdout.write("shared-suite")';
  const { root, taskId } = await approvedImplementation(t, "signature-reuse", {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
    manifest: {
      checks: [
        { id: "focused", name: "Focused checks", scope: "focused", commands: [command("focused-suite", script, { deterministic: true })] },
        { id: "module", name: "Module checks", scope: "module", commands: [command("module-suite", script, { deterministic: true })] },
        { id: "broad", name: "Broad checks", scope: "broad", commands: [command("broad-suite", script, { deterministic: true })] },
      ],
      acceptance: { "AC-01": ["check:module", "check:broad", "batch:approved-journey"] },
    },
  });
  await dryRunFinalization(root, taskId);
  const result = await finalizeTask(root, taskId);
  assert.deepEqual(result.result.metrics.checkGroupSignatureReuse, ["module"]);
  assert.deepEqual(result.result.metrics.checkGroupRuns, { focused: 1, module: 0, broad: 1 });
  assert.equal(result.state.checks.module.status, "passed");
  assert.match(result.state.checks.module.summary, /identical command evidence of focused/);
  assert.deepEqual(result.state.checks.module.evidence, result.state.checks.focused.evidence);
  // The broad group executed its own commands even though they are identical.
  assert.notDeepEqual(result.state.checks.broad.evidence, result.state.checks.focused.evidence);
});

test("identical commands run independently unless deterministic reuse is explicit", async (t) => {
  const marker = ".openatdd/requirements/.no-implicit-reuse-invocations";
  const script = `const fs = require("node:fs"); const marker = ${JSON.stringify(marker)}; const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0; fs.writeFileSync(marker, String(count + 1)); if (count > 0) process.exit(9);`;
  const { root, taskId } = await approvedImplementation(t, "no-implicit-reuse", {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
    manifest: {
      checks: [
        { id: "focused", scope: "focused", commands: [command("focused-stateful", script)] },
        { id: "module", scope: "module", commands: [command("module-stateful", script)] },
        { id: "broad", scope: "broad", commands: [command("broad-pass")] },
      ],
      acceptance: { "AC-01": ["check:module", "check:broad", "batch:approved-journey"] },
    },
  });
  await dryRunFinalization(root, taskId);
  await assert.rejects(
    () => finalizeTask(root, taskId),
    (error) => error.code === "FINALIZATION_COMMAND_FAILED",
  );
  assert.equal(await readFile(path.join(root, marker), "utf8"), "2");
});

test("fast finalization validates, rehearses, and commits one frozen journey in a single call", async (t) => {
  const { root, taskId, files } = await approvedImplementation(t, "fast-single-call");
  const result = await fastFinalize(root, taskId);
  assert.equal(result.validation.valid, true);
  assert.equal(result.preview.status, "passed");
  assert.equal(result.unchanged, false);
  assert.equal(result.state.phase, "DELIVERED");
  assert.equal(result.result.metrics.checkGroupRuns.broad, 1);
  assert.equal(result.result.metrics.uatJourneyRuns, 1);
  assert.equal(await pathExists(files.report), true);

  // A repeat for the same frozen fingerprint reports unchanged without rehearsing.
  const repeated = await fastFinalize(root, taskId);
  assert.equal(repeated.unchanged, true);
  assert.equal(repeated.preview, null);
  assert.equal(repeated.result.sourceFingerprint, result.result.sourceFingerprint);

  const invalid = await approvedImplementation(t, "fast-invalid-manifest");
  invalid.manifest.uat.batches[0].acceptanceIds = ["AC-99"];
  await writeManifest(invalid.root, invalid.manifest);
  await assert.rejects(
    () => fastFinalize(invalid.root, invalid.taskId),
    (error) => error.code === "INVALID_FINALIZATION_MANIFEST",
  );
  assert.equal(await pathExists(invalid.files.finalizePreview), false);
});

test("Quick fast finalization reuses exact deterministic rehearsal evidence without rerunning the broad command", async (t) => {
  const marker = ".openatdd/requirements/.quick-rehearsal-invocations";
  const script = `const fs = require("node:fs"); const marker = ${JSON.stringify(marker)}; const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0; fs.writeFileSync(marker, String(count + 1)); process.stdout.write("broad-ok");`;
  const { root, taskId } = await approvedImplementation(t, "quick-rehearsal-reuse", {
    manifest: {
      dryRun: {
        commands: [command("rehearsal-broad", script, { deterministic: true })],
      },
      checks: [
        { id: "focused", scope: "focused", commands: [command("focused-check")] },
        { id: "module", scope: "module", commands: [command("module-check")] },
        { id: "broad", scope: "broad", commands: [command("formal-broad", script, { deterministic: true })] },
      ],
    },
  });

  const result = await fastFinalize(root, taskId);
  assert.deepEqual(result.result.metrics.rehearsalEvidenceReuse, ["broad"]);
  assert.equal(result.result.metrics.rehearsalCommandInvocations, 1);
  assert.deepEqual(result.result.metrics.checkGroupRuns, { focused: 0, module: 0, broad: 1 });
  assert.equal(result.result.metrics.commandInvocations, 1);
  assert.equal(result.result.metrics.uatJourneyRuns, 1);
  assert.equal(await readFile(path.join(root, marker), "utf8"), "1");
  assert.equal(result.state.results["AC-01"].status, "passed");
  assert(result.state.results["AC-01"].evidence.length > 0);
});

test("Quick rehearsal reuse supports complete deterministic multi-command groups", async (t) => {
  const marker = ".openatdd/requirements/.quick-multi-rehearsal-invocations";
  const append = (value) => `const fs = require("node:fs"); fs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${value}\n`)}); process.stdout.write(${JSON.stringify(value)});`;
  const { root, taskId } = await approvedImplementation(t, "quick-multi-rehearsal-reuse", {
    manifest: {
      dryRun: {
        commands: [
          command("rehearsal-one", append("one"), { deterministic: true }),
          command("rehearsal-two", append("two"), { deterministic: true }),
        ],
      },
      checks: [
        { id: "focused", scope: "focused", commands: [command("focused-check")] },
        { id: "module", scope: "module", commands: [command("module-check")] },
        { id: "broad", scope: "broad", commands: [
          command("formal-one", append("one"), { deterministic: true }),
          command("formal-two", append("two"), { deterministic: true }),
        ] },
      ],
    },
  });

  const result = await fastFinalize(root, taskId);
  assert.deepEqual(result.result.metrics.rehearsalEvidenceReuse, ["broad"]);
  assert.equal(result.result.metrics.rehearsalCommandInvocations, 2);
  assert.equal(result.result.metrics.commandInvocations, 1);
  assert.deepEqual((await readFile(path.join(root, marker), "utf8")).trim().split("\n"), ["one", "two"]);
  assert.equal(result.state.checks.broad.evidence.length, 2);
});

test("tampered rehearsal evidence is not reused by formal Quick finalization", async (t) => {
  const marker = ".openatdd/requirements/.quick-tamper-invocations";
  const script = `const fs = require("node:fs"); const marker = ${JSON.stringify(marker)}; const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0; fs.writeFileSync(marker, String(count + 1)); process.stdout.write("broad-ok");`;
  const { root, taskId } = await approvedImplementation(t, "quick-tampered-rehearsal", {
    manifest: {
      dryRun: { commands: [command("rehearsal-broad", script, { deterministic: true })] },
      checks: [
        { id: "focused", scope: "focused", commands: [command("focused-check")] },
        { id: "module", scope: "module", commands: [command("module-check")] },
        { id: "broad", scope: "broad", commands: [command("formal-broad", script, { deterministic: true })] },
      ],
    },
  });

  const preview = await dryRunFinalization(root, taskId);
  await writeFile(resolveArtifactPath(root, preview.preview.commandResults[0].evidencePath), "tampered evidence\n");
  const result = await finalizeTask(root, taskId);
  assert.deepEqual(result.result.metrics.rehearsalEvidenceReuse, []);
  assert.equal(await readFile(path.join(root, marker), "utf8"), "2");
  assert.match(result.state.checks.broad.summary, /group passed/);
});

test("formal verification epochs start at formal time outside Quick rehearsal capture", async (t) => {
  const { root, taskId } = await approvedImplementation(t, "standard-formal-boundary", {
    assessment: { scope: "cross-module", projectPattern: "established", reversibility: "reversible", uncertainty: "medium" },
  });
  const previewAt = "2026-01-01T00:00:00.000Z";
  const formalAt = "2026-01-01T00:10:00.000Z";
  const preview = await dryRunFinalization(root, taskId, {}, clock(previewAt));
  const result = await finalizeTask(root, taskId, {}, clock(formalAt));

  assert.equal(preview.preview.verificationStartedAt, previewAt);
  assert.equal(result.state.verification.startedAt, formalAt);
  assert.equal(result.state.verificationNotBefore, formalAt);
});

test("project-scoped finalization preflight skips live assertions without fabricated evidence", async (t) => {
  const { root, taskId } = await approvedImplementation(t, "project-preflight", {
    manifest: {
      preflight: {
        scope: "project",
        reason: "The approved journey is a deterministic component harness with no live environment dependency.",
      },
    },
  });
  const profile = path.join(root, ".openatdd", "environments", "local.yaml");
  const profileText = await readFile(profile, "utf8");
  await writeFile(profile, profileText
    .replace("service_urls: n/a", "service_urls: http://127.0.0.1:1")
    .replace("entry_url: n/a", "entry_url: http://127.0.0.1:1/app")
    .replace("role: n/a", "role: tester")
    .replace("organization: n/a", "organization: qa-org")
    .replace("integration: n/a", "integration: unavailable-live-api")
    .replace("fixture: n/a", "fixture: sample-order")
    .replace('credential_variables: ""', "credential_variables: OPENATDD_TEST_PASSWORD"));

  await dryRunFinalization(root, taskId);
  const completed = await finalizeTask(root, taskId);
  assert.equal(completed.state.preflight.scope, "project");
  assert.equal(completed.state.preflight.status, "passed");
  for (const name of ["services", "entry_url", "credential_variables", "login", "organization", "integration", "fixture", "known_workarounds"]) {
    assert.equal(completed.state.preflight.checks.find((item) => item.name === name)?.status, "not_applicable");
  }
  assert.deepEqual(completed.state.preflight.credentialVariables, []);
});

test("project scope never requires credentials but still scans artifacts for existing local values", async (t) => {
  const secret = "ultrasecrettoken9931";
  const { root, taskId } = await approvedImplementation(t, "project-scope-leak", {
    requirement: `Deliver the export token ${secret} to finance`,
    manifest: {
      preflight: {
        scope: "project",
        reason: "The approved journey is a deterministic component harness with no live environment dependency.",
      },
    },
  });
  const profile = path.join(root, ".openatdd", "environments", "local.yaml");
  await writeFile(profile, (await readFile(profile, "utf8"))
    .replace('credential_variables: ""', "credential_variables: OPENATDD_TEST_TOKEN"));
  await writeFile(path.join(root, ".env.openatdd.local"), `OPENATDD_TEST_TOKEN=${secret}\n`);
  // Not requiring credentials is not the same as not scanning for them.
  await assert.rejects(
    () => dryRunFinalization(root, taskId),
    (error) => error.code === "FINALIZATION_DRY_RUN_FAILED"
      && error.details.errors.some((item) => String(item).includes("credential value")),
  );
});

test("CLI exposes both finalize modes and forwards JSON results", async (t) => {
  const { root, taskId } = await approvedImplementation(t, "cli-finalize");
  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  const validation = await execFileAsync(process.execPath, [cli, "validate-finalization", taskId, "--json", "--root", root]);
  assert.equal(JSON.parse(validation.stdout).valid, true);
  const preview = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--dry-run", "--json", "--root", root]);
  assert.equal(JSON.parse(preview.stdout).status, "passed");
  const final = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--json", "--root", root]);
  assert.equal(JSON.parse(final.stdout).status, "passed");
  const repeated = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--json", "--root", root]);
  assert.equal(JSON.parse(repeated.stdout).unchanged, true);
});

test("CLI fast finalization needs one invocation and rejects a combined dry-run", async (t) => {
  const { root, taskId } = await approvedImplementation(t, "cli-fast-finalize");
  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  const result = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--fast", "--json", "--root", root]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "passed");
  assert.equal(payload.validation.valid, true);
  assert.equal(payload.preview.status, "passed");
  assert.equal((await loadTask(root, taskId)).state.phase, "DELIVERED");

  const repeated = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--fast", "--root", root]);
  assert.match(repeated.stdout, /Rehearsal skipped/);
  assert.match(repeated.stdout, /Finalization remains complete/);

  await assert.rejects(
    () => execFileAsync(process.execPath, [cli, "finalize", taskId, "--fast", "--dry-run", "--root", root]),
    (error) => error.stderr.includes("INVALID_FINALIZE_MODE"),
  );
});

test("CLI static validation returns nonzero for an invalid acceptance mapping", async (t) => {
  const { root, taskId, manifest, files } = await approvedImplementation(t, "invalid-cli-manifest");
  manifest.uat.batches[0].acceptanceIds = ["AC-99"];
  await writeManifest(root, manifest);
  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  await assert.rejects(
    () => execFileAsync(process.execPath, [cli, "validate-finalization", taskId, "--json", "--root", root]),
    (error) => error.code === 1 && JSON.parse(error.stdout).valid === false,
  );
  assert.equal(await pathExists(files.finalizePreview), false);
});

test("multi-file commits roll back validation failures and recover interrupted journals", async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, "state.json");
  await writeFile(target, "before\n");
  await assert.rejects(
    () => atomicWriteBatch(root, [
      { target, content: "first\n" },
      { target, content: "duplicate\n" },
    ]),
    (error) => error.code === "TRANSACTION_DUPLICATE_TARGET",
  );
  assert.equal(await readFile(target, "utf8"), "before\n");

  const directory = path.join(gitPrivateRoot(root), "transactions", "interrupted");
  await mkdir(directory, { recursive: true });
  const before = path.join(directory, "before-0000");
  const after = path.join(directory, "after-0000");
  await writeFile(before, "before\n");
  await writeFile(after, "after\n");
  await writeFile(target, "after\n");
  await writeFile(path.join(directory, "journal.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "interrupted",
    status: "prepared",
    entries: [{ target, before, after, existed: true }],
  }, null, 2)}\n`);
  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  await execFileAsync(process.execPath, [cli, "help", "--root", root]);
  assert.equal(await readFile(target, "utf8"), "before\n");
  assert.equal(await pathExists(directory), false);
});

test("affected history reuses identical epoch evidence and caches distinct replays", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01")];
  const manifest = finalizationManifest(criteria);
  manifest.checks.find((group) => group.scope === "broad").commands[0].deterministic = true;

  await prepareApprovedTask(root, "historical", {
    criteria,
    impactPaths: ["src/shared"],
    createdAt: "2020-01-01T00:00:00.000Z",
    acceptanceAt: "2020-01-01T00:01:00.000Z",
    solutionAt: "2020-01-01T00:02:00.000Z",
  });
  await beginImplementation(root, "historical");
  await writeManifest(root, manifest);
  await dryRunFinalization(root, "historical");
  await finalizeTask(root, "historical");
  const historicalBeforeRepair = await loadTask(root, "historical");
  const originalHistoryEvidence = historicalBeforeRepair.state.checks.broad.evidence[0];
  const originalHistoryEvidencePath = resolveArtifactPath(root, originalHistoryEvidence.path);
  await writeFile(originalHistoryEvidencePath, "overwritten by a later failed formal run\n");
  await rm(path.join(gitPrivateRoot(root), "reverification", "index.json"), { force: true });

  await prepareApprovedTask(root, "current-one", {
    criteria,
    impactPaths: ["src/shared"],
    createdAt: "2021-01-01T00:00:00.000Z",
    acceptanceAt: "2021-01-01T00:01:00.000Z",
    solutionAt: "2021-01-01T00:02:00.000Z",
  });
  await beginImplementation(root, "current-one");
  await dryRunFinalization(root, "current-one");
  const first = await finalizeTask(root, "current-one");
  assert.equal(first.result.metrics.affectedHistoryPasses, 1);
  // The replay commands are argv-identical to the broad group that already ran
  // against this frozen fingerprint, so no historical suite is executed twice.
  assert.equal(first.result.metrics.historyRuns, 0);
  assert.equal(first.result.metrics.historyEpochReuse, 1);
  assert.equal(first.result.metrics.historyCacheHits, 0);
  assert.equal(await pathExists(path.join(gitPrivateRoot(root), "reverification", "index.json")), true);
  const repairedHistorical = (await loadTask(root, "historical")).state;
  assert.match(repairedHistorical.results["AC-01"].summary, /Reverified once/);
  assert.notEqual(repairedHistorical.checks.broad.evidence[0].path, originalHistoryEvidence.path);
  assert.match(repairedHistorical.checks.broad.evidence[0].path, /tasks\/current-one\/evidence\/finalize/);

  await prepareApprovedTask(root, "current-two", {
    criteria,
    impactPaths: ["src/shared"],
    createdAt: "2022-01-01T00:00:00.000Z",
    acceptanceAt: "2022-01-01T00:01:00.000Z",
    solutionAt: "2022-01-01T00:02:00.000Z",
  });
  await beginImplementation(root, "current-two");
  await dryRunFinalization(root, "current-two");
  const second = await finalizeTask(root, "current-two");
  assert.equal(second.result.metrics.historyRuns, 0);
  assert.equal(second.result.metrics.historyCacheHits + second.result.metrics.historyEpochReuse, 2);
  assert.deepEqual(new Set(second.result.affectedHistory), new Set(["historical", "current-one"]));

  await rm(path.join(root, ".openatdd", "transactions"), { recursive: true, force: true });
});

test("repaired finalization preserves prior fingerprint-scoped history evidence", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01")];
  const historicalManifest = finalizationManifest(criteria);
  historicalManifest.checks.find((group) => group.scope === "broad").commands = [command("historical-broad", 'process.stdout.write("historical")')];

  await prepareApprovedTask(root, "history-source", {
    criteria,
    impactPaths: ["src/shared"],
    createdAt: "2020-01-01T00:00:00.000Z",
    acceptanceAt: "2020-01-01T00:01:00.000Z",
    solutionAt: "2020-01-01T00:02:00.000Z",
  });
  await beginImplementation(root, "history-source");
  await writeManifest(root, historicalManifest);
  await dryRunFinalization(root, "history-source");
  await finalizeTask(root, "history-source");

  await prepareApprovedTask(root, "repairable-current", {
    criteria,
    impactPaths: ["src/shared"],
    createdAt: "2021-01-01T00:00:00.000Z",
    acceptanceAt: "2021-01-01T00:01:00.000Z",
    solutionAt: "2021-01-01T00:02:00.000Z",
  });
  await beginImplementation(root, "repairable-current");
  await writeManifest(root, finalizationManifest(criteria));
  await dryRunFinalization(root, "repairable-current");
  await finalizeTask(root, "repairable-current");

  let historyState = (await loadTask(root, "history-source")).state;
  const firstEvidence = historyState.checks["finalize-repairable-current"].evidence[0];
  assert.match(firstEvidence.path, /fingerprint-[a-f0-9]{64}/);
  const firstEvidencePath = resolveArtifactPath(root, firstEvidence.path);
  const firstEvidenceBytes = await readFile(firstEvidencePath);

  await recordIssue(root, "repairable-current", {
    acceptanceId: "AC-01",
    status: "open",
    symptom: "A repair changes the frozen source fingerprint",
  });
  const repairEvidence = path.join(root, ".openatdd", "repair-evidence.txt");
  await writeFile(repairEvidence, "repair passed\n");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "repair.txt"), "new fingerprint\n");
  await recordIssue(root, "repairable-current", {
    id: "ISSUE-001",
    status: "resolved",
    rootCause: "The source changed after the first delivery",
    regression: "history_evidence_is_fingerprint_scoped",
    invariant: "Historical evidence from one frozen fingerprint is never overwritten by a later formal run",
    paths: "skills/openatdd/scripts/finalization.mjs",
    evidence: repairEvidence,
  });
  await dryRunFinalization(root, "repairable-current");
  await finalizeTask(root, "repairable-current");

  historyState = (await loadTask(root, "history-source")).state;
  const secondEvidence = historyState.checks["finalize-repairable-current"].evidence[0];
  assert.match(secondEvidence.path, /fingerprint-[a-f0-9]{64}/);
  assert.notEqual(secondEvidence.path, firstEvidence.path);
  assert.deepEqual(await readFile(firstEvidencePath), firstEvidenceBytes);
});
