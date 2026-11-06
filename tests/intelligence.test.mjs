import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RISK_OVERLAYS,
  classifyTask,
  modelPolicyForRouting,
  validateAssessment,
  validateRouting,
} from "../skills/openatdd/scripts/routing.mjs";
import { profileForDispatch, verificationExecutionProfile } from "../skills/openatdd/scripts/agent-profiles.mjs";
import {
  deriveDefaultExecutionPlan,
  validateExecutionPlan,
  validateExecutionResult,
  validateRuntimeAttestation,
} from "../skills/openatdd/scripts/execution-contracts.mjs";
import {
  blockingDecisions,
  createDecision,
  invalidationForDecisionChange,
  pendingDecisions,
  resolveDecision,
  validateDecision,
} from "../skills/openatdd/scripts/decisions.mjs";

function assessment(overrides = {}) {
  return {
    scope: "local",
    projectPattern: "established",
    reversibility: "reversible",
    uncertainty: "low",
    riskSignals: [],
    ...overrides,
  };
}

function decisionInput(overrides = {}) {
  return {
    id: "DEC-001",
    owner: "human",
    question: "Which export scope should the feature use?",
    options: [
      { id: "all-results", label: "All matching results", consequence: "Supports reconciliation across every page." },
      { id: "current-page", label: "Current page", consequence: "Completes faster but exports only visible rows." },
    ],
    recommendation: "all-results",
    recommendationBasis: "The existing product describes exports as filtered-result exports.",
    ...overrides,
  };
}

function planTask(overrides = {}) {
  return {
    id: "ST-001",
    acceptanceIds: ["AC-01"],
    task: "Implement the bounded change",
    stage: 1,
    dependsOn: [],
    writeScope: ["src/feature"],
    doNotTouch: ["src/other"],
    expectedResult: "The approved behavior is implemented",
    verification: ["node --test tests/feature.test.mjs"],
    firstArtifact: "src/feature/index.mjs",
    route: "bounded-implementation",
    ...overrides,
  };
}

test("routing classifies a local established low-risk task as quick", () => {
  const routing = classifyTask(assessment());
  assert.equal(routing.schemaVersion, 1);
  assert.equal(routing.lane, "quick");
  assert.equal(routing.investigation.externalResearch, false);
  assert.deepEqual(routing.controller, {
    profile: "controller",
    model: null,
    reasoningEffort: null,
    forkTurns: "none",
    sandbox: "workspace-write",
  });
  assert.deepEqual(routing.agents, { policy: "optional", roles: ["bounded-implementation", "acceptance-review"] });
  assert.deepEqual(routing.interaction, { approvals: "autonomous", contract: "compact" });
  assert.equal(validateRouting(routing).valid, true);
});

test("Quick guidance keeps known-target work compact without weakening validation", async () => {
  const skill = await readFile(new URL("../skills/openatdd/SKILL.md", import.meta.url), "utf8");
  const governance = await readFile(new URL("../skills/openatdd/references/governance.md", import.meta.url), "utf8");
  const finalization = await readFile(new URL("../skills/openatdd/references/fast-finalization.md", import.meta.url), "utf8");
  const runtime = `${skill}\n${governance}\n${finalization}`;
  assert.match(skill, /default work budget is one location step/);
  assert.match(skill, /optimization budget,\s*not a correctness cap/);
  assert.match(skill, /known-failing repository-wide check/);
  assert.match(runtime, /openatdd validate-finalization/);
  assert.match(skill, /memory .*--limit 5/);
  assert.match(skill, /openatdd finalize TASK --fast/);
  assert.match(runtime, /resolved\s+`authorization` decision before any product code changes/);
});

test("routing classifies ordinary cross-module work as standard", () => {
  const routing = classifyTask(assessment({ scope: "cross-module", uncertainty: "medium" }));
  assert.equal(routing.lane, "standard");
  assert.equal(routing.investigation.externalResearch, false);
  assert.deepEqual(routing.agents, { policy: "optional", roles: ["independent-review", "acceptance-review", "bounded-implementation", "complex-implementation"] });
  assert.equal(routing.controller.profile, "controller");
  assert.equal(routing.controller.reasoningEffort, null);
  assert.deepEqual(routing.interaction, { approvals: "human", contract: "full" });
  assert(routing.reasons.includes("cross-module-scope"));
});

