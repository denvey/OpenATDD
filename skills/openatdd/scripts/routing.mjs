import { assert } from "./lib.mjs";

export const LANES = Object.freeze({
  QUICK: "quick",
  STANDARD: "standard",
  DEEP: "deep",
});

export const RISK_OVERLAYS = Object.freeze([
  "migration",
  "authentication",
  "authorization",
  "payment",
  "privacy",
  "security",
  "external-service",
  "deletion",
  "production",
  "irreversible",
  "public-compatibility",
  "sensitive-boundary-change",
  "shared-data-migration",
  "external-side-effect",
]);

export const RISK_SIGNALS = RISK_OVERLAYS;

/**
 * Overlays that describe a materially dangerous or externally mutating change.
 * They never change the lane, but they do require a recorded and resolved
 * authorization decision before product code may be modified.
 */
export const AUTHORIZATION_OVERLAYS = Object.freeze([
  "deletion",
  "production",
  "irreversible",
  "shared-data-migration",
  "external-side-effect",
]);

export const AGENT_POLICIES = Object.freeze({
  [LANES.QUICK]: Object.freeze({
    policy: "none",
    roles: Object.freeze([]),
  }),
  [LANES.STANDARD]: Object.freeze({
    policy: "optional",
    roles: Object.freeze([
      "independent-review",
      "bounded-implementation",
      "complex-implementation",
    ]),
  }),
  [LANES.DEEP]: Object.freeze({
    policy: "parallel",
    roles: Object.freeze([
      "local-discovery",
      "external-research",
      "independent-review",
      "bounded-implementation",
      "complex-implementation",
    ]),
  }),
});

export const CONTROLLER_PROFILES = Object.freeze({
  [LANES.QUICK]: Object.freeze({
    profile: "sol-controller",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    forkTurns: "none",
    sandbox: "workspace-write",
  }),
  [LANES.STANDARD]: Object.freeze({
    profile: "sol-critical-controller",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "none",
    sandbox: "workspace-write",
  }),
  [LANES.DEEP]: Object.freeze({
    profile: "sol-critical-controller",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "none",
    sandbox: "workspace-write",
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
const RISK_OVERLAY_SET = new Set(RISK_OVERLAYS);
const RISK_SIGNAL_SET = new Set(RISK_SIGNALS);
const AUTHORIZATION_OVERLAY_SET = new Set(AUTHORIZATION_OVERLAYS);

/**
 * Return the recorded overlays that require an explicit authorization decision.
 * Accepts either a routing record or a bare signal list so persisted schema-v1
 * tasks without `riskOverlays` still resolve from `assessment.riskSignals`.
 * `additional` extends the built-in set with project-configured overlays; the
 * configuration can only tighten the requirement, never remove a built-in one.
 */
export function authorizationOverlays(source, additional = []) {
  const signals = Array.isArray(source)
    ? source
    : source?.riskOverlays ?? source?.assessment?.riskSignals ?? [];
  const required = new Set([...AUTHORIZATION_OVERLAYS, ...additional]);
  return RISK_OVERLAYS.filter((signal) => required.has(signal) && signals.includes(signal));
}

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

function cloneControllerProfile(lane) {
  return { ...CONTROLLER_PROFILES[lane] };
}

function collectRiskSignals(assessment) {
  const signals = new Set(assessment.riskSignals ?? []);
  for (const [name, active] of Object.entries(assessment.risks ?? {})) {
    if (active) signals.add(name);
  }
  if (assessment.reversibility === "irreversible") signals.add("irreversible");
  return RISK_SIGNALS.filter((name) => signals.has(name));
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
        if (!RISK_SIGNAL_SET.has(signal)) errors.push(`Unknown risk signal: ${signal}.`);
        if (seen.has(signal)) errors.push(`Duplicate risk signal: ${signal}.`);
        seen.add(signal);
      }
    }
  }

  if (assessment.risks !== undefined) {
    if (!isRecord(assessment.risks)) {
      errors.push("risks must be an object when provided.");
    } else {
      for (const [name, active] of Object.entries(assessment.risks)) {
        if (!RISK_SIGNAL_SET.has(name)) errors.push(`Unknown risk flag: ${name}.`);
        if (typeof active !== "boolean") errors.push(`Risk flag ${name} must be boolean.`);
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

export function controllerProfileForLane(lane) {
  assert(LANE_VALUES.has(lane), "INVALID_ROUTING_LANE", `Unknown routing lane: ${lane}`);
  return cloneControllerProfile(lane);
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
      && normalized.uncertainty === "low";

    if (quick) {
      lane = LANES.QUICK;
      reasons.push("local-scope", "established-project-pattern", "low-uncertainty");
    } else {
      lane = LANES.STANDARD;
      if (normalized.scope === "cross-module") reasons.push("cross-module-scope");
      if (normalized.projectPattern !== "established") reasons.push(`${normalized.projectPattern}-project-pattern`);
      if (normalized.uncertainty === "medium") reasons.push("medium-uncertainty");
      if (reasons.length === 0) reasons.push("standard-by-conservative-default");
    }
  }

  const result = {
    schemaVersion: 1,
    lane,
    reasons,
    assessment: normalized,
    riskOverlays: normalized.riskSignals.filter((signal) => RISK_OVERLAY_SET.has(signal)),
    investigation: {
      externalResearch: lane === LANES.DEEP,
    },
    controller: cloneControllerProfile(lane),
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

  if (routing.riskOverlays !== undefined) {
    const expected = routing.assessment?.riskSignals?.filter((signal) => RISK_OVERLAY_SET.has(signal)) ?? [];
    if (!Array.isArray(routing.riskOverlays)
      || routing.riskOverlays.some((signal) => !RISK_OVERLAY_SET.has(signal))
      || JSON.stringify(routing.riskOverlays) !== JSON.stringify(expected)) {
      errors.push("riskOverlays must match assessment.riskSignals.");
    }
  }

  if (!isRecord(routing.investigation) || typeof routing.investigation.externalResearch !== "boolean") {
    errors.push("investigation.externalResearch must be boolean.");
  } else if (LANE_VALUES.has(routing.lane) && routing.investigation.externalResearch !== (routing.lane === LANES.DEEP)) {
    errors.push("External research policy does not match the routing lane.");
  }

  if (!isRecord(routing.controller)) {
    errors.push("controller must contain the authoritative controller profile.");
  } else if (LANE_VALUES.has(routing.lane)) {
    const expected = CONTROLLER_PROFILES[routing.lane];
    for (const key of ["profile", "model", "reasoningEffort", "forkTurns", "sandbox"]) {
      if (routing.controller[key] !== expected[key]) errors.push(`Controller ${key} does not match the routing lane.`);
    }
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
