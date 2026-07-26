import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RISK_OVERLAYS,
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

test("Quick guidance keeps known-target work compact without weakening validation", async () => {
  const skill = await readFile(new URL("../skills/openatdd/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /default work budget is one location step/);
  assert.match(skill, /optimization budget, not a correctness cap/);
  assert.match(skill, /known-failing repository-wide check/);
  assert.match(skill, /openatdd validate-finalization/);
  assert.match(skill, /memory .*--limit 5/);
  assert.match(skill, /openatdd finalize <task-id> --fast/);
  assert.match(skill, /resolved\n   `authorization` decision before any product code changes/);
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

test("every allowed Agent task label resolves to the single Luna low read-only scout", () => {
  assert.deepEqual(profileForDispatch({ role: "local-discovery" }), {
    role: "local-discovery",
    profile: "default",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    forkTurns: "none",
    sandbox: "read-only",
    escalation: null,
  });
  for (const role of ["external-research", "independent-review"]) {
    const profile = profileForDispatch({ role, riskSignals: ["security"] });
    assert.equal(profile.profile, "default");
    assert.equal(profile.model, "gpt-5.6-luna");
    assert.equal(profile.reasoningEffort, "low");
    assert.equal(profile.sandbox, "read-only");
    assert.equal(profile.escalation, null);
  }
  assert.throws(
    () => profileForDispatch({ role: "clean-context-execution" }),
    (error) => error.code === "UNKNOWN_AGENT_ROLE",
  );
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