test("routing classifies novel cross-cutting work as deep", () => {
  const routing = classifyTask(assessment({ scope: "cross-module", projectPattern: "none" }));
  assert.equal(routing.lane, "deep");
  assert.equal(routing.investigation.externalResearch, true);
  assert.equal(routing.controller.profile, "critical-controller");
  assert.equal(routing.controller.reasoningEffort, null);
  assert.equal(routing.agents.policy, "parallel");
  assert.deepEqual(routing.interaction, { approvals: "human", contract: "full" });
  assert(routing.agents.roles.includes("external-research"));
  assert(!routing.agents.roles.includes("clean-context-execution"));
});

test("risk signals add safety overlays without changing problem-solving depth", async (t) => {
  for (const signal of RISK_OVERLAYS) {
    await t.test(signal, () => {
      const routing = classifyTask(assessment({ riskSignals: [signal] }));
      assert.equal(routing.lane, "quick");
      assert.deepEqual(routing.riskOverlays, [signal]);
      assert.equal(routing.investigation.externalResearch, false);
    });
  }
});

test("only system, high-uncertainty, or novel cross-cutting complexity enters Deep", () => {
  for (const overrides of [
    { scope: "system" },
    { uncertainty: "high" },
    { scope: "cross-module", projectPattern: "none" },
  ]) {
    const routing = classifyTask(assessment(overrides));
    assert.equal(routing.lane, "deep");
  }
});

test("local established token bug with an existing migration is not Deep", () => {
  const routing = classifyTask(assessment({
    reversibility: "costly",
    riskSignals: ["migration", "security"],
  }));
  assert.equal(routing.lane, "quick");
  assert.deepEqual(routing.riskOverlays, ["migration", "security"]);
  assert.deepEqual(routing.reasons, ["local-scope", "established-project-pattern", "low-uncertainty"]);
});

test("material safety risk stays separate from problem-solving depth", () => {
  const routing = classifyTask(assessment({
    reversibility: "irreversible",
    riskSignals: ["authorization", "sensitive-boundary-change", "production"],
  }));
  assert.equal(routing.lane, "quick");
  assert.deepEqual(routing.riskOverlays, [
    "authorization",
    "production",
    "irreversible",
    "sensitive-boundary-change",
  ]);
});

test("routing overlay validation is additive for persisted schema-v1 tasks", () => {
  const routing = classifyTask(assessment({ riskSignals: ["security"] }));
  const legacy = structuredClone(routing);
  delete legacy.riskOverlays;
  assert.equal(validateRouting(legacy).valid, true);
  assert.equal(validateRouting({ ...routing, riskOverlays: [] }).valid, false);
});

