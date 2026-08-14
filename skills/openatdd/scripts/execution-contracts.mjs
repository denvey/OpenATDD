import path from "node:path";

import { assert } from "./lib.mjs";

export const IMPLEMENTATION_ROUTES = Object.freeze([
  "bounded-implementation",
  "complex-implementation",
]);

export const FAILURE_CLASSES = Object.freeze([
  "none",
  "runtime",
  "model_identity",
  "permission",
  "dependency",
  "scope",
  "verification",
  "conflict",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeExecutionPath(value) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  assert(raw, "EXECUTION_PATH_REQUIRED", "Execution paths cannot be empty.");
  assert(!path.posix.isAbsolute(raw) && !/^[A-Za-z]:\//.test(raw), "EXECUTION_PATH_ABSOLUTE", `Execution path must be project-relative: ${raw}.`);
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "").replace(/\/$/, "");
  assert(normalized && normalized !== "." && normalized !== ".." && !normalized.startsWith("../"), "EXECUTION_PATH_ESCAPE", `Execution path escapes the project: ${raw}.`);
  return normalized;
}

export function executionPathsOverlap(left, right) {
  const a = normalizeExecutionPath(left);
  const b = normalizeExecutionPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function stringList(value, code, message) {
  assert(Array.isArray(value) && value.length > 0 && value.every(nonEmpty), code, message);
  return [...new Set(value.map((item) => item.trim()))];
}

function optionalStringList(value, code, message) {
  if (value === undefined) return [];
  assert(Array.isArray(value) && value.every(nonEmpty), code, message);
  return [...new Set(value.map((item) => item.trim()))];
}

function optionalMetadata(value, code, message) {
  if (value === undefined) return undefined;
  assert(isRecord(value), code, message);
  return { ...value };
}

function normalizePlanTask(input) {
  assert(isRecord(input), "INVALID_EXECUTION_TASK", "Each execution task must be an object.");
  assert(nonEmpty(input.id), "EXECUTION_TASK_ID_REQUIRED", "Each execution task needs an id.");
  assert(nonEmpty(input.task), "EXECUTION_TASK_DESCRIPTION_REQUIRED", `Execution task ${input.id ?? "unknown"} needs a description.`);
  assert(Number.isInteger(input.stage) && input.stage > 0, "INVALID_EXECUTION_STAGE", `Execution task ${input.id} stage must be a positive integer.`);
  assert(IMPLEMENTATION_ROUTES.includes(input.route), "UNKNOWN_EXECUTION_ROUTE", `Execution task ${input.id} has unknown route ${input.route}.`);
  assert(nonEmpty(input.expectedResult), "EXECUTION_EXPECTED_RESULT_REQUIRED", `Execution task ${input.id} needs an expectedResult.`);
  assert(nonEmpty(input.firstArtifact), "EXECUTION_FIRST_ARTIFACT_REQUIRED", `Execution task ${input.id} needs a firstArtifact.`);
  const writeScope = stringList(input.writeScope, "EXECUTION_WRITE_SCOPE_REQUIRED", `Execution task ${input.id} needs a non-empty writeScope.`).map(normalizeExecutionPath);
  const doNotTouch = optionalStringList(input.doNotTouch, "INVALID_EXECUTION_EXCLUSIONS", `Execution task ${input.id} doNotTouch must contain non-empty paths.`).map(normalizeExecutionPath);
  for (const forbidden of doNotTouch) {
    assert(!writeScope.some((allowed) => executionPathsOverlap(allowed, forbidden)), "EXECUTION_SCOPE_CONFLICT", `Execution task ${input.id} writeScope overlaps doNotTouch: ${forbidden}.`);
  }
  const normalized = {
    id: input.id.trim(),
    acceptanceIds: stringList(input.acceptanceIds, "EXECUTION_ACCEPTANCE_REQUIRED", `Execution task ${input.id} needs acceptanceIds.`),
    task: input.task.trim(),
    stage: input.stage,
    dependsOn: optionalStringList(input.dependsOn, "INVALID_EXECUTION_DEPENDENCIES", `Execution task ${input.id} dependsOn must contain task ids.`),
    writeScope,
    doNotTouch,
    expectedResult: input.expectedResult.trim(),
    verification: stringList(input.verification, "EXECUTION_VERIFICATION_REQUIRED", `Execution task ${input.id} needs verification commands.`),
    firstArtifact: input.firstArtifact.trim(),
    route: input.route,
  };
  const session = optionalMetadata(input.session ?? input.sessionMetadata, "INVALID_EXECUTION_SESSION_METADATA", `Execution task ${input.id} session metadata must be an object.`);
  const isolation = optionalMetadata(input.isolation ?? input.isolationMetadata, "INVALID_EXECUTION_ISOLATION_METADATA", `Execution task ${input.id} isolation metadata must be an object.`);
  if (session !== undefined) normalized.session = session;
  if (isolation !== undefined) normalized.isolation = isolation;
  return normalized;
}

export function validateExecutionPlan(acceptanceIds, input) {
  assert(isRecord(input), "INVALID_EXECUTION_PLAN", "Execution plan must be an object.");
  assert(input.schemaVersion === 1, "UNSUPPORTED_EXECUTION_PLAN", "Execution plan schemaVersion must be 1.");
  assert(Array.isArray(input.tasks) && input.tasks.length > 0, "EXECUTION_TASKS_REQUIRED", "Execution plan needs at least one task.");
  const knownAcceptance = new Set(acceptanceIds);
  const tasks = input.tasks.map(normalizePlanTask);
  const byId = new Map();
  for (const task of tasks) {
    assert(!byId.has(task.id), "DUPLICATE_EXECUTION_TASK", `Duplicate execution task id: ${task.id}.`);
    for (const acceptanceId of task.acceptanceIds) assert(knownAcceptance.has(acceptanceId), "UNKNOWN_EXECUTION_ACCEPTANCE", `Execution task ${task.id} references unknown acceptance ${acceptanceId}.`);
    byId.set(task.id, task);
  }
  const covered = new Set(tasks.flatMap((task) => task.acceptanceIds));
  for (const acceptanceId of knownAcceptance) assert(covered.has(acceptanceId), "EXECUTION_ACCEPTANCE_NOT_COVERED", `Execution plan does not cover ${acceptanceId}.`);
  for (const task of tasks) {
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      assert(dependency, "UNKNOWN_EXECUTION_DEPENDENCY", `Execution task ${task.id} depends on unknown task ${dependencyId}.`);
      assert(dependency.stage < task.stage, "INVALID_EXECUTION_DEPENDENCY_ORDER", `Execution task ${task.id} dependency ${dependencyId} must be in a prior stage.`);
    }
  }
  for (let index = 0; index < tasks.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < tasks.length; otherIndex += 1) {
      const left = tasks[index];
      const right = tasks[otherIndex];
      const overlap = left.writeScope.some((a) => right.writeScope.some((b) => executionPathsOverlap(a, b)));
      assert(left.stage !== right.stage || !overlap, "EXECUTION_SCOPE_OWNER_CONFLICT", `Same-stage execution tasks ${left.id} and ${right.id} have overlapping write scopes.`);
    }
  }
  const normalized = { schemaVersion: 1, tasks };
  for (const key of ["orchestration", "parallel", "isolation", "metadata"]) {
    if (input[key] !== undefined) {
      assert(isRecord(input[key]), "INVALID_EXECUTION_PLAN_METADATA", `Execution plan ${key} metadata must be an object.`);
      normalized[key] = { ...input[key] };
    }
  }
  return normalized;
}

