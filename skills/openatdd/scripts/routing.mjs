import { assert } from "./lib.mjs";

export const LANES = Object.freeze({
  QUICK: "quick",
  STANDARD: "standard",
  DEEP: "deep",
});

export const HARD_ESCALATORS = Object.freeze([
  "deletion",
  "migration",
  "authentication",
  "authorization",
  "payment",
  "privacy",
  "security",
  "external-service",
  "production",
  "irreversible",
  "public-compatibility",
]);

export const AGENT_POLICIES = Object.freeze({
  [LANES.QUICK]: Object.freeze({
    policy: "none",
    roles: Object.freeze([]),
  }),
  [LANES.STANDARD]: Object.freeze({
    policy: "optional",
    roles: Object.freeze(["independent-review"]),
  }),
  [LANES.DEEP]: Object.freeze({
    policy: "parallel",
    roles: Object.freeze([
      "local-discovery",
      "external-research",
      "clean-context-execution",
      "independent-review",
    ]),
  }),
});

export const INTERACTION_POLICIES = Object.freeze({
  [LANES.QUICK]: Object.freeze({
    approvals: "autonomous",
    contract: "compact",
  }),
  [LANES.STANDARD]: Object.freeze({
    approvals: "human",
    contract: "full",
  }),
  [LANES.DEEP]: Object.freeze({
    approvals: "human",
    contract: "full",
  }),
});

const SCOPES = new Set(["local", "cross-module", "system"]);
const PROJECT_PATTERNS = new Set(["established", "partial", "none"]);
const REVERSIBILITIES = new Set(["reversible", "costly", "irreversible"]);
const UNCERTAINTIES = new Set(["low", "medium", "high"]);
const LANE_VALUES = new Set(Object.values(LANES));
const HARD_ESCALATOR_SET = new Set(HARD_ESCALATORS);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addEnumError(errors, label, value, allowed) {
  if (!allowed.has(value)) {
    errors.push(`${label} must be one of: ${[...allowed].join(", ")}.`);
  }
}

function cloneAgentPolicy(lane) {
  const policy = AGENT_POLICIES[lane];
  return { policy: policy.policy, roles: [...policy.roles] };
}

function cloneInteractionPolicy(lane) {
  const policy = INTERACTION_POLICIES[lane];
  return { approvals: policy.approvals, contract: policy.contract };
}

function collectRiskSignals(assessment) {
  const signals = new Set(assessment.riskSignals ?? []);
  for (const [name, active] of Object.entries(assessment.risks ?? {})) {
    if (active) signals.add(name);
  }
  if (assessment.reversibility === "irreversible") signals.add("irreversible");
  return HARD_ESCALATORS.filter((name) => signals.has(name));
}

function canonicalAssessment(assessment) {
  return {
    scope: assessment.scope,
    projectPattern: assessment.projectPattern,
    reversibility: assessment.reversibility,
    uncertainty: assessment.uncertainty,
    riskSignals: collectRiskSignals(assessment),
  };
}

/**
 * Validate the structured, repository-derived facts used by the routing rules.
 * The function is side-effect free and returns every detected error.
 */