test("Agent roles resolve to deterministic lane-aware model and authority profiles", () => {
  for (const role of ["local-discovery", "external-research"]) {
    const profile = profileForDispatch({ role });
    assert.equal(profile.profile, "read-only-scout");
    assert.equal(profile.model, null);
    assert.equal(profile.reasoningEffort, null);
    assert.equal(profile.sandbox, "read-only");
    assert.equal(profile.writable, false);
    assert.equal(profile.canSpawnAgents, false);
  }
  const standardReview = profileForDispatch({ role: "independent-review", lane: "standard" });
  assert.equal(standardReview.profile, "review");
  assert.equal(standardReview.reasoningEffort, null);
  const deepReview = profileForDispatch({ role: "independent-review", lane: "deep" });
  assert.equal(deepReview.profile, "critical-review");
  assert.equal(deepReview.reasoningEffort, null);
  const bounded = profileForDispatch({ role: "bounded-implementation", lane: "standard" });
  assert.equal(bounded.model, null);
  assert.equal(bounded.reasoningEffort, null);
  assert.equal(bounded.sandbox, "workspace-write");
  assert.equal(bounded.authority, "approved-subtask-only");
  assert.equal(bounded.escalation, "controller-diagnosis");
  const complex = profileForDispatch({ role: "complex-implementation", lane: "deep" });
  assert.equal(complex.profile, "complex-implementation-worker");
  assert.equal(complex.model, null);
  assert.equal(complex.reasoningEffort, null);
  assert.equal(complex.leaf, true);
  assert.equal(complex.canSpawnAgents, false);
  assert.equal(complex.escalation, "controller-diagnosis");
  assert.throws(
    () => profileForDispatch({ role: "clean-context-execution" }),
    (error) => error.code === "UNKNOWN_AGENT_ROLE",
  );
  assert.deepEqual(profileForDispatch({ role: "clean-context-execution", deliveryVersion: 2 }), {
    role: "clean-context-execution",
    profile: "clean-context-execution",
    model: null,
    reasoningEffort: null,
    forkTurns: "none",
    sandbox: "workspace-write",
    escalation: null,
  });
});

test("routing guidance preserves the selected controller and recommends supported executors without unmeasured gains", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const skill = await readFile(new URL("../skills/openatdd/SKILL.md", import.meta.url), "utf8");
  const governance = await readFile(new URL("../skills/openatdd/references/governance.md", import.meta.url), "utf8");
  const docs = `${readme}\n${skill}\n${governance}`;
  assert.match(readme, /controller retains the user's current conversation model and reasoning\s+setting in every lane/);
  assert.match(skill, /Do not switch it for a lane, risk,\s+parallel batch, or role preference/);
  assert.match(skill, /Sol \/ xhigh/);
  assert.match(skill, /Terra 6\.1 \/ xhigh/);
  assert.match(skill, /selected host tool supports that model and effort/);
  assert.match(skill, /use host-permitted subagents for bounded work when delegation improves total\s+delivery time/);
  assert.match(skill, /users need not append a separate delegation phrase/);
  assert.match(skill, /does\s+not override a host that requires explicit user authorization for delegation/);
  assert.doesNotMatch(docs, /only when delegation is explicitly requested|only for explicitly requested delegation/);
  assert.doesNotMatch(docs, /complex(?:\/cross-module| or ambiguous)? implementation uses Terra\/high/i);
  assert.match(readme, /not a claimed cost or quality win until a real\s+project evaluation demonstrates it/);
});

test("role profiles follow complexity and risk without prescribing model-specific effort levels", () => {
  const ordinary = modelPolicyForRouting(classifyTask(assessment()));
  assert.equal(ordinary.design.reasoningEffort, null);
  assert.equal(ordinary.implementation.model, null);
  assert.equal(ordinary.implementation.reasoningEffort, null);
  assert.equal(ordinary.implementation.mode, "inline");
  assert.equal(ordinary.hostSelectionRequired, false);
  assert.equal(ordinary.acceptance.model, null);
  assert.equal(ordinary.acceptance.reasoningEffort, null);
  assert.equal(ordinary.acceptance.sandbox, "read-only");
  assert.equal(ordinary.maxImplementationWorkers, 2);
  const complex = modelPolicyForRouting(classifyTask(assessment({ scope: "system" })));
  assert.equal(complex.design.profile, "critical-controller");
  assert.equal(complex.design.reasoningEffort, null);
  assert.equal(complex.implementation.reasoningEffort, null);
  assert.equal(complex.acceptance.reasoningEffort, null);
  const sensitive = modelPolicyForRouting(classifyTask(assessment({ riskSignals: ["authorization"] })));
  assert.equal(sensitive.acceptance.profile, "critical-review");
  assert.equal(sensitive.design.reasoningEffort, null);
  assert.equal(sensitive.acceptance.reasoningEffort, null);
  const uncertain = modelPolicyForRouting(classifyTask(assessment()), { concerns: ["Concurrent updates may overwrite each other"] });
  assert.equal(uncertain.acceptance.profile, "critical-review");
  assert.equal(uncertain.acceptance.reasoningEffort, null);
  assert.throws(() => modelPolicyForRouting(classifyTask(assessment()), { concerns: [""] }), /non-empty reasons/);
  const review = profileForDispatch({ role: "acceptance-review", lane: "deep" });
  assert.equal(review.reasoningEffort, null);
  assert.equal(validateRuntimeAttestation(review, { ...review, verified: true, source: "test", model: "gpt-5.6-luna" }).model, "gpt-5.6-luna");
});

