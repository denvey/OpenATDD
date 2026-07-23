import assert from "node:assert/strict";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  approveAcceptance,
  beginImplementation,
  beginPreUat,
  createTask,
  draftSolution,
  loadTask,
  markReady,
  recordAcceptanceResult,
  recordCheck,
  recordIssue,
  taskFiles,
} from "../skills/openatdd/scripts/workflow.mjs";
import {
  clock,
  criterion,
  prepareApprovedTask,
  solutionMarkdown,
  temporaryProject,
  writeAcceptance,
  writeEvidence,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);

async function loadCases() {
  const cases = [];
  for (const set of ["dev", "regression", "holdout"]) {
    const directory = path.resolve("evals", set);
    for (const name of (await readdir(directory)).filter((item) => item.endsWith(".json")).sort()) {
      cases.push(JSON.parse(await readFile(path.join(directory, name), "utf8")));
    }
  }
  return cases;
}

async function probeGateOrder(t) {
  const root = await temporaryProject(t);
  await createTask(root, "probe-gates", "Probe both approval gates", clock("2020-01-01T00:00:00.000Z"));
  let acceptanceRejected = false;
  try {
    await draftSolution(root, "probe-gates");
  } catch (error) {
    acceptanceRejected = error.code === "INVALID_PHASE";
  }
  await writeAcceptance(root, "probe-gates", [criterion("AC-01")]);
  await approveAcceptance(root, "probe-gates", clock("2020-01-01T00:01:00.000Z"));
  await draftSolution(root, "probe-gates");
  let solutionRejected = false;
  try {
    await beginImplementation(root, "probe-gates");
  } catch (error) {
    solutionRejected = error.code === "INVALID_PHASE";
  }
  return {
    acceptance_gate_before_solution: acceptanceRejected,
    solution_gate_before_implementation: solutionRejected,
  };
}

async function probeManualBoundary(t) {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01", { classification: "MANUAL", title: "A person judges visual comfort" })];
  await prepareApprovedTask(root, "manual-boundary", { criteria });
  await beginImplementation(root, "manual-boundary");
  await beginPreUat(root, "manual-boundary");
  let automaticPassRejected = false;
  const evidence = await writeEvidence(root, "manual-boundary", "visual.txt", "screenshot prepared");
  try {
    await recordAcceptanceResult(root, "manual-boundary", { acceptanceId: "AC-01", status: "passed", evidence });
  } catch (error) {
    automaticPassRejected = error.code === "MANUAL_CANNOT_AUTO_PASS";
  }
  await recordAcceptanceResult(root, "manual-boundary", {
    acceptanceId: "AC-01",
    status: "manual",
    summary: "Human must judge visual comfort",
  });
  const checkEvidence = await writeEvidence(root, "manual-boundary", "tests.txt", "checks passed");
  await recordCheck(root, "manual-boundary", {
    name: "tests",
    command: "npm test",
    status: "passed",
    evidence: checkEvidence,
  });
  const ready = await markReady(root, "manual-boundary");
  return {
    manual_cannot_auto_pass: automaticPassRejected,
    manual_is_explicitly_handed_off: ready.state.results["AC-01"].status === "manual",
    automatic_checks_still_required: ready.state.checks.tests.status === "passed",
  };
}

async function probeContractDrift(t) {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "drift-probe");
  const files = taskFiles(root, "drift-probe");
  await writeFile(files.acceptance, `${await readFile(files.acceptance, "utf8")}\nunapproved drift\n`);
  let rejected = false;
  try {
    await beginImplementation(root, "drift-probe");
  } catch (error) {
    rejected = error.code === "ACCEPTANCE_DRIFT";
  }
  return { silent_acceptance_change_rejected: rejected };
}

async function probeFreshEvidence(t) {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "fresh-probe");
  await beginImplementation(root, "fresh-probe");
  await beginPreUat(root, "fresh-probe");
  let details = [];
  try {
    await markReady(root, "fresh-probe");
  } catch (error) {
    details = error.details?.errors ?? [];
  }
  return {
    ready_without_evidence_rejected: details.some((item) => item.includes("no recorded result")),
    ready_without_project_check_rejected: details.some((item) => item.includes("project check")),
  };
}