export function validateRuntimeAttestation(expected, input) {
  assert(isRecord(input), "RUNTIME_ATTESTATION_REQUIRED", "A host runtime attestation is required.");
  assert(input.verified === true, "RUNTIME_ATTESTATION_UNVERIFIED", "The host must verify the actual Agent runtime.");
  for (const key of ["profile", "model", "reasoningEffort", "forkTurns", "sandbox", "leaf", "canSpawnAgents"]) {
    assert(input[key] === expected[key], "RUNTIME_PROFILE_MISMATCH", `Runtime attestation ${key} does not match the authoritative profile.`);
  }
  assert(nonEmpty(input.source), "RUNTIME_ATTESTATION_SOURCE_REQUIRED", "Runtime attestation needs a source.");
  return {
    verified: true,
    source: input.source.trim(),
    profile: input.profile,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    forkTurns: input.forkTurns,
    sandbox: input.sandbox,
    leaf: input.leaf,
    canSpawnAgents: input.canSpawnAgents,
  };
}

export function validateRuntimeFailure(input) {
  assert(isRecord(input), "RUNTIME_FAILURE_REQUIRED", "A blocked unverified runtime needs a failure record.");
  assert(input.verified === false, "RUNTIME_FAILURE_MUST_BE_UNVERIFIED", "Runtime failure records must explicitly set verified=false.");
  assert(["runtime", "model_identity", "permission"].includes(input.failureClass), "INVALID_RUNTIME_FAILURE_CLASS", "Runtime failure class must be runtime, model_identity, or permission.");
  assert(nonEmpty(input.blocker), "RUNTIME_FAILURE_BLOCKER_REQUIRED", "Runtime failure records need a concrete blocker.");
  assert(nonEmpty(input.source), "RUNTIME_ATTESTATION_SOURCE_REQUIRED", "Runtime failure records need a source.");
  return {
    verified: false,
    source: input.source.trim(),
    failureClass: input.failureClass,
    blocker: input.blocker.trim(),
  };
}