test("independent review documentation exposes the bounded retry and fallback contract", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const skill = await readFile(new URL("../skills/openatdd/SKILL.md", import.meta.url), "utf8");
  const governance = await readFile(new URL("../skills/openatdd/references/governance.md", import.meta.url), "utf8");
  const docs = `${readme}\n${skill}\n${governance}`;
  assert.match(docs, /15-minute hard budget/);
  assert.match(docs, /5-minute targeted recheck/);
  assert.match(docs, /never a third\s+attempt|third attempt.*rejected|third attempt.*not allowed/is);
  assert.match(docs, /Actionable findings.*successful review/is);
  assert.match(docs, /review-fallback TASK --status approved\|denied/);
});

test("execution plans cover acceptance and reject ownership, dependency, and path conflicts", () => {
  const plan = validateExecutionPlan(["AC-01"], { schemaVersion: 1, tasks: [planTask()] });
  assert.equal(plan.tasks[0].writeScope[0], "src/feature");
  assert.throws(
    () => validateExecutionPlan(["AC-01"], { schemaVersion: 1, tasks: [planTask(), planTask({ id: "ST-002", writeScope: ["src/feature/file.mjs"] })] }),
    (error) => error.code === "EXECUTION_SCOPE_OWNER_CONFLICT",
  );
  assert.throws(
    () => validateExecutionPlan(["AC-01"], { schemaVersion: 1, tasks: [planTask({ stage: 1, dependsOn: ["ST-002"] }), planTask({ id: "ST-002", stage: 1, acceptanceIds: ["AC-01"], writeScope: ["tests/feature"] })] }),
    (error) => error.code === "INVALID_EXECUTION_DEPENDENCY_ORDER",
  );
  assert.throws(
    () => validateExecutionPlan(["AC-01"], { schemaVersion: 1, tasks: [planTask({ writeScope: ["../outside"] })] }),
    (error) => error.code === "EXECUTION_PATH_ESCAPE",
  );
});

test("default execution planning returns a bounded Worker contract or a concrete sequential reason", () => {
  const planned = deriveDefaultExecutionPlan({
    acceptanceIds: ["AC-01", "AC-02"],
    impactPaths: ["src/feature", "tests/feature.test.mjs"],
    lane: "standard",
    requirement: "Implement the approved feature",
    verification: ["\"node\" \"--test\" \"tests/feature.test.mjs\""],
  });
  assert.equal(planned.status, "planned");
  assert.equal(planned.plan.tasks[0].route, "bounded-implementation");
  assert.deepEqual(planned.plan.tasks[0].acceptanceIds, ["AC-01", "AC-02"]);

  const unsafe = deriveDefaultExecutionPlan({
    acceptanceIds: ["AC-01"],
    impactPaths: [".openatdd"],
    lane: "deep",
    requirement: "Rewrite controller state",
    verification: ["npm test"],
  });
  assert.equal(unsafe.status, "controller-sequential");
  assert.equal(unsafe.reason.code, "protected-write-scope");

  const unverifiable = deriveDefaultExecutionPlan({
    acceptanceIds: ["AC-01"],
    impactPaths: ["src/feature"],
    lane: "deep",
    verification: [],
  });
  assert.equal(unverifiable.status, "controller-sequential");
  assert.equal(unverifiable.reason.code, "verification-unavailable");
});