async function probeRepairRerun(t) {
  const root = await temporaryProject(t);
  const criteria = [criterion("AC-01"), criterion("AC-02")];
  await prepareApprovedTask(root, "repair-probe", { criteria, impactPaths: ["src/export"] });
  await beginImplementation(root, "repair-probe");
  await beginPreUat(root, "repair-probe");
  for (const item of criteria) {
    const evidence = await writeEvidence(root, "repair-probe", `${item.id}.txt`, "passed");
    await recordAcceptanceResult(root, "repair-probe", { acceptanceId: item.id, status: "passed", evidence });
  }
  let evidence = await writeEvidence(root, "repair-probe", "tests.txt", "passed");
  await recordCheck(root, "repair-probe", { name: "tests", command: "npm test", status: "passed", evidence });
  await recordIssue(root, "repair-probe", {
    acceptanceId: "AC-01",
    status: "open",
    symptom: "Final page is missing",
  });
  evidence = await writeEvidence(root, "repair-probe", "fix.txt", "fixed");
  await recordIssue(root, "repair-probe", {
    id: "ISSUE-001",
    status: "resolved",
    rootCause: "Final cursor was not consumed",
    regression: "includes_final_cursor",
    invariant: "All matching rows are emitted exactly once",
    paths: "src/export",
    evidence,
  });
  const { state } = await loadTask(root, "repair-probe");
  return {
    failed_item_becomes_affected: state.results["AC-01"].status === "affected",
    previous_pass_becomes_affected: state.results["AC-02"].status === "affected",
    project_check_becomes_affected: state.checks.tests.status === "affected",
    incident_memory_written: Boolean(state.issues[0].memoryId),
  };
}

async function probeSharedImpact(t) {
  const root = await temporaryProject(t);
  await prepareApprovedTask(root, "prior", {
    createdAt: "2020-01-01T00:00:00.000Z",
    acceptanceAt: "2020-01-01T00:01:00.000Z",
    solutionAt: "2020-01-01T00:02:00.000Z",
    impactPaths: ["src/shared"],
  });
  await beginImplementation(root, "prior");
  await beginPreUat(root, "prior");
  const evidence = await writeEvidence(root, "prior", "prior.txt", "prior passed");
  await recordAcceptanceResult(root, "prior", { acceptanceId: "AC-01", status: "passed", evidence });
  const current = await prepareApprovedTask(root, "current", {
    createdAt: "2021-01-01T00:00:00.000Z",
    acceptanceAt: "2021-01-01T00:01:00.000Z",
    solutionAt: "2021-01-01T00:02:00.000Z",
    impactPaths: ["src/shared/child"],
  });
  const prior = await loadTask(root, "prior");
  return {
    historical_task_detected: current.state.affectedDependencies.some((item) => item.taskId === "prior"),
    historical_acceptance_marked_affected: prior.state.results["AC-01"].status === "affected",
    current_handoff_depends_on_reverification: current.state.affectedDependencies[0].acceptanceIds.includes("AC-01"),
  };
}

async function probePortableCli(t) {
  const root = await temporaryProject(t);
  const installRoot = path.join(root, "installed", "openatdd");
  const target = path.join(root, "target");
  await cp(path.resolve("skills/openatdd"), installRoot, { recursive: true });
  const script = path.join(installRoot, "scripts", "openatdd.mjs");
  const first = await execFileAsync(process.execPath, [script, "init", "--root", target]);
  await execFileAsync(process.execPath, [script, "new", "probe", "--requirement", "Portable", "--root", target]);
  const state = JSON.parse((await execFileAsync(process.execPath, [script, "status", "probe", "--json", "--root", target])).stdout);
  return {
    copied_cli_executes: first.stdout.includes("Initialized OpenATDD"),
    target_project_initialized: state.phase === "ACCEPTANCE_DRAFT",
  };
}

const probes = {
  "gate-order": probeGateOrder,
  "manual-boundary": probeManualBoundary,
  "contract-drift": probeContractDrift,
  "fresh-evidence": probeFreshEvidence,
  "repair-rerun": probeRepairRerun,
  "shared-impact": probeSharedImpact,
  "portable-cli": probePortableCli,
};

test("evaluation corpus satisfies the deterministic hard-gate baseline", async (t) => {
  const cases = await loadCases();
  assert.deepEqual(new Set(cases.map((item) => item.set)), new Set(["dev", "regression", "holdout"]));
  for (const evaluation of cases) {
    await t.test(evaluation.id, async (subtest) => {
      assert.equal(typeof evaluation.input, "string");
      assert(Array.isArray(evaluation.forbidden) && evaluation.forbidden.length > 0);
      assert(probes[evaluation.scenario], `Unknown evaluation scenario: ${evaluation.scenario}`);
      const observed = await probes[evaluation.scenario](subtest);
      for (const [key, expected] of Object.entries(evaluation.expected)) {
        assert.equal(observed[key], expected, `${evaluation.id}: ${key}`);
      }
    });
  }
});
