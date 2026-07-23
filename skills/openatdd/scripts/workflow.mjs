import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  asArray,
  assert,
  assertTaskId,
  atomicWrite,
  captureEvidence,
  isoNow,
  normalizeImpactPath,
  pathExists,
  readJson,
  readUtf8,
  tokenize,
  verifyCapturedEvidence,
  writeJson,
} from "./lib.mjs";
import {
  acceptanceTemplate,
  fingerprint,
  solutionTemplate,
  validateAcceptance,
  validateSolution,
} from "./contracts.mjs";

export const PHASES = Object.freeze({
  ACCEPTANCE_DRAFT: "ACCEPTANCE_DRAFT",
  ACCEPTANCE_APPROVED: "ACCEPTANCE_APPROVED",
  SOLUTION_DRAFT: "SOLUTION_DRAFT",
  CONTRACT_APPROVED: "CONTRACT_APPROVED",
  IMPLEMENTING: "IMPLEMENTING",
  PRE_UAT: "PRE_UAT",
  REPAIRING: "REPAIRING",
  BLOCKED: "BLOCKED",
  READY_FOR_UAT: "READY_FOR_UAT",
});

const CONFIG_TEMPLATE = `version: 1
notification:
  mode: draft
verification:
  web: playwright
  require_fresh_evidence: true
impact_analysis:
  enabled: true
memory:
  strategy: scoped
`;

const INVARIANTS_TEMPLATE = `# Project invariants

Record durable rules discovered while resolving real defects. Keep this file
small; use the incident index for details.
`;

function historyEvent(event, at, details = undefined) {
  return details === undefined ? { event, at } : { event, at, details };
}

function initialState(taskId, requirement, now) {
  return {
    schemaVersion: 1,
    taskId,
    requirement,
    phase: PHASES.ACCEPTANCE_DRAFT,
    createdAt: now,
    updatedAt: now,
    acceptance: { approvedAt: null, sha256: null, items: [] },
    solution: { approvedAt: null, sha256: null, impactPaths: [], trace: [] },
    verificationNotBefore: null,
    results: {},
    checks: {},
    issues: [],
    affectedDependencies: [],
    readyAt: null,
    history: [historyEvent("TASK_CREATED", now, { requirement })],
  };
}

export function projectFiles(root) {
  const projectRoot = path.resolve(root);
  const openatdd = path.join(projectRoot, ".openatdd");
  return {
    root: projectRoot,
    openatdd,
    config: path.join(openatdd, "config.yaml"),
    tasks: path.join(openatdd, "tasks"),
    memory: path.join(openatdd, "memory"),
    incidents: path.join(openatdd, "memory", "incidents"),
    invariants: path.join(openatdd, "memory", "invariants.md"),
    memoryIndex: path.join(openatdd, "memory", "index.json"),
  };
}

export function taskFiles(root, taskId) {
  assertTaskId(taskId);
  const project = projectFiles(root);
  const task = path.join(project.tasks, taskId);
  return {
    ...project,
    task,
    acceptance: path.join(task, "acceptance.md"),
    solution: path.join(task, "solution.md"),
    state: path.join(task, "state.json"),
    issues: path.join(task, "issues.md"),
    evidence: path.join(task, "evidence"),
    report: path.join(task, "report.md"),
    notification: path.join(task, "notification.md"),
  };
}

export async function initProject(root) {
  const files = projectFiles(root);
  await mkdir(files.tasks, { recursive: true });
  await mkdir(files.incidents, { recursive: true });
  if (!(await pathExists(files.config))) await atomicWrite(files.config, CONFIG_TEMPLATE);
  if (!(await pathExists(files.invariants))) await atomicWrite(files.invariants, INVARIANTS_TEMPLATE);
  if (!(await pathExists(files.memoryIndex))) {
    await writeJson(files.memoryIndex, { schemaVersion: 1, incidents: [] });
  }
  return files;
}

export async function createTask(root, taskId, requirement, clock = () => new Date()) {
  assertTaskId(taskId);
  assert(requirement?.trim(), "REQUIREMENT_REQUIRED", "A one-line requirement is required.");
  await initProject(root);
  const files = taskFiles(root, taskId);
  assert(!(await pathExists(files.task)), "TASK_EXISTS", `Task already exists: ${taskId}`);
  await mkdir(files.evidence, { recursive: true });
  const now = isoNow(clock);
  await atomicWrite(files.acceptance, acceptanceTemplate(taskId, requirement.trim()));
  await atomicWrite(files.issues, renderIssues(initialState(taskId, requirement.trim(), now)));
  await writeJson(files.state, initialState(taskId, requirement.trim(), now));
  return loadTask(root, taskId);
}

