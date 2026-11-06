import { assert } from "./lib.mjs";

const DEFAULT_SCOUT_PROFILE = Object.freeze({
  profile: "read-only-scout",
  model: null,
  reasoningEffort: null,
  forkTurns: "none",
  sandbox: "read-only",
  writable: false,
  leaf: true,
  canSpawnAgents: false,
  authority: "read-only-discovery",
});

const STANDARD_REVIEW_PROFILE = Object.freeze({
  profile: "review",
  model: null,
  reasoningEffort: null,
  forkTurns: "none",
  sandbox: "read-only",
  writable: false,
  leaf: true,
  canSpawnAgents: false,
  authority: "read-only-independent-review",
});

const DEEP_REVIEW_PROFILE = Object.freeze({
  ...STANDARD_REVIEW_PROFILE,
  profile: "critical-review",
  reasoningEffort: null,
});

const HIGH_REVIEW_RISKS = new Set([
  "authentication", "authorization", "payment", "privacy", "security",
  "migration", "shared-data-migration", "production", "deletion",
  "irreversible", "sensitive-boundary-change", "external-side-effect",
]);

export function acceptanceReviewProfile(input = {}) {
  assert(input.concerns === undefined || (Array.isArray(input.concerns)
    && input.concerns.every((item) => typeof item === "string" && item.trim())),
  "INVALID_REVIEW_CONCERNS", "Review concerns must contain non-empty reasons.");
  const high = (input.riskSignals ?? []).some((risk) => HIGH_REVIEW_RISKS.has(risk))
    || (input.concerns ?? []).some((concern) => typeof concern === "string" && concern.trim());
  return {
    ...(high ? DEEP_REVIEW_PROFILE : STANDARD_REVIEW_PROFILE),
    authority: "read-only-acceptance-review",
  };
}

const BOUNDED_IMPLEMENTATION_PROFILE = Object.freeze({
  profile: "implementation-worker",
  model: null,
  reasoningEffort: null,
  forkTurns: "none",
  sandbox: "workspace-write",
  writable: true,
  leaf: true,
  canSpawnAgents: false,
  authority: "approved-subtask-only",
  escalation: "controller-diagnosis",
});

const COMPLEX_IMPLEMENTATION_PROFILE = Object.freeze({
  ...BOUNDED_IMPLEMENTATION_PROFILE,
  profile: "complex-implementation-worker",
});

const LOW_BROWSER_PROFILE = Object.freeze({
  mode: "browser-low",
  profile: "browser-execution",
  model: null,
  reasoningEffort: null,
  forkTurns: "none",
  sandbox: "read-only",
  capabilities: Object.freeze(["browser"]),
  reuseSession: true,
  screenshotPolicy: "checkpoint-or-failure",
  escalation: "main-on-failure-or-uncertainty",
});

export const AGENT_PROFILE_DEFAULTS = Object.freeze({
  "local-discovery": DEFAULT_SCOUT_PROFILE,
  "external-research": DEFAULT_SCOUT_PROFILE,
  "bounded-implementation": BOUNDED_IMPLEMENTATION_PROFILE,
  "complex-implementation": COMPLEX_IMPLEMENTATION_PROFILE,
});

const LEGACY_AGENT_PROFILE_DEFAULTS = Object.freeze({
  "clean-context-execution": Object.freeze({
    profile: "clean-context-execution",
    model: null,
    reasoningEffort: null,
    forkTurns: "none",
    sandbox: "workspace-write",
  }),
});

export function profileForDispatch(input = {}) {
  const role = String(input.role ?? "").trim();
  const lane = String(input.lane ?? "standard").trim();
  const deliveryVersion = Number(input.deliveryVersion ?? 3);
  const base = role === "acceptance-review"
    ? acceptanceReviewProfile(input)
    : role === "independent-review"
    ? (lane === "deep" ? DEEP_REVIEW_PROFILE : STANDARD_REVIEW_PROFILE)
    : AGENT_PROFILE_DEFAULTS[role]
    ?? (deliveryVersion < 3 ? LEGACY_AGENT_PROFILE_DEFAULTS[role] : undefined);
  assert(base, "UNKNOWN_AGENT_ROLE", `Unknown Agent role: ${role || "missing"}.`);
  return {
    role,
    ...base,
    escalation: base.escalation ?? null,
  };
}

export function verificationExecutionProfile(input = {}) {
  const surface = String(input.surface ?? "cli").trim().toLowerCase();
  const requestedMode = String(input.mode ?? "auto").trim().toLowerCase();
  assert(["auto", "deterministic", "browser-low", "human"].includes(requestedMode), "INVALID_VERIFICATION_EXECUTOR", `Unknown verification execution mode: ${requestedMode || "missing"}.`);
  if (requestedMode === "human" || input.subjectiveVisual === true) {
    return {
      mode: "human",
      model: null,
      reasoningEffort: null,
      reason: "Subjective visual judgment remains as a manual UAT step in the delivery report.",
    };
  }
  if (requestedMode === "deterministic" || surface !== "web" || input.deterministicAvailable === true) {
    return {
      mode: "deterministic",
      model: null,
      reasoningEffort: null,
      reason: surface === "web"
        ? "A stable command-backed browser journey is available, so execution uses no model."
        : `The ${surface || "project"} journey is command-backed and uses no model executor.`,
    };
  }
  return { ...LOW_BROWSER_PROFILE };
}
