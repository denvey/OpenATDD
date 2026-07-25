import { assert } from "./lib.mjs";

export const DECISION_OWNERS = Object.freeze({
  HUMAN: "human",
  AGENT: "agent",
  AUTHORIZATION: "authorization",
});

export const DECISION_STATUSES = Object.freeze({
  PENDING: "pending",
  RESOLVED: "resolved",
});

export const INVALIDATION_TARGETS = Object.freeze([
  "acceptance",
  "solution",
  "context",
  "verification",
]);

const OWNER_VALUES = new Set(Object.values(DECISION_OWNERS));
const STATUS_VALUES = new Set(Object.values(DECISION_STATUSES));
const INVALIDATION_TARGET_SET = new Set(INVALIDATION_TARGETS);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function validTimestamp(value) {
  return value === undefined || (nonEmpty(value) && !Number.isNaN(Date.parse(value)));
}

function trimIfString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeResolution(resolution, rationale) {
  if (resolution === undefined || resolution === null) return null;
  if (typeof resolution === "string") return { optionId: resolution, rationale: trimIfString(rationale) || undefined };
  if (!isRecord(resolution)) return resolution;
  return {
    optionId: resolution.optionId,
    rationale: trimIfString(resolution.rationale) || undefined,
  };
}

function normalizeOption(option) {
  if (!isRecord(option)) return option;
  return {
    id: option.id,
    label: trimIfString(option.label),
    consequence: trimIfString(option.consequence),
  };
}

function normalizeTargets(targets) {
  if (targets === undefined) return [...INVALIDATION_TARGETS];
  return Array.isArray(targets) ? [...new Set(targets)] : targets;
}