test("runtime attestation records actual model metadata and proves leaf capability", () => {
  const expected = profileForDispatch({ role: "bounded-implementation", lane: "standard" });
  const attested = validateRuntimeAttestation(expected, { ...expected, verified: true, source: "host-runtime", model: "gpt-6.1-sol", reasoningEffort: "high" });
  assert.equal(attested.model, "gpt-6.1-sol");
  assert.equal(attested.reasoningEffort, "high");
  assert.equal(attested.canSpawnAgents, false);
  const unknown = validateRuntimeAttestation(expected, {
    verified: true, source: "host-permissions", forkTurns: "none",
    sandbox: "workspace-write", leaf: true, canSpawnAgents: false,
  });
  assert.equal(unknown.profile, null);
  assert.equal(unknown.model, null);
  assert.equal(unknown.reasoningEffort, null);
  assert.throws(
    () => validateRuntimeAttestation(expected, { ...expected, verified: true, source: "host-runtime", canSpawnAgents: true }),
    (error) => error.code === "RUNTIME_PROFILE_MISMATCH",
  );
});

test("passed execution results require current candidate, scope, verification, evidence, and no authority mutation", () => {
  const task = planTask();
  const valid = validateExecutionResult(task, {
    taskId: "ST-001",
    status: "passed",
    summary: "Implemented and verified",
    changedPaths: ["src/feature/index.mjs"],
    verification: [{ command: task.verification[0], status: "passed", summary: "1 test passed" }],
    evidence: ["evidence.txt"],
    candidateFingerprint: "candidate-1",
    failureClass: "none",
    blocker: null,
  }, "candidate-1");
  assert.equal(valid.status, "passed");
  assert.throws(
    () => validateExecutionResult(task, { ...valid, evidence: ["evidence.txt"], changedPaths: ["src/other/file.mjs"] }, "candidate-1"),
    (error) => error.code === "EXECUTION_RESULT_SCOPE_VIOLATION",
  );
  assert.throws(
    () => validateExecutionResult(task, { ...valid, evidence: ["evidence.txt"], candidateFingerprint: "stale" }, "candidate-1"),
    (error) => error.code === "STALE_EXECUTION_CANDIDATE",
  );
  assert.throws(
    () => validateExecutionResult(task, { ...valid, evidence: ["evidence.txt"], contractMutation: true }, "candidate-1"),
    (error) => error.code === "EXECUTION_AUTHORITY_VIOLATION",
  );
});

test("verification execution uses zero-model commands first and a bounded low browser model only for dynamic Web", () => {
  assert.deepEqual(verificationExecutionProfile({ surface: "web", deterministicAvailable: true }), {
    mode: "deterministic",
    model: null,
    reasoningEffort: null,
    reason: "A stable command-backed browser journey is available, so execution uses no model.",
  });
  const dynamic = verificationExecutionProfile({ surface: "web" });
  assert.equal(dynamic.mode, "browser-low");
  assert.equal(dynamic.model, null);
  assert.equal(dynamic.reasoningEffort, null);
  assert.equal(dynamic.forkTurns, "none");
  assert.equal(dynamic.sandbox, "read-only");
  assert.deepEqual(dynamic.capabilities, ["browser"]);
  assert.equal(dynamic.reuseSession, true);
  assert.equal(dynamic.screenshotPolicy, "checkpoint-or-failure");
  assert.equal(dynamic.escalation, "main-on-failure-or-uncertainty");
  assert.equal(verificationExecutionProfile({ surface: "web", subjectiveVisual: true }).mode, "human");
  assert.equal(verificationExecutionProfile({ surface: "cli" }).mode, "deterministic");
});

test("irreversible assessment adds a safety overlay without changing a local task's depth", () => {
  const routing = classifyTask(assessment({ reversibility: "irreversible" }));
  assert.equal(routing.lane, "quick");
  assert.deepEqual(routing.assessment.riskSignals, ["irreversible"]);
  assert.deepEqual(routing.riskOverlays, ["irreversible"]);
});

