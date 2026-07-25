import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  atomicWriteBatch,
  filesBelow,
  pathExists,
} from "../skills/openatdd/scripts/lib.mjs";
import {
  dryRunFinalization,
  finalizeTask,
} from "../skills/openatdd/scripts/finalization.mjs";
import {
  fingerprintProject,
  validateFinalizationManifest,
} from "../skills/openatdd/scripts/manifest.mjs";
import {
  beginImplementation,
  loadTask,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";
import {
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

async function approvedImplementation(testContext, taskId = "fast-finalize", options = {}) {
  const root = await temporaryProject(testContext);
  const criteria = options.criteria ?? [criterion("AC-01")];
  await prepareApprovedTask(root, taskId, {
    criteria,
    impactPaths: options.impactPaths ?? ["src/shared"],
    createdAt: options.createdAt,
    acceptanceAt: options.acceptanceAt,
    solutionAt: options.solutionAt,
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

test("fingerprints include deliverable changes and exclude credentials and runtime evidence", async (t) => {
  const root = await temporaryProject(t);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, ".openatdd", "tasks", "ignored", "evidence"), { recursive: true });
  await mkdir(path.join(root, ".openatdd", "knowledge"), { recursive: true });
  await writeFile(path.join(root, "src", "feature.mjs"), "export const value = 1;\n");
  await writeFile(path.join(root, "new-file.txt"), "untracked deliverable\n");
  await writeFile(path.join(root, ".env.openatdd.local"), "PASSWORD=local-only\n");
  await writeFile(path.join(root, ".openatdd", "tasks", "ignored", "evidence", "run.txt"), "runtime\n");
  await writeFile(path.join(root, ".openatdd", "knowledge", "graph.json"), "{\"rebuilt\":1}\n");
  const first = await fingerprintProject(root, { include: ["**/*"] });
  assert(first.files.some((item) => item.path === "src/feature.mjs"));
  assert(first.files.some((item) => item.path === "new-file.txt"));
  assert(!first.files.some((item) => item.path === ".env.openatdd.local"));
  assert(!first.files.some((item) => item.path.includes("evidence/run.txt")));
  assert(!first.files.some((item) => item.path === ".openatdd/knowledge/graph.json"));

  await writeFile(path.join(root, ".env.openatdd.local"), "PASSWORD=changed-local-only\n");
  await writeFile(path.join(root, ".openatdd", "knowledge", "graph.json"), "{\"rebuilt\":2}\n");
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
  assert.equal(completed.state.phase, "READY_FOR_UAT");
  assert.equal(completed.state.finalization.status, "complete");
  assert.equal(completed.state.results["AC-01"].status, "passed");
  assert.equal(completed.result.metrics.checkGroupRuns.broad, 1);
  assert.equal(completed.result.metrics.uatJourneyRuns, 1);
  assert.equal(completed.result.metrics.dryRunRuns, 1);
  assert.equal(completed.result.metrics.finalRuns, 1);
  assert(completed.result.metrics.cliInvocations >= 3);
  assert(completed.result.metrics.phaseDurationsMs.checks >= 0);
  assert(completed.result.metrics.evidenceWritesByPhase.checks >= 3);
  assert.equal(await pathExists(files.report), true);
  assert.equal(await pathExists(files.notification), true);
  assert.equal(await pathExists(files.finalizationSnapshot), true);

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
  const { root, taskId } = await approvedImplementation(t, "assisted-finalize", {
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

  assert.equal(completed.state.phase, "READY_FOR_UAT");
  assert.equal(completed.state.results["AC-01"].status, "manual");
  assert.match(completed.state.results["AC-01"].summary, /human judgment remains required/);
  assert(completed.state.results["AC-01"].evidence.length > 0);
  assert.equal(completed.state.uat.batches["manual-handoff"].status, "manual");
  assert.match(completed.state.uat.batches["manual-handoff"].summary, /no automatic journey was executed/);
  assert.equal(completed.result.metrics.uatJourneyRuns, 0);
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
        evidence: path.relative(root, loginEvidence),
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
      evidence: path.relative(root, evidence),
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
  assert(completed.result.metrics.commandInvocations >= 4);
});

test("CLI exposes both finalize modes and forwards JSON results", async (t) => {
  const { root, taskId } = await approvedImplementation(t, "cli-finalize");
  const cli = path.resolve("skills/openatdd/scripts/openatdd.mjs");
  const preview = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--dry-run", "--json", "--root", root]);
  assert.equal(JSON.parse(preview.stdout).status, "passed");
  const final = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--json", "--root", root]);
  assert.equal(JSON.parse(final.stdout).status, "passed");
  const repeated = await execFileAsync(process.execPath, [cli, "finalize", taskId, "--json", "--root", root]);
  assert.equal(JSON.parse(repeated.stdout).unchanged, true);
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

  const directory = path.join(root, ".openatdd", "transactions", "interrupted");
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

test("affected history runs once per new fingerprint and later finalizations reuse its cache", async (t) => {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01")];
  const manifest = finalizationManifest(criteria);

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
  await rm(path.join(root, ".openatdd", "reverification", "index.json"), { force: true });

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
  assert.equal(first.result.metrics.historyRuns, 1);
  assert.equal(first.result.metrics.historyCacheHits, 0);
  assert.equal(await pathExists(path.join(root, ".openatdd", "reverification", "index.json")), true);
  assert.match((await loadTask(root, "historical")).state.results["AC-01"].summary, /Reverified once/);

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
  assert.equal(second.result.metrics.historyCacheHits, 1);
  assert.equal(second.result.metrics.historyRuns, 1);
  assert.deepEqual(new Set(second.result.affectedHistory), new Set(["historical", "current-one"]));

  await rm(path.join(root, ".openatdd", "transactions"), { recursive: true, force: true });
});