export function validateAssessment(assessment) {
  const errors = [];
  if (!isRecord(assessment)) {
    return { valid: false, errors: ["Assessment must be an object."] };
  }

  addEnumError(errors, "scope", assessment.scope, SCOPES);
  addEnumError(errors, "projectPattern", assessment.projectPattern, PROJECT_PATTERNS);
  addEnumError(errors, "reversibility", assessment.reversibility, REVERSIBILITIES);
  addEnumError(errors, "uncertainty", assessment.uncertainty, UNCERTAINTIES);

  if (assessment.riskSignals !== undefined) {
    if (!Array.isArray(assessment.riskSignals)) {
      errors.push("riskSignals must be an array when provided.");
    } else {
      const seen = new Set();
      for (const signal of assessment.riskSignals) {
        if (!HARD_ESCALATOR_SET.has(signal)) errors.push(`Unknown hard risk signal: ${signal}.`);
        if (seen.has(signal)) errors.push(`Duplicate hard risk signal: ${signal}.`);
        seen.add(signal);
      }
    }
  }

  if (assessment.risks !== undefined) {
    if (!isRecord(assessment.risks)) {
      errors.push("risks must be an object when provided.");
    } else {
      for (const [name, active] of Object.entries(assessment.risks)) {
        if (!HARD_ESCALATOR_SET.has(name)) errors.push(`Unknown hard risk flag: ${name}.`);
        if (typeof active !== "boolean") errors.push(`Hard risk flag ${name} must be boolean.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function agentPolicyForLane(lane) {
  assert(LANE_VALUES.has(lane), "INVALID_ROUTING_LANE", `Unknown routing lane: ${lane}`);
  return cloneAgentPolicy(lane);
}

export function interactionPolicyForLane(lane) {
  assert(LANE_VALUES.has(lane), "INVALID_ROUTING_LANE", `Unknown routing lane: ${lane}`);
  return cloneInteractionPolicy(lane);
}

/**
 * Deterministically classify a task from facts gathered by discovery.
 * No repository access, model judgment, clocks, or environment state is used.
 */
export function classifyTask(assessment) {
  const validation = validateAssessment(assessment);
  assert(validation.valid, "INVALID_ROUTING_ASSESSMENT", "Task routing assessment is invalid.", validation);

  const normalized = canonicalAssessment(assessment);
  const reasons = [];
  let lane;

  for (const signal of normalized.riskSignals) reasons.push(`hard-escalator:${signal}`);

  if (normalized.scope === "system") reasons.push("system-scope");
  if (normalized.uncertainty === "high") reasons.push("high-uncertainty");
  if (normalized.projectPattern === "none" && normalized.scope !== "local") {
    reasons.push("novel-cross-cutting-work");
  }

  if (reasons.length > 0) {
    lane = LANES.DEEP;
  } else {
    const quick = normalized.scope === "local"
      && normalized.projectPattern === "established"
      && normalized.reversibility === "reversible"
      && normalized.uncertainty === "low";

    if (quick) {
      lane = LANES.QUICK;
      reasons.push("local-scope", "established-project-pattern", "low-uncertainty", "reversible");
    } else {
      lane = LANES.STANDARD;
      if (normalized.scope === "cross-module") reasons.push("cross-module-scope");
      if (normalized.projectPattern !== "established") reasons.push(`${normalized.projectPattern}-project-pattern`);
      if (normalized.reversibility === "costly") reasons.push("costly-to-reverse");
      if (normalized.uncertainty === "medium") reasons.push("medium-uncertainty");
      if (reasons.length === 0) reasons.push("standard-by-conservative-default");
    }
  }

  const result = {
    schemaVersion: 1,
    lane,
    reasons,
    assessment: normalized,
    investigation: {
      externalResearch: lane === LANES.DEEP,
    },
    agents: cloneAgentPolicy(lane),
    interaction: interactionPolicyForLane(lane),
  };

  const resultValidation = validateRouting(result);
  assert(resultValidation.valid, "INVALID_ROUTING_RESULT", "Generated task routing is invalid.", resultValidation);
  return result;
}

export function validateRouting(routing) {
  const errors = [];
  if (!isRecord(routing)) return { valid: false, errors: ["Routing result must be an object."] };

  if (routing.schemaVersion !== 1) errors.push("Routing schemaVersion must be 1.");
  if (!LANE_VALUES.has(routing.lane)) errors.push(`Unknown routing lane: ${routing.lane}.`);
  if (!Array.isArray(routing.reasons) || routing.reasons.length === 0 || routing.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
    errors.push("Routing reasons must contain at least one non-empty string.");
  }

  const assessmentValidation = validateAssessment(routing.assessment);
  errors.push(...assessmentValidation.errors.map((error) => `assessment: ${error}`));

  if (!isRecord(routing.investigation) || typeof routing.investigation.externalResearch !== "boolean") {
    errors.push("investigation.externalResearch must be boolean.");
  } else if (LANE_VALUES.has(routing.lane) && routing.investigation.externalResearch !== (routing.lane === LANES.DEEP)) {
    errors.push("External research policy does not match the routing lane.");
  }

  if (!isRecord(routing.agents) || !Array.isArray(routing.agents.roles) || typeof routing.agents.policy !== "string") {
    errors.push("agents must contain a policy and roles array.");
  } else if (LANE_VALUES.has(routing.lane)) {
    const expected = AGENT_POLICIES[routing.lane];
    if (routing.agents.policy !== expected.policy || JSON.stringify(routing.agents.roles) !== JSON.stringify(expected.roles)) {
      errors.push("Agent policy does not match the routing lane.");
    }
  }

  if (!isRecord(routing.interaction) || typeof routing.interaction.approvals !== "string" || typeof routing.interaction.contract !== "string") {
    errors.push("interaction must contain approvals and contract policies.");
  } else if (LANE_VALUES.has(routing.lane)) {
    const expected = INTERACTION_POLICIES[routing.lane];
    if (routing.interaction.approvals !== expected.approvals || routing.interaction.contract !== expected.contract) {
      errors.push("Interaction policy does not match the routing lane.");
    }
  }

  return { valid: errors.length === 0, errors };
}