test("routing assessment validation rejects unknown and malformed risk input", () => {
  const invalid = validateAssessment(assessment({ riskSignals: ["mystery"], risks: { deletion: "yes" } }));
  assert.equal(invalid.valid, false);
  assert(invalid.errors.some((error) => error.includes("Unknown risk signal")));
  assert(invalid.errors.some((error) => error.includes("must be boolean")));
  assert.throws(
    () => classifyTask(assessment({ scope: "tiny" })),
    (error) => error.code === "INVALID_ROUTING_ASSESSMENT",
  );
});

test("decision creation validates two or three grounded options", () => {
  const decision = createDecision(decisionInput());
  assert.equal(decision.status, "pending");
  assert.equal(decision.blocking, true);
  assert.equal(validateDecision(decision).valid, true);

  assert.throws(
    () => createDecision(decisionInput({ options: [decisionInput().options[0]] })),
    (error) => error.code === "INVALID_DECISION" && error.details.errors.some((item) => item.includes("two or three")),
  );
  assert.throws(
    () => createDecision(decisionInput({ recommendation: "missing" })),
    (error) => error.code === "INVALID_DECISION" && error.details.errors.some((item) => item.includes("recommendation")),
  );
  assert.throws(
    () => createDecision(decisionInput({ options: [{ id: "broken" }, null] })),
    (error) => error.code === "INVALID_DECISION",
  );
});

test("agent decisions default to non-blocking while human and authorization decisions block", () => {
  const human = createDecision(decisionInput());
  const agent = createDecision(decisionInput({ id: "DEC-002", owner: "agent" }));
  const authorization = createDecision(decisionInput({ id: "DEC-003", owner: "authorization", coversOverlays: ["deletion"] }));
  const legacyAuthorization = structuredClone(authorization);
  delete legacyAuthorization.coversOverlays;

  // An authorization decision must state which risk overlays it covers.
  assert.throws(
    () => createDecision(decisionInput({ id: "DEC-004", owner: "authorization" })),
    (error) => error.code === "INVALID_DECISION",
  );
  // Persisted decisions from before coversOverlays remain readable so users can
  // add a new scoped authorization; they do not themselves cover any overlay.
  assert.equal(validateDecision(legacyAuthorization).valid, true);

  assert.deepEqual(pendingDecisions([human, agent, authorization]).map((item) => item.id), ["DEC-001", "DEC-002", "DEC-003"]);
  assert.deepEqual(pendingDecisions([human, agent, authorization], { owner: "agent" }).map((item) => item.id), ["DEC-002"]);
  assert.deepEqual(blockingDecisions([human, agent, authorization]).map((item) => item.id), ["DEC-001", "DEC-003"]);
});

test("decision resolution is deterministic and preserves optional timestamps", () => {
  const pending = createDecision(decisionInput({ createdAt: "2026-07-24T00:00:00.000Z" }));
  const resolved = resolveDecision(pending, "all-results", {
    rationale: "Use the recommendation.",
    resolvedAt: "2026-07-24T00:01:00.000Z",
  });

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.resolution, { optionId: "all-results", rationale: "Use the recommendation." });
  assert.equal(resolved.resolvedAt, "2026-07-24T00:01:00.000Z");
  assert.equal(resolved.downstreamInvalidation.required, false);
  assert.deepEqual(blockingDecisions([resolved]), []);
  assert.throws(
    () => resolveDecision(pending, "unknown"),
    (error) => error.code === "INVALID_DECISION_RESOLUTION",
  );
});

test("changing a resolved decision carries downstream invalidation metadata", () => {
  const first = resolveDecision(createDecision(decisionInput()), "all-results");
  const metadata = invalidationForDecisionChange(first, "current-page");
  assert.equal(metadata.required, true);
  assert.deepEqual(metadata.targets, ["acceptance", "solution", "context", "verification"]);

  const changed = resolveDecision(first, "current-page");
  assert.equal(changed.resolution.optionId, "current-page");
  assert.equal(changed.downstreamInvalidation.previousResolution, "all-results");
  assert.equal(changed.downstreamInvalidation.nextResolution, "current-page");
  assert.equal(changed.downstreamInvalidation.required, true);
});
