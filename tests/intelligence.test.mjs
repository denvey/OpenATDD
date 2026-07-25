import assert from "node:assert/strict";
import test from "node:test";
import {
  HARD_ESCALATORS,
  classifyTask,
  validateAssessment,
  validateRouting,
} from "../skills/openatdd/scripts/routing.mjs";
import { profileForDispatch } from "../skills/openatdd/scripts/agent-profiles.mjs";
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

test("routing classifies a local established low-risk task as quick", () => {
  const routing = classifyTask(assessment());
  assert.equal(routing.schemaVersion, 1);
  assert.equal(routing.lane, "quick");
  assert.equal(routing.investigation.externalResearch, false);
  assert.deepEqual(routing.agents, { policy: "none", roles: [] });
  assert.deepEqual(routing.interaction, { approvals: "autonomous", contract: "compact" });
  assert.equal(validateRouting(routing).valid, true);
});

test("routing classifies ordinary cross-module work as standard", () => {
  const routing = classifyTask(assessment({ scope: "cross-module", uncertainty: "medium" }));
  assert.equal(routing.lane, "standard");
  assert.equal(routing.investigation.externalResearch, false);
  assert.deepEqual(routing.agents, { policy: "optional", roles: ["independent-review"] });
  assert.deepEqual(routing.interaction, { approvals: "human", contract: "full" });
  assert(routing.reasons.includes("cross-module-scope"));
});

test("routing classifies novel cross-cutting work as deep", () => {
  const routing = classifyTask(assessment({ scope: "cross-module", projectPattern: "none" }));
  assert.equal(routing.lane, "deep");
  assert.equal(routing.investigation.externalResearch, true);
  assert.equal(routing.agents.policy, "parallel");
  assert.deepEqual(routing.interaction, { approvals: "human", contract: "full" });
  assert(routing.agents.roles.includes("external-research"));
  assert(routing.agents.roles.includes("clean-context-execution"));
});

test("every hard risk deterministically escalates to deep", async (t) => {
  for (const signal of HARD_ESCALATORS) {
    await t.test(signal, () => {
      const routing = classifyTask(assessment({ riskSignals: [signal] }));
      assert.equal(routing.lane, "deep");
      assert(routing.reasons.includes(`hard-escalator:${signal}`));
    });
  }
});

test("Agent profiles route exploration to Luna, execution and review to Terra, and escalate only bounded high-risk work", () => {
  assert.deepEqual(profileForDispatch({ role: "local-discovery" }), {
    role: "local-discovery",
    profile: "local-discovery",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    forkTurns: "none",
    sandbox: "read-only",
    escalation: null,
  });
  assert.equal(profileForDispatch({ role: "clean-context-execution" }).model, "gpt-5.6-terra");
  assert.equal(profileForDispatch({ role: "independent-review" }).reasoningEffort, "high");

  const highRiskReview = profileForDispatch({ role: "independent-review", riskSignals: ["security"] });
  assert.equal(highRiskReview.model, "gpt-5.6-sol");
  assert.equal(highRiskReview.escalation, "hard-risk-independent-review");

  const escalatedRepair = profileForDispatch({
    role: "clean-context-execution",
    repairAttempts: [{ outcome: "failed" }, { outcome: "no-progress" }],
  });
  assert.equal(escalatedRepair.model, "gpt-5.6-sol");
  assert.equal(escalatedRepair.escalation, "two-consecutive-failed-repairs");
  assert.equal(profileForDispatch({
    role: "clean-context-execution",
    repairAttempts: [{ outcome: "failed" }, { outcome: "progress" }],
  }).model, "gpt-5.6-terra");
});

test("irreversible assessment escalates even without a duplicated risk flag", () => {
  const routing = classifyTask(assessment({ reversibility: "irreversible" }));
  assert.equal(routing.lane, "deep");
  assert.deepEqual(routing.assessment.riskSignals, ["irreversible"]);
});

test("routing assessment validation rejects unknown and malformed risk input", () => {
  const invalid = validateAssessment(assessment({ riskSignals: ["mystery"], risks: { deletion: "yes" } }));
  assert.equal(invalid.valid, false);
  assert(invalid.errors.some((error) => error.includes("Unknown hard risk signal")));
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
  const authorization = createDecision(decisionInput({ id: "DEC-003", owner: "authorization" }));

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