export async function adoptTask(root, taskId, requirement, clock = () => new Date()) {
  assertTaskId(taskId);
  assert(requirement?.trim(), "REQUIREMENT_REQUIRED", "A one-line requirement is required.");
  await initProject(root);
  const files = taskFiles(root, taskId);
  assert(await pathExists(files.acceptance), "ACCEPTANCE_NOT_FOUND", `Cannot adopt ${taskId} without acceptance.md.`);
  assert(!(await pathExists(files.state)), "TASK_EXISTS", `Task state already exists: ${taskId}`);
  await mkdir(files.evidence, { recursive: true });
  const now = isoNow(clock);
  const state = initialState(taskId, requirement.trim(), now);
  state.history.push(historyEvent("TASK_ADOPTED", now));
  if (!(await pathExists(files.issues))) await atomicWrite(files.issues, renderIssues(state));
  await writeJson(files.state, state);
  return { state, files };
}

export async function loadTask(root, taskId) {
  const files = taskFiles(root, taskId);
  assert(await pathExists(files.state), "TASK_NOT_FOUND", `OpenATDD task does not exist: ${taskId}`);
  const state = await readJson(files.state);
  assert(state.schemaVersion === 1, "UNSUPPORTED_STATE", `Unsupported task state version: ${state.schemaVersion}`);
  return { state, files };
}

async function saveTask(files, state, clock = () => new Date()) {
  state.updatedAt = isoNow(clock);
  await writeJson(files.state, state);
  return { state, files };
}

function assertPhase(state, allowed, action) {
  const phases = asArray(allowed);
  assert(
    phases.includes(state.phase),
    "INVALID_PHASE",
    `${action} is not allowed in phase ${state.phase}. Expected: ${phases.join(", ")}.`,
  );
}

function appendHistory(state, event, at, details = undefined) {
  state.history.push(historyEvent(event, at, details));
}

function validationFailure(code, message, validation) {
  assert(validation.errors.length === 0, code, message, {
    errors: validation.errors,
    warnings: validation.warnings,
  });
}

async function assertAcceptanceIntegrity(files, state) {
  assert(state.acceptance.approvedAt, "ACCEPTANCE_NOT_APPROVED", "Acceptance has not been approved.");
  const markdown = await readUtf8(files.acceptance);
  assert(
    fingerprint(markdown) === state.acceptance.sha256,
    "ACCEPTANCE_DRIFT",
    "acceptance.md changed after approval. Reopen acceptance before changing it.",
  );
  return markdown;
}

async function assertSolutionIntegrity(files, state) {
  assert(state.solution.approvedAt, "SOLUTION_NOT_APPROVED", "Solution has not been approved.");
  const markdown = await readUtf8(files.solution);
  assert(
    fingerprint(markdown) === state.solution.sha256,
    "SOLUTION_DRIFT",
    "solution.md changed after approval. Reopen the solution before changing it.",
  );
  return markdown;
}

async function assertContractIntegrity(files, state) {
  await assertAcceptanceIntegrity(files, state);
  await assertSolutionIntegrity(files, state);
}

export async function approveAcceptance(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.ACCEPTANCE_DRAFT, PHASES.ACCEPTANCE_APPROVED], "Acceptance approval");
  const markdown = await readUtf8(files.acceptance);
  const validation = validateAcceptance(markdown);
  validationFailure("INVALID_ACCEPTANCE", "Acceptance card is not ready for approval.", validation);
  const digest = fingerprint(markdown);

  if (state.acceptance.sha256 === digest && state.acceptance.approvedAt) {
    return { state, files, warnings: validation.warnings, unchanged: true };
  }

  const now = isoNow(clock);
  state.acceptance = {
    approvedAt: now,
    sha256: digest,
    items: validation.parsed.criteria,
  };
  state.phase = PHASES.ACCEPTANCE_APPROVED;
  state.readyAt = null;
  appendHistory(state, "ACCEPTANCE_APPROVED", now, { sha256: digest });
  await saveTask(files, state, clock);
  return { state, files, warnings: validation.warnings, unchanged: false };
}

export async function draftSolution(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.ACCEPTANCE_APPROVED, PHASES.SOLUTION_DRAFT], "Solution drafting");
  await assertAcceptanceIntegrity(files, state);
  if (!(await pathExists(files.solution))) {
    await atomicWrite(files.solution, solutionTemplate(taskId, state.acceptance.items));
  }
  if (state.phase !== PHASES.SOLUTION_DRAFT) {
    const now = isoNow(clock);
    state.phase = PHASES.SOLUTION_DRAFT;
    appendHistory(state, "SOLUTION_DRAFTED", now);
    await saveTask(files, state, clock);
  }
  return { state, files };
}