export function validateExecutionResult(task, input, candidateFingerprint) {
  assert(isRecord(input), "INVALID_EXECUTION_RESULT", "Execution result must be an object.");
  assert(input.taskId === task.id, "EXECUTION_RESULT_TASK_MISMATCH", `Execution result must target ${task.id}.`);
  assert(["passed", "blocked"].includes(input.status), "INVALID_EXECUTION_RESULT_STATUS", "Execution result status must be passed or blocked.");
  assert(nonEmpty(input.summary), "EXECUTION_RESULT_SUMMARY_REQUIRED", "Execution result needs a summary.");
  assert(FAILURE_CLASSES.includes(input.failureClass), "INVALID_EXECUTION_FAILURE_CLASS", `Unknown execution failure class: ${input.failureClass}.`);
  const changedPaths = optionalStringList(input.changedPaths, "INVALID_EXECUTION_CHANGED_PATHS", "changedPaths must contain non-empty paths.").map(normalizeExecutionPath);
  assert(changedPaths.every((changed) => task.writeScope.some((allowed) => executionPathsOverlap(changed, allowed))), "EXECUTION_RESULT_SCOPE_VIOLATION", "Execution result contains changed paths outside the planned write scope.");
  const verification = Array.isArray(input.verification) ? input.verification : [];
  assert(verification.every((item) => isRecord(item) && nonEmpty(item.command) && ["passed", "failed"].includes(item.status) && nonEmpty(item.summary)), "INVALID_EXECUTION_VERIFICATION", "Execution verification entries need command, status, and summary.");
  const evidence = optionalStringList(input.evidence, "INVALID_EXECUTION_EVIDENCE", "Execution evidence must contain non-empty locators.");
  if (input.status === "passed") {
    assert(changedPaths.length > 0, "EXECUTION_CHANGED_PATHS_REQUIRED", "A passed execution result needs changedPaths.");
    assert(task.verification.every((command) => verification.some((item) => item.command === command && item.status === "passed")), "EXECUTION_VERIFICATION_INCOMPLETE", "A passed execution result must pass every planned verification command.");
    assert(evidence.length > 0, "EXECUTION_EVIDENCE_REQUIRED", "A passed execution result needs evidence.");
    assert(nonEmpty(input.candidateFingerprint) && input.candidateFingerprint === candidateFingerprint, "STALE_EXECUTION_CANDIDATE", "Execution evidence is not bound to the current candidate fingerprint.");
    assert(input.failureClass === "none" && (input.blocker === null || input.blocker === undefined), "INVALID_PASSED_EXECUTION_FAILURE", "A passed result cannot contain a blocker or failure class.");
  } else {
    assert(input.failureClass !== "none", "BLOCKED_EXECUTION_FAILURE_REQUIRED", "A blocked result needs a concrete failure class.");
    assert(nonEmpty(input.blocker), "BLOCKED_EXECUTION_REASON_REQUIRED", "A blocked result needs a concrete blocker.");
  }
  assert(input.contractMutation !== true && input.authorizationMutation !== true && input.acceptanceMutation !== true, "EXECUTION_AUTHORITY_VIOLATION", "Workers cannot mutate acceptance, solution, authorization, or execution contracts.");
  return {
    taskId: task.id,
    status: input.status,
    summary: input.summary.trim(),
    changedPaths,
    verification: verification.map((item) => ({ command: item.command.trim(), status: item.status, summary: item.summary.trim() })),
    evidence,
    candidateFingerprint: input.candidateFingerprint ?? null,
    failureClass: input.failureClass,
    blocker: input.blocker?.trim() || null,
  };
}