export function validateDecision(decision) {
  const errors = [];
  if (!isRecord(decision)) return { valid: false, errors: ["Decision must be an object."] };

  if (decision.schemaVersion !== 1) errors.push("Decision schemaVersion must be 1.");
  if (!/^DEC-\d{3,}$/.test(decision.id ?? "")) errors.push("Decision id must use DEC- followed by at least three digits.");
  if (!OWNER_VALUES.has(decision.owner)) errors.push("Decision owner must be human, agent, or authorization.");
  if (!STATUS_VALUES.has(decision.status)) errors.push("Decision status must be pending or resolved.");
  if (typeof decision.blocking !== "boolean") errors.push("Decision blocking must be boolean.");
  if (!nonEmpty(decision.question)) errors.push("Decision question is required.");

  if (!Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 3) {
    errors.push("A decision requires two or three options.");
  } else {
    const ids = new Set();
    for (const [index, option] of decision.options.entries()) {
      if (!isRecord(option)) {
        errors.push(`Option ${index + 1} must be an object.`);
        continue;
      }
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(option.id ?? "")) errors.push(`Option ${index + 1} has an invalid id.`);
      if (ids.has(option.id)) errors.push(`Duplicate decision option: ${option.id}.`);
      ids.add(option.id);
      if (!nonEmpty(option.label)) errors.push(`Option ${option.id ?? index + 1} requires a label.`);
      if (!nonEmpty(option.consequence)) errors.push(`Option ${option.id ?? index + 1} requires a consequence.`);
    }

    if (!ids.has(decision.recommendation)) errors.push("Decision recommendation must name one of the options.");
    if (decision.resolution !== null && decision.resolution !== undefined && !ids.has(decision.resolution?.optionId)) {
      errors.push("Decision resolution must name one of the options.");
    }
  }

  if (!nonEmpty(decision.recommendationBasis)) errors.push("Decision recommendationBasis is required.");
  if (decision.status === DECISION_STATUSES.PENDING && decision.resolution !== null) {
    errors.push("A pending decision cannot have a resolution.");
  }
  if (decision.status === DECISION_STATUSES.RESOLVED && !isRecord(decision.resolution)) {
    errors.push("A resolved decision requires a resolution.");
  }
  if (decision.resolution?.rationale !== undefined && !nonEmpty(decision.resolution.rationale)) {
    errors.push("Resolution rationale cannot be blank.");
  }
  if (!validTimestamp(decision.createdAt)) errors.push("createdAt must be a valid timestamp when provided.");
  if (!validTimestamp(decision.resolvedAt)) errors.push("resolvedAt must be a valid timestamp when provided.");
  if (decision.status === DECISION_STATUSES.PENDING && decision.resolvedAt !== undefined) {
    errors.push("A pending decision cannot have resolvedAt.");
  }

  if (!Array.isArray(decision.invalidationTargets) || decision.invalidationTargets.length === 0) {
    errors.push("Decision invalidationTargets must be a non-empty array.");
  } else {
    const targets = new Set();
    for (const target of decision.invalidationTargets) {
      if (!INVALIDATION_TARGET_SET.has(target)) errors.push(`Unknown invalidation target: ${target}.`);
      if (targets.has(target)) errors.push(`Duplicate invalidation target: ${target}.`);
      targets.add(target);
    }
  }

  if (decision.downstreamInvalidation !== undefined) {
    const invalidation = decision.downstreamInvalidation;
    if (!isRecord(invalidation) || typeof invalidation.required !== "boolean" || !Array.isArray(invalidation.targets)) {
      errors.push("downstreamInvalidation must contain required and targets.");
    } else {
      if (invalidation.required && invalidation.targets.length === 0) {
        errors.push("Required downstream invalidation must name at least one target.");
      }
      if (!invalidation.required && invalidation.targets.length > 0) {
        errors.push("Non-required downstream invalidation cannot name targets.");
      }
      for (const target of invalidation.targets) {
        if (!INVALIDATION_TARGET_SET.has(target)) errors.push(`Unknown downstream invalidation target: ${target}.`);
      }
      if (invalidation.decisionId !== decision.id) errors.push("downstreamInvalidation decisionId must match the decision.");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function createDecision(input) {
  assert(isRecord(input), "INVALID_DECISION", "Decision input must be an object.");
  const resolution = normalizeResolution(input.resolution, input.rationale);
  const status = input.status ?? (resolution ? DECISION_STATUSES.RESOLVED : DECISION_STATUSES.PENDING);
  const decision = {
    schemaVersion: 1,
    id: input.id,
    owner: input.owner,
    status,
    blocking: input.blocking ?? input.owner !== DECISION_OWNERS.AGENT,
    question: trimIfString(input.question),
    options: Array.isArray(input.options) ? input.options.map(normalizeOption) : input.options,
    recommendation: input.recommendation,
    recommendationBasis: trimIfString(input.recommendationBasis),
    resolution,
    invalidationTargets: normalizeTargets(input.invalidationTargets),
  };
  if (input.createdAt !== undefined) decision.createdAt = input.createdAt;
  if (input.resolvedAt !== undefined) decision.resolvedAt = input.resolvedAt;

  const validation = validateDecision(decision);
  assert(validation.valid, "INVALID_DECISION", "Decision record is invalid.", validation);
  return decision;
}

export function invalidationForDecisionChange(decision, nextOptionId) {
  const validation = validateDecision(decision);
  assert(validation.valid, "INVALID_DECISION", "Decision record is invalid.", validation);
  assert(
    decision.options.some((option) => option.id === nextOptionId),
    "INVALID_DECISION_RESOLUTION",
    `Unknown decision option: ${nextOptionId}`,
  );

  const previousResolution = decision.resolution?.optionId ?? null;
  const required = previousResolution !== null && previousResolution !== nextOptionId;
  return {
    required,
    decisionId: decision.id,
    previousResolution,
    nextResolution: nextOptionId,
    targets: required ? [...decision.invalidationTargets] : [],
    reason: required ? "A resolved decision changed; dependent artifacts must be regenerated and reapproved." : null,
  };
}

export function resolveDecision(decision, optionId, metadata = {}) {
  const invalidation = invalidationForDecisionChange(decision, optionId);
  const resolved = {
    ...decision,
    status: DECISION_STATUSES.RESOLVED,
    resolution: {
      optionId,
      rationale: trimIfString(metadata.rationale) || undefined,
    },
    downstreamInvalidation: invalidation,
  };
  if (metadata.resolvedAt !== undefined) resolved.resolvedAt = metadata.resolvedAt;

  const validation = validateDecision(resolved);
  assert(validation.valid, "INVALID_DECISION", "Resolved decision record is invalid.", validation);
  return resolved;
}

export function pendingDecisions(decisions, options = {}) {
  assert(Array.isArray(decisions), "INVALID_DECISIONS", "Decisions must be an array.");
  if (options.owner !== undefined) {
    assert(OWNER_VALUES.has(options.owner), "INVALID_DECISION_OWNER", `Unknown decision owner: ${options.owner}`);
  }
  return decisions.filter((decision) => {
    const validation = validateDecision(decision);
    assert(validation.valid, "INVALID_DECISION", `Decision ${decision?.id ?? "<unknown>"} is invalid.`, validation);
    return decision.status === DECISION_STATUSES.PENDING
      && (options.owner === undefined || decision.owner === options.owner)
      && (!options.blockingOnly || decision.blocking);
  });
}

export function blockingDecisions(decisions) {
  return pendingDecisions(decisions, { blockingOnly: true });
}