function pathsOverlap(left, right) {
  const a = normalizeImpactPath(left);
  const b = normalizeImpactPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

async function taskIds(root) {
  const files = projectFiles(root);
  try {
    const entries = await readdir(files.tasks, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function markAffectedDependencies(root, currentState, approvedAt, clock) {
  const dependencies = [];
  for (const otherId of await taskIds(root)) {
    if (otherId === currentState.taskId) continue;
    const other = await loadTask(root, otherId);
    const prior = other.state;
    if (!prior.solution?.approvedAt || prior.solution.approvedAt >= approvedAt) continue;
    const overlaps = [];
    for (const currentPath of currentState.solution.impactPaths) {
      for (const previousPath of prior.solution.impactPaths ?? []) {
        if (pathsOverlap(currentPath, previousPath)) overlaps.push([currentPath, previousPath]);
      }
    }
    if (overlaps.length === 0) continue;

    const acceptanceIds = prior.acceptance.items.map((item) => item.id);
    for (const acceptanceId of acceptanceIds) {
      const previous = prior.results[acceptanceId];
      prior.results[acceptanceId] = {
        ...(previous ?? {}),
        acceptanceId,
        status: "affected",
        previousStatus: previous?.status ?? "unverified",
        summary: `Affected by ${currentState.taskId} through shared impact paths.`,
        evidence: [],
        verifiedAt: null,
        affectedAt: approvedAt,
        affectedBy: currentState.taskId,
      };
    }
    for (const check of Object.values(prior.checks)) {
      if (check.status === "passed") {
        check.previousStatus = check.status;
        check.status = "affected";
        check.evidence = [];
        check.verifiedAt = null;
        check.affectedAt = approvedAt;
        check.affectedBy = currentState.taskId;
      }
    }
    prior.verificationNotBefore = approvedAt;
    prior.readyAt = null;
    prior.phase = PHASES.PRE_UAT;
    appendHistory(prior, "ACCEPTANCE_AFFECTED", approvedAt, {
      byTask: currentState.taskId,
      overlaps,
      acceptanceIds,
    });
    await saveTask(other.files, prior, clock);
    dependencies.push({ taskId: otherId, acceptanceIds, overlaps, notBefore: approvedAt });
  }
  return dependencies;
}

export async function approveSolution(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.SOLUTION_DRAFT, PHASES.CONTRACT_APPROVED], "Solution approval");
  await assertAcceptanceIntegrity(files, state);
  const markdown = await readUtf8(files.solution);
  const validation = validateSolution(markdown, state.acceptance.items);
  validationFailure("INVALID_SOLUTION", "Solution card is not ready for approval.", validation);
  const digest = fingerprint(markdown);

  if (state.solution.sha256 === digest && state.solution.approvedAt) {
    return { state, files, warnings: validation.warnings, unchanged: true, affectedDependencies: state.affectedDependencies };
  }

  const now = isoNow(clock);
  state.solution = {
    approvedAt: now,
    sha256: digest,
    impactPaths: validation.parsed.impactPaths.map(normalizeImpactPath),
    trace: validation.parsed.trace,
  };
  state.phase = PHASES.CONTRACT_APPROVED;
  state.verificationNotBefore = now;
  state.readyAt = null;
  appendHistory(state, "SOLUTION_APPROVED", now, { sha256: digest });
  state.affectedDependencies = await markAffectedDependencies(root, state, now, clock);
  await saveTask(files, state, clock);
  return {
    state,
    files,
    warnings: validation.warnings,
    unchanged: false,
    affectedDependencies: state.affectedDependencies,
  };
}

export async function beginImplementation(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.CONTRACT_APPROVED, PHASES.IMPLEMENTING], "Implementation");
  await assertContractIntegrity(files, state);
  if (state.phase !== PHASES.IMPLEMENTING) {
    const now = isoNow(clock);
    state.phase = PHASES.IMPLEMENTING;
    appendHistory(state, "IMPLEMENTATION_STARTED", now);
    await saveTask(files, state, clock);
  }
  return { state, files };
}

export async function beginPreUat(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.REPAIRING, PHASES.PRE_UAT, PHASES.BLOCKED],
    "Pre-UAT",
  );
  await assertContractIntegrity(files, state);
  if (state.phase !== PHASES.PRE_UAT) {
    const now = isoNow(clock);
    state.phase = PHASES.PRE_UAT;
    appendHistory(state, "PRE_UAT_STARTED", now);
    await saveTask(files, state, clock);
  }
  return { state, files };
}

function evidenceBoundary(state) {
  const values = [state.solution.approvedAt, state.verificationNotBefore].filter(Boolean).map((value) => new Date(value).getTime());
  return values.length === 0 ? null : new Date(Math.max(...values)).toISOString();
}

async function optionalEvidence(root, value, boundary, clock) {
  return asArray(value).length > 0 ? captureEvidence(root, value, boundary, clock) : [];
}

