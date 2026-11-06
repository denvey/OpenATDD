import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { assert, resolveInside, sha256, verifyCapturedEvidence } from "./lib.mjs";
import { canonicalJson, loadFinalizationManifest, resolveCommand } from "./manifest.mjs";

// The existing UAT batches are the single acceptance execution contract.
export async function acceptanceTestContract(root, manifest, acceptanceItems) {
  const batches = manifest.uat.batches;
  const rootPath = await realpath(root);
  const testFiles = new Map();
  const batchIds = new Set();
  for (const batch of batches) {
    assert(!batchIds.has(batch.id), "INVALID_ACCEPTANCE_TEST_PLAN", `Duplicate acceptance batch: ${batch.id}`);
    batchIds.add(batch.id);
    assert(new Set(batch.acceptanceIds).size === batch.acceptanceIds.length, "INVALID_ACCEPTANCE_TEST_PLAN", `Duplicate acceptance IDs in ${batch.id}`);
    if (batch.runner === "internal") continue;
    assert(Array.isArray(batch.testFiles) && batch.testFiles.length > 0, "INVALID_ACCEPTANCE_TEST_PLAN", `Acceptance batch ${batch.id} requires testFiles containing its assertions, adapters and fixtures.`);
    for (const name of batch.testFiles) {
      assert(typeof name === "string" && name.trim() && !path.isAbsolute(name), "INVALID_ACCEPTANCE_TEST_PLAN", "testFiles must contain project-relative file paths.");
      const { resolved, relative } = resolveInside(root, name);
      const actual = await realpath(resolved);
      resolveInside(rootPath, actual);
      const info = await lstat(resolved);
      assert(info.isFile(), "INVALID_ACCEPTANCE_TEST_PLAN", `Acceptance test must be a regular file: ${name}`);
      testFiles.set(relative, { path: relative, sha256: sha256(await readFile(actual)), mode: info.mode & 0o777 });
    }
    for (const command of batch.commands) {
      const exits = command.expectedExitCodes ?? [0];
      assert(exits.length === 1 && exits[0] === 0, "INVALID_ACCEPTANCE_TEST_PLAN", `Acceptance command ${command.id} must require exit zero for delivery.`);
    }
  }
  const { resolved: profilePath } = resolveInside(root, `.openatdd/environments/${manifest.environment}.yaml`);
  resolveInside(rootPath, await realpath(profilePath));
  const files = [...testFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
  const contract = {
    acceptanceIds: acceptanceItems.map(({ id, classification }) => ({ id, classification })),
    surface: manifest.surface,
    environment: manifest.environment,
    profileSha256: sha256(await readFile(profilePath)),
    preflight: manifest.preflight ?? null,
    batches: batches.map((batch) => ({
      id: batch.id, acceptanceIds: batch.acceptanceIds, runner: batch.runner ?? "command",
      testFiles: [...(batch.testFiles ?? [])].sort(),
      commands: (batch.commands ?? []).map((command) => {
        const normalized = resolveCommand(root, command);
        return { id: normalized.id, argv: normalized.argv, cwd: path.relative(root, normalized.cwd) || ".", env: [...normalized.env].sort(), timeoutMs: normalized.timeoutMs, expectedExitCodes: normalized.expectedExitCodes };
      }),
    })),
    files,
  };
  return { digest: sha256(canonicalJson(contract)), files, batchIds: batches.filter((batch) => batch.runner !== "internal").map((batch) => batch.id) };
}

export function acceptanceCommandOutcome(result, batch, { baseline = false } = {}) {
  let payload;
  try { payload = JSON.parse(result.stdout); } catch {
    assert(false, "INVALID_ACCEPTANCE_OUTCOME", `Acceptance command ${result.id} must print one JSON result object, not setup errors or test-runner logs.`);
  }
  assert(payload?.schemaVersion === 1 && Array.isArray(payload.results) && payload.results.length > 0, "INVALID_ACCEPTANCE_OUTCOME", `Acceptance command ${result.id} requires schemaVersion:1 and non-empty results.`);
  const seen = new Set();
  for (const item of payload.results) {
    assert(item && typeof item === "object" && !Array.isArray(item), "INVALID_ACCEPTANCE_OUTCOME", `Acceptance command ${result.id} returned an invalid result item.`);
    assert(batch.acceptanceIds.includes(item.acceptanceId) && !seen.has(item.acceptanceId), "INVALID_ACCEPTANCE_OUTCOME", `Unknown or duplicate acceptance outcome: ${item.acceptanceId}`);
    seen.add(item.acceptanceId);
    assert(["passed", "failed"].includes(item.status) && typeof item.summary === "string" && item.summary.trim(), "INVALID_ACCEPTANCE_OUTCOME", `Invalid acceptance result: ${item.acceptanceId}`);
    assert(item.status === "passed" || (baseline && item.failureClass === "assertion"), "INVALID_ACCEPTANCE_OUTCOME", `Only an assertion failure is a valid initial acceptance gap: ${item.acceptanceId}`);
  }
  const failed = payload.results.some((item) => item.status === "failed");
  assert(result.exitCode === (failed ? 1 : 0), "INVALID_ACCEPTANCE_OUTCOME", `Acceptance command ${result.id} exit code contradicts its results.`);
  return payload.results.map(({ acceptanceId, status, failureClass, summary }) => ({ acceptanceId, status, ...(status === "failed" ? { failureClass } : {}), summary }));
}

export function assertBatchOutcomeCoverage(batch, outcomes) {
  const ids = outcomes.map((item) => item.acceptanceId);
  assert(new Set(ids).size === ids.length && batch.acceptanceIds.every((id) => ids.includes(id)), "INVALID_ACCEPTANCE_OUTCOME", `Acceptance results must cover each criterion in ${batch.id} exactly once.`);
}

export async function assertAcceptanceBaseline(root, state, manifestInfo = undefined) {
  if (!(state.deliveryVersion >= 4)) return;
  const baseline = state.acceptanceBaseline;
  assert(baseline?.recordedAt && baseline.contractDigest && baseline.evidence?.length, "ACCEPTANCE_BASELINE_REQUIRED", "Run the executable acceptance baseline with begin before implementation or delivery.");
  assert(baseline.acceptanceSha256 === state.acceptance.sha256 && baseline.solutionSha256 === state.solution.sha256, "ACCEPTANCE_BASELINE_DRIFT", "Acceptance baseline no longer matches the approved cards; reopen the solution.");
  try {
    const info = manifestInfo ?? await loadFinalizationManifest(root, state.taskId, baseline.manifestPath);
    const contract = await acceptanceTestContract(root, info.manifest, state.acceptance.items);
    assert(contract.digest === baseline.contractDigest, "ACCEPTANCE_BASELINE_DRIFT", "Frozen acceptance tests, commands or environment changed; reopen the solution before rebuilding the baseline.");
    const errors = await verifyCapturedEvidence(root, baseline.evidence, baseline.recordedAt);
    assert(errors.length === 0, "ACCEPTANCE_BASELINE_DRIFT", "Acceptance baseline evidence is missing or changed.", { errors });
  } catch (error) {
    if (error.code === "ACCEPTANCE_BASELINE_DRIFT") throw error;
    assert(false, "ACCEPTANCE_BASELINE_DRIFT", `Frozen acceptance contract is unreadable or invalid: ${error.message}`);
  }
}