export async function recordAcceptanceResult(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT],
    "Acceptance recording",
  );
  await assertContractIntegrity(files, state);
  const criterion = state.acceptance.items.find((item) => item.id === input.acceptanceId);
  assert(criterion, "UNKNOWN_ACCEPTANCE", `Unknown acceptance criterion: ${input.acceptanceId}`);
  const allowed = ["passed", "failed", "blocked", "manual", "affected", "deferred", "cancelled"];
  assert(allowed.includes(input.status), "INVALID_RESULT_STATUS", `Invalid acceptance status: ${input.status}`);

  if (input.status === "passed") {
    assert(criterion.classification !== "MANUAL", "MANUAL_CANNOT_AUTO_PASS", `${criterion.id} requires human judgment.`);
  }
  if (input.status === "manual") {
    assert(
      criterion.classification === "MANUAL" || criterion.classification === "ASSISTED",
      "AUTO_CANNOT_BE_MANUAL",
      `${criterion.id} is automatic and cannot be left for manual judgment.`,
    );
  }
  if (["deferred", "cancelled"].includes(input.status)) {
    assert(!criterion.blocking, "BLOCKING_CANNOT_BE_SKIPPED", `${criterion.id} is blocking and cannot be ${input.status}.`);
  }

  const needsEvidence = input.status === "passed" || (input.status === "manual" && criterion.classification === "ASSISTED");
  const boundary = evidenceBoundary(state);
  const evidence = needsEvidence
    ? await captureEvidence(files.root, input.evidence, boundary, clock)
    : await optionalEvidence(files.root, input.evidence, boundary, clock);
  const now = isoNow(clock);
  state.results[criterion.id] = {
    acceptanceId: criterion.id,
    classification: criterion.classification,
    blocking: criterion.blocking,
    status: input.status,
    summary: input.summary?.trim() || criterion.title,
    evidence,
    verifiedAt: now,
  };
  state.readyAt = null;
  if (input.status === "failed") state.phase = PHASES.REPAIRING;
  else if (input.status === "blocked") state.phase = PHASES.BLOCKED;
  else if (state.phase === PHASES.READY_FOR_UAT || state.phase === PHASES.BLOCKED) state.phase = PHASES.PRE_UAT;
  appendHistory(state, "ACCEPTANCE_RECORDED", now, { acceptanceId: criterion.id, status: input.status });
  return saveTask(files, state, clock);
}

function checkKey(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "check";
}

export async function recordCheck(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT],
    "Check recording",
  );
  await assertContractIntegrity(files, state);
  assert(input.name?.trim(), "CHECK_NAME_REQUIRED", "Check name is required.");
  assert(input.command?.trim(), "CHECK_COMMAND_REQUIRED", "The executed check command is required.");
  assert(["passed", "failed", "blocked", "affected"].includes(input.status), "INVALID_CHECK_STATUS", `Invalid check status: ${input.status}`);
  const boundary = evidenceBoundary(state);
  const evidence = input.status === "passed"
    ? await captureEvidence(files.root, input.evidence, boundary, clock)
    : await optionalEvidence(files.root, input.evidence, boundary, clock);
  const now = isoNow(clock);
  const key = checkKey(input.name);
  state.checks[key] = {
    id: key,
    name: input.name.trim(),
    command: input.command.trim(),
    status: input.status,
    summary: input.summary?.trim() || "",
    evidence,
    verifiedAt: now,
  };
  state.readyAt = null;
  if (input.status === "failed") state.phase = PHASES.REPAIRING;
  else if (input.status === "blocked") state.phase = PHASES.BLOCKED;
  else if (state.phase === PHASES.READY_FOR_UAT || state.phase === PHASES.BLOCKED) state.phase = PHASES.PRE_UAT;
  appendHistory(state, "CHECK_RECORDED", now, { check: key, status: input.status });
  return saveTask(files, state, clock);
}

function splitValues(value) {
  return asArray(value)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function nextIssueId(state) {
  const numbers = state.issues.map((issue) => Number(issue.id.match(/(\d+)$/)?.[1] ?? 0));
  return `ISSUE-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

function renderIssues(state) {
  const lines = [`# Issues: ${state.taskId}`, ""];
  if (state.issues.length === 0) return `${lines.join("\n")}No issues recorded.\n`;
  for (const issue of state.issues) {
    lines.push(`## ${issue.id} [${issue.status}] ${issue.acceptanceId}`, "", `- Symptom: ${issue.symptom}`);
    if (issue.rootCause) lines.push(`- Root cause: ${issue.rootCause}`);
    if (issue.regression) lines.push(`- Regression protection: ${issue.regression}`);
    if (issue.invariant) lines.push(`- Invariant: ${issue.invariant}`);
    if (issue.memoryId) lines.push(`- Memory: ${issue.memoryId}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function createIncident(root, state, issue, input, now) {
  const files = projectFiles(root);
  const index = await readJson(files.memoryIndex);
  const year = new Date(now).getUTCFullYear();
  const sequence = index.incidents.filter((item) => item.id.startsWith(`INC-${year}-`)).length + 1;
  const invariantSequence = index.incidents.filter((item) => item.invariantId?.startsWith(`INV-${year}-`)).length + 1;
  const id = `INC-${year}-${String(sequence).padStart(3, "0")}`;
  const invariantId = `INV-${year}-${String(invariantSequence).padStart(3, "0")}`;
  const safeName = issue.symptom.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "incident";
  const relativeFile = `incidents/${id}-${safeName}.md`;
  const incidentPath = path.join(files.memory, relativeFile);
  const paths = splitValues(input.paths).map(normalizeImpactPath);
  const tags = splitValues(input.tags);
  const entry = {
    id,
    title: issue.symptom,
    area: input.area?.trim() || paths[0] || state.taskId,
    rootCause: input.rootCause.trim(),
    invariantId,
    invariant: input.invariant.trim(),
    tests: splitValues(input.regression),
    paths,
    tags,
    sourceTask: state.taskId,
    sourceIssue: issue.id,
    createdAt: now,
    file: relativeFile,
  };
  const body = `# ${id}: ${issue.symptom}\n\n- Area: ${entry.area}\n- Source task: ${state.taskId}\n- Source issue: ${issue.id}\n- Created: ${now}\n\n## Root cause\n\n${entry.rootCause}\n\n## Invariant\n\n${invariantId}: ${entry.invariant}\n\n## Regression protection\n\n${entry.tests.map((test) => `- ${test}`).join("\n")}\n\n## Impact paths\n\n${paths.map((item) => `- \`${item}\``).join("\n") || "- Not recorded"}\n`;
  await atomicWrite(incidentPath, body);
  index.incidents.push(entry);
  await writeJson(files.memoryIndex, index);
  const invariants = await readUtf8(files.invariants);
  if (!invariants.includes(entry.invariant)) {
    await atomicWrite(files.invariants, `${invariants.trimEnd()}\n\n## ${invariantId}\n\n${entry.invariant}\n\nProtection: ${entry.tests.join(", ")}\n`);
  }
  return entry;
}

function invalidateVerification(state, now, issueId) {
  for (const [acceptanceId, result] of Object.entries(state.results)) {
    if (!["deferred", "cancelled"].includes(result.status)) {
      state.results[acceptanceId] = {
        ...result,
        previousStatus: result.status,
        status: "affected",
        summary: `Reverification required after resolving ${issueId}.`,
        evidence: [],
        verifiedAt: null,
        affectedAt: now,
        affectedBy: issueId,
      };
    }
  }
  for (const check of Object.values(state.checks)) {
    if (check.status === "passed") {
      check.previousStatus = check.status;
      check.status = "affected";
      check.summary = `Reverification required after resolving ${issueId}.`;
      check.evidence = [];
      check.verifiedAt = null;
      check.affectedAt = now;
      check.affectedBy = issueId;
    }
  }
  state.verificationNotBefore = now;
  state.readyAt = null;
  state.phase = PHASES.PRE_UAT;
}

export async function recordIssue(root, taskId, input, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(
    state,
    [PHASES.IMPLEMENTING, PHASES.PRE_UAT, PHASES.REPAIRING, PHASES.BLOCKED, PHASES.READY_FOR_UAT],
    "Issue recording",
  );
  await assertContractIntegrity(files, state);
  assert(["open", "resolved"].includes(input.status), "INVALID_ISSUE_STATUS", "Issue status must be open or resolved.");
  const now = isoNow(clock);

  if (input.status === "open") {
    assert(input.acceptanceId, "ACCEPTANCE_REQUIRED", "An affected acceptance ID is required for a new issue.");
    assert(state.acceptance.items.some((item) => item.id === input.acceptanceId), "UNKNOWN_ACCEPTANCE", `Unknown acceptance criterion: ${input.acceptanceId}`);
    assert(input.symptom?.trim(), "SYMPTOM_REQUIRED", "A reproducible symptom is required.");
    const id = input.id || nextIssueId(state);
    assert(!state.issues.some((issue) => issue.id === id), "ISSUE_EXISTS", `Issue already exists: ${id}`);
    const evidence = await optionalEvidence(files.root, input.evidence, evidenceBoundary(state), clock);
    state.issues.push({
      id,
      acceptanceId: input.acceptanceId,
      status: "open",
      symptom: input.symptom.trim(),
      evidence,
      openedAt: now,
    });
    state.results[input.acceptanceId] = {
      acceptanceId: input.acceptanceId,
      status: "failed",
      summary: input.symptom.trim(),
      evidence,
      verifiedAt: now,
    };
    state.phase = PHASES.REPAIRING;
    state.readyAt = null;
    appendHistory(state, "ISSUE_OPENED", now, { issueId: id, acceptanceId: input.acceptanceId });
  } else {
    assert(input.id, "ISSUE_ID_REQUIRED", "Issue ID is required when resolving an issue.");
    const issue = state.issues.find((item) => item.id === input.id);
    assert(issue, "ISSUE_NOT_FOUND", `Issue does not exist: ${input.id}`);
    assert(issue.status === "open", "ISSUE_ALREADY_RESOLVED", `Issue is already resolved: ${input.id}`);
    assert(input.rootCause?.trim(), "ROOT_CAUSE_REQUIRED", "Root cause is required to resolve an issue.");
    assert(splitValues(input.regression).length > 0, "REGRESSION_REQUIRED", "Regression protection is required to resolve an issue.");
    assert(input.invariant?.trim(), "INVARIANT_REQUIRED", "A durable invariant is required to resolve an issue.");
    assert(splitValues(input.paths).length > 0, "IMPACT_PATH_REQUIRED", "At least one affected path is required to resolve an issue.");
    const evidence = await captureEvidence(files.root, input.evidence, evidenceBoundary(state), clock);
    Object.assign(issue, {
      status: "resolved",
      rootCause: input.rootCause.trim(),
      regression: splitValues(input.regression),
      invariant: input.invariant.trim(),
      paths: splitValues(input.paths).map(normalizeImpactPath),
      evidence,
      resolvedAt: now,
    });
    const incident = await createIncident(root, state, issue, input, now);
    issue.memoryId = incident.id;
    invalidateVerification(state, now, issue.id);
    appendHistory(state, "ISSUE_RESOLVED", now, { issueId: issue.id, memoryId: incident.id });
  }

  await atomicWrite(files.issues, renderIssues(state));
  return saveTask(files, state, clock);
}

function invalidateForReopen(state, now, reason) {
  for (const result of Object.values(state.results)) {
    result.previousStatus = result.status;
    result.status = "affected";
    result.summary = `Contract reopened: ${reason}`;
    result.evidence = [];
    result.verifiedAt = null;
  }
  for (const check of Object.values(state.checks)) {
    check.previousStatus = check.status;
    check.status = "affected";
    check.summary = `Contract reopened: ${reason}`;
    check.evidence = [];
    check.verifiedAt = null;
  }
  state.verificationNotBefore = now;
  state.readyAt = null;
}

export async function reopenAcceptance(root, taskId, reason, clock = () => new Date()) {
  assert(reason?.trim(), "REASON_REQUIRED", "A reason is required to reopen acceptance.");
  const { state, files } = await loadTask(root, taskId);
  assert(state.acceptance.approvedAt, "ACCEPTANCE_NOT_APPROVED", "Acceptance is not currently approved.");
  const now = isoNow(clock);
  invalidateForReopen(state, now, reason.trim());
  state.acceptance.approvedAt = null;
  state.acceptance.sha256 = null;
  state.solution = { approvedAt: null, sha256: null, impactPaths: [], trace: [], stale: true };
  state.affectedDependencies = [];
  state.phase = PHASES.ACCEPTANCE_DRAFT;
  appendHistory(state, "ACCEPTANCE_REOPENED", now, { reason: reason.trim() });
  return saveTask(files, state, clock);
}

export async function reopenSolution(root, taskId, reason, clock = () => new Date()) {
  assert(reason?.trim(), "REASON_REQUIRED", "A reason is required to reopen the solution.");
  const { state, files } = await loadTask(root, taskId);
  await assertAcceptanceIntegrity(files, state);
  assert(state.solution.approvedAt, "SOLUTION_NOT_APPROVED", "Solution is not currently approved.");
  const now = isoNow(clock);
  invalidateForReopen(state, now, reason.trim());
  state.solution = { approvedAt: null, sha256: null, impactPaths: [], trace: [], stale: true };
  state.affectedDependencies = [];
  state.phase = PHASES.SOLUTION_DRAFT;
  appendHistory(state, "SOLUTION_REOPENED", now, { reason: reason.trim() });
  return saveTask(files, state, clock);
}

async function contractErrors(files, state) {
  const errors = [];
  const warnings = [];
  if (state.acceptance.approvedAt) {
    const markdown = await readUtf8(files.acceptance);
    const validation = validateAcceptance(markdown);
    errors.push(...validation.errors.map((item) => `Acceptance: ${item}`));
    warnings.push(...validation.warnings.map((item) => `Acceptance: ${item}`));
    if (fingerprint(markdown) !== state.acceptance.sha256) errors.push("Acceptance contract hash does not match the approved version.");
  }
  if (state.solution.approvedAt) {
    const markdown = await readUtf8(files.solution);
    const validation = validateSolution(markdown, state.acceptance.items);
    errors.push(...validation.errors.map((item) => `Solution: ${item}`));
    warnings.push(...validation.warnings.map((item) => `Solution: ${item}`));
    if (fingerprint(markdown) !== state.solution.sha256) errors.push("Solution contract hash does not match the approved version.");
  }
  return { errors, warnings };
}

async function evidenceErrors(root, state) {
  const errors = [];
  const boundary = evidenceBoundary(state);
  for (const result of Object.values(state.results)) {
    if (["passed", "manual"].includes(result.status) && (result.evidence?.length ?? 0) > 0) {
      errors.push(...(await verifyCapturedEvidence(root, result.evidence, boundary)).map((item) => `${result.acceptanceId}: ${item}`));
    }
  }
  for (const check of Object.values(state.checks)) {
    if (check.status === "passed") {
      errors.push(...(await verifyCapturedEvidence(root, check.evidence, boundary)).map((item) => `Check ${check.name}: ${item}`));
    }
  }
  return errors;
}

export async function validateTask(root, taskId) {
  const { state, files } = await loadTask(root, taskId);
  const contract = await contractErrors(files, state);
  const errors = [...contract.errors, ...(await evidenceErrors(files.root, state))];
  return {
    valid: errors.length === 0,
    errors,
    warnings: contract.warnings,
    state,
  };
}

async function readinessErrors(root, state, files) {
  const validation = await validateTask(root, state.taskId);
  const errors = [...validation.errors];
  const boundary = evidenceBoundary(state);

  for (const criterion of state.acceptance.items) {
    const result = state.results[criterion.id];
    if (!result) {
      errors.push(`${criterion.id} has no recorded result.`);
      continue;
    }
    if (["failed", "blocked", "affected"].includes(result.status)) {
      errors.push(`${criterion.id} is ${result.status}.`);
      continue;
    }
    if (criterion.classification === "AUTO" && criterion.blocking && result.status !== "passed") {
      errors.push(`${criterion.id} is a blocking automatic criterion and must pass.`);
    }
    if (criterion.classification === "ASSISTED" && criterion.blocking && !["passed", "manual"].includes(result.status)) {
      errors.push(`${criterion.id} is blocking assisted acceptance and needs a pass or explicit human judgment.`);
    }
    if (criterion.classification === "MANUAL" && result.status !== "manual") {
      errors.push(`${criterion.id} must be explicitly handed to human UAT.`);
    }
    if (new Date(result.verifiedAt ?? 0).getTime() < new Date(boundary ?? 0).getTime()) {
      errors.push(`${criterion.id} was not verified after the latest contract or repair boundary.`);
    }
  }

  const checks = Object.values(state.checks);
  if (checks.length === 0) errors.push("At least one relevant project check must be recorded.");
  for (const check of checks) {
    if (check.status !== "passed") errors.push(`Project check ${check.name} is ${check.status}.`);
  }
  if (state.issues.some((issue) => issue.status === "open")) errors.push("One or more issues remain open.");

  for (const dependency of state.affectedDependencies) {
    const prior = await loadTask(root, dependency.taskId);
    for (const acceptanceId of dependency.acceptanceIds) {
      const result = prior.state.results[acceptanceId];
      if (!result || !["passed", "manual"].includes(result.status)) {
        errors.push(`Affected task ${dependency.taskId}/${acceptanceId} has not been reverified.`);
        continue;
      }
      if (new Date(result.verifiedAt ?? 0).getTime() < new Date(dependency.notBefore).getTime()) {
        errors.push(`Affected task ${dependency.taskId}/${acceptanceId} lacks fresh reverification.`);
      }
      errors.push(...(await verifyCapturedEvidence(files.root, result.evidence, dependency.notBefore)).map(
        (item) => `Affected task ${dependency.taskId}/${acceptanceId}: ${item}`,
      ));
    }
    for (const check of Object.values(prior.state.checks)) {
      if (check.status !== "passed") {
        errors.push(`Affected task ${dependency.taskId} check ${check.name} is ${check.status}.`);
        continue;
      }
      if (new Date(check.verifiedAt ?? 0).getTime() < new Date(dependency.notBefore).getTime()) {
        errors.push(`Affected task ${dependency.taskId} check ${check.name} lacks fresh reverification.`);
      }
      errors.push(...(await verifyCapturedEvidence(files.root, check.evidence, dependency.notBefore)).map(
        (item) => `Affected task ${dependency.taskId} check ${check.name}: ${item}`,
      ));
    }
    if (prior.state.issues.some((issue) => issue.status === "open")) {
      errors.push(`Affected task ${dependency.taskId} still has an open issue.`);
    }
  }
  return errors;
}

function resultTable(state) {
  const lines = ["| Acceptance | Class | Blocking | Status | Evidence |", "|---|---|---:|---|---|"];
  const taskPrefix = `.openatdd/tasks/${state.taskId}/`;
  for (const criterion of state.acceptance.items) {
    const result = state.results[criterion.id];
    const evidence = (result?.evidence ?? []).map((item) => {
      const target = item.path.startsWith(taskPrefix) ? item.path.slice(taskPrefix.length) : item.path;
      return `[${path.basename(item.path)}](${target})`;
    }).join(", ") || "-";
    lines.push(`| ${criterion.id} | ${criterion.classification} | ${criterion.blocking ? "yes" : "no"} | ${result?.status ?? "unverified"} | ${evidence} |`);
  }
  return lines.join("\n");
}

export function renderTaskReport(state) {
  const checks = Object.values(state.checks);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  const lines = [
    `# Pre-UAT report: ${state.taskId}`,
    "",
    `- Requirement: ${state.requirement}`,
    `- Phase: ${state.phase}`,
    `- Acceptance approved: ${state.acceptance.approvedAt}`,
    `- Solution approved: ${state.solution.approvedAt}`,
    `- Ready at: ${state.readyAt ?? "not ready"}`,
    "",
    "## Acceptance results",
    "",
    resultTable(state),
    "",
    "## Project checks",
    "",
  ];
  if (checks.length === 0) lines.push("No checks recorded.");
  else {
    for (const check of checks) lines.push(`- ${check.name}: **${check.status}** — \`${check.command}\``);
  }
  lines.push("", "## Repairs", "");
  const resolved = state.issues.filter((issue) => issue.status === "resolved");
  if (resolved.length === 0) lines.push("No defects were resolved during pre-UAT.");
  else {
    for (const issue of resolved) lines.push(`- ${issue.id}: ${issue.rootCause} (${issue.memoryId})`);
  }
  lines.push("", "## Affected historical acceptance", "");
  if (state.affectedDependencies.length === 0) lines.push("No historical tasks were affected.");
  else {
    for (const item of state.affectedDependencies) lines.push(`- ${item.taskId}: ${item.acceptanceIds.join(", ")}`);
  }
  lines.push("", "## Human judgment", "");
  if (manual.length === 0) lines.push("No manual acceptance criteria remain.");
  else {
    for (const item of manual) lines.push(`- ${item.id} [${item.classification}]: ${item.title}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderNotification(state) {
  const automatic = state.acceptance.items.filter((item) => item.classification === "AUTO" && item.blocking);
  const manual = state.acceptance.items.filter((item) => item.classification !== "AUTO");
  return `# UAT notification draft\n\n${state.taskId} is ready for formal human acceptance.\n\n- Requirement: ${state.requirement}\n- Automatic blockers: ${automatic.length}/${automatic.length} passed\n- Report: report.md\n- Remaining human judgments: ${manual.length}\n\nThe approved acceptance journey and evidence are in this task directory.\nThis is a draft; send it only through an already-authorized channel.\n`;
}

export async function markReady(root, taskId, clock = () => new Date()) {
  const { state, files } = await loadTask(root, taskId);
  assertPhase(state, [PHASES.PRE_UAT, PHASES.READY_FOR_UAT], "Readiness");
  await assertContractIntegrity(files, state);
  const errors = await readinessErrors(root, state, files);
  assert(errors.length === 0, "READINESS_BLOCKED", "Task is not ready for human UAT.", { errors });
  const now = isoNow(clock);
  state.phase = PHASES.READY_FOR_UAT;
  state.readyAt = now;
  appendHistory(state, "READY_FOR_UAT", now);
  await saveTask(files, state, clock);
  await atomicWrite(files.report, renderTaskReport(state));
  await atomicWrite(files.notification, renderNotification(state));
  return { state, files };
}

export async function writeReport(root, taskId) {
  const { state, files } = await loadTask(root, taskId);
  await atomicWrite(files.report, renderTaskReport(state));
  if (state.phase === PHASES.READY_FOR_UAT) await atomicWrite(files.notification, renderNotification(state));
  return { state, files };
}

export async function searchMemory(root, query, limit = 10) {
  await initProject(root);
  const files = projectFiles(root);
  const index = await readJson(files.memoryIndex);
  const terms = tokenize(query);
  const matches = index.incidents
    .map((incident) => {
      const searchable = JSON.stringify(incident).toLowerCase();
      const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
      return { score, ...incident };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
  return { query, terms, matches };
}

export function summarizeState(state) {
  return {
    taskId: state.taskId,
    requirement: state.requirement,
    phase: state.phase,
    acceptanceApproved: Boolean(state.acceptance.approvedAt),
    solutionApproved: Boolean(state.solution.approvedAt),
    acceptance: state.acceptance.items.map((item) => ({
      id: item.id,
      classification: item.classification,
      blocking: item.blocking,
      status: state.results[item.id]?.status ?? "unverified",
    })),
    checks: Object.values(state.checks).map((check) => ({ name: check.name, status: check.status })),
    openIssues: state.issues.filter((issue) => issue.status === "open").map((issue) => issue.id),
    affectedDependencies: state.affectedDependencies,
    readyAt: state.readyAt,
  };
}
